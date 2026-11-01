import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab} from '../experiments/durable-admission-outbox-lab.mjs';

const NOW=1793450000500;
const UID='device-stage-a';
const FRAME=(n=1,overrides={})=>({sequence:n,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...overrides});
function setup(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-admission-v1-'));
  const key=randomBytes(32),pair=generateKeyPairSync('ed25519');
  const registry=new Map([[UID,{enabled:true,scope:'prototype-ingest-v1',epoch:1,publicKey:pair.publicKey}]]);
  let clock=NOW;
  const create=opts=>createDurableAdmissionOutboxLab({directory:dir,integrityKey:key,identities:registry,clock:()=>clock,...opts});
  const signed=(seq=1,overrides={})=>{
    const envelope={version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,observedAtMs:clock-1000,frame:FRAME(seq,overrides)};
    const canonical=canonicalOfflineEnvelope(envelope);
    return {envelope,signature:sign(null,Buffer.from(canonical),pair.privateKey).toString('base64url')};
  };
  try{return fn({dir,key,pair,registry,create,signed,now:x=>{clock=x;}});}finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

test('no implicit commission, explicit fresh local journal and durable complete reading',()=>setup(x=>{
  const journal=x.create();
  assert.deepEqual(journal.accept(x.signed()),{accepted:false,reason:'admission-journal-unavailable'});
  assert.throws(()=>journal.pending(UID));
  assert.deepEqual(journal.commission(),{commissioned:true});
  assert.throws(()=>journal.commission());
  const sample=x.signed();
  const stored=journal.accept(sample);
  assert.equal(stored.accepted,true);
  assert.equal(stored.kind,'LOCAL_DURABLE_ADMISSION_ONLY');
  assert.equal(stored.sequence,1);
  assert.equal(stored.digest,createHash('sha256').update(canonicalOfflineEnvelope(sample.envelope)).digest('hex'));
  const records=journal.pending(UID);
  assert.equal(records.length,1);
  assert.deepEqual(records[0].envelope,sample.envelope);
  assert.equal(records[0].signature,sample.signature);
  assert.equal(records[0].digest,stored.digest);
  const rebooted=x.create();
  assert.deepEqual(rebooted.pending(UID),records);
  assert.deepEqual(rebooted.accept(sample),{accepted:false,reason:'replay-or-out-of-order'});
  assert.equal(rebooted.pending(UID).length,1);
}));

test('signed records remain monotonic and survive independent instance restart',()=>setup(x=>{
  const journal=x.create();journal.commission();
  for(const n of [1,2,4])assert.equal(journal.accept(x.signed(n)).accepted,true);
  assert.deepEqual(x.create().pending(UID).map(e=>e.sequence),[1,2,4]);
  assert.equal(x.create().accept(x.signed(3)).reason,'replay-or-out-of-order');
  assert.equal(x.create().accept(x.signed(4)).reason,'replay-or-out-of-order');
}));

test('forgery, modified risk, unexpected private keys and malformed fields deny without commit',()=>setup(x=>{
  const journal=x.create();journal.commission();
  const s=x.signed();
  assert.equal(journal.accept({...s,signature:'A'.repeat(86)}).reason,'signature-invalid');
  assert.equal(journal.accept({...s,envelope:{...s.envelope,frame:FRAME(1,{risk:'SAFE'})}}).reason,'invalid-source-frame');
  assert.equal(journal.accept({...s,envelope:{...s.envelope,frame:{...FRAME(1),wifi:'PRIVATE'}}}).reason,'invalid-source-frame');
  assert.equal(journal.accept({...s,envelope:{...s.envelope,frame:{...FRAME(1),gateCommand:'OPEN'}}}).reason,'invalid-source-frame');
  assert.deepEqual(journal.pending(UID),[]);
  assert.equal(journal.accept(s).accepted,true);
}));

test('revocation, scope, epoch and registry outage fail closed',()=>setup(x=>{
  const journal=x.create();journal.commission();
  const old=x.registry.get(UID);
  x.registry.set(UID,{...old,enabled:false});
  assert.equal(journal.accept(x.signed()).reason,'identity-not-authorized');
  x.registry.set(UID,{...old,scope:'read-only'});
  assert.equal(journal.accept(x.signed()).reason,'identity-not-authorized');
  x.registry.set(UID,{...old,epoch:2});
  assert.equal(journal.accept(x.signed()).reason,'identity-not-authorized');
  x.registry.set(UID,old);
  assert.equal(journal.accept(x.signed()).accepted,true);
  const newPair=generateKeyPairSync('ed25519');
  x.registry.set(UID,{...old,publicKey:newPair.publicKey});
  assert.equal(journal.accept(x.signed(2)).reason,'signature-invalid');
  const newEnv=x.signed(2).envelope;
  const forgedValid={envelope:newEnv,signature:sign(null,Buffer.from(canonicalOfflineEnvelope(newEnv)),newPair.privateKey).toString('base64url')};
  assert.equal(journal.accept(forgedValid).reason,'identity-rotation-requires-operator');
  assert.equal(journal.pending(UID).length,1);
}));

test('clock unavailability, old/future samples and missing signer deny',()=>setup(x=>{
  const journal=x.create();journal.commission();
  const old=x.signed();
  x.now(NOW+40000);
  assert.equal(journal.accept(old).reason,'source-clock-unverified');
  x.now(NOW-10000);
  assert.equal(journal.accept(old).reason,'source-clock-unverified');
  x.now(NOW);
  assert.equal(journal.accept({...old,signature:null}).reason,'signature-invalid');
  assert.equal(journal.accept(old).accepted,true);
}));

test('outbox backpressure refuses ninth accepted reading instead of dropping earlier data',()=>setup(x=>{
  const journal=x.create();journal.commission();
  for(let n=1;n<=8;n++)assert.equal(journal.accept(x.signed(n)).accepted,true);
  assert.equal(journal.accept(x.signed(9)).reason,'outbox-capacity-reached');
  assert.deepEqual(journal.pending(UID).map(x=>x.sequence),[1,2,3,4,5,6,7,8]);
}));

test('journal tampering cannot be interpreted as an empty first run',()=>setup(x=>{
  const journal=x.create();journal.commission();journal.accept(x.signed());
  const file=path.join(x.dir,'durable-admission-outbox-lab.json');
  const serialized=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,serialized.replace('WARNING','SAFE'));
  assert.deepEqual(journal.accept(x.signed(2)),{accepted:false,reason:'admission-journal-unavailable'});
  assert.throws(()=>journal.pending(UID));
  assert.throws(()=>journal.commission());
  assert.equal(fs.readFileSync(file,'utf8').includes('SAFE'),true);
}));

test('loss of the on-disk journal cannot silently reconstruct high-water history',()=>setup(x=>{
  const journal=x.create();journal.commission();journal.accept(x.signed());
  fs.unlinkSync(path.join(x.dir,'durable-admission-outbox-lab.json'));
  assert.equal(journal.accept(x.signed(2)).reason,'admission-journal-unavailable');
  assert.throws(()=>journal.pending(UID));
}));

test('symlinked journal, stale lock and wrong key refuse operation',()=>setup(x=>{
  const journal=x.create();journal.commission();journal.accept(x.signed());
  const different=x.create({integrityKey:randomBytes(32)});
  assert.equal(different.accept(x.signed(2)).reason,'admission-journal-unavailable');
  const lock=path.join(x.dir,'durable-admission-outbox-lab.lock');
  fs.writeFileSync(lock,'stale lock',{mode:0o600});
  assert.equal(journal.accept(x.signed(2)).reason,'admission-journal-unavailable');
  assert.throws(()=>journal.pending(UID));
  fs.unlinkSync(lock);
  const file=path.join(x.dir,'durable-admission-outbox-lab.json');
  fs.renameSync(file,file+'.bak');
  fs.symlinkSync(file+'.bak',file);
  assert.equal(journal.accept(x.signed(2)).reason,'admission-journal-unavailable');
  assert.throws(()=>journal.pending(UID));
}));

test('directory must not be writable by others',()=>setup(x=>{
  fs.chmodSync(x.dir,0o777);
  assert.throws(()=>x.create(),/Unsafe admission directory/);
  fs.chmodSync(x.dir,0o700);
}));

test('journal has no network, Firebase Admin, actuator or notification API',()=>{
  const src=fs.readFileSync('experiments/durable-admission-outbox-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|fetch\s*\(|https\.request|servo\.write|sendMessage\s*\(/);
  assert.doesNotMatch(src,/\.remove\s*\(|\.ref\s*\(/);
});
