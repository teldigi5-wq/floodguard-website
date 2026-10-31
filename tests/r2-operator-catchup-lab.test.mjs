import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_ISSUER_RECEIPT_VERSION,canonicalR2PublisherReceipt}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {canonicalR2RecoveryAnchor,draftR2RecoveryAnchor,
  reviewR2RecoveryAnchor}
  from '../experiments/r2-recovery-anchor-lab.mjs';
import {R2_CATCHUP_APPROVAL_VERSION,canonicalR2CatchupApproval,
  draftR2CatchupApproval,reviewR2OperatorCatchup}
  from '../experiments/r2-operator-catchup-lab.mjs';

const now=Date.UTC(2026,9,30,14,0,0);
const sets=Object.fromEntries(['water','rain'].map(s=>[
  s,Object.fromEntries(['report','receipt','anchor','approval'].map(role=>[
    role,generateKeyPairSync('ed25519')
  ]))
]));
const digest=txt=>createHash('sha256').update(txt,'utf8').digest('hex');
const signed=(str,key)=>sign(null,Buffer.from(str),key.privateKey)
  .toString('base64url');
const sample=s=>s==='water'
  ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
  :{currentMm:1,dailyMm:22,reportedStatus:'NORMAL'};
const p=(s,seq)=>({
  version:R2_PUBLIC_PROOF_VERSION,stream:s,
  sourceAlias:s==='water'?'water-primary':'rain-primary',
  epoch:1,sequence:seq,observedAtMs:now-3000,receivedAtMs:now-1500,
  sample:sample(s)
});
const record=(s,seq)=>{
  const payload=p(s,seq);
  return {payload,signature:signed(canonicalR2PublicEvidence(payload),
    sets[s].report)};
};
const anchor=(s,ref)=>{
  const draft=draftR2RecoveryAnchor(s,ref);
  return {anchor:draft,signature:signed(canonicalR2RecoveryAnchor(draft),
    sets[s].anchor)};
};
const receiptFor=(s,ref)=>{
  const v=ref.payload;
  const receipt={
    version:R2_ISSUER_RECEIPT_VERSION,stream:s,
    sourceAlias:v.sourceAlias,epoch:v.epoch,sequence:v.sequence,
    payloadDigest:digest(canonicalR2PublicEvidence(v)),
    acceptedAtMs:v.receivedAtMs
  };
  return {receipt,receiptSignature:signed(canonicalR2PublisherReceipt(receipt),
    sets[s].receipt)};
};
const approve=(s,inputs,approvedAtMs=now)=>{
  const approval=draftR2CatchupApproval({...inputs,approvedAtMs});
  return {approval,signature:signed(canonicalR2CatchupApproval(approval),
    sets[s].approval)};
};
function fixture(s='water',seq=2) {
  const publicRecord=record(s,seq);
  const signedAnchor=anchor(s,record(s,1));
  const receipt=receiptFor(s,publicRecord);
  const keys=sets[s];
  const x={stream:s,publicRecord,signedAnchor,...receipt,
    trustedReportKey:keys.report.publicKey,
    trustedReceiptKey:keys.receipt.publicKey,
    trustedAnchorKey:keys.anchor.publicKey,
    trustedApprovalKey:keys.approval.publicKey};
  // A sequence gap must be rejected before an operator approval is drafted.
  return {...x,signedApproval:seq===2?approve(s,x):null};
}
const review=x=>reviewR2OperatorCatchup(x);

test('water and rain need independent approval for an exact, single unanchored write',()=>{
  for(const s of ['water','rain']){
    const x=fixture(s),out=review(x);
    assert.deepEqual(out,{
      approved:true,kind:'OFFLINE_SIGNED_CATCHUP_PROPOSAL_NOT_PERSISTED',
      proposedAnchor:draftR2RecoveryAnchor(s,x.publicRecord),
      requiresIndependentAnchorSigning:true
    });
    assert.equal(reviewR2RecoveryAnchor(x).reason,
      'published-ahead-of-anchor-reconcile');
  }
});

test('operator catch-up cannot skip a missing sequence or silently rotate epoch',()=>{
  for(const s of ['water','rain']){
    assert.equal(review(fixture(s,3)).reason,'nonadjacent-checkpoint-gap');
    const x=fixture(s);
    const wrong=record(s,2);
    const updated={...wrong,payload:{...wrong.payload,epoch:2}};
    assert.equal(review({...x,publicRecord:updated}).reason,
      'checkpoint-not-ahead-or-unverified');
  }
});

test('replayed, swapped or forged operator signatures never approve',()=>{
  const water=fixture('water'),rain=fixture('rain');
  assert.equal(review({...water,signedApproval:{
    ...water.signedApproval,signature:'A'.repeat(86)
  }}).reason,'operator-approval-signature-invalid');
  assert.equal(review({...water,signedApproval:rain.signedApproval}).reason,
    'operator-approval-signature-invalid');
  assert.equal(review({...water,trustedApprovalKey:rain.trustedApprovalKey}).reason,
    'operator-approval-signature-invalid');
  assert.equal(review({...water,signedApproval:null}).reason,
    'operator-approval-unavailable');
  assert.equal(review({...water,signedApproval:{
    approval:water.signedApproval.approval,
    signature:'wrong'
  }}).reason,'operator-approval-unavailable');
});

test('receipt must be independently signed and refer to exactly the public record',()=>{
  for(const s of ['water','rain']){
    const x=fixture(s);
    assert.equal(review({...x,receiptSignature:'A'.repeat(86)}).reason,
      'receipt-signature-invalid');
    const modified={...x.receipt,payloadDigest:'0'.repeat(64)};
    assert.equal(review({...x,receipt:modified,
      receiptSignature:signed(canonicalR2PublisherReceipt(modified),
        sets[s].receipt)}).reason,'receipt-public-binding-invalid');
    const swapped=fixture(s==='water'?'rain':'water');
    assert.equal(review({...x,receipt:swapped.receipt,
      receiptSignature:swapped.receiptSignature}).reason,'receipt-signature-invalid');
  }
});

test('operator approval is bound to prior anchor, exact payload and signed receipt',()=>{
  const x=fixture('water');
  const modified={...x.signedApproval.approval,
    fromAnchorDigest:'0'.repeat(64)};
  assert.equal(review({...x,signedApproval:{
    approval:modified,
    signature:signed(canonicalR2CatchupApproval(modified),
      sets.water.approval)
  }}).reason,'operator-approval-binding-invalid');
  const modifiedReceipt={...x.signedApproval.approval,
    receiptDigest:'0'.repeat(64)};
  assert.equal(review({...x,signedApproval:{
    approval:modifiedReceipt,
    signature:signed(canonicalR2CatchupApproval(modifiedReceipt),
      sets.water.approval)
  }}).reason,'operator-approval-binding-invalid');
  const early={...x.signedApproval.approval,
    approvedAtMs:x.receipt.acceptedAtMs-1};
  assert.equal(review({...x,signedApproval:{
    approval:early,
    signature:signed(canonicalR2CatchupApproval(early),
      sets.water.approval)
  }}).reason,'operator-approval-binding-invalid');
});

test('all signer roles are distinct; one key cannot approve its own report',()=>{
  const x=fixture('rain');
  assert.equal(review({...x,trustedApprovalKey:x.trustedAnchorKey}).reason,
    'role-key-separation-invalid');
  assert.equal(review({...x,trustedReceiptKey:x.trustedReportKey}).reason,
    'role-key-separation-invalid');
  assert.equal(review({...x,trustedAnchorKey:null}).reason,
    'trusted-keys-unavailable');
});

test('operator approval only applies when external checkpoint is precisely behind',()=>{
  const x=fixture('water');
  const matched=anchor('water',x.publicRecord);
  assert.equal(review({...x,signedAnchor:matched}).reason,
    'checkpoint-not-ahead-or-unverified');
  const rollback=record('water',1);
  assert.equal(review({...x,publicRecord:rollback}).reason,
    'checkpoint-not-ahead-or-unverified');
  assert.equal(review({...x,signedAnchor:{
    ...x.signedAnchor,signature:'A'.repeat(86)
  }}).reason,'checkpoint-not-ahead-or-unverified');
});

test('canonical approval rejects extra metadata, nonadjacent gaps and commands',()=>{
  const x=fixture('water').signedApproval.approval;
  assert.equal(x.version,R2_CATCHUP_APPROVAL_VERSION);
  assert.equal(canonicalR2CatchupApproval(
    Object.fromEntries(Object.entries(x).reverse())
  ),canonicalR2CatchupApproval(x));
  for(const bad of [
    {...x,privateIp:'192.0.2.1'},
    {...x,gateCommand:'OPEN'},
    {...x,toSequence:x.fromSequence+2},
    {...x,fromSequence:0},
    {...x,toPayloadDigest:'wrong'},
    {...x,approvedAtMs:-1}
  ])assert.throws(()=>canonicalR2CatchupApproval(bad));
});

test('source is pure and contains no Firebase, file writes, signing key or endpoints',()=>{
  const source=readFileSync('experiments/r2-operator-catchup-lab.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|writeFileSync|renameSync|node:https|node:http/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\.set\s*\(|\.update\s*\(/);
});
