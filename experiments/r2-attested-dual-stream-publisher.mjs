// Stage R2: synthetic-only server-receipt preflight and restricted RTDB
// Emulator publisher. This is NOT a deployable gateway, trusted backend,
// hardware attestation, real issuer registry, or production Firestore/RTDB code.
// Trust anchors and registry binding MUST originate independently from a
// privileged operator; accepting them from callers is unsafe in production.
import {createHash, KeyObject, verify} from 'node:crypto';
import {canonicalR2PublicEvidence,verifyR2PublicEvidence}
  from './r2-dual-stream-public-evidence.mjs';

const LAB_VERSION='floodguard-r2-publisher-receipt-lab-v1';
const RECEIPT_FIELDS=[
  'version','stream','sourceAlias','epoch','sequence',
  'payloadDigest','acceptedAtMs'
];
const BINDING_FIELDS=[
  'stream','sourceAlias','epoch','enabled','scope',
  'reportSignerFingerprint','receiptSignerFingerprint'
];
const EPOCH_MAX=10000;
const SEQUENCE_MAX=2147483647;
const MIN_MS=Date.UTC(2000,0,1);
const digestPattern=/^[a-f0-9]{64}$/;
const signaturePattern=/^[A-Za-z0-9_-]{86}$/;
const recordObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v) &&
  (Object.getPrototypeOf(v)===Object.prototype ||
    Object.getPrototypeOf(v)===null);
const exact=(v,keys)=>recordObject(v)&&Object.keys(v).length===keys.length &&
  keys.every(k=>Object.hasOwn(v,k));
const number=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const isKey=k=>k instanceof KeyObject&&k.type==='public' &&
  k.asymmetricKeyType==='ed25519';
const deny=reason=>Object.freeze({published:false,reason});
const fingerprint=k=>createHash('sha256')
  .update(k.export({type:'spki',format:'der'})).digest('hex');
const sha256=str=>createHash('sha256').update(str,'utf8').digest('hex');

export const R2_ISSUER_RECEIPT_VERSION=LAB_VERSION;

export function canonicalR2PublisherReceipt(value) {
  if (!exact(value,RECEIPT_FIELDS) ||
      value.version!==LAB_VERSION ||
      (value.stream!=='water'&&value.stream!=='rain') ||
      value.sourceAlias!==(value.stream==='water'?'water-primary':'rain-primary') ||
      !number(value.epoch,1,EPOCH_MAX) ||
      !number(value.sequence,1,SEQUENCE_MAX) ||
      typeof value.payloadDigest!=='string' ||
      !digestPattern.test(value.payloadDigest) ||
      !number(value.acceptedAtMs,MIN_MS,Number.MAX_SAFE_INTEGER))
    throw new TypeError('Invalid synthetic receipt contract');
  return JSON.stringify({
    version:LAB_VERSION,stream:value.stream,
    sourceAlias:value.sourceAlias,epoch:value.epoch,
    sequence:value.sequence,payloadDigest:value.payloadDigest,
    acceptedAtMs:value.acceptedAtMs
  });
}

/**
 * Plan without any IO. An operator-provisioned binding pins two independent
 * public keys; a valid report alone is insufficient without a signed server
 * acceptance receipt and matching source/epoch/digest/receipt timestamp.
 * Signed proof means lab report integrity only, not physical sensor accuracy.
 */
export function planR2AttestedLabPublication({
  stream,record,receipt,receiptSignature,trustedReportKey,trustedReceiptKey,
  registryBinding,nowMs
}={}) {
  try {
    if ((stream!=='water'&&stream!=='rain') ||
        !isKey(trustedReportKey)||!isKey(trustedReceiptKey) ||
        !exact(registryBinding,BINDING_FIELDS) ||
        registryBinding.stream!==stream ||
        registryBinding.sourceAlias!==(stream==='water'?'water-primary':'rain-primary') ||
        registryBinding.enabled!==true ||
        registryBinding.scope!==(stream==='water'
          ? 'r2-water-publish-v1':'r2-rain-publish-v1') ||
        registryBinding.reportSignerFingerprint!==fingerprint(trustedReportKey) ||
        registryBinding.receiptSignerFingerprint!==fingerprint(trustedReceiptKey))
      return deny('operator-trust-unverified');

    const current=verifyR2PublicEvidence({
      stream,record,trustedPublicKey:trustedReportKey,
      connected:true,nowMs
    });
    if (current.accepted!==true)
      return deny('signed-report-'+current.reason);

    const payload=record.payload;
    if (!exact(receipt,RECEIPT_FIELDS) ||
        typeof receiptSignature!=='string' ||
        !signaturePattern.test(receiptSignature))
      return deny('receipt-invalid');

    const canonical=canonicalR2PublisherReceipt(receipt);
    const signatureBytes=Buffer.from(receiptSignature,'base64url');
    if (signatureBytes.length!==64 ||
        !verify(null,Buffer.from(canonical,'utf8'),
          trustedReceiptKey,signatureBytes))
      return deny('receipt-signature-unverified');
    const reportDigest=sha256(canonicalR2PublicEvidence(payload));
    if (receipt.stream!==stream ||
        receipt.sourceAlias!==payload.sourceAlias ||
        receipt.epoch!==payload.epoch ||
        receipt.sequence!==payload.sequence ||
        receipt.payloadDigest!==reportDigest ||
        receipt.acceptedAtMs!==payload.receivedAtMs ||
        payload.epoch!==registryBinding.epoch)
      return deny('receipt-binding-mismatch');

    // No untrusted path concatenation; only two fixed and reviewed locations.
    const path=stream==='water'
      ? '/floodguard/evidenceLabV1/water'
      : '/floodguard/evidenceLabV1/rain';
    return Object.freeze({
      allowed:true,kind:'SYNTHETIC_ATTESTED_PLAN_NOT_APPLIED',path
    });
  }catch{
    return deny('invalid-publication-input');
  }
}

function verifiedHistoricalRecord(record,stream,trustedKey) {
  if (!exact(record,['payload','signature']) ||
      typeof record.signature!=='string' ||
      !signaturePattern.test(record.signature) ||
      record.payload?.stream!==stream) return false;
  try {
    const canonical=canonicalR2PublicEvidence(record.payload);
    const bytes=Buffer.from(record.signature,'base64url');
    return bytes.length===64 && verify(null,Buffer.from(canonical,'utf8'),
      trustedKey,bytes);
  }catch{return false;}
}

/**
 * Only the local demo RTDB may be accessed. This adapter has no Admin SDK,
 * root transaction, network endpoint, secrets or credentials. Its database
 * is the separately-scoped rules-unit-testing publisher client. The
 * server-side RTDB rule enforces monotonicity atomically across races; a
 * previous .get() is an audit preflight, NOT a concurrency primitive.
 */
export async function publishR2AttestedLabReport({
  database,stream,record,receipt,receiptSignature,
  trustedReportKey,trustedReceiptKey,registryBinding,nowMs
}={}) {
  if (process.env.FG_R2_ATTESTED_PUBLISHER_LAB_TEST!=='1' ||
      process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
    return deny('emulator-only');
  if (!database || typeof database.ref!=='function')
    return deny('scoped-database-unavailable');
  const plan=planR2AttestedLabPublication({
    stream,record,receipt,receiptSignature,trustedReportKey,trustedReceiptKey,
    registryBinding,nowMs
  });
  if (plan.allowed!==true)return plan;
  try {
    const ref=database.ref(plan.path);
    // Existing operator-seeded state is mandatory. If corrupted or replaced
    // by a forged signed record, an operator must explicitly reconcile it;
    // no silent reset, new key enrollment, or epoch rotation.
    const current=(await ref.get()).val();
    if (!verifiedHistoricalRecord(current,stream,trustedReportKey))
      return deny('published-checkpoint-unverified');
    const old=current.payload,next=record.payload;
    if (old.sourceAlias!==next.sourceAlias ||
        old.epoch!==next.epoch ||
        next.sequence<=old.sequence ||
        next.observedAtMs<old.observedAtMs ||
        next.receivedAtMs<old.receivedAtMs)
      return deny('publication-replay-or-rollback');
    // RTDB .set at this single leaf is atomic and its Security Rules
    // recheck the checkpoint under concurrent callers. Never write siblings.
    await ref.set(record);
    return Object.freeze({
      published:true,kind:'OFFLINE_EMULATOR_ATTESTED_PUBLISH_NOT_PRODUCTION'
    });
  }catch {
    // On transport loss the server MAY have committed. Do not retry blindly
    // or claim rollback; operator-side checkpoint reconciliation is required.
    return deny('publication-outcome-unconfirmed');
  }
}
