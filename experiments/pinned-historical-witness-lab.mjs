// FloodGuard R2/R3: independently PINNED witness verification experiment.
// NO witness issuance, remote connection, Firebase/Admin SDK, journal ACK,
// deletion, public writes, notification, or physical commands.
// A witness must originate in a separately governed, read-after-commit service;
// this synthetic verifier CANNOT establish that the signer actually did so.
import {createHash,KeyObject,verify} from 'node:crypto';
import {observeHistoricalOutboxRecordLab}
  from './historical-outbox-observer-lab.mjs';

const VERSION='floodguard-external-publication-witness-lab-v1';
const HEX=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const MAX_WITNESS_AGE_MS=30000;
const WITNESS_FIELDS=['version','deviceId','epoch','sequence','digest',
  'historyDigest','receiptSignerFingerprint','witnessedAtMs'];
const HISTORY_FIELDS=['schema','deviceId','epoch','issuerFingerprint','entries'];
const RECEIPT_FIELDS=['version','deviceId','epoch','sequence','digest','acceptedAtMs'];
const ENTRY_FIELDS=['sequence','digest','observedAtMs','distanceCm','levelCm',
  'status','overallRisk','receipt','receiptSignature'];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>obj(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const publicKey=x=>x instanceof KeyObject&&x.type==='public'&&
  x.asymmetricKeyType==='ed25519';
const digest=x=>createHash('sha256').update(x).digest('hex');
const fp=k=>digest(k.export({format:'der',type:'spki'}));
const deny=reason=>Object.freeze({observed:false,reason,canAcknowledge:false});

// Fixed-field ordering and *numeric* sequence order guarantee a stable hash
// across RTDB JSON key ordering and source JS object insertion order.
export function canonicalPublicationHistoryWitnessLab(history) {
  if(!exact(history,HISTORY_FIELDS)||!UID.test(history.deviceId)||
     !integer(history.epoch,1,10000)||!HEX.test(history.issuerFingerprint)||
     !obj(history.entries))throw TypeError('Invalid witness history');
  const names=Object.keys(history.entries);
  if(names.length<1||names.length>8)throw TypeError('Witness history capacity invalid');
  const pairs=names.map(key=>{
    if(!/^s_[1-9]\d*$/.test(key))throw TypeError('Noncanonical sequence key');
    const seq=Number(key.slice(2));
    if(!integer(seq,1,2147483647)||key!=='s_'+seq)
      throw TypeError('Invalid witness sequence');
    return [seq,key];
  }).sort((a,b)=>a[0]-b[0]);
  const rows=pairs.map(([seq,key])=>{
    const e=history.entries[key];
    if(!exact(e,ENTRY_FIELDS)||e.sequence!==seq||
       typeof e.digest!=='string'||!HEX.test(e.digest)||
       !integer(e.observedAtMs,946684800000,Number.MAX_SAFE_INTEGER)||
       typeof e.distanceCm!=='number'||!Number.isFinite(e.distanceCm)||
       typeof e.levelCm!=='number'||!Number.isFinite(e.levelCm)||
       typeof e.status!=='string'||e.overallRisk!=='UNKNOWN'||
       !exact(e.receipt,RECEIPT_FIELDS)||e.receipt.sequence!==seq||
       e.receipt.digest!==e.digest||
       typeof e.receiptSignature!=='string'||!SIG.test(e.receiptSignature))
      throw TypeError('Malformed historical witness entry');
    return [key,e.sequence,e.digest,e.observedAtMs,e.distanceCm,e.levelCm,
      e.status,e.overallRisk,...RECEIPT_FIELDS.map(k=>e.receipt[k]),
      e.receiptSignature];
  });
  return JSON.stringify([VERSION,'private-history-v1',history.schema,
    history.deviceId,history.epoch,history.issuerFingerprint,rows]);
}
function canonicalWitness(w) {
  if(!exact(w,WITNESS_FIELDS)||w.version!==VERSION||!UID.test(w.deviceId)||
     !integer(w.epoch,1,10000)||!integer(w.sequence,1,2147483647)||
     !HEX.test(w.digest)||!HEX.test(w.historyDigest)||
     !HEX.test(w.receiptSignerFingerprint)||
     !integer(w.witnessedAtMs,946684800000,Number.MAX_SAFE_INTEGER))
    throw TypeError('Invalid external witness');
  return JSON.stringify(Object.fromEntries(WITNESS_FIELDS.map(k=>[k,w[k]])));
}
/**
 * A positive result means a PINNED distinct witness signed THIS digest
 * at the supplied time. It does NOT prove: independent witness hardware,
 * monotonic external storage, physical truth, end-user alert delivery,
 * or that a privileged operator cannot forge the input root.
 * NEVER use a client-supplied witness key/pin or this result for queue ACK.
 */
export function observePinnedHistoricalWitnessLab({
  pending,root,sourceBinding,trustedReceiptKey,nowMs,
  witness,witnessSignature,trustedWitnessKey,expectedWitnessFingerprint
}={}) {
  try {
    const base=observeHistoricalOutboxRecordLab({
      pending,root,sourceBinding,trustedReceiptKey,nowMs
    });
    if(base.observed!==true)return deny('historical-proof-unavailable');
    if(!publicKey(trustedWitnessKey)||!publicKey(trustedReceiptKey)||
       typeof expectedWitnessFingerprint!=='string'||
       !HEX.test(expectedWitnessFingerprint)||
       expectedWitnessFingerprint!==fp(trustedWitnessKey)||
       expectedWitnessFingerprint===fp(trustedReceiptKey))
      return deny('independent-witness-key-not-pinned');
    const bytes=canonicalWitness(witness);
    const checkpoint=root.projectionControl.devices[pending.envelope.deviceId];
    const history=root.publicationHistoryV1;
    if(witness.deviceId!==pending.envelope.deviceId||
       witness.epoch!==pending.envelope.epoch||
       witness.sequence!==checkpoint.sequence||
       witness.digest!==checkpoint.digest||
       witness.receiptSignerFingerprint!==fp(trustedReceiptKey)||
       witness.historyDigest!==digest(canonicalPublicationHistoryWitnessLab(history)))
      return deny('external-witness-snapshot-mismatch');
    const latest=history.entries['s_'+checkpoint.sequence];
    if(!latest||witness.witnessedAtMs<latest.receipt.acceptedAtMs||
       witness.witnessedAtMs>nowMs+2000||
       nowMs-witness.witnessedAtMs>MAX_WITNESS_AGE_MS)
      return deny('external-witness-clock-unverified');
    if(typeof witnessSignature!=='string'||!SIG.test(witnessSignature))
      return deny('external-witness-signature-invalid');
    const signature=Buffer.from(witnessSignature,'base64url');
    if(signature.length!==64||
       !verify(null,Buffer.from(bytes),trustedWitnessKey,signature))
      return deny('external-witness-signature-invalid');
    return Object.freeze({
      observed:true,kind:'PINNED_EXTERNAL_WITNESS_MATCH_LAB_ONLY',
      sequence:pending.sequence,digest:pending.digest,
      latestSequence:checkpoint.sequence,witnessedAtMs:witness.witnessedAtMs,
      canAcknowledge:false,sourceFreshness:'NOT_CERTIFIED',
      floodClearance:'UNKNOWN',notificationDelivery:'NOT_VERIFIED',
      physicalGatePosition:'UNVERIFIED'
    });
  }catch{return deny('external-witness-unavailable');}
}
