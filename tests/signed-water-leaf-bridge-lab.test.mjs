import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {
  planSignedWaterLeafBridgeLab,
  SIGNED_WATER_LEAF_LAB_ROOT,
  SIGNED_WATER_LEAF_LAB_FIELDS,
} from '../experiments/signed-water-leaf-bridge-lab.mjs';

const NOW=1700000000500;
const frame=(sequence=1,fields={})=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...fields
});
function fixture(fields={}, selectedFrame=frame()) {
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:'device-stage-a',
    epoch:1,observedAtMs:NOW-1000,frame:selectedFrame,
  };
  const digest=createHash('sha256').update(
    canonicalOfflineEnvelope(envelope),'utf8').digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',
    deviceId:envelope.deviceId,epoch:envelope.epoch,
    sequence:envelope.frame.sequence,digest,acceptedAtMs:NOW-250,
  };
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),privateKey).toString('base64url');
  return {
    envelope,receipt,signature,trustedReceiptKey:publicKey,
    registryBinding:{deviceId:envelope.deviceId,epoch:1,enabled:true,scope:'prototype-ingest-v1'},
    databaseRecord:{deviceId:envelope.deviceId,epoch:1,sequence:1,digest,acceptedAtMs:NOW-250,status:'DATABASE_CONFIRMED'},
    lastPublished:{initialized:false},nowMs:NOW,...fields
  };
}
const accepted=x=>{const y=planSignedWaterLeafBridgeLab(x);assert.equal(y.planned,true,JSON.stringify(y));return y;};
const denied=(x,reason)=>{const y=planSignedWaterLeafBridgeLab(x);assert.equal(y.planned,false);assert.equal(y.proposedLeaves,undefined);if(reason)assert.equal(y.reason,reason);};

test('valid signed receipt + confirmed database record proposes ONLY five isolated scalar leaves',()=>{
  const x=fixture(),p=accepted(x);
  assert.equal(p.kind,'OFFLINE_ISOLATED_LEAF_PLAN_NOT_PUBLISHED');
  assert.equal(p.root,'/floodguard/publicTelemetryLabV1');
  assert.equal(p.root,SIGNED_WATER_LEAF_LAB_ROOT);
  assert.deepEqual(Object.keys(p.proposedLeaves),SIGNED_WATER_LEAF_LAB_FIELDS);
  assert.deepEqual({...p.proposedLeaves},{
    'water/distanceCm':16.5,'water/levelCm':8.5,'water/status':'WARNING',
    'system/lastUpdate':NOW-1000,'system/overallRisk':'UNKNOWN'
  });
  assert.equal(p.nextCheckpoint.sequence,1);
  assert.equal(p.nextCheckpoint.digest,x.receipt.digest);
  for(const key of ['gate/','alarm/','esp8266/','wifi','ip','private','command'])
    assert.ok(!JSON.stringify(p.proposedLeaves).includes(key));
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.proposedLeaves));
  assert.ok(Object.isFrozen(p.nextCheckpoint));
});
test('signed report SAFE is not proof of physical field clearance',()=>{
  const x=fixture({},frame(1,{distanceCm:18.5,levelCm:6.5,risk:'SAFE'}));
  // This receipt proves the lab input's sequence/digest, not calibration,
  // independent hydraulic safety or actual gate position.
  const p=accepted(x);
  assert.equal(p.proposedLeaves['water/status'],'SAFE');
  assert.equal(p.floodClearance,'UNKNOWN');
  assert.equal(p.physicalGatePosition,'UNVERIFIED');
  assert.equal(p.notificationDelivery,'NOT_VERIFIED');
  assert.equal(p.readyForActuation,false);
  assert.equal(p.sourceTrust,'SYNTHETIC_EVIDENCE_ONLY');
  assert.equal(p.proposedLeaves['system/overallRisk'],'UNKNOWN');
});
test('forged signer, signature, digest or source data cannot create a leaf proposal',()=>{
  const x=fixture(),other=generateKeyPairSync('ed25519');
  denied({...x,trustedReceiptKey:other.publicKey},'receipt-unverified');
  denied({...x,signature:'A'.repeat(86)},'receipt-unverified');
  denied({...x,receipt:{...x.receipt,digest:'a'.repeat(64)}},'receipt-unverified');
  denied({...x,envelope:{...x.envelope,frame:frame(1,{distanceCm:17.5,levelCm:7.5,risk:'SAFE'})}},'receipt-unverified');
  denied({...x,envelope:{...x.envelope,frame:frame(2)}},'receipt-unverified');
});
test('registry revocation, scope and missing database confirmation fail closed',()=>{
  const x=fixture();
  denied({...x,registryBinding:{...x.registryBinding,enabled:false}},'device-not-authorized');
  denied({...x,registryBinding:{...x.registryBinding,scope:'public-read'}},'device-not-authorized');
  denied({...x,databaseRecord:{...x.databaseRecord,status:'PENDING'}},'database-not-confirmed');
  denied({...x,databaseRecord:{...x.databaseRecord,digest:'f'.repeat(64)}},'database-not-confirmed');
  denied({...x,databaseRecord:undefined},'database-not-confirmed');
});
test('restart checkpoint, duplicate sequence and operator epoch boundary are preserved',()=>{
  const x=fixture(),last={
    initialized:true,epoch:1,sequence:1,digest:x.receipt.digest
  };
  denied({...x,lastPublished:undefined},'publication-state-unavailable');
  denied({...x,lastPublished:last},'publication-replay-or-out-of-order');
  denied({...x,lastPublished:{...last,sequence:4}},'publication-replay-or-out-of-order');
  denied({...x,lastPublished:{...last,epoch:2}},'epoch-change-needs-operator');
});
test('stale, future, malformed and contradictory sensor frames are not proposed',()=>{
  const x=fixture();
  denied({...x,nowMs:NOW+50000},'source-timestamp-unverified');
  denied({...x,nowMs:NOW-10000},'source-timestamp-unverified');
  denied({...x,envelope:{...x.envelope,frame:frame(1,{levelCm:0})}},'invalid-projection-input');
  denied({...x,envelope:{...x.envelope,frame:frame(1,{risk:'SAFE'})}},'invalid-projection-input');
  denied({...x,envelope:{...x.envelope,frame:{...frame(),wifi:'PRIVATE'}}},'invalid-projection-input');
  denied({...x,envelope:{...x.envelope,frame:{...frame(),gateCommand:'OPEN'}}},'invalid-projection-input');
});
test('five-leaf contract is an exact read-only subset of PR34 field groups',()=>{
  const supported=new Set([
    'water/distanceCm','water/levelCm','water/status',
    'system/lastUpdate','system/overallRisk',
  ]);
  assert.deepEqual(new Set(SIGNED_WATER_LEAF_LAB_FIELDS),supported);
  assert.equal(SIGNED_WATER_LEAF_LAB_FIELDS.length,5);
  assert.equal(Object.isFrozen(SIGNED_WATER_LEAF_LAB_FIELDS),true);
  assert.equal(SIGNED_WATER_LEAF_LAB_FIELDS.some(x=>/^(gate|alarm|esp8266)\//.test(x)),false);
});
test('lab has no live read/write, Firebase, network, privileged key or gate operation',()=>{
  const s=readFileSync('experiments/signed-water-leaf-bridge-lab.mjs','utf8');
  assert.doesNotMatch(s,/firebase-admin|firebase\/database|node:http|node:https|fetch\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/\.update\s*\(|\.set\s*\(|\.remove\s*\(|servo\.write|gateServo|serviceAccount|process\.env/);
  assert.doesNotMatch(s,/\/floodguard\/live(?:\/|['"])/);
});
