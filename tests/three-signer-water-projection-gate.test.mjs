// FloodGuard R3: ephemeral synthetic Ed25519 fixture; NO Firebase or devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';
import {planThreeSignerWaterProjectionGate}
  from '../experiments/three-signer-water-projection-gate.mjs';

const NOW=1700000000500;
const id='device-stage-a';
const key=()=>generateKeyPairSync('ed25519');
const signature=(content,privateKey)=>sign(null,Buffer.from(content,'utf8'),privateKey).toString('base64url');
function fixture(){
  const device=key(),server=key(),databaseIssuer=key();
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:id,epoch:1,
    observedAtMs:NOW-1000,
    frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const signed=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(signed,'utf8').digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',
    deviceId:id,epoch:1,sequence:2,digest,acceptedAtMs:NOW-250
  };
  const attestation={
    version:'floodguard-synthetic-persisted-attestation-v1',
    deviceId:id,epoch:1,sequence:2,digest,
    acceptedAtMs:NOW-250,confirmedAtMs:NOW-100,
    scope:'prototype-ingest-v1',deviceEnabled:true,
    databaseState:'DATABASE_CONFIRMED'
  };
  return {
    envelope,deviceSignature:signature(signed,device.privateKey),
    sourceBinding:{deviceId:id,epoch:1,enabled:true,scope:'prototype-ingest-v1',publicKey:device.publicKey},
    receipt,receiptSignature:signature(JSON.stringify(receipt),server.privateKey),
    trustedReceiptKey:server.publicKey,
    attestation,attestationSignature:signature(canonicalSyntheticPublicationAttestation(attestation),databaseIssuer.privateKey),
    trustedDatabaseIssuerKey:databaseIssuer.publicKey,
    databaseRecord:{deviceId:id,epoch:1,sequence:2,digest,
      acceptedAtMs:NOW-250,status:'DATABASE_CONFIRMED'},
    lastPublished:{initialized:true,epoch:1,sequence:1,digest:'a'.repeat(64)},
    nowMs:NOW,
    _keys:{device,server,databaseIssuer}
  };
}
const project=x=>planThreeSignerWaterProjectionGate(x);
const deny=(x,expected)=>{
  const result=project(x);
  assert.equal(result.planned,false,JSON.stringify(result));
  if(expected)assert.equal(result.reason,expected);
  assert.equal(result.proposedLeaves,undefined);
  for(const k of ['canPublish','canAcknowledge','canSendAlert','canOperateGate','physicalSourceVerified'])
    assert.equal(result[k],false,k);
  return result;
};

test('three independently signed synthetic claims yield five isolated proposals, not a publish operation',()=>{
  const x=fixture(),result=project(x);
  assert.equal(result.planned,true,JSON.stringify(result));
  assert.equal(result.kind,'OFFLINE_THREE_SIGNER_LEAF_PROPOSAL_NOT_PUBLISHED');
  assert.equal(result.root,'/floodguard/publicTelemetryLabV1');
  assert.deepEqual({...result.proposedLeaves},{
    'water/distanceCm':16.5,'water/levelCm':8.5,'water/status':'WARNING',
    'system/lastUpdate':NOW-1000,'system/overallRisk':'UNKNOWN'
  });
  assert.equal(result.nextCheckpoint.sequence,2);
  assert.equal(result.nextCheckpoint.digest,x.receipt.digest);
  assert.equal(result.floodClearance,'UNKNOWN');
  assert.equal(result.physicalGatePosition,'UNVERIFIED');
  assert.equal(result.signedEvidence,'SYNTHETIC_AUTHORITIES_ONLY');
  for(const k of ['canPublish','canAcknowledge','canSendAlert','canOperateGate','physicalSourceVerified'])
    assert.equal(result[k],false,k);
  for(const v of [result,result.proposedLeaves,result.nextCheckpoint])
    assert.equal(Object.isFrozen(v),true);
});

test('caller-supplied DATABASE_CONFIRMED without independent issuer signature is denied',()=>{
  const x=fixture();
  deny({...x,attestation:undefined},'independent-db-attestation-unverified');
  deny({...x,attestationSignature:undefined},'independent-db-attestation-unverified');
  deny({...x,attestationSignature:'A'.repeat(86)},'independent-db-attestation-unverified');
});

test('tampered, wrong issuer, stale or reversed confirmation fails closed',()=>{
  const x=fixture(),stranger=key();
  deny({...x,trustedDatabaseIssuerKey:stranger.publicKey},'independent-db-attestation-unverified');
  deny({...x,attestation:{...x.attestation,databaseState:'PENDING'}},
    'independent-db-attestation-unverified');
  deny({...x,attestation:{...x.attestation,deviceEnabled:false}},
    'independent-db-attestation-unverified');
  deny({...x,attestation:{...x.attestation,confirmedAtMs:NOW-30000}},
    'independent-db-attestation-unverified');
  deny({...x,attestation:{...x.attestation,confirmedAtMs:NOW+2001}},
    'independent-db-attestation-unverified');
  deny({...x,attestation:{...x.attestation,sequence:3}},
    'independent-db-attestation-unverified');
});

test('independent signer roles must have distinct trusted Ed25519 public keys',()=>{
  const x=fixture();
  deny({...x,trustedDatabaseIssuerKey:x.trustedReceiptKey},'signer-role-confusion');
  deny({...x,trustedDatabaseIssuerKey:x.sourceBinding.publicKey},'signer-role-confusion');
  deny({...x,trustedReceiptKey:x.sourceBinding.publicKey},'signer-role-confusion');
});

test('device signatures, registry revocation and wrong keys prevent planning',()=>{
  const x=fixture(),stranger=key();
  deny({...x,deviceSignature:'A'.repeat(86)},'source-signature-unverified');
  deny({...x,deviceSignature:signature(canonicalOfflineEnvelope(x.envelope),stranger.privateKey)},
    'source-signature-unverified');
  deny({...x,sourceBinding:{...x.sourceBinding,enabled:false}},
    'trusted-authority-unavailable');
  deny({...x,sourceBinding:{...x.sourceBinding,scope:'operator-admin'}},
    'trusted-authority-unavailable');
  deny({...x,sourceBinding:{...x.sourceBinding,epoch:2}},
    'trusted-authority-unavailable');
  deny({...x,sourceBinding:{...x.sourceBinding,privateKey:'not-allowed'}},
    'trusted-authority-unavailable');
});

test('receipt signer, digest and accepted time cannot be forged',()=>{
  const x=fixture(),stranger=key();
  deny({...x,trustedReceiptKey:stranger.publicKey},'signed-acceptance-unverified');
  deny({...x,receiptSignature:'A'.repeat(86)},'signed-acceptance-unverified');
  deny({...x,receipt:{...x.receipt,digest:'b'.repeat(64)}},
    'signed-acceptance-unverified');
  deny({...x,receipt:{...x.receipt,sequence:5}},
    'signed-acceptance-unverified');
});

test('a databaseRecord is not privileged merely because its status says confirmed',()=>{
  const x=fixture();
  deny({...x,databaseRecord:{...x.databaseRecord,status:'ACCEPTED_ONLY'}},
    'database-claim-mismatch');
  deny({...x,databaseRecord:{...x.databaseRecord,sequence:3}},
    'database-claim-mismatch');
  deny({...x,databaseRecord:{...x.databaseRecord,acceptedAtMs:NOW}},
    'database-claim-mismatch');
  deny({...x,databaseRecord:{...x.databaseRecord,admin:true}},
    'database-claim-mismatch');
  deny({...x,databaseRecord:undefined},'database-claim-mismatch');
});

test('no implicit first-publication bootstrap, absent checkpoint or epoch rotation',()=>{
  const x=fixture();
  for(const state of [undefined,null,{initialized:false},{},
    {initialized:true,epoch:1,sequence:1,digest:'invalid'},
    {...x.lastPublished,epoch:2}])
    deny({...x,lastPublished:state},'publication-history-not-authoritative');
  deny({...x,lastPublished:{...x.lastPublished,sequence:2}},
    'underlying-projection-refused');
  deny({...x,lastPublished:{...x.lastPublished,sequence:3}},
    'underlying-projection-refused');
});

test('crossed clocks, malformed telemetry and private gate commands never pass',()=>{
  const x=fixture();
  deny({...x,nowMs:NaN},'clock-unavailable');
  deny({...x,nowMs:NOW+50000},'independent-db-attestation-unverified');
  deny({...x,envelope:{...x.envelope,frame:{
    ...x.envelope.frame,gateCommand:'OPEN'
  }}},'invalid-evidence');
  deny({...x,envelope:{...x.envelope,frame:{
    ...x.envelope.frame,distanceCm:17.5,levelCm:7.5,risk:'SAFE'
  }}},'source-signature-unverified');
});

test('a synthetic SAFE claim still cannot authorize public physical safety',()=>{
  const x=fixture();
  const safe={...x.envelope,frame:{...x.envelope.frame,distanceCm:18.5,levelCm:6.5,risk:'SAFE'}};
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(safe)).digest('hex');
  const receipt={...x.receipt,digest};
  const attestation={...x.attestation,digest};
  const input={
    ...x,envelope:safe,
    deviceSignature:signature(canonicalOfflineEnvelope(safe),x._keys.device.privateKey),
    receipt,receiptSignature:signature(JSON.stringify(receipt),x._keys.server.privateKey),
    attestation,attestationSignature:signature(
      canonicalSyntheticPublicationAttestation(attestation),x._keys.databaseIssuer.privateKey),
    databaseRecord:{...x.databaseRecord,digest}
  };
  const result=project(input);
  assert.equal(result.planned,true,JSON.stringify(result));
  assert.equal(result.proposedLeaves['water/status'],'SAFE');
  assert.equal(result.proposedLeaves['system/overallRisk'],'UNKNOWN');
  assert.equal(result.floodClearance,'UNKNOWN');
  assert.equal(result.canPublish,false);
  assert.equal(result.physicalSourceVerified,false);
});

test('new module contains no network, production secrets, RTDB writer, alert or gate API',()=>{
  const src=readFileSync('experiments/three-signer-water-projection-gate.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:https|node:http/);
  assert.doesNotMatch(src,/\bfetch\s*\(|\.listen\s*\(|writeFileSync|createServer|process\.env/);
  assert.doesNotMatch(src,/serviceAccount|servo\.write|digitalWrite|\.ref\s*\(|\.set\s*\(|\.updateChildren\s*\(|\.remove\s*\(/);
  assert.doesNotMatch(src,/\/floodguard\/live/);
  assert.match(src,/verifySyntheticPublicationAttestation/);
  assert.match(src,/verifyStage8OfflineReceipt/);
  assert.match(src,/verifyBytes\(canonical,deviceSignature,sourceBinding\.publicKey\)/);
  assert.match(src,/publication-history-not-authoritative/);
});
