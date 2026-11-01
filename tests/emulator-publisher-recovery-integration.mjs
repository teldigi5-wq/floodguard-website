// End-to-end synthetic signed outbox -> real RTDB Emulator transaction ->
// independently fetched protected read-back; NO real Firebase credentials.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomBytes,sign} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {attemptRetainedPublicationLab}
  from '../experiments/emulator-publisher-recovery-lab.mjs';

const UID='device-stage-a',NOW=1793450000500,ROOT='/floodguard';
if(process.env.FG_PUBLISHER_RECOVERY_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Dedicated loopback RTDB Emulator required');
let env,dir,outbox,source,issuer,sourceBinding,receipt,signature,adapter,envelope;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fp=key=>hash(key.export({type:'spki',format:'der'}));
async function elevated(fn){
  let v;
  await env.withSecurityRulesDisabled(async ctx=>{v=await fn(ctx.database());});
  return v;
}
const readRoot=()=>elevated(async db=>(await db.ref(ROOT).get()).val());
const seed=s=>elevated(db=>db.ref(ROOT).set(s));
const stage=s=>elevated(db=>db.ref(ROOT+'/staging/ingestV1/'+UID).set(s));
const confirmed=c=>elevated(db=>db.ref(ROOT+'/confirmedIngest/'+UID).set(c));
async function atomic(candidate){
  let outcome;
  await env.withSecurityRulesDisabled(async ctx=>{
    const ref=ctx.database().ref(ROOT);
    const holder={};
    await new Promise((resolve,reject)=>{
      const limit=setTimeout(()=>reject(Error('RTDB Emulator readiness timeout')),4000);
      holder.listener=()=>{clearTimeout(limit);resolve();};
      ref.on('value',holder.listener,error=>{clearTimeout(limit);reject(error);});
    });
    try{
      const result=await ref.transaction(candidate,undefined,false);
      outcome={committed:result.committed};
    }finally{ref.off('value',holder.listener);}
  });
  return outcome;
}
async function setupReading({sequence=1,distanceCm=16.5,levelCm=8.5,risk='WARNING',
  observedAtMs=NOW-1000}={}){
  envelope={version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,
    observedAtMs,frame:{sequence,distanceCm,levelCm,risk}};
  const deviceSignature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
    source.privateKey).toString('base64url');
  assert.equal(outbox.accept({envelope,signature:deviceSignature}).accepted,true);
  receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,epoch:1,
    sequence,digest:hash(canonicalOfflineEnvelope(envelope)),acceptedAtMs:NOW+50};
  signature=sign(null,Buffer.from(JSON.stringify(receipt)),
    issuer.privateKey).toString('base64url');
  await stage({...envelope.frame});
  await confirmed({deviceId:UID,epoch:1,sequence,digest:receipt.digest,
    acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'});
}
const run=(overrides={})=>attemptRetainedPublicationLab({
  outbox,deviceId:UID,sourceBinding,trustedReceiptKey:issuer.publicKey,
  receipt,receiptSignature:signature,database:adapter,nowMs:NOW+100,...overrides
});
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-publisher-recovery',database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  dir=mkdtempSync(path.join(os.tmpdir(),'fg-publisher-recovery-'));
  source=generateKeyPairSync('ed25519');
  issuer=generateKeyPairSync('ed25519');
  sourceBinding={deviceId:UID,epoch:1,enabled:true,
    scope:'prototype-ingest-v1',publicKey:source.publicKey};
  outbox=createDurableAdmissionOutboxLab({directory:dir,clock:()=>NOW,
    integrityKey:randomBytes(32),
    identities:new Map([[UID,sourceBinding]])});
  outbox.commission();
  adapter={disposableEmulatorOnly:true,readRoot,transactionRoot:atomic};
  await seed({
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    projectionControl:{waterAuthority:{deviceId:UID,epoch:1,
      enabled:true,scope:'water-primary',
      receiptSignerFingerprint:fp(issuer.publicKey)},
      devices:{[UID]:{initialized:false,epoch:1}}},
    staging:{ingestV1:{[UID]:{sequence:1,distanceCm:18.5,levelCm:6.5,risk:'SAFE'}}},
    confirmedIngest:{[UID]:{deviceId:UID,epoch:1,sequence:1,digest:'0'.repeat(64),
      acceptedAtMs:NOW,status:'DATABASE_CONFIRMED'}},
    publicTelemetryLabV1:{
      water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
      system:{lastUpdate:NOW-3000,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},alarm:{active:false}
    },
    privateIngest:{wifi:'SYNTHETIC_PRIVATE'}
  });
  await setupReading();
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});

test('real emulator transaction + independent readback records signed frame; NO local ACK',async()=>{
  const result=await run();
  assert.equal(result.status,'PUBLISHED_READBACK_MATCH_NO_ACK',JSON.stringify(result));
  assert.equal(result.canAcknowledge,false);
  const root=await readRoot();
  assert.equal(root.publicTelemetryLabV1.water.status,'WARNING');
  assert.equal(root.publicTelemetryLabV1.system.overallRisk,'UNKNOWN');
  assert.equal(root.projectionControl.devices[UID].digest,receipt.digest);
  assert.equal(root.publicationHistoryV1.entries.s_1.receipt.digest,receipt.digest);
  assert.equal(root.privateIngest.wifi,'SYNTHETIC_PRIVATE');
  assert.deepEqual(outbox.pending(UID).map(x=>x.sequence),[1]);
});

test('replay after committed publication is read-only recovery, not a second transaction',async()=>{
  assert.equal((await run()).status,'PUBLISHED_READBACK_MATCH_NO_ACK');
  const prevented={disposableEmulatorOnly:true,readRoot,
    transactionRoot:()=>{throw Error('should not be invoked');}};
  assert.equal((await run({database:prevented})).status,'ALREADY_RECORDED_NO_ACK');
  assert.deepEqual(outbox.pending(UID).map(x=>x.sequence),[1]);
});

test('lost commit response after actual atomic write is recovered from separate DB read',async()=>{
  const lost={disposableEmulatorOnly:true,readRoot,transactionRoot:async cb=>{
    await atomic(cb);
    throw Error('SYNTHETIC_NETWORK_RESPONSE_LOST_AFTER_COMMIT');
  }};
  const result=await run({database:lost});
  assert.equal(result.status,'AMBIGUOUS_COMMIT_READBACK_MATCH_NO_ACK',JSON.stringify(result));
  assert.equal(result.canAcknowledge,false);
  assert.equal((await readRoot()).publicationHistoryV1.entries.s_1.digest,receipt.digest);
  assert.equal(outbox.pending(UID).length,1);
});

test('ambiguous failure before commit remains uncertain and never claims delivery',async()=>{
  const failed={disposableEmulatorOnly:true,readRoot,
    transactionRoot:async()=>{throw Error('SYNTHETIC_DISCONNECT_BEFORE_COMMIT');}};
  const result=await run({database:failed});
  assert.equal(result.status,'UNCERTAIN');
  assert.equal(result.reason,'commit-result-ambiguous-and-unverified');
  assert.equal((await readRoot()).publicationHistoryV1,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('forged signed receipt cannot be published or acknowledged',async()=>{
  const bad=await run({receiptSignature:'A'.repeat(86)});
  assert.equal(bad.status,'DENIED',JSON.stringify(bad));
  assert.equal((await readRoot()).publicationHistoryV1,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('privileged source revocation prevents publication, and missing history remains pending',async()=>{
  await elevated(db=>db.ref(ROOT+'/deviceAuthorization/'+UID+'/enabled').set(false));
  const result=await run();
  assert.equal(result.status,'DENIED',JSON.stringify(result));
  assert.equal((await readRoot()).publicationHistoryV1,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('corrupt public scalar prevents publication, never repairs it by broad root overwrite',async()=>{
  await elevated(db=>db.ref(ROOT+'/publicTelemetryLabV1/water/status').set({wifi:'SYNTHETIC_PRIVATE'}));
  const result=await run();
  assert.equal(result.status,'DENIED',JSON.stringify(result));
  assert.equal((await readRoot()).publicationHistoryV1,undefined);
  assert.equal(outbox.pending(UID).length,1);
});

test('database not independently readable means no transaction or positive result',async()=>{
  const disconnected={disposableEmulatorOnly:true,
    readRoot:async()=>{throw Error('READ_UNAVAILABLE');},
    transactionRoot:()=>{throw Error('must not write');}};
  const result=await run({database:disconnected});
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(outbox.pending(UID).length,1);
});

test('claimed commit without persisted proof returns UNCERTAIN, not delivered',async()=>{
  const fake={disposableEmulatorOnly:true,readRoot,
    transactionRoot:async()=>({committed:true})};
  const result=await run({database:fake});
  assert.equal(result.status,'UNCERTAIN');
  assert.equal(result.reason,'transaction-claimed-commit-but-no-proof');
  assert.equal(outbox.pending(UID).length,1);
});

test('regular Firebase clients cannot read private receipt history or write telemetry',async()=>{
  assert.equal((await run()).status,'PUBLISHED_READBACK_MATCH_NO_ACK');
  const guest=env.unauthenticatedContext().database();
  assert.equal((await assertSucceeds(
    guest.ref(ROOT+'/publicTelemetryLabV1/water/status').get())).val(),'WARNING');
  for(const p of [ROOT,ROOT+'/confirmedIngest',ROOT+'/publicationHistoryV1',
    ROOT+'/projectionControl'])
    await assertFails(guest.ref(p).get());
  await assertFails(guest.ref(ROOT+'/publicationHistoryV1').set({forged:true}));
  await assertFails(guest.ref(ROOT+'/publicTelemetryLabV1/water/status').set('SAFE'));
});

test('no production adapter, credentials or ACK path exists in coordinator',()=>{
  const src=readFileSync('experiments/emulator-publisher-recovery-lab.mjs','utf8');
  for(const prohibited of ['firebase-admin','firebase/database','serviceAccount','node:https',
    'servo.write','sendMessage','process.env'])
    assert.equal(src.includes(prohibited),false,prohibited);
  assert.doesNotMatch(src,/\.acknowledge\s*\(|\.delete\s*\(|\.remove\s*\(/);
});
