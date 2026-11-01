// FloodGuard isolated publication capsule V2 — PURE transaction reducer.
// No network, credentials, Firebase SDK, Admin privilege, unrelated data,
// real devices, alert delivery, outbox acknowledgment, or physical gate action.
// The ONLY allowed transaction root is /floodguardPublicationLabV2.
// Source binding and issuer key are synthetic server-provisioned inputs in this
// lab. Revocation racing with a transaction is NOT atomically fenced here.
import {createHash,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {canonicalPublicationHistoryWitnessLab}
  from './pinned-historical-witness-lab.mjs';
import {projectPublicTelemetryLabV1}
  from '../tests/fixtures/pr34/public-telemetry-leaf-projection-lab.mjs';

export const CAPSULE_ROOT='/floodguardPublicationLabV2';
const HISTORY_SCHEMA='floodguard-immutable-publication-history-lab-v1';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const key=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const fp=x=>createHash('sha256').update(x.export({type:'spki',format:'der'})).digest('hex');
const hash=x=>createHash('sha256').update(x).digest('hex');
const deny=reason=>Object.freeze({allowed:false,reason,canAcknowledge:false});
const receiptFields=['version','deviceId','epoch','sequence','digest','acceptedAtMs'];
const entryFields=['sequence','digest','observedAtMs','distanceCm','levelCm',
  'status','overallRisk','receipt','receiptSignature'];
const historyFields=['schema','deviceId','epoch','issuerFingerprint','entries'];
const capsuleFields=['public','checkpoint'];
function validPublic(publicTree) {
  if(!exact(publicTree,['water','system'])||
     !exact(publicTree.water,['distanceCm','levelCm','status'])||
     !exact(publicTree.system,['lastUpdate','overallRisk'])||
     publicTree.system.overallRisk!=='UNKNOWN')return false;
  try {
    const p=projectPublicTelemetryLabV1(publicTree);
    return Object.keys(p).length===2&&
      p.water.distanceCm===publicTree.water.distanceCm&&
      p.water.levelCm===publicTree.water.levelCm&&
      p.water.status===publicTree.water.status&&
      p.system.lastUpdate===publicTree.system.lastUpdate&&
      p.system.overallRisk===publicTree.system.overallRisk;
  }catch{return false;}
}
function validateHistory(history,checkpoint,publicTree,issuerKey,deviceId,epoch) {
  if(!exact(history,historyFields)||history.schema!==HISTORY_SCHEMA||
     history.deviceId!==deviceId||history.epoch!==epoch||
     history.issuerFingerprint!==fp(issuerKey)||!record(history.entries))
    return 'private-history-unavailable';
  const keys=Object.keys(history.entries);
  if(keys.length===0||keys.length>8)return 'private-history-capacity';
  try{canonicalPublicationHistoryWitnessLab(history);}
  catch{return 'private-history-structure-invalid';}
  let previousObserved=0,previousAccepted=0;
  const nums=keys.map(x=>Number(x.slice(2))).sort((a,b)=>a-b);
  for(const seq of nums){
    const e=history.entries['s_'+seq];
    if(!exact(e,entryFields)||!exact(e.receipt,receiptFields)||
       !integer(e.sequence,1,2147483647)||
       e.sequence!==seq||!HEX.test(e.digest)||
       e.receipt.deviceId!==deviceId||e.receipt.epoch!==epoch||
       e.receipt.sequence!==seq||e.receipt.digest!==e.digest||
       e.observedAtMs<previousObserved||
       e.receipt.acceptedAtMs<previousAccepted||
       e.receipt.acceptedAtMs<e.observedAtMs||
       !verifyStage8OfflineReceipt({
         receipt:e.receipt,signature:e.receiptSignature,publicKey:issuerKey,
         expected:{deviceId,epoch,sequence:seq,digest:e.digest}
       }))return 'private-history-signature-or-order-invalid';
    previousObserved=e.observedAtMs;
    previousAccepted=e.receipt.acceptedAtMs;
  }
  const last=history.entries['s_'+nums.at(-1)];
  if(last.sequence!==checkpoint.sequence||last.digest!==checkpoint.digest||
     last.distanceCm!==publicTree.water.distanceCm||
     last.levelCm!==publicTree.water.levelCm||
     last.status!==publicTree.water.status||
     last.observedAtMs!==publicTree.system.lastUpdate||
     last.overallRisk!=='UNKNOWN')return 'history-checkpoint-mismatch';
  return null;
}
/**
 * An authenticated publisher's transaction may ONLY replace this isolated
 * capsule: public water/system scalars, latest checkpoint and signed history.
 * An independent server MUST verify device authorization and receipt issuance
 * without trusting client-supplied sourceBinding or trustedReceiptKey.
 */
export function deriveScopedPublicationCapsuleLab({
  current,pending,sourceBinding,trustedReceiptKey,
  receipt,receiptSignature,nowMs
}={}) {
  if(!record(current)||!exact(current,Object.hasOwn(current,'history')
       ?[...capsuleFields,'history']:capsuleFields)||
     !validPublic(current.public)||!record(current.checkpoint)||
     !integer(nowMs,946684800000,Number.MAX_SAFE_INTEGER))
    return deny('capsule-structure-invalid');
  if(!exact(pending,['sequence','digest','acceptedAtMs','envelope','signature'])||
     !integer(pending.sequence,1,2147483647)||
     typeof pending.digest!=='string'||!HEX.test(pending.digest)||
     !integer(pending.acceptedAtMs,946684800000,nowMs)||
     typeof pending.signature!=='string'||!SIG.test(pending.signature)||
     !key(sourceBinding?.publicKey)||!key(trustedReceiptKey)||
     !exact(sourceBinding,['deviceId','epoch','enabled','scope','publicKey'])||
     sourceBinding.enabled!==true||sourceBinding.scope!=='prototype-ingest-v1')
    return deny('signed-source-authority-unavailable');
  let canonical;
  try{canonical=canonicalOfflineEnvelope(pending.envelope);}
  catch{return deny('invalid-source-envelope');}
  const e=pending.envelope,uid=e.deviceId,seq=e.frame.sequence;
  if(!UID.test(uid)||sourceBinding.deviceId!==uid||
     sourceBinding.epoch!==e.epoch||pending.sequence!==seq||
     hash(canonical)!==pending.digest||
     Buffer.from(pending.signature,'base64url').length!==64||
     !verify(null,Buffer.from(canonical),sourceBinding.publicKey,
       Buffer.from(pending.signature,'base64url')))
    return deny('invalid-source-signature');
  if(e.observedAtMs<nowMs-30000||e.observedAtMs>nowMs+2000)
    return deny('source-timestamp-unverified');
  if(e.frame.risk==='SENSOR_ERROR')return deny('sensor-error-not-publishable-as-water-safety');
  if(!exact(receipt,receiptFields)||typeof receiptSignature!=='string'||
     !SIG.test(receiptSignature)||receipt.version!=='floodguard-offline-receipt-v1'||
     receipt.deviceId!==uid||receipt.epoch!==e.epoch||
     receipt.sequence!==seq||receipt.digest!==pending.digest||
     receipt.acceptedAtMs<pending.acceptedAtMs||
     receipt.acceptedAtMs>nowMs||
     !verifyStage8OfflineReceipt({receipt,signature:receiptSignature,
       publicKey:trustedReceiptKey,expected:{deviceId:uid,epoch:e.epoch,
         sequence:seq,digest:pending.digest}}))
    return deny('independent-database-receipt-unverified');
  const checkpoint=current.checkpoint;
  const bootstrap=exact(checkpoint,['initialized','epoch'])&&
    checkpoint.initialized===false&&checkpoint.epoch===e.epoch;
  const started=exact(checkpoint,['initialized','epoch','sequence','digest'])&&
    checkpoint.initialized===true&&checkpoint.epoch===e.epoch&&
    integer(checkpoint.sequence,1,2147483647)&&HEX.test(checkpoint.digest);
  if(!bootstrap&&!started)return deny('checkpoint-invalid');
  if(started&&seq<=checkpoint.sequence)return deny('replay-or-out-of-order');
  if(e.observedAtMs<current.public.system.lastUpdate)
    return deny('timestamp-regression');
  let entries={};
  if(started){
    const failure=validateHistory(current.history,checkpoint,current.public,
      trustedReceiptKey,uid,e.epoch);
    if(failure)return deny(failure);
    entries=current.history.entries;
    if(Object.keys(entries).length>=8)return deny('history-capacity-reached');
    const last=current.history.entries['s_'+checkpoint.sequence];
    if(e.observedAtMs<last.observedAtMs||
       receipt.acceptedAtMs<last.receipt.acceptedAtMs)
      return deny('history-time-regression');
  }else if(Object.hasOwn(current,'history'))return deny('unexpected-bootstrap-history');
  const proposedPublic={
    water:{distanceCm:e.frame.distanceCm,levelCm:e.frame.levelCm,status:e.frame.risk},
    system:{lastUpdate:e.observedAtMs,overallRisk:'UNKNOWN'}
  };
  if(!validPublic(proposedPublic))return deny('projected-public-leaf-invalid');
  const entry={sequence:seq,digest:pending.digest,observedAtMs:e.observedAtMs,
    distanceCm:e.frame.distanceCm,levelCm:e.frame.levelCm,
    status:e.frame.risk,overallRisk:'UNKNOWN',
    receipt:{...receipt},receiptSignature};
  const next={
    public:proposedPublic,
    checkpoint:{initialized:true,epoch:e.epoch,sequence:seq,digest:pending.digest},
    history:{
      schema:HISTORY_SCHEMA,deviceId:uid,epoch:e.epoch,
      issuerFingerprint:fp(trustedReceiptKey),
      entries:{...entries,['s_'+seq]:entry}
    }
  };
  return Object.freeze({allowed:true,
    kind:'SCOPED_EMULATOR_CAPSULE_CANDIDATE_ONLY',
    next,sequence:seq,digest:pending.digest,canAcknowledge:false});
}
