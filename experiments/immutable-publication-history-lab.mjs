// FloodGuard: append-only per-reading PUBLICATION EVIDENCE rehearsal.
// This is a PURE CANDIDATE for the loopback RTDB Emulator, not a publisher,
// credential handler, alert sender, hardware actuator, or outbox ACK.
// Existing PR #39 source authorization, signed receipt and scalar projection
// are evaluated first. All evidence is private, not under publicTelemetryLabV1.
import {createHash,KeyObject} from 'node:crypto';
import {deriveIsolatedAtomicWaterStateLab}
  from './isolated-atomic-water-state-lab.mjs';
import {verifyStage8OfflineReceipt}
  from './stage8-ack-reconciliation.mjs';

const SCHEMA='floodguard-immutable-publication-history-lab-v1';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const MAX_RECORDS=8; // test backpressure, not production sizing
// A string prefix prevents RTDB's dense numeric map -> Array conversion.
const seqKey=n=>'s_'+n;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,ks)=>obj(x)&&Object.keys(x).length===ks.length&&
  ks.every(k=>Object.hasOwn(x,k));
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const deny=reason=>Object.freeze({allowed:false,reason});
const receiptKeys=['version','deviceId','epoch','sequence','digest','acceptedAtMs'];
const entryKeys=['sequence','digest','observedAtMs','distanceCm','levelCm',
  'status','overallRisk','receipt','receiptSignature'];
const historyKeys=['schema','deviceId','epoch','issuerFingerprint','entries'];
const sigKey=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const fingerprint=k=>createHash('sha256').update(
  k.export({type:'spki',format:'der'})).digest('hex');

function validEntry(entry,uid,epoch,trustedReceiptKey) {
  if(!exact(entry,entryKeys)||!int(entry.sequence,1,2147483647)||
     typeof entry.digest!=='string'||!HEX.test(entry.digest)||
     !int(entry.observedAtMs,946684800000,8640000000000000)||
     typeof entry.distanceCm!=='number'||!Number.isFinite(entry.distanceCm)||
     entry.distanceCm<=0||entry.distanceCm>25||
     typeof entry.levelCm!=='number'||!Number.isFinite(entry.levelCm)||
     entry.levelCm<0||entry.levelCm>25||
     Math.abs(entry.levelCm-(25-entry.distanceCm))>0.05||
     !['SAFE','WARNING','DANGER','SENSOR_ERROR'].includes(entry.status)||
     entry.overallRisk!=='UNKNOWN'||!exact(entry.receipt,receiptKeys)||
     typeof entry.receiptSignature!=='string'||!SIG.test(entry.receiptSignature))
    return false;
  const expected=entry.levelCm>=11?'DANGER':entry.levelCm>=8.5?'WARNING':'SAFE';
  if(entry.status!=='SENSOR_ERROR'&&entry.status!==expected)return false;
  const r=entry.receipt;
  if(r.deviceId!==uid||r.epoch!==epoch||r.sequence!==entry.sequence||
     r.digest!==entry.digest||!int(r.acceptedAtMs,entry.observedAtMs,8640000000000000))
    return false;
  return verifyStage8OfflineReceipt({
    receipt:r,signature:entry.receiptSignature,publicKey:trustedReceiptKey,
    expected:{deviceId:uid,epoch,sequence:entry.sequence,digest:entry.digest}
  });
}

function validateHistory(current,uid,epoch,issuerFingerprint,trustedReceiptKey) {
  const checkpoint=current.projectionControl?.devices?.[uid];
  const existing=current.publicationHistoryV1;
  if(checkpoint?.initialized===false) {
    if(existing!==undefined&&existing!==null)
      return {error:'unexpected-prepublication-history'};
    return {entries:{}};
  }
  if(checkpoint?.initialized!==true||!exact(existing,historyKeys)||
     existing.schema!==SCHEMA||existing.deviceId!==uid||
     existing.epoch!==epoch||existing.issuerFingerprint!==issuerFingerprint||
     !obj(existing.entries))
    return {error:'publication-history-unavailable'};
  const keys=Object.keys(existing.entries);
  if(keys.length<1||keys.length>MAX_RECORDS)
    return {error:'publication-history-invalid'};
  const sorted=keys.map(k=>/^s_[1-9]\\d*$/.test(k)?Number(k.slice(2)):NaN)
    .sort((a,b)=>a-b);
  if(sorted.some((n,i)=>!int(n,1,2147483647)||!keys.includes(seqKey(n))||
     (i>0&&sorted[i-1]>=n)))return {error:'publication-history-invalid'};
  let previousTime=0,previousAccepted=0;
  for(const sequence of sorted) {
    const entry=existing.entries[seqKey(sequence)];
    if(!validEntry(entry,uid,epoch,trustedReceiptKey)||
       entry.sequence!==sequence||
       entry.observedAtMs<previousTime||
       entry.receipt.acceptedAtMs<previousAccepted)
      return {error:'publication-history-corrupt'};
    previousTime=entry.observedAtMs;
    previousAccepted=entry.receipt.acceptedAtMs;
  }
  const last=existing.entries[seqKey(sorted.at(-1))],publicState=current.publicTelemetryLabV1;
  if(last.sequence!==checkpoint.sequence||last.digest!==checkpoint.digest||
     publicState?.water?.distanceCm!==last.distanceCm||
     publicState?.water?.levelCm!==last.levelCm||
     publicState?.water?.status!==last.status||
     publicState?.system?.lastUpdate!==last.observedAtMs||
     publicState?.system?.overallRisk!==last.overallRisk)
    return {error:'publication-history-checkpoint-diverged'};
  return {entries:existing.entries,last};
}

/**
 * Must be called only inside one controlled emulator transaction over the
 * full private /floodguard snapshot; never from an untrusted HTTP body.
 * A successful candidate is NOT a cloud ACK and NEVER prunes an outbox.
 */
export function deriveHistoricalAtomicWaterStateLab({
  current,envelope,receipt,signature,trustedReceiptKey,nowMs
}={}) {
  const core=deriveIsolatedAtomicWaterStateLab({
    current,envelope,receipt,signature,trustedReceiptKey,nowMs
  });
  if(core.allowed!==true)return deny(core.reason||'base-publication-denied');
  const uid=envelope.deviceId,issuerFingerprint=sigKey(trustedReceiptKey)
    ?fingerprint(trustedReceiptKey):'';
  if(!UID.test(uid)||!HEX.test(issuerFingerprint)||
     current.projectionControl.waterAuthority.receiptSignerFingerprint!==issuerFingerprint||
     !exact(receipt,receiptKeys)||
     receipt.deviceId!==uid||receipt.epoch!==envelope.epoch||
     receipt.sequence!==envelope.frame.sequence||
     receipt.digest!==core.next.projectionControl.devices[uid].digest||
     receipt.acceptedAtMs!==current.confirmedIngest[uid].acceptedAtMs||
     !verifyStage8OfflineReceipt({receipt,signature,publicKey:trustedReceiptKey,
       expected:{deviceId:uid,epoch:envelope.epoch,
         sequence:envelope.frame.sequence,digest:receipt.digest}}))
    return deny('publication-evidence-signature-unverified');

  const existing=validateHistory(current,uid,envelope.epoch,
    issuerFingerprint,trustedReceiptKey);
  if(existing.error)return deny(existing.error);
  if(Object.keys(existing.entries).length>=MAX_RECORDS)
    return deny('publication-evidence-capacity-reached');
  const previous=existing.last;
  if(previous&&(envelope.observedAtMs<previous.observedAtMs||
     receipt.acceptedAtMs<previous.receipt.acceptedAtMs))
    return deny('publication-evidence-time-regression');

  const sequence=envelope.frame.sequence;
  if(Object.hasOwn(existing.entries,seqKey(sequence)))
    return deny('publication-evidence-replay');
  const record={
    sequence,digest:receipt.digest,
    observedAtMs:envelope.observedAtMs,
    distanceCm:envelope.frame.distanceCm,
    levelCm:envelope.frame.levelCm,
    status:envelope.frame.risk,
    overallRisk:'UNKNOWN',
    receipt:{...receipt},
    receiptSignature:signature
  };
  if(!validEntry(record,uid,envelope.epoch,trustedReceiptKey))
    return deny('publication-evidence-invalid');
  const next={
    ...core.next,
    publicationHistoryV1:{
      schema:SCHEMA,deviceId:uid,epoch:envelope.epoch,
      issuerFingerprint,entries:{...existing.entries,[seqKey(sequence)]:record}
    }
  };
  return Object.freeze({
    allowed:true,kind:'EMULATOR_HISTORY_AND_PUBLIC_ATOMIC_CANDIDATE',
    sequence,digest:receipt.digest,next,
    canAcknowledge:false,
    floodClearance:'UNKNOWN',
    physicalGatePosition:'UNVERIFIED'
  });
}
