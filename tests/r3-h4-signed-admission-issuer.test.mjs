// R3 H4: synthetic Ed25519, authority snapshots and incident races ONLY.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';
import {createH4OfflineAdmissionIssuer}
  from '../experiments/r3-h4-signed-admission-issuer.mjs';

const NOW=1700000000500;
const ID='device-stage-a';
const key=()=>generateKeyPairSync('ed25519');
const signature=(value,priv)=>sign(null,Buffer.from(value),priv).toString('base64url');
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
  const device=key(),receiptKey=key(),attestor=key();
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
    observedAtMs:NOW-1000,
    frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const canonical=canonicalOfflineEnvelope(envelope),digest=hash(canonical);
  const receipt={version:'floodguard-offline-receipt-v1',
    deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:NOW-250};
  const attestation={
    version:'floodguard-synthetic-persisted-attestation-v1',
    deviceId:ID,epoch:1,sequence:2,digest,
    acceptedAtMs:NOW-250,confirmedAtMs:NOW-100,
    scope:'prototype-ingest-v1',deviceEnabled:true,
    databaseState:'DATABASE_CONFIRMED'
  };
  const evidence={
    envelope,deviceSignature:signature(canonical,device.privateKey),
    receipt,receiptSignature:signature(JSON.stringify(receipt),receiptKey.privateKey),
    attestation,
    attestationSignature:signature(
      canonicalSyntheticPublicationAttestation(attestation),attestor.privateKey),
    databaseRecord:{deviceId:ID,epoch:1,sequence:2,digest,
      acceptedAtMs:NOW-250,status:'DATABASE_CONFIRMED'}
  };
  const state={
    revision:1,
    issuer:{enabled:true,generation:1,scope:'lab-signed-admission-v1'},
    publisher:{enabled:true,deviceId:ID,epoch:1,scope:'publication-lab-water-v1'},
    incident:{blocked:false,epoch:1},
    sourceBinding:{deviceId:ID,epoch:1,enabled:true,scope:'prototype-ingest-v1',
      publicKey:device.publicKey},
    trustedReceiptKey:receiptKey.publicKey,
    trustedDatabaseIssuerKey:attestor.publicKey,
    lastPublished:{initialized:true,epoch:1,sequence:1,digest:'a'.repeat(64)}
  };
  return {evidence,state,keys:{device,receiptKey,attestor}};
}
function authority(read){
  return Object.freeze({read});
}
function issuer(state,clock=()=>NOW){
  return createH4OfflineAdmissionIssuer({authority:authority(async()=>state),clock});
}
const refused=async (result)=>{
  const r=await result;
  assert.equal(r.issued,false,JSON.stringify(r));
  assert.equal(r.ticket,undefined);
  for(const k of ['canPublish','canWriteFirebase','canOperateGate','canSendAlert'])
    assert.equal(r[k],false);
  assert.equal(r.releaseDecision,'NO_GO');
  return r;
};

test('valid three-signer chain yields exact short-lived H3 admission candidate, not actual permission',async()=>{
  const {state,evidence}=fixture();
  const result=await issuer(state).issue(evidence);
  assert.equal(result.issued,true,JSON.stringify(result));
  assert.deepEqual({...result.ticket},{
    enabled:true,deviceId:ID,epoch:1,sequence:2,
    digest:evidence.receipt.digest,observedAtMs:NOW-1000,
    distanceCm:16.5,levelCm:8.5,status:'WARNING',
    issuedAtMs:NOW,expiresAtMs:NOW+4000
  });
  assert.deepEqual({...result.candidate.current},{
    distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs:NOW-1000,overallRisk:'UNKNOWN'
  });
  assert.equal(result.candidate.checkpoint.digest,evidence.receipt.digest);
  assert.equal(result.candidate.checkpoint.sequence,2);
  for(const v of [result,result.ticket,result.candidate,result.candidate.current,result.candidate.checkpoint])
    assert.equal(Object.isFrozen(v),true);
  for(const k of ['canPublish','canWriteFirebase','canOperateGate','canSendAlert',
    'canAcknowledge','physicalSourceVerified'])
    assert.equal(result[k],false,k);
  assert.equal(result.releaseDecision,'NO_GO');
});
test('any missing or forged source, receipt, attestor or confirmation evidence fails closed',async()=>{
  const {state,evidence}=fixture();
  for(const overrides of [
    {deviceSignature:'A'.repeat(86)},
    {receiptSignature:'A'.repeat(86)},
    {attestationSignature:'A'.repeat(86)},
    {attestation:undefined},
    {databaseRecord:{...evidence.databaseRecord,status:'PENDING'}},
    {databaseRecord:{...evidence.databaseRecord,digest:'f'.repeat(64)}},
    {receipt:{...evidence.receipt,acceptedAtMs:NOW-500}},
    {envelope:{...evidence.envelope,deviceId:'device-stage-b'}},
  ])await refused(issuer(state).issue({...evidence,...overrides}));
});
test('untrusted state and non-isolated signing keys cannot yield admission',async()=>{
  const {state,evidence,keys}=fixture();
  for(const patch of [
    {issuer:{...state.issuer,enabled:false}},
    {publisher:{...state.publisher,enabled:false}},
    {incident:{...state.incident,blocked:true}},
    {incident:undefined},
    {sourceBinding:{...state.sourceBinding,enabled:false}},
    {trustedDatabaseIssuerKey:keys.device.publicKey},
    {trustedReceiptKey:state.sourceBinding.publicKey},
    {revision:0},
    {lastPublished:{...state.lastPublished,initialized:false}},
    {lastPublished:{...state.lastPublished,sequence:2}},
    {lastPublished:{...state.lastPublished,epoch:2}},
  ])await refused(issuer({...state,...patch}).issue(evidence));
});
test('replayed, out-of-order or stale readings do not receive a fresh ticket',async()=>{
  const {state,evidence}=fixture();
  await refused(issuer({...state,lastPublished:{...state.lastPublished,sequence:2}})
    .issue(evidence));
  await refused(issuer(state,()=>NOW+6000).issue(evidence));
  await refused(issuer(state,()=>NOW-40000).issue(evidence));
});
test('revocation or incident toggle during issuance denies even if first authority read was valid',async()=>{
  const {state,evidence}=fixture();
  let count=0;
  const a=authority(async()=>{
    count++;
    return count===1?state:{...state,incident:{blocked:true,epoch:1},revision:2};
  });
  await refused(createH4OfflineAdmissionIssuer({authority:a,clock:()=>NOW}).issue(evidence));
  assert.equal(count,2);
});
test('checkpoint mutation without revision increment is still detected',async()=>{
  const {state,evidence}=fixture();
  let n=0;
  const a=authority(async()=>{
    n++;
    return n===1?state:{
      ...state,lastPublished:{...state.lastPublished,digest:'c'.repeat(64)}
    };
  });
  const result=await refused(createH4OfflineAdmissionIssuer({authority:a,clock:()=>NOW}).issue(evidence));
  assert.equal(result.reason,'authority-or-checkpoint-changed');
});
test('clock drift or loss during authority checks fails closed',async()=>{
  const {state,evidence}=fixture();
  for(const times of [[NOW,NOW+3000],[NOW,NOW-1],[NOW,NaN]]){
    let n=0;
    const result=await refused(issuer(state,()=>times[n++]).issue(evidence));
    assert.equal(result.reason,'clock-moved-or-unavailable');
  }
});
test('unavailable or throwing authority cannot grant admission',async()=>{
  const {evidence}=fixture();
  await refused(createH4OfflineAdmissionIssuer({
    authority:authority(async()=>{throw Error('lab read unavailable');}),
    clock:()=>NOW
  }).issue(evidence));
  assert.throws(()=>createH4OfflineAdmissionIssuer({
    authority:{read:async()=>({})},clock:()=>NOW}),TypeError);
});
test('injected caller role, unrecognized fields or direct tickets are not accepted as evidence',async()=>{
  const {state,evidence}=fixture();
  await refused(issuer(state).issue({...evidence,role:'owner'}));
  await refused(issuer(state).issue({...evidence,enabled:true}));
  await refused(issuer(state).issue({ticket:{enabled:true}}));
  await refused(issuer(state).issue(null));
});
test('issuer contains no cloud SDK, network/HTTP, private-key or device control code',()=>{
  const source=readFileSync(new URL(
    '../experiments/r3-h4-signed-admission-issuer.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from 'firebase-admin|from 'node:http|from 'node:https|from 'node:net/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\.listen\s*\(|setInsecure\s*\(/);
  assert.doesNotMatch(source,/writeFileSync\s*\(|servo\.write\s*\(|child_process/);
  assert.match(source,/releaseDecision:'NO_GO'/);
});
