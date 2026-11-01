// FloodGuard R2/R3 — READ-ONLY historical outbox observation laboratory.
// This is NOT a delivery receipt, ACK permit, trusted HTTP endpoint, cloud
// publisher or actual hardware proof. Inputs MUST be obtained by a trusted
// operator independently of any incoming device or web request.
import {createHash,KeyObject,verify} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {projectPublicTelemetryLabV1,PUBLIC_TELEMETRY_LAB_FIELDS}
  from '../tests/fixtures/pr34/public-telemetry-leaf-projection-lab.mjs';

const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const SCHEMA='floodguard-immutable-publication-history-lab-v1';
const receiptKeys=['version','deviceId','epoch','sequence','digest','acceptedAtMs'];
const entryKeys=['sequence','digest','observedAtMs','distanceCm','levelCm',
  'status','overallRisk','receipt','receiptSignature'];
const historyKeys=['schema','deviceId','epoch','issuerFingerprint','entries'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,ks)=>record(x)&&Object.keys(x).length===ks.length&&
  ks.every(k=>Object.hasOwn(x,k));
const pubkey=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const num=(x,a,b)=>Number.isSafeInteger(x)&&x>=a&&x<=b;
const fp=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
const deny=reason=>Object.freeze({observed:false,reason,canAcknowledge:false});
const seqKey=n=>'s_'+n;
function verifiedPublic(tree) {
  if(!record(tree))return false;
  try {
    const projected=projectPublicTelemetryLabV1(tree);
    if(Object.keys(projected).length!==Object.keys(tree).length)return false;
    for(const [group,fields] of Object.entries(tree)){
      if(!Object.hasOwn(PUBLIC_TELEMETRY_LAB_FIELDS,group)||
         !record(fields)||!record(projected[group])||
         Object.keys(fields).length!==Object.keys(projected[group]).length)return false;
      for(const [field,value] of Object.entries(fields)){
        if(!Object.hasOwn(projected[group],field)||
           !['string','number','boolean'].includes(typeof value)||
           (typeof value==='number'&&!Number.isFinite(value))||
           projected[group][field]!==value)return false;
      }
    }
    return true;
  }catch{return false;}
}
function validEntry(entry,uid,epoch,issuer,nowMs) {
  if(!exact(entry,entryKeys)||!num(entry.sequence,1,2147483647)||
     typeof entry.digest!=='string'||!HEX.test(entry.digest)||
     !num(entry.observedAtMs,946684800000,nowMs+2000)||
     typeof entry.distanceCm!=='number'||!Number.isFinite(entry.distanceCm)||
     entry.distanceCm<=0||entry.distanceCm>25||
     typeof entry.levelCm!=='number'||!Number.isFinite(entry.levelCm)||
     entry.levelCm<0||entry.levelCm>25||
     Math.abs(entry.levelCm-(25-entry.distanceCm))>0.05||
     !['SAFE','WARNING','DANGER','SENSOR_ERROR'].includes(entry.status)||
     entry.overallRisk!=='UNKNOWN'||
     !exact(entry.receipt,receiptKeys)||
     typeof entry.receiptSignature!=='string'||!SIG.test(entry.receiptSignature))
    return false;
  const status=entry.levelCm>=11?'DANGER':entry.levelCm>=8.5?'WARNING':'SAFE';
  if(entry.status!=='SENSOR_ERROR'&&entry.status!==status)return false;
  const rc=entry.receipt;
  if(rc.deviceId!==uid||rc.epoch!==epoch||rc.sequence!==entry.sequence||
     rc.digest!==entry.digest||!num(rc.acceptedAtMs,entry.observedAtMs,nowMs+2000))
    return false;
  return verifyStage8OfflineReceipt({receipt:rc,
    signature:entry.receiptSignature,publicKey:issuer,
    expected:{deviceId:uid,epoch,sequence:entry.sequence,digest:entry.digest}});
}
/**
 * A positive observation is never a license to delete, ACK or compact.
 * Do not trust request-supplied keys or root; both must come from protected
 * independently authorized server/operator storage. Historic receipts
 * attest source hashes, not independent physical delivery or notifications.
 */
export function observeHistoricalOutboxRecordLab({
  pending,root,sourceBinding,trustedReceiptKey,nowMs
}={}) {
  try {
    if(!num(nowMs,946684800000,Number.MAX_SAFE_INTEGER)||
       !pubkey(trustedReceiptKey)||!pubkey(sourceBinding?.publicKey)||
       !exact(pending,['sequence','digest','acceptedAtMs','envelope','signature'])||
       !num(pending.sequence,1,2147483647)||
       typeof pending.digest!=='string'||!HEX.test(pending.digest)||
       !num(pending.acceptedAtMs,0,nowMs)||
       typeof pending.signature!=='string'||!SIG.test(pending.signature))
      return deny('invalid-local-evidence');
    const canonical=canonicalOfflineEnvelope(pending.envelope);
    const e=pending.envelope,uid=e.deviceId,epoch=e.epoch;
    if(!UID.test(uid)||e.frame.sequence!==pending.sequence||
       createHash('sha256').update(canonical).digest('hex')!==pending.digest||
       !exact(sourceBinding,['deviceId','epoch','enabled','scope','publicKey'])||
       sourceBinding.deviceId!==uid||sourceBinding.epoch!==epoch||
       sourceBinding.enabled!==true||sourceBinding.scope!=='prototype-ingest-v1'||
       !verify(null,Buffer.from(canonical),sourceBinding.publicKey,
         Buffer.from(pending.signature,'base64url')))
      return deny('local-device-signature-unverified');
    if(!record(root)||!record(root.projectionControl)||
       !record(root.projectionControl.devices)||
       !record(root.deviceAuthorization)||!record(root.confirmedIngest))
      return deny('protected-root-unavailable');
    const auth=root.projectionControl.waterAuthority,member=root.deviceAuthorization[uid];
    if(!exact(auth,['deviceId','epoch','enabled','scope','receiptSignerFingerprint'])||
       auth.deviceId!==uid||auth.epoch!==epoch||auth.enabled!==true||
       auth.scope!=='water-primary'||auth.receiptSignerFingerprint!==fp(trustedReceiptKey)||
       !exact(member,['enabled','scope'])||member.enabled!==true||
       member.scope!=='prototype-ingest-v1')
      return deny('operator-authority-not-current');
    const checkpoint=root.projectionControl.devices[uid],history=root.publicationHistoryV1;
    if(!exact(checkpoint,['initialized','epoch','sequence','digest'])||
       checkpoint.initialized!==true||checkpoint.epoch!==epoch||
       !num(checkpoint.sequence,1,2147483647)||!HEX.test(checkpoint.digest)||
       !exact(history,historyKeys)||history.schema!==SCHEMA||
       history.deviceId!==uid||history.epoch!==epoch||
       history.issuerFingerprint!==fp(trustedReceiptKey)||
       !record(history.entries))
      return deny('history-or-checkpoint-unavailable');
    const keys=Object.keys(history.entries);
    if(keys.length<1||keys.length>8)return deny('history-capacity-or-shape-invalid');
    const sorted=keys.map(k=>/^s_[1-9]\d*$/.test(k)?Number(k.slice(2)):NaN)
      .sort((a,b)=>a-b);
    if(sorted.some((s,i)=>!num(s,1,2147483647)||!keys.includes(seqKey(s))||
        (i>0&&sorted[i-1]>=s)))
      return deny('history-keys-invalid');
    let lastObserved=0,lastAccepted=0;
    for(const sequence of sorted){
      const recordValue=history.entries[seqKey(sequence)];
      if(!validEntry(recordValue,uid,epoch,trustedReceiptKey,nowMs)||
         recordValue.sequence!==sequence||
         recordValue.observedAtMs<lastObserved||
         recordValue.receipt.acceptedAtMs<lastAccepted)
        return deny('historical-receipt-invalid');
      lastObserved=recordValue.observedAtMs;
      lastAccepted=recordValue.receipt.acceptedAtMs;
    }
    const latest=history.entries[seqKey(sorted.at(-1))];
    if(checkpoint.sequence!==latest.sequence||checkpoint.digest!==latest.digest)
      return deny('checkpoint-history-diverged');
    const confirmed=root.confirmedIngest[uid];
    if(!exact(confirmed,['deviceId','epoch','sequence','digest','acceptedAtMs','status'])||
       confirmed.deviceId!==uid||confirmed.epoch!==epoch||
       confirmed.sequence!==latest.sequence||confirmed.digest!==latest.digest||
       confirmed.acceptedAtMs!==latest.receipt.acceptedAtMs||
       confirmed.status!=='DATABASE_CONFIRMED')
      return deny('latest-database-confirmation-diverged');
    const publicTree=root.publicTelemetryLabV1;
    if(!verifiedPublic(publicTree)||publicTree.water?.distanceCm!==latest.distanceCm||
       publicTree.water?.levelCm!==latest.levelCm||
       publicTree.water?.status!==latest.status||
       publicTree.system?.lastUpdate!==latest.observedAtMs||
       publicTree.system?.overallRisk!=='UNKNOWN')
      return deny('current-public-scalar-diverged');
    const target=history.entries[seqKey(pending.sequence)];
    if(!target)return deny('historical-sequence-absent');
    if(target.digest!==pending.digest||target.sequence!==pending.sequence||
       target.observedAtMs!==e.observedAtMs||
       target.distanceCm!==e.frame.distanceCm||
       target.levelCm!==e.frame.levelCm||
       target.status!==e.frame.risk||
       target.overallRisk!=='UNKNOWN'||
       target.receipt.acceptedAtMs<pending.acceptedAtMs)
      return deny('retained-frame-history-conflict');
    return Object.freeze({
      observed:true,kind:'HISTORIC_SIGNED_EVIDENCE_OBSERVED_NOT_ACKNOWLEDGED',
      sequence:pending.sequence,digest:pending.digest,
      latestSequence:checkpoint.sequence,
      isLatest:pending.sequence===checkpoint.sequence,
      canAcknowledge:false,sourceFreshness:'NOT_CERTIFIED',
      floodClearance:'UNKNOWN',physicalGatePosition:'UNVERIFIED',
      notificationDelivery:'NOT_VERIFIED'
    });
  }catch{return deny('history-reconciliation-unavailable');}
}
