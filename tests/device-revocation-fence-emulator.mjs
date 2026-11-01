// FloodGuard publisher-lease revocation integration on REAL RTDB Emulator.
// Tests Auth Rules enforcement (no admin publisher writes) with synthetic
// staged device/issuer keys. Not a public service or production deployment.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {generateKeyPairSync,randomBytes,sign,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {DEVICE_FENCED_CAPSULE_ROOT as ROOT,deriveDeviceRevocationCapsuleLab,
  observeDeviceRevocationCapsuleLab}
  from '../experiments/device-revocation-fence-lab.mjs';

if(process.env.FG_REVOKE_FENCE_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Requires opt-in demo Firebase database Emulator at loopback');

const UID='device-stage-a',LEASE='lease-stage-first',NOW=1793450000500;
let env,source,issuer,binding,outbox,folder,publisher,operator,guest;
const digest=x=>createHash('sha256').update(x).digest('hex');
const fp=k=>digest(k.export({type:'spki',format:'der'}));
const starting=()=>({
  authority:{deviceId:UID,epoch:1,enabled:true,
    leaseId:LEASE,receiptSignerFingerprint:fp(issuer.publicKey)},
  device:{deviceId:UID,epoch:1,enabled:true,
    sourceKeyFingerprint:fp(source.publicKey)},
  public:{
    water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
    system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'}
  },
  checkpoint:{initialized:false,epoch:1}
});
async function fixtureRead(fn){
  let value;
  await env.withSecurityRulesDisabled(async ctx=>{value=await fn(ctx.database());});
  return value;
}
const readProtected=()=>fixtureRead(async db=>
  (await db.ref(ROOT).get()).val());
const readPublisher=async()=> (await publisher.ref(ROOT).get()).val();
const publisherCtx=(lease=LEASE,epoch=1)=>env.authenticatedContext(
  'publisher-stage-a',
  {fgCapsulePublisher:true,fgLeaseId:lease,fgPublisherEpoch:epoch}
).database();
function packet(sequence=1,fields={}){
  const envelope={version:'floodguard-offline-envelope-v1',
    deviceId:UID,epoch:1,observedAtMs:NOW-1200+sequence*300,
    frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...fields}};
  const signature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
    source.privateKey).toString('base64url');
  const accepted=outbox.accept({envelope,signature});
  assert.equal(accepted.accepted,true,JSON.stringify(accepted));
  const pending=outbox.pending(UID).find(e=>e.sequence===sequence);
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
    epoch:1,sequence,digest:pending.digest,acceptedAtMs:NOW+50};
  const receiptSignature=sign(null,Buffer.from(JSON.stringify(receipt)),
    issuer.privateKey).toString('base64url');
  return {pending,receipt,receiptSignature};
}
function propose(state,p,lease=LEASE,override={}){
  return deriveDeviceRevocationCapsuleLab({
    current:state,publisherLease:lease,pending:p.pending,receipt:p.receipt,
    receiptSignature:p.receiptSignature,sourceBinding:binding,
    trustedReceiptKey:issuer.publicKey,nowMs:NOW+100,...override
  });
}
async function publish(p,db=publisher,lease=LEASE){
  const ref=db.ref(ROOT);
  const initial=(await assertSucceeds(ref.get())).val();
  assert.ok(initial?.authority&&initial?.public&&initial?.checkpoint);
  let last={allowed:false,reason:'not-called'};
  const listener=()=>{};
  // Hold an authorized read listener throughout the transaction to avoid
  // premature null local cache callbacks in the Firebase SDK.
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Emulator listener timeout')),4000);
    const once=()=>{clearTimeout(timeout);resolve();};
    listener.value=once;
    ref.on('value',once,e=>{clearTimeout(timeout);reject(e);});
  });
  try{
    const result=await ref.transaction(current=>{
      last=propose(current,p,lease);
      return last.allowed===true?last.next:undefined;
    },undefined,false);
    return {committed:result.committed,reason:last.reason};
  }finally{ref.off('value',listener.value);}
}
async function revoked(){
  await assertSucceeds(operator.ref(ROOT+'/authority/enabled').set(false));
}
async function revokeDevice(){
  await assertSucceeds(operator.ref(ROOT+'/device/enabled').set(false));
}
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-fg-device-revocation-fence',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/device-revocation-fence-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  folder=mkdtempSync(path.join(os.tmpdir(),'fg-revoke-fence-'));
  source=generateKeyPairSync('ed25519');
  issuer=generateKeyPairSync('ed25519');
  binding={deviceId:UID,epoch:1,enabled:true,
    scope:'prototype-ingest-v1',publicKey:source.publicKey};
  outbox=createDurableAdmissionOutboxLab({
    directory:folder,clock:()=>NOW,integrityKey:randomBytes(32),
    identities:new Map([[UID,binding]])
  });
  outbox.commission();
  await fixtureRead(db=>db.ref('/').set({
    floodguard:{privateIngest:{wifi:'SYNTHETIC_PRIVATE',ip:'127.0.0.2'},
      deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}}},
    floodguardPublicationLabV4:starting()
  }));
  publisher=publisherCtx();
  operator=env.authenticatedContext('operator-stage-a',
    {fgCapsuleOperator:true}).database();
  guest=env.unauthenticatedContext().database();
});
afterEach(()=>{if(folder)rmSync(folder,{recursive:true,force:true});});

test('lease-bound publisher publishes one signed frame with no Admin bypass',async()=>{
  const p=packet();
  const result=await publish(p);
  assert.equal(result.committed,true,result.reason);
  const state=await readPublisher();
  assert.equal(state.public.water.status,'WARNING');
  assert.equal(state.authority.enabled,true);
  assert.equal(state.history.entries.s_1.digest,p.pending.digest);
  assert.equal(state.checkpoint.digest,p.pending.digest);
  const observed=observeDeviceRevocationCapsuleLab({
    current:state,publisherLease:LEASE,pending:p.pending,sourceBinding:binding,
    trustedReceiptKey:issuer.publicKey,nowMs:NOW+100
  });
  assert.equal(observed.observed,true,JSON.stringify(observed));
  assert.equal(observed.canAcknowledge,false);
  assert.equal(outbox.pending(UID).length,1);
});

test('revocation by independent operator immediately denies previously issued publisher token',async()=>{
  const p=packet();
  assert.equal((await publish(p)).committed,true);
  const before=await readProtected();
  await revoked();
  const after=await readProtected();
  assert.equal(after.authority.enabled,false);
  assert.deepEqual(after.public,before.public);
  assert.deepEqual(after.history,before.history);
  await assertFails(publisher.ref(ROOT).get());
  await assertFails(publisher.ref(ROOT).set(before));
  await assertFails(publisher.ref(ROOT+'/public/water/status').set('SAFE'));
  assert.equal(outbox.pending(UID).length,1);
});

test('stale candidate calculated before durable revocation cannot overwrite it',async()=>{
  const p=packet();
  const before=await readPublisher();
  const plan=propose(before,p);
  assert.equal(plan.allowed,true,JSON.stringify(plan));
  await revoked();
  await assertFails(publisher.ref(ROOT).set(plan.next));
  const final=await readProtected();
  assert.equal(final.authority.enabled,false);
  assert.equal(final.history,undefined);
  assert.equal(final.public.water.status,'SAFE');
  assert.equal(outbox.pending(UID).length,1);
});

test('publisher cannot alter authority, disable revocation, delete root or create private extras',async()=>{
  const original=await readPublisher();
  for(const edit of [
    s=>{s.authority.enabled=false;},
    s=>{s.authority.epoch=2;},
    s=>{s.authority.leaseId='lease-stage-hijacked';},
    s=>{s.authority.receiptSignerFingerprint='a'.repeat(64);},
    s=>{delete s.authority;},
    s=>{s.authority.wifi='PRIVATE';}
  ]){
    const modified=structuredClone(original);edit(modified);
    await assertFails(publisher.ref(ROOT).set(modified));
  }
  await assertFails(publisher.ref(ROOT).remove());
  await assertFails(publisher.ref(ROOT+'/authority/enabled').remove());
  await assertFails(publisher.ref(ROOT+'/authority/enabled').set(false));
  await assertFails(publisher.ref(ROOT+'/privateIngest').set({wifi:'LEAK'}));
  assert.deepEqual(await readPublisher(),original);
});

test('operator cannot publish, read history, modify publisher lease or re-enable after revoke',async()=>{
  await assertFails(operator.ref(ROOT).get());
  await assertFails(operator.ref(ROOT+'/public/water/status').set('DANGER'));
  await assertFails(operator.ref(ROOT+'/authority/leaseId').set('lease-stage-rogue'));
  assert.equal((await assertSucceeds(operator.ref(ROOT+'/authority/enabled').get())).val(),true);
  await revoked();
  await assertFails(operator.ref(ROOT+'/authority/enabled').set(true));
  await assertFails(operator.ref(ROOT+'/authority/enabled').remove());
  assert.equal((await readProtected()).authority.enabled,false);
});

test('missing, stale epoch, wrong lease, wrong UID or wrong claim cannot write capsule',async()=>{
  for(const db of [
    guest,env.authenticatedContext('publisher-stage-a').database(),
    env.authenticatedContext('some-other-user',
      {fgCapsulePublisher:true,fgLeaseId:LEASE,fgPublisherEpoch:1}).database(),
    publisherCtx('lease-stage-old'),publisherCtx(LEASE,2)
  ]){
    await assertFails(db.ref(ROOT).get());
    await assertFails(db.ref(ROOT).set(starting()));
  }
});

test('publisher cannot see legacy device authorization and Wi-Fi while guest sees only scalars',async()=>{
  for(const p of ['/','/floodguard','/floodguard/privateIngest',
    '/floodguard/deviceAuthorization/'+UID]){
    await assertFails(publisher.ref(p).get());
    await assertFails(publisher.ref(p).set('FORGED'));
  }
  assert.equal((await assertSucceeds(
    guest.ref(ROOT+'/public/water/status').get())).val(),'SAFE');
  for(const p of [ROOT,ROOT+'/authority',ROOT+'/history',ROOT+'/public/water']){
    await assertFails(guest.ref(p).get());
  }
  await assertFails(guest.ref(ROOT+'/public/water/status').set('WARNING'));
});

test('strict leaf validation forbids nested secrets despite a valid publisher token',async()=>{
  await assertFails(publisher.ref(ROOT+'/public/water/status')
    .set({wifi:'SYNTHETIC_PRIVATE'}));
  await assertFails(publisher.ref(ROOT+'/public/water/unknown').set('SECRET'));
  await assertFails(publisher.ref(ROOT+'/public/system/overallRisk').set('LOW'));
  await assertFails(publisher.ref(ROOT+'/public/water/distanceCm').set(-1));
  assert.equal((await readPublisher()).public.water.status,'SAFE');
});

test('token lease rotation invalidates old lease (rotation itself is NOT implemented)',async()=>{
  const updated=await readProtected();
  updated.authority.leaseId='lease-stage-second';
  // Simulates a trusted separate operator rotation, not a production API.
  await fixtureRead(db=>db.ref(ROOT).set(updated));
  await assertFails(publisher.ref(ROOT).get());
  const newPublisher=publisherCtx('lease-stage-second');
  await assertSucceeds(newPublisher.ref(ROOT).get());
  const next=packet();
  assert.equal((await publish(next,newPublisher,'lease-stage-second')).committed,true);
  assert.equal(outbox.pending(UID).length,1);
});

test('source or issuer mismatch fails in reducer, and nothing can ACK the outbox',async()=>{
  const p=packet();
  const snapshot=await readPublisher();
  assert.equal(propose(snapshot,p,LEASE,{sourceBinding:{...binding,enabled:false}}).allowed,false);
  assert.equal(propose(snapshot,p,LEASE,{receiptSignature:'A'.repeat(86)}).allowed,false);
  assert.equal(propose(snapshot,p,'lease-stage-wrong').allowed,false);
  assert.equal((await readProtected()).history,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('after revocation the signed observer cannot report current confirmation',async()=>{
  const p=packet();
  assert.equal((await publish(p)).committed,true);
  await revoked();
  const v=observeDeviceRevocationCapsuleLab({
    current:await readProtected(),publisherLease:LEASE,pending:p.pending,
    sourceBinding:binding,trustedReceiptKey:issuer.publicKey,nowMs:NOW+100
  });
  assert.equal(v.observed,false);
  assert.equal(v.canAcknowledge,false);
  assert.equal(outbox.pending(UID).length,1);
});

test('fence code contains no production privileged SDK, token issuer, HTTP listener or journal ACK',()=>{
  const src=readFileSync('experiments/device-revocation-fence-lab.mjs','utf8');
  for(const k of ['firebase-admin','serviceAccount','node:https','server.listen','sendMessage'])
    assert.equal(src.includes(k),false);
  assert.doesNotMatch(src,/\.acknowledge\s*\(|\.delete\s*\(|\.remove\s*\(/);
});

test('operator device revocation blocks previously issued publisher even while publisher lease is active',async()=>{
  const p=packet();
  assert.equal((await publish(p)).committed,true);
  const old=await readProtected();
  assert.equal(old.device.enabled,true);
  assert.equal(old.authority.enabled,true);
  await revokeDevice();
  const current=await readProtected();
  assert.equal(current.authority.enabled,true);
  assert.equal(current.device.enabled,false);
  assert.deepEqual(current.history,old.history);
  assert.deepEqual(current.public,old.public);
  await assertFails(publisher.ref(ROOT).get());
  await assertFails(publisher.ref(ROOT).set(old));
  assert.equal(outbox.pending(UID).length,1);
});

test('old prepared signed telemetry cannot overwrite device revocation',async()=>{
  const p=packet();
  const old=await readPublisher();
  const planned=propose(old,p);
  assert.equal(planned.allowed,true,JSON.stringify(planned));
  await revokeDevice();
  await assertFails(publisher.ref(ROOT).set(planned.next));
  const actual=await readProtected();
  assert.equal(actual.device.enabled,false);
  assert.equal(actual.history,undefined);
  assert.equal(actual.public.water.status,'SAFE');
  assert.equal(outbox.pending(UID).length,1);
});

test('publisher cannot modify pinned device identity, epoch, fingerprint, enabled, or remove root',async()=>{
  const old=await readPublisher();
  for(const mutate of [
    s=>{s.device.enabled=false;},
    s=>{s.device.enabled=null;},
    s=>{s.device.epoch=2;},
    s=>{s.device.deviceId='device-stage-z';},
    s=>{s.device.sourceKeyFingerprint='b'.repeat(64);},
    s=>{s.device.extra='PRIVATE';},
    s=>{delete s.device;}
  ]){
    const changed=structuredClone(old);mutate(changed);
    await assertFails(publisher.ref(ROOT).set(changed));
  }
  await assertFails(publisher.ref(ROOT).remove());
  await assertFails(publisher.ref(ROOT+'/device/enabled').set(false));
  assert.deepEqual(await readPublisher(),old);
});

test('operator has only one-way device revoke, not source-key rotation or publication',async()=>{
  await assertFails(operator.ref(ROOT).get());
  await assertFails(operator.ref(ROOT+'/device/sourceKeyFingerprint').set('a'.repeat(64)));
  await assertFails(operator.ref(ROOT+'/device/epoch').set(2));
  await assertFails(operator.ref(ROOT+'/public/water/status').set('DANGER'));
  assert.equal((await assertSucceeds(operator.ref(ROOT+'/device/enabled').get())).val(),true);
  await revokeDevice();
  await assertFails(operator.ref(ROOT+'/device/enabled').set(true));
  await assertFails(operator.ref(ROOT+'/device/enabled').remove());
  // The independent operator retains its separate publisher-revoke power.
  await assertSucceeds(operator.ref(ROOT+'/authority/enabled').set(false));
  assert.equal((await readProtected()).device.enabled,false);
});

test('revoked device disables public scalar reads to prevent new stale SAFE responses',async()=>{
  assert.equal((await assertSucceeds(guest.ref(ROOT+'/public/water/status').get())).val(),'SAFE');
  const p=packet();
  await revokeDevice();
  await assertFails(guest.ref(ROOT+'/public/water/status').get());
  await assertFails(guest.ref(ROOT+'/public/system/lastUpdate').get());
  await assertFails(publisher.ref(ROOT+'/public/water/status').set('SAFE'));
  assert.equal(outbox.pending(UID).length,1);
});

test('pinned source public key and epoch must match owner-provisioned same-root device',async()=>{
  const p=packet();
  const state=await readPublisher();
  const stranger=generateKeyPairSync('ed25519');
  assert.equal(propose(state,p,LEASE,{sourceBinding:{
    ...binding,publicKey:stranger.publicKey
  }}).allowed,false);
  assert.equal(propose(state,p,LEASE,{sourceBinding:{
    ...binding,epoch:2
  }}).allowed,false);
  const newEpoch=structuredClone(state);
  newEpoch.device.epoch=2;
  assert.equal(propose(newEpoch,p).allowed,false);
  const newFingerprint=structuredClone(state);
  newFingerprint.device.sourceKeyFingerprint='f'.repeat(64);
  assert.equal(propose(newFingerprint,p).allowed,false);
  assert.equal((await readProtected()).history,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('after device revocation prior successful history cannot be used as current positive proof',async()=>{
  const p=packet();
  assert.equal((await publish(p)).committed,true);
  await revokeDevice();
  const result=observeDeviceRevocationCapsuleLab({
    current:await readProtected(),publisherLease:LEASE,
    pending:p.pending,sourceBinding:binding,
    trustedReceiptKey:issuer.publicKey,nowMs:NOW+100
  });
  assert.equal(result.observed,false);
  assert.equal(result.canAcknowledge,false);
  assert.equal(outbox.pending(UID).length,1);
});
