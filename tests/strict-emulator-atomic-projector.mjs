// Privileged publisher smoke/regression against ONLY isolated local RTDB Emulator.
// Never uses production SDK secrets, hardware, external URLs or live alerts.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  initializeTestEnvironment,assertFails,assertSucceeds
} from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {publishStrictEmulatorFrame} from '../experiments/strict-emulator-atomic-projector.mjs';

if(process.env.FG_STRICT_EMULATOR_PROJECTOR_TEST!=='1'||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Strict projector tests require local RTDB Emulator only');

const path='/floodguard',uid='device-stage-a',now=1700000000500;
const rules=readFileSync('docs/firebase/phase-b-strict-readonly-live.rules.json','utf8');
const server=generateKeyPairSync('ed25519');
const approvedSignerFingerprint=createHash('sha256')
  .update(server.publicKey.export({format:'der',type:'spki'})).digest('hex');
let env;

const frame=sequence=>({sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'});
const envelope=(sequence=1)=>({
  version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
  observedAtMs:now-1000,frame:frame(sequence)
});
function input(seq=1,changes={}) {
  const e=envelope(seq);
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(e)).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:uid,epoch:1,
    sequence:seq,digest,acceptedAtMs:now-200
  };
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),server.privateKey)
    .toString('base64url');
  return {...changes,envelope:e,receipt,signature,
    trustedReceiptKey:server.publicKey,nowMs:now};
}
async function admin(callback){
  // Firebase's rules-unit-testing helper resolves to void, not the callback
  // return. Explicitly capture it so test assertions observe actual results.
  let output;
  await env.withSecurityRulesDisabled(async owner=>{
    output=await callback(owner.database());
  });
  return output;
}
async function root(){return admin(async db=>(await db.ref(path).get()).val());}
async function amend(updates){return admin(db=>db.ref(path).update(updates));}
async function project(opts){return admin(db=>publishStrictEmulatorFrame({database:db,...opts}));}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-strict-projector',database:{
      host:'127.0.0.1',port:9000,rules
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  const accepted=input(1);
  await admin(db=>db.ref(path).set({
    deviceAuthorization:{
      [uid]:{enabled:true,scope:'prototype-ingest-v1'}
    },
    staging:{ingestV1:{[uid]:frame(1)}},
    confirmedIngest:{
      [uid]:{deviceId:uid,epoch:1,sequence:1,
        digest:accepted.receipt.digest,
        acceptedAtMs:accepted.receipt.acceptedAtMs,
        status:'DATABASE_CONFIRMED'}
    },
    projectionControl:{
      waterAuthority:{
        deviceId:uid,epoch:1,enabled:true,scope:'water-primary',
        receiptSignerFingerprint:approvedSignerFingerprint
      },
      devices:{[uid]:{initialized:false,epoch:1}}
    },
    live:{
      water:{distanceCm:20,levelCm:5,status:'SAFE'},
      rain:{dailyMm:12,status:'NORMAL'},
      gate:{status:'CLOSED',angle:0,countdownSeconds:0},
      alarm:{active:false},
      devices:{arduino:'ONLINE'},
      system:{lastUpdate:now-10000,overallRisk:'LOW'},
      esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-50,
        ip:'192.0.2.80',wifi:'PRIVATE-SYNTHETIC'}
    }
  }));
});

test('signed + confirmed + staged frame and preprovisioned checkpoint publishes atomically',async()=>{
  const before=await root();
  const result=await project(input());
  assert.deepEqual(result,{
    published:true,kind:'OFFLINE_EMULATOR_PROJECTED_NOT_PRODUCTION',sequence:1
  });
  const after=await root();
  assert.equal(after.live.water.status,'WARNING');
  assert.equal(after.live.water.levelCm,8.5);
  assert.equal(after.live.water.distanceCm,16.5);
  assert.equal(after.live.system.lastUpdate,now-1000);
  assert.equal(after.live.system.overallRisk,'UNKNOWN');
  assert.deepEqual(after.live.rain,before.live.rain);
  assert.deepEqual(after.live.gate,before.live.gate);
  assert.deepEqual(after.live.alarm,before.live.alarm);
  assert.deepEqual(after.live.esp8266,before.live.esp8266);
  assert.deepEqual(after.confirmedIngest,before.confirmedIngest);
  assert.deepEqual(after.staging,before.staging);
  assert.deepEqual(after.deviceAuthorization,before.deviceAuthorization);
  assert.deepEqual(after.projectionControl.devices[uid],{
    initialized:true,epoch:1,sequence:1,digest:input().receipt.digest
  });
  const visitor=env.unauthenticatedContext().database();
  await assertSucceeds(visitor.ref(path+'/live/water').get());
  await assertSucceeds(visitor.ref(path+'/live/system').get());
  for(const hidden of [
    path,path+'/live',path+'/live/esp8266',
    path+'/live/esp8266/ip',path+'/confirmedIngest',
    path+'/projectionControl',path+'/projectionControl/waterAuthority',
    path+'/staging'
  ])await assertFails(visitor.ref(hidden).get());
  await assertFails(visitor.ref(path+'/live/water/status').set('SAFE'));
});

test('repeat and lower sequence do not change the database at all',async()=>{
  assert.equal((await project(input(1))).published,true);
  const before=await root();
  const replay=await project(input(1));
  assert.equal(replay.published,false);
  assert.equal(replay.reason,'publication-replay-or-out-of-order');
  assert.deepEqual(await root(),before);
});

test('new confirmed and staged sequence moves checkpoint and preserves private data',async()=>{
  assert.equal((await project(input(1))).published,true);
  const next=input(2);
  await amend({
    ['staging/ingestV1/'+uid]:frame(2),
    ['confirmedIngest/'+uid]:{
      deviceId:uid,epoch:1,sequence:2,digest:next.receipt.digest,
      acceptedAtMs:next.receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'
    }
  });
  const result=await project(next);
  assert.equal(result.published,true);
  assert.equal((await root()).projectionControl.devices[uid].sequence,2);
  assert.equal((await project(next)).published,false);
});

test('privileged projection refuses a forged receipt and unmatched stored digest',async()=>{
  const before=await root();
  const wrongKey=generateKeyPairSync('ed25519');
  let result=await project({...input(),trustedReceiptKey:wrongKey.publicKey});
  assert.equal(result.published,false);
  assert.equal(result.reason,'receipt-signer-not-authorized');
  const forged=input();forged.receipt={...forged.receipt,digest:'0'.repeat(64)};
  assert.equal((await project(forged)).published,false);
  await amend({['confirmedIngest/'+uid+'/digest']:'0'.repeat(64)});
  result=await project(input());
  assert.equal(result.published,false);
  assert.equal(result.reason,'database-not-confirmed');
  await amend({['confirmedIngest/'+uid+'/digest']:before.confirmedIngest[uid].digest});
  assert.deepEqual(await root(),before);
});

test('staging mismatch and absent confirmation block all public writes',async()=>{
  const before=await root();
  await amend({['staging/ingestV1/'+uid+'/risk']:'SAFE'});
  assert.equal((await project(input())).reason,'staging-frame-mismatch');
  await amend({['staging/ingestV1/'+uid]:before.staging.ingestV1[uid]});
  await amend({['confirmedIngest/'+uid]:null});
  assert.equal((await project(input())).reason,'database-not-confirmed');
  const after=await root();
  assert.deepEqual(after.live,before.live);
  assert.deepEqual(after.projectionControl,before.projectionControl);
});

test('revoked and wrong-scope identity never publishes even with signed receipt',async()=>{
  const before=await root();
  await amend({['deviceAuthorization/'+uid+'/enabled']:false});
  assert.equal((await project(input())).reason,'device-not-authorized');
  await amend({['deviceAuthorization/'+uid]:{
    enabled:true,scope:'prototype-primary-telemetry'
  }});
  assert.equal((await project(input())).reason,'device-not-authorized');
  assert.deepEqual((await root()).live,before.live);
});

test('missing checkpoint and missing public branch are fail-closed',async()=>{
  const before=await root();
  await amend({['projectionControl/devices/'+uid]:null});
  assert.equal((await project(input())).reason,'publication-state-unavailable');
  await amend({['projectionControl/devices/'+uid]:{initialized:false,epoch:1}});
  await amend({'live/water':null});
  assert.equal((await project(input())).reason,'public-schema-unavailable');
  assert.equal((await root()).projectionControl.devices[uid].initialized,false);
  assert.deepEqual((await root()).live.system,before.live.system);
});

test('expired source time is rejected independently of a valid signature',async()=>{
  const before=await root();
  assert.equal((await project({...input(),nowMs:now+30002})).reason,
    'source-timestamp-unverified');
  assert.deepEqual(await root(),before);
});

test('two concurrent deliveries of one sequence can commit at most once',async()=>{
  const entries=await Promise.all([project(input()),project(input())]);
  assert.equal(entries.filter(x=>x.published===true).length,1);
  assert.equal(entries.filter(x=>x.published===false).length,1);
  assert.equal((await root()).projectionControl.devices[uid].sequence,1);
});


test('second enrolled and confirmed device cannot overwrite the sole water source',async()=>{
  const other='device-stage-b';
  const otherEnvelope={
    ...envelope(1),deviceId:other,
    frame:{sequence:1,distanceCm:3.5,levelCm:21.5,risk:'DANGER'}
  };
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(otherEnvelope))
    .digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:other,epoch:1,
    sequence:1,digest,acceptedAtMs:now-200
  };
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),server.privateKey)
    .toString('base64url');
  await amend({
    ['deviceAuthorization/'+other]:{enabled:true,scope:'prototype-ingest-v1'},
    ['staging/ingestV1/'+other]:otherEnvelope.frame,
    ['confirmedIngest/'+other]:{...receipt,status:'DATABASE_CONFIRMED'},
    ['projectionControl/devices/'+other]:{initialized:false,epoch:1}
  });
  const before=await root();
  const rejected=await project({
    envelope:otherEnvelope,receipt,signature,
    trustedReceiptKey:server.publicKey,nowMs:now
  });
  assert.deepEqual(rejected,{published:false,reason:'water-source-not-authorized'});
  assert.deepEqual(await root(),before,
    'cross-device conflict must not update public data or either checkpoint');
  const original=await project(input(1));
  assert.equal(original.published,true,'approved primary must remain usable');
  assert.equal((await root()).live.water.status,'WARNING');
});

test('water authority must be explicitly present, enabled, scope/epoch matched',async()=>{
  const original=await root();
  const authority=original.projectionControl.waterAuthority;
  const cases=[
    null,{...authority,enabled:false},
    {...authority,scope:'rain-primary'},
    {...authority,epoch:2},
    {...authority,deviceId:'device-stage-b'},
    {...authority,allowAll:true}
  ];
  for(const candidate of cases){
    await amend({'projectionControl/waterAuthority':candidate});
    const result=await project(input(1));
    assert.deepEqual(result,{published:false,reason:'water-source-not-authorized'});
    const current=await root();
    assert.deepEqual(current.live,original.live);
    assert.deepEqual(current.projectionControl.devices,original.projectionControl.devices);
  }
  await amend({'projectionControl/waterAuthority':authority});
  assert.equal((await project(input(1))).published,true);
});

test('attacker-issued but otherwise consistent signed receipt cannot replace pinned server issuer',async()=>{
  const fake=generateKeyPairSync('ed25519');
  const data=input(1),signature=sign(
    null,Buffer.from(JSON.stringify(data.receipt)),fake.privateKey
  ).toString('base64url');
  const before=await root();
  const result=await project({
    ...data,signature,trustedReceiptKey:fake.publicKey
  });
  assert.deepEqual(result,{published:false,reason:'receipt-signer-not-authorized'});
  assert.deepEqual(await root(),before);
  const valid=await project(data);
  assert.equal(valid.published,true);
});

test('missing or malformed receipt trust material cannot authorize a publisher',async()=>{
  const before=await root();
  for(const key of [undefined,null,'fake-issuer-key',server.privateKey]){
    const denied=await project({...input(),trustedReceiptKey:key});
    assert.deepEqual(denied,{published:false,reason:'trusted-signer-invalid'});
  }
  assert.deepEqual(await root(),before);
});

test('emulator-only test module has no Firebase Admin SDK, secret loading or host endpoint',()=>{
  const source=readFileSync('experiments/strict-emulator-atomic-projector.mjs','utf8');
  assert.match(source,/FG_STRICT_EMULATOR_PROJECTOR_TEST/);
  assert.match(source,/FIREBASE_DATABASE_EMULATOR_HOST/);
  assert.match(source,/transaction\(current=>/);
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|https:\/\/|sendMessage\s*\(|writeFileSync/);
  assert.doesNotMatch(source,/\.set\(|\.update\(/);
});
