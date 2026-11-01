// Real Firebase RTDB Emulator snapshot checks; synthetic trusted state only.
// No production Firebase URL/credential, deployed publisher, real device or gate.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab} from '../experiments/durable-admission-outbox-lab.mjs';
import {reconcileConfirmedWaterOutboxLab}
  from '../experiments/confirmed-outbox-reconciliation-lab.mjs';

const HOST='127.0.0.1:9000',UID='device-stage-a',NOW=1793450000500;
if(process.env.FG_CONFIRMED_OUTBOX_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Exact disposable loopback RTDB Emulator environment required');
let env,dir,journal,sourceBinding,sourceKey,receiptKey,request;
const anon=()=>env.unauthenticatedContext().database();
async function admin(fn){
  let result;
  await env.withSecurityRulesDisabled(async c=>{result=await fn(c.database());});
  return result;
}
const root=()=>admin(async db=>(await db.ref('/floodguard').get()).val());
async function inputFromRead(){
  const snapshot=await root();
  return {pending:journal.pending(UID)[0],root:snapshot,
    receipt:request.receipt,receiptSignature:request.signature,
    trustedReceiptKey:receiptKey.publicKey,sourceBinding,nowMs:NOW+100};
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-confirmed-outbox',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  dir=mkdtempSync(path.join(os.tmpdir(),'fg-db-reconcile-'));
  sourceKey=generateKeyPairSync('ed25519');
  receiptKey=generateKeyPairSync('ed25519');
  sourceBinding={deviceId:UID,epoch:1,enabled:true,
    scope:'prototype-ingest-v1',publicKey:sourceKey.publicKey};
  journal=createDurableAdmissionOutboxLab({directory:dir,integrityKey:randomBytes(32),
    identities:new Map([[UID,sourceBinding]]),clock:()=>NOW});
  journal.commission();
  const frame={sequence:1,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
  const envelope={version:'floodguard-offline-envelope-v1',
    deviceId:UID,epoch:1,observedAtMs:NOW-1000,frame};
  const signature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
    sourceKey.privateKey).toString('base64url');
  assert.equal(journal.accept({envelope,signature}).accepted,true);
  const digest=journal.pending(UID)[0].digest;
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
    epoch:1,sequence:1,digest,acceptedAtMs:NOW+50};
  request={receipt,signature:sign(null,Buffer.from(JSON.stringify(receipt)),
    receiptKey.privateKey).toString('base64url')};
  const issuerFp=createHash('sha256')
    .update(receiptKey.publicKey.export({type:'spki',format:'der'})).digest('hex');
  await admin(db=>db.ref('/floodguard').set({
    projectionControl:{
      waterAuthority:{deviceId:UID,epoch:1,enabled:true,
        scope:'water-primary',receiptSignerFingerprint:issuerFp},
      devices:{[UID]:{initialized:true,epoch:1,sequence:1,digest}}
    },
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmedIngest:{[UID]:{deviceId:UID,epoch:1,sequence:1,digest,
      acceptedAtMs:NOW+50,status:'DATABASE_CONFIRMED'}},
    publicTelemetryLabV1:{
      water:{distanceCm:16.5,levelCm:8.5,status:'WARNING'},
      system:{lastUpdate:NOW-1000,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},alarm:{active:false}
    },
    live:{esp8266:{wifi:'PRIVATE_SYNTHETIC'}},
    privateIngest:{secret:'PRIVATE_SYNTHETIC'}
  }));
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});

test('real emulator privileged read allows exact synthetic confirmation observation, no ACK',async()=>{
  const input=await inputFromRead();
  const result=reconcileConfirmedWaterOutboxLab(input);
  assert.equal(result.confirmed,true,JSON.stringify(result));
  assert.equal(result.canAcknowledge,false);
  assert.equal(journal.pending(UID).length,1);
  const guest=anon();
  assert.equal((await assertSucceeds(guest.ref('/floodguard/publicTelemetryLabV1/water/status').get())).val(),'WARNING');
  await assertFails(guest.ref('/floodguard').get());
  await assertFails(guest.ref('/floodguard/confirmedIngest').get());
  await assertFails(guest.ref('/floodguard/publicTelemetryLabV1/water').get());
});

test('privileged snapshot mutation/replay checkpoint mismatch denies without losing local frame',async()=>{
  await admin(db=>db.ref('/floodguard/projectionControl/devices/'+UID+'/sequence').set(2));
  const result=reconcileConfirmedWaterOutboxLab(await inputFromRead());
  assert.equal(result.confirmed,false);
  assert.equal(result.reason,'superseded-or-conflicting-checkpoint');
  assert.equal(journal.pending(UID).length,1);
});

test('synthetic public leaf object injection is observable to guest but never accepted as proof',async()=>{
  await admin(db=>db.ref('/floodguard/publicTelemetryLabV1/water/status')
    .set({nestedSecret:'SYNTHETIC_PRIVATE'}));
  const guest=anon();
  assert.equal((await assertSucceeds(
    guest.ref('/floodguard/publicTelemetryLabV1/water/status/nestedSecret').get()
  )).val(),'SYNTHETIC_PRIVATE');
  const result=reconcileConfirmedWaterOutboxLab(await inputFromRead());
  assert.equal(result.confirmed,false);
  assert.equal(result.reason,'public-scalar-schema-corrupt');
  assert.equal(journal.pending(UID).length,1);
});
