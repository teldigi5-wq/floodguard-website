// Pure unit tests; no network, Firebase credentials, hardware or messages.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {canonicalR2PublisherReceipt,planR2AttestedLabPublication,
  R2_ISSUER_RECEIPT_VERSION}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';

const now=Date.UTC(2026,9,30,13,0,0);
const keys={water:{
  report:generateKeyPairSync('ed25519'),issuer:generateKeyPairSync('ed25519')
},rain:{
  report:generateKeyPairSync('ed25519'),issuer:generateKeyPairSync('ed25519')
}};
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fingerprint=key=>createHash('sha256')
  .update(key.export({type:'spki',format:'der'})).digest('hex');
const payload=(stream,sequence=2,overrides={})=>({
  version:R2_PUBLIC_PROOF_VERSION,stream,
  sourceAlias:stream==='water'?'water-primary':'rain-primary',
  epoch:1,sequence,observedAtMs:now-3000,receivedAtMs:now-1500,
  sample:stream==='water'
    ? {distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
    : {currentMm:1,dailyMm:12,reportedStatus:'NORMAL'},...overrides
});
const make=(stream='water',sequence=2)=>{
  const source=keys[stream],p=payload(stream,sequence);
  const canonical=canonicalR2PublicEvidence(p);
  const record={payload:p,signature:sign(null,Buffer.from(canonical),
    source.report.privateKey).toString('base64url')};
  const receipt={version:R2_ISSUER_RECEIPT_VERSION,stream,
    sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    payloadDigest:digest(canonical),acceptedAtMs:p.receivedAtMs};
  const receiptSignature=sign(null,
    Buffer.from(canonicalR2PublisherReceipt(receipt)),
    source.issuer.privateKey).toString('base64url');
  const registryBinding={
    stream,sourceAlias:p.sourceAlias,epoch:1,enabled:true,
    scope:stream==='water'?'r2-water-publish-v1':'r2-rain-publish-v1',
    reportSignerFingerprint:fingerprint(source.report.publicKey),
    receiptSignerFingerprint:fingerprint(source.issuer.publicKey)
  };
  return {stream,record,receipt,receiptSignature,
    trustedReportKey:source.report.publicKey,
    trustedReceiptKey:source.issuer.publicKey,
    registryBinding,nowMs:now};
};
const plan=inputs=>planR2AttestedLabPublication(inputs);

test('independent water/rain signatures and operator pins yield only fixed plans',()=>{
  assert.deepEqual(plan(make('water')),{
    allowed:true,kind:'SYNTHETIC_ATTESTED_PLAN_NOT_APPLIED',
    path:'/floodguard/evidenceLabV1/water'
  });
  assert.deepEqual(plan(make('rain')),{
    allowed:true,kind:'SYNTHETIC_ATTESTED_PLAN_NOT_APPLIED',
    path:'/floodguard/evidenceLabV1/rain'
  });
});
test('independent receipt issuer cannot be substituted by a report signer',()=>{
  const x=make('water'),other=make('rain');
  assert.equal(plan({...x,trustedReceiptKey:x.trustedReportKey}).reason,
    'operator-trust-unverified');
  assert.equal(plan({...x,trustedReceiptKey:other.trustedReceiptKey}).reason,
    'operator-trust-unverified');
  assert.equal(plan({...x,receiptSignature:other.receiptSignature}).reason,
    'receipt-signature-unverified');
});
test('tampered report and copied/replayed receipt do not authorize publication',()=>{
  const x=make('water');
  const bad={...x.record.payload,sample:{
    ...x.record.payload.sample,distanceCm:14,levelCm:11
  }};
  assert.equal(plan({...x,record:{...x.record,payload:bad}}).reason,
    'signed-report-signature-unverified');
  const copied=make('water',3);
  assert.equal(plan({...x,receipt:copied.receipt,
    receiptSignature:copied.receiptSignature}).reason,
    'receipt-binding-mismatch');
});
test('validly re-signed but mismatched receipt time, digest, epoch and stream fail',()=>{
  for(const stream of ['water','rain']){
    const x=make(stream),privateKey=keys[stream].issuer.privateKey;
    for(const invalid of [
      {...x.receipt,acceptedAtMs:x.receipt.acceptedAtMs+1},
      {...x.receipt,epoch:2},
      {...x.receipt,sequence:3},
      {...x.receipt,payloadDigest:'0'.repeat(64)},
      {...x.receipt,sourceAlias:'unknown'},
      {...x.receipt,stream:stream==='water'?'rain':'water'}
    ]){
      const signature=sign(null,
        Buffer.from(canonicalR2PublisherReceipt(invalid)),privateKey)
        .toString('base64url');
      assert.equal(plan({...x,receipt:invalid,receiptSignature:signature}).reason,
        'receipt-binding-mismatch');
    }
  }
});
test('revoked operator pin or wrong stream scope cannot publish a signed report',()=>{
  const x=make('rain');
  for(const changes of [
    {enabled:false},{scope:'r2-water-publish-v1'},
    {stream:'water'},{epoch:2},
    {reportSignerFingerprint:'0'.repeat(64)},
    {receiptSignerFingerprint:'0'.repeat(64)}
  ])assert.equal(plan({...x,registryBinding:{...x.registryBinding,...changes}}).reason,
    changes.epoch===2?'receipt-binding-mismatch':'operator-trust-unverified');
});
test('missing, malformed or unsafe time cannot be used as a server receipt',()=>{
  const x=make('water');
  for(const malformed of [null,undefined,{},{
    ...x.receipt,privateKey:'TEST'
  },{
    ...x.receipt,acceptedAtMs:-1
  }])assert.equal(plan({...x,receipt:malformed}).allowed,false);
  assert.equal(plan({...x,nowMs:now+60000}).reason,
    'signed-report-source-not-current');
});
test('canonical receipt is stable, rejects command fields and unsafe sequence',()=>{
  const x=make('water'),reversed=Object.fromEntries(
    Object.entries(x.receipt).reverse()
  );
  assert.equal(canonicalR2PublisherReceipt(reversed),
    canonicalR2PublisherReceipt(x.receipt));
  assert.throws(()=>canonicalR2PublisherReceipt({
    ...x.receipt,gateCommand:'OPEN'
  }));
  assert.throws(()=>canonicalR2PublisherReceipt({
    ...x.receipt,sequence:0
  }));
  assert.throws(()=>canonicalR2PublisherReceipt({
    ...x.receipt,payloadDigest:'not-a-hash'
  }));
});
test('publisher module contains no real endpoint, admin SDK or device driver',()=>{
  const source=readFileSync('experiments/r2-attested-dual-stream-publisher.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|node:https|node:http/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\.listen\s*\(/);
  assert.match(source,/FG_R2_ATTESTED_PUBLISHER_LAB_TEST/);
});
