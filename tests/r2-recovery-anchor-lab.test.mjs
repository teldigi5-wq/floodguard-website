// No RTDB connection, private credentials or device interfaces.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_RECOVERY_ANCHOR_VERSION,canonicalR2RecoveryAnchor,
  draftR2RecoveryAnchor,reviewR2RecoveryAnchor}
  from '../experiments/r2-recovery-anchor-lab.mjs';
const key=generateKeyPairSync('ed25519');
const reportKeys={water:generateKeyPairSync('ed25519'),
  rain:generateKeyPairSync('ed25519')};
const time=Date.UTC(2026,9,30,13,0,0);
const payload=(stream,sequence=1)=>({
  version:R2_PUBLIC_PROOF_VERSION,stream,
  sourceAlias:stream==='water'?'water-primary':'rain-primary',
  epoch:1,sequence,observedAtMs:time-2000,receivedAtMs:time-1000,
  sample:stream==='water'
    ? {distanceCm:17,levelCm:8,reportedStatus:'SAFE'}
    : {currentMm:1,dailyMm:11,reportedStatus:'NORMAL'}
});
const signedReport=p=>({
  payload:p,signature:sign(null,Buffer.from(canonicalR2PublicEvidence(p)),
    reportKeys[p.stream].privateKey).toString('base64url')
});
const externalAnchor=(stream,record)=>{
  const anchor=draftR2RecoveryAnchor(stream,record);
  return {anchor,signature:sign(null,Buffer.from(canonicalR2RecoveryAnchor(anchor)),
    key.privateKey).toString('base64url')};
};
const fixture=(stream='water')=>{
  const publicRecord=signedReport(payload(stream));
  return {stream,publicRecord,signedAnchor:externalAnchor(stream,publicRecord),
    trustedAnchorKey:key.publicKey,trustedReportKey:reportKeys[stream].publicKey};
};
const review=options=>reviewR2RecoveryAnchor(options);

test('operator-signed matching water and rain anchors validate independently',()=>{
  for(const stream of ['water','rain'])
    assert.deepEqual(review(fixture(stream)),{
      matches:true,kind:'OFFLINE_OPERATOR_ANCHOR_MATCH_NOT_DURABILITY_PROOF'
    });
});
test('canonical checkpoint refuses extra metadata, commands and malformed inputs',()=>{
  const x=fixture().signedAnchor.anchor;
  assert.equal(x.version,R2_RECOVERY_ANCHOR_VERSION);
  assert.equal(canonicalR2RecoveryAnchor(
    Object.fromEntries(Object.entries(x).reverse())
  ),canonicalR2RecoveryAnchor(x));
  for(const bad of [
    {...x,gateCommand:'OPEN'},
    {...x,ip:'192.0.2.1'},
    {...x,epoch:0},
    {...x,sequence:-1},
    {...x,sourceAlias:'other'},
    {...x,payloadDigest:'not-a-hash'}
  ])assert.throws(()=>canonicalR2RecoveryAnchor(bad));
});
test('a known higher external checkpoint detects syntactically valid older DB restore',()=>{
  for(const stream of ['water','rain']){
    const x=fixture(stream);
    const newer=signedReport(payload(stream,3));
    const anchor=externalAnchor(stream,newer);
    assert.equal(review({...x,signedAnchor:anchor}).reason,
      'database-behind-independent-anchor');
  }
});
test('database newer than operator anchor requires reconciliation, not inferred success',()=>{
  const x=fixture('water');
  assert.equal(review({...x,publicRecord:signedReport(payload('water',2))}).reason,
    'published-ahead-of-anchor-reconcile');
});
test('same sequence, different signed contents cannot masquerade as same checkpoint',()=>{
  const x=fixture('water'), p=x.publicRecord.payload;
  const changed=signedReport({...p,sample:{
    distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'
  }});
  assert.equal(review({...x,publicRecord:changed}).reason,
    'same-sequence-digest-conflict');
});
test('forged checkpoint signature, wrong trusted key and forged published frame fail',()=>{
  const x=fixture('rain'),untrusted=generateKeyPairSync('ed25519');
  assert.equal(review({...x,signedAnchor:{
    ...x.signedAnchor,signature:'A'.repeat(86)
  }}).reason,'anchor-signature-unverified');
  assert.equal(review({...x,trustedAnchorKey:untrusted.publicKey}).reason,
    'anchor-signature-unverified');
  assert.equal(review({...x,publicRecord:{
    ...x.publicRecord,signature:'A'.repeat(86)
  }}).reason,'published-signature-unverified');
  assert.equal(review({...x,signedAnchor:null}).reason,'anchor-unavailable');
  assert.equal(review({...x,trustedReportKey:null}).reason,'trusted-keys-unavailable');
});
test('water anchor never approves a rain checkpoint or an epoch rebinding',()=>{
  const water=fixture('water'),rain=fixture('rain');
  assert.equal(review({...rain,signedAnchor:water.signedAnchor}).reason,
    'anchor-stream-mismatch');
  const changed=signedReport({...water.publicRecord.payload,epoch:2});
  assert.equal(review({...water,publicRecord:changed}).reason,
    'authority-or-epoch-diverged');
});
test('recovery preflight never persists a checkpoint, contacts hardware or treats file rollback as safe',()=>{
  const source=readFileSync('experiments/r2-recovery-anchor-lab.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|node:https|node:http|sendMessage\s*\(/);
  assert.doesNotMatch(source,/writeFileSync|renameSync|mkdirSync|\.listen\s*\(/);
});
