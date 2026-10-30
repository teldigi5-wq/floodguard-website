// Synthetic signed publishing gate; no network or production operations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {
  planStrictSyntheticPublicProjection,STRICT_SYNTHETIC_PUBLIC_PATHS
} from '../experiments/strict-signed-projection-gate.mjs';

const now=1700000000500;
const frame=(sequence=1,overrides={})=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...overrides
});
const envelope=(sequence=1,overrides={})=>({
  version:'floodguard-offline-envelope-v1',deviceId:'device-stage-a',
  epoch:1,observedAtMs:now-1000,frame:frame(sequence),...overrides
});
const stamp=env=>createHash('sha256')
  .update(canonicalOfflineEnvelope(env),'utf8').digest('hex');
function fixture() {
  const pair=generateKeyPairSync('ed25519');
  const env=envelope();
  const digest=stamp(env);
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:env.deviceId,
    epoch:env.epoch,sequence:env.frame.sequence,digest,acceptedAtMs:now-250
  };
  const bytes=JSON.stringify(receipt);
  const signature=sign(null,Buffer.from(bytes),pair.privateKey).toString('base64url');
  const registryBinding={
    deviceId:env.deviceId,epoch:env.epoch,enabled:true,scope:'prototype-ingest-v1'
  };
  const databaseRecord={
    deviceId:env.deviceId,epoch:env.epoch,sequence:env.frame.sequence,digest,
    acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'
  };
  return {
    envelope:env,receipt,signature,trustedReceiptKey:pair.publicKey,
    registryBinding,databaseRecord,lastPublished:{initialized:false},nowMs:now
  };
}
const project=arg=>planStrictSyntheticPublicProjection(arg);
const deny=(input,reason)=>assert.deepEqual(project(input),{allowed:false,reason});

test('matching signed receipt and confirmed database create only five child-path proposals',()=>{
  const input=fixture(),result=project(input);
  assert.equal(result.allowed,true);
  assert.equal(result.kind,'OFFLINE_PROJECTION_PLAN_NOT_APPLIED');
  assert.deepEqual(Object.keys(result.proposedPublicChanges),STRICT_SYNTHETIC_PUBLIC_PATHS);
  assert.deepEqual(result.proposedPublicChanges,{
    'water/distanceCm':16.5,'water/levelCm':8.5,'water/status':'WARNING',
    'system/lastUpdate':now-1000,'system/overallRisk':'UNKNOWN'
  });
  assert.equal(result.nextCheckpoint.sequence,1);
  assert.equal(result.nextCheckpoint.digest,input.receipt.digest);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.nextCheckpoint),true);
  assert.equal(Object.isFrozen(result.proposedPublicChanges),true);
});
test('a forged device payload cannot reuse a valid signed receipt',()=>{
  const x=fixture();
  // Both forgeries remain plausible under the calibrated 25 cm contract;
  // their signed receipts, not basic telemetry schema, must reject them.
  deny({...x,envelope:{...x.envelope,frame:frame(1,{
    distanceCm:17.5,levelCm:7.5,risk:'SAFE'
  })}},'receipt-unverified');
  deny({...x,envelope:{...x.envelope,frame:frame(1,{
    distanceCm:24,levelCm:1,risk:'SAFE'
  })}},'receipt-unverified');
  deny({...x,envelope:{...x.envelope,frame:frame(2)}},'receipt-unverified');
});
test('incorrect signature or signer key blocks all proposed public changes',()=>{
  const x=fixture(),stranger=generateKeyPairSync('ed25519');
  deny({...x,signature:'x'.repeat(86)},'receipt-unverified');
  deny({...x,trustedReceiptKey:stranger.publicKey},'receipt-unverified');
  deny({...x,receipt:{...x.receipt,acceptedAtMs:now}},'receipt-unverified');
  deny({...x,signature:undefined},'receipt-unverified');
});
test('source registry must be present, same device/epoch, enabled and exact scope',()=>{
  const x=fixture();
  for(const binding of [
    undefined,{...x.registryBinding,enabled:false},
    {...x.registryBinding,scope:'prototype-primary-telemetry'},
    {...x.registryBinding,deviceId:'device-stage-b'},
    {...x.registryBinding,epoch:2},
    {...x.registryBinding,admin:true}
  ])deny({...x,registryBinding:binding},'device-not-authorized');
});
test('receipt acceptance without independent matching database confirmation is not publishable',()=>{
  const x=fixture();
  for(const recorded of [
    undefined,{...x.databaseRecord,status:'ACCEPTED_ONLY'},
    {...x.databaseRecord,status:'PENDING'},
    {...x.databaseRecord,sequence:2},
    {...x.databaseRecord,digest:'0'.repeat(64)},
    {...x.databaseRecord,acceptedAtMs:now},
    {...x.databaseRecord,privateKey:'SYNTHETIC'}
  ])deny({...x,databaseRecord:recorded},'database-not-confirmed');
});
test('outdated, future and reversed source clocks fail closed',()=>{
  const x=fixture(),pair=generateKeyPairSync('ed25519');
  function resigned(overrides,receivedAtMs=now-250) {
    const changed={...x.envelope,...overrides};
    const signedReceipt={...x.receipt,digest:stamp(changed),acceptedAtMs:receivedAtMs};
    return {
      ...x,envelope:changed,receipt:signedReceipt,
      signature:sign(null,Buffer.from(JSON.stringify(signedReceipt)),pair.privateKey).toString('base64url'),
      trustedReceiptKey:pair.publicKey,
      databaseRecord:{...x.databaseRecord,digest:signedReceipt.digest,acceptedAtMs:receivedAtMs}
    };
  }
  deny(resigned({observedAtMs:now-30001}),'source-timestamp-unverified');
  deny(resigned({observedAtMs:now+2001},now+2001),'source-timestamp-unverified');
  deny(resigned({observedAtMs:now-50},now-100),'source-timestamp-unverified');
  deny(resigned({observedAtMs:now-1000},now+2001),'source-timestamp-unverified');
  deny({...x,nowMs:NaN},'clock-unavailable');
});
test('missing publication checkpoint after process restart is not treated as a new installation',()=>{
  const x=fixture();
  for(const checkpoint of [undefined,null,{}, {initialized:false,sequence:0},
    {initialized:true},{initialized:true,epoch:1,sequence:1,digest:'WRONG'}])
    deny({...x,lastPublished:checkpoint},'publication-state-unavailable');
});
test('replay, old sequence and unauthorized epoch change never produce updates',()=>{
  const x=fixture(),old={
    initialized:true,epoch:1,sequence:1,digest:x.receipt.digest
  };
  deny({...x,lastPublished:old},'publication-replay-or-out-of-order');
  deny({...x,lastPublished:{...old,sequence:2}},'publication-replay-or-out-of-order');
  deny({...x,lastPublished:{...old,epoch:2}},'epoch-change-needs-operator');
});
test('unknown, command, private metadata or invalid numeric fields are rejected before planning',()=>{
  const x=fixture();
  for(const frameChange of [
    {...x.envelope.frame,gateCommand:'OPEN'},
    {...x.envelope.frame,ip:'192.0.2.2'},
    {...x.envelope.frame,risk:'UNKNOWN'},
    {...x.envelope.frame,levelCm:Infinity},
    {...x.envelope.frame,sequence:1.5}
  ])deny({...x,envelope:{...x.envelope,frame:frameChange}},'invalid-projection-input');
});
test('no unrestricted writer, live service, network or secret access in the prototype',()=>{
  const s=readFileSync('experiments/strict-signed-projection-gate.mjs','utf8');
  assert.doesNotMatch(s,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/firebase-admin|node:https|node:http|process\.env|serviceAccount|sendMessage\s*\(/);
  assert.doesNotMatch(s,/writeFileSync|fs\.promises|DATABASE_URL|ADMIN_KEY/);
  const x=project(fixture());
  assert.doesNotMatch(JSON.stringify(x),/device-stage-a|signature|privateKey|apiKey|authToken/);
  assert.deepEqual(STRICT_SYNTHETIC_PUBLIC_PATHS,[
    'water/distanceCm','water/levelCm','water/status',
    'system/lastUpdate','system/overallRisk'
  ]);
});
