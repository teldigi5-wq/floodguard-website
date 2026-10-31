// FloodGuard R2: operator-approved catch-up after a confirmed public write
// and an unadvanced external recovery anchor. OFFLINE/EMULATOR LAB ONLY.
// NO NETWORK, FILE IO, KEY GENERATION, AUTOMATIC REPAIR OR TRUST ENROLLMENT.
// All trusted keys/approvals are independent test fixtures. This cannot
// establish durable antirollback without an external nonrollback authority.
import {createHash,KeyObject,verify} from 'node:crypto';
import {canonicalR2PublicEvidence}
  from './r2-dual-stream-public-evidence.mjs';
import {canonicalR2PublisherReceipt}
  from './r2-attested-dual-stream-publisher.mjs';
import {canonicalR2RecoveryAnchor,draftR2RecoveryAnchor,
  reviewR2RecoveryAnchor}
  from './r2-recovery-anchor-lab.mjs';

const VERSION='floodguard-r2-operator-catchup-lab-v1';
const FIELDS=['version','stream','sourceAlias','epoch','fromSequence',
  'fromAnchorDigest','toSequence','toPayloadDigest','receiptDigest',
  'approvedAtMs'];
const own=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||
   Object.getPrototypeOf(v)===null);
const exact=(v,keys)=>own(v)&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));
const count=v=>Number.isSafeInteger(v)&&v>=1&&v<=2147483647;
const integer=v=>Number.isSafeInteger(v)&&v>=Date.UTC(2000,0,1);
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const key=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const sig=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{86}$/.test(s)&&
  Buffer.from(s,'base64url').length===64;
const fail=reason=>Object.freeze({approved:false,reason});
const spki=k=>hash(k.export({type:'spki',format:'der'}).toString('base64'));

export const R2_CATCHUP_APPROVAL_VERSION=VERSION;

/**
 * The operator must sign exactly this one-step catch-up request after an
 * out-of-band audit. The receipt digest and anchor digest prevent an approval
 * from being moved to a different publication or prior checkpoint.
 */
export function canonicalR2CatchupApproval(approval) {
  if(!exact(approval,FIELDS)||
     approval.version!==VERSION||
     (approval.stream!=='water'&&approval.stream!=='rain')||
     approval.sourceAlias!==(approval.stream==='water'
       ?'water-primary':'rain-primary')||
     !Number.isSafeInteger(approval.epoch)||approval.epoch<1||
     approval.epoch>10000||
     !count(approval.fromSequence)||!count(approval.toSequence)||
     approval.toSequence!==approval.fromSequence+1||
     !hex(approval.fromAnchorDigest)||!hex(approval.toPayloadDigest)||
     !hex(approval.receiptDigest)||!integer(approval.approvedAtMs))
    throw new TypeError('Invalid recovery catch-up approval');
  return JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,approval[k]])));
}

/**
 * Prepares an unsigned request for deliberate operator review. It neither
 * signs nor approves it. The signed external anchor must already be trusted.
 */
export function draftR2CatchupApproval({
  stream,publicRecord,signedAnchor,receipt,approvedAtMs
}={}) {
  if(stream!=='water'&&stream!=='rain')
    throw new TypeError('Invalid stream');
  const next=draftR2RecoveryAnchor(stream,publicRecord);
  const previous=canonicalR2RecoveryAnchor(signedAnchor?.anchor);
  const receiptCanonical=canonicalR2PublisherReceipt(receipt);
  const from=signedAnchor.anchor;
  const draft={
    version:VERSION,stream,sourceAlias:next.sourceAlias,
    epoch:next.epoch,fromSequence:from.sequence,
    fromAnchorDigest:hash(previous),toSequence:next.sequence,
    toPayloadDigest:next.payloadDigest,
    receiptDigest:hash(receiptCanonical),approvedAtMs
  };
  canonicalR2CatchupApproval(draft);
  return Object.freeze(draft);
}

/**
 * Verify a deliberately signed one-step reconciliation after a confirmed
 * write was missed by an external operator checkpoint. NEVER auto-sign,
 * auto-persist, reset the stream, rotate a key, or advance an operator ledger.
 * This returns a proposal that MUST be independently countersigned/stored.
 */
export function reviewR2OperatorCatchup({
  stream,publicRecord,signedAnchor,receipt,receiptSignature,
  signedApproval,trustedReportKey,trustedReceiptKey,
  trustedAnchorKey,trustedApprovalKey
}={}) {
  try {
    if(stream!=='water'&&stream!=='rain'||
       ![trustedReportKey,trustedReceiptKey,trustedAnchorKey,
         trustedApprovalKey].every(key))
      return fail('trusted-keys-unavailable');

    // Separate test roles are mandatory; a signer cannot self-approve.
    const pins=[trustedReportKey,trustedReceiptKey,
      trustedAnchorKey,trustedApprovalKey].map(spki);
    if(new Set(pins).size!==4)return fail('role-key-separation-invalid');

    const state=reviewR2RecoveryAnchor({
      stream,publicRecord,signedAnchor,
      trustedAnchorKey,trustedReportKey
    });
    if(state.reason!=='published-ahead-of-anchor-reconcile')
      return fail('checkpoint-not-ahead-or-unverified');

    if(!exact(receipt,['version','stream','sourceAlias','epoch','sequence',
        'payloadDigest','acceptedAtMs'])||!sig(receiptSignature))
      return fail('receipt-unavailable');
    const canonicalReceipt=canonicalR2PublisherReceipt(receipt);
    if(!verify(null,Buffer.from(canonicalReceipt),
        trustedReceiptKey,Buffer.from(receiptSignature,'base64url')))
      return fail('receipt-signature-invalid');

    const actual=publicRecord.payload;
    const hashOfPublic=hash(canonicalR2PublicEvidence(actual));
    if(receipt.stream!==stream||
       receipt.sourceAlias!==actual.sourceAlias||
       receipt.epoch!==actual.epoch||
       receipt.sequence!==actual.sequence||
       receipt.payloadDigest!==hashOfPublic||
       receipt.acceptedAtMs!==actual.receivedAtMs)
      return fail('receipt-public-binding-invalid');

    const from=signedAnchor.anchor;
    // Only one unanchored write can be ratified with one approval.
    if(actual.sequence!==from.sequence+1)
      return fail('nonadjacent-checkpoint-gap');

    if(!exact(signedApproval,['approval','signature'])||
       !sig(signedApproval.signature))
      return fail('operator-approval-unavailable');
    const canonicalApproval=canonicalR2CatchupApproval(
      signedApproval.approval
    );
    if(!verify(null,Buffer.from(canonicalApproval),
        trustedApprovalKey,
        Buffer.from(signedApproval.signature,'base64url')))
      return fail('operator-approval-signature-invalid');
    const expected=draftR2CatchupApproval({
      stream,publicRecord,signedAnchor,receipt,
      approvedAtMs:signedApproval.approval.approvedAtMs
    });
    if(canonicalR2CatchupApproval(expected)!==canonicalApproval||
       signedApproval.approval.approvedAtMs<receipt.acceptedAtMs)
      return fail('operator-approval-binding-invalid');

    return Object.freeze({
      approved:true,
      kind:'OFFLINE_SIGNED_CATCHUP_PROPOSAL_NOT_PERSISTED',
      proposedAnchor:draftR2RecoveryAnchor(stream,publicRecord),
      requiresIndependentAnchorSigning:true
    });
  }catch{
    return fail('invalid-catchup-evidence');
  }
}