// FloodGuard R2/R3: read-only comparison of a LOCAL retained signed frame
// with an INDEPENDENTLY retrieved RTDB emulator root snapshot and signed receipt.
// No network, Firebase writer, journal deletion/ack, alarm or gate commands.
// IMPORTANT: caller MUST NOT accept root, operator binding or trusted keys from
// an HTTP request. Synthetic compatibility review, NOT a production proof.
import {createHash,KeyObject,verify} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {projectPublicTelemetryLabV1,PUBLIC_TELEMETRY_LAB_FIELDS}
  from '../tests/fixtures/pr34/public-telemetry-leaf-projection-lab.mjs';

const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const keys=['water/distanceCm','water/levelCm','water/status',
  'system/lastUpdate','system/overallRisk'];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,ks)=>obj(x)&&Object.keys(x).length===ks.length&&
  ks.every(k=>Object.hasOwn(x,k));
const pubkey=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const fp=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
const deny=reason=>Object.freeze({confirmed:false,reason,canAcknowledge:false});
const scalar=x=>['string','number','boolean'].includes(typeof x)&&
  !(typeof x==='number'&&!Number.isFinite(x));
function strictPublicTree(tree) {
  if(!obj(tree)||!obj(tree.water)||!obj(tree.system))return false;
  try{
    const p=projectPublicTelemetryLabV1(tree);
    if(Object.keys(p).length!==Object.keys(tree).length)return false;
    for(const [group,values] of Object.entries(tree)){
      if(!Object.hasOwn(PUBLIC_TELEMETRY_LAB_FIELDS,group)||!obj(values)||
         !obj(p[group])||Object.keys(p[group]).length!==Object.keys(values).length)
        return false;
      for(const [field,value] of Object.entries(values))
        if(!Object.hasOwn(p[group],field)||!scalar(value)||p[group][field]!==value)
          return false;
    }
    return true;
  }catch{return false;}
}
/**
 * Positive result is only a READ-ONLY observation of one exact, current
 * emulator snapshot. There is NO authority to retire a pending outbox entry.
 */
export function reconcileConfirmedWaterOutboxLab({
  pending,root,receipt,receiptSignature,trustedReceiptKey,
  sourceBinding,nowMs
}={}) {
  if(!Number.isSafeInteger(nowMs)||nowMs<946684800000)
    return deny('invalid-reconciliation-clock');
  if(!exact(pending,['sequence','digest','acceptedAtMs','envelope','signature'])||
     !Number.isSafeInteger(pending.sequence)||pending.sequence<1||
     typeof pending.digest!=='string'||!HEX.test(pending.digest)||
     !Number.isSafeInteger(pending.acceptedAtMs)||pending.acceptedAtMs<0||
     typeof pending.signature!=='string'||!SIG.test(pending.signature)||
     !pubkey(sourceBinding?.publicKey)||!pubkey(trustedReceiptKey))
    return deny('untrusted-pending-input');

  let canonical;
  try{canonical=canonicalOfflineEnvelope(pending.envelope);}
  catch{return deny('invalid-pending-frame');}
  const e=pending.envelope,uid=e.deviceId;
  if(!UID.test(uid)||e.frame.sequence!==pending.sequence||
     createHash('sha256').update(canonical).digest('hex')!==pending.digest||
     !exact(sourceBinding,['deviceId','epoch','enabled','scope','publicKey'])||
     sourceBinding.deviceId!==uid||sourceBinding.epoch!==e.epoch||
     sourceBinding.enabled!==true||sourceBinding.scope!=='prototype-ingest-v1'||
     !verify(null,Buffer.from(canonical),sourceBinding.publicKey,
       Buffer.from(pending.signature,'base64url')))
    return deny('signed-local-frame-unverified');

  // A raw client-supplied JSON snapshot has no authority. A trusted caller
  // must separately fetch the protected DB snapshot using its scoped service.
  if(!obj(root)||!obj(root.projectionControl)||!obj(root.deviceAuthorization)||
     !obj(root.confirmedIngest)||!obj(root.publicTelemetryLabV1))
    return deny('database-snapshot-unavailable');
  const authority=root.projectionControl.waterAuthority;
  if(!exact(authority,['deviceId','epoch','enabled','scope','receiptSignerFingerprint'])||
     authority.deviceId!==uid||authority.epoch!==e.epoch||
     authority.enabled!==true||authority.scope!=='water-primary'||
     authority.receiptSignerFingerprint!==fp(trustedReceiptKey))
    return deny('water-authority-not-pinned');
  const member=root.deviceAuthorization[uid];
  if(!exact(member,['enabled','scope'])||member.enabled!==true||
     member.scope!=='prototype-ingest-v1')
    return deny('device-authorization-not-current');
  const checkpoint=root.projectionControl.devices?.[uid];
  if(!exact(checkpoint,['initialized','epoch','sequence','digest'])||
     checkpoint.initialized!==true||checkpoint.epoch!==e.epoch||
     !Number.isSafeInteger(checkpoint.sequence)||!HEX.test(checkpoint.digest))
    return deny('publication-checkpoint-unavailable');
  if(checkpoint.sequence!==pending.sequence||checkpoint.digest!==pending.digest)
    return deny('superseded-or-conflicting-checkpoint');

  const confirmed=root.confirmedIngest[uid];
  if(!exact(confirmed,['deviceId','epoch','sequence','digest','acceptedAtMs','status'])||
     confirmed.deviceId!==uid||confirmed.epoch!==e.epoch||
     confirmed.sequence!==pending.sequence||confirmed.digest!==pending.digest||
     confirmed.status!=='DATABASE_CONFIRMED'||
     !Number.isSafeInteger(confirmed.acceptedAtMs)||
     confirmed.acceptedAtMs<pending.acceptedAtMs||
     confirmed.acceptedAtMs>nowMs)
    return deny('database-confirmation-mismatch');
  if(!exact(receipt,['version','deviceId','epoch','sequence','digest','acceptedAtMs'])||
     receipt.acceptedAtMs!==confirmed.acceptedAtMs||
     !verifyStage8OfflineReceipt({receipt,signature:receiptSignature,
       publicKey:trustedReceiptKey,expected:{
         deviceId:uid,epoch:e.epoch,sequence:pending.sequence,digest:pending.digest
       }}))
    return deny('signed-database-receipt-unverified');

  const publicData=root.publicTelemetryLabV1;
  if(!strictPublicTree(publicData))
    return deny('public-scalar-schema-corrupt');
  const mapped={
    'water/distanceCm':e.frame.distanceCm,
    'water/levelCm':e.frame.levelCm,
    'water/status':e.frame.risk,
    'system/lastUpdate':e.observedAtMs,
    'system/overallRisk':'UNKNOWN'
  };
  for(const key of keys){
    const [group,field]=key.split('/');
    if(publicData[group]?.[field]!==mapped[key])
      return deny('public-projection-mismatch');
  }
  return Object.freeze({
    confirmed:true,kind:'SYNTHETIC_DB_SNAPSHOT_MATCH_NO_ACK',
    sequence:pending.sequence,digest:pending.digest,
    sourceFreshness:'NOT_CERTIFIED',
    floodClearance:'UNKNOWN',
    physicalGatePosition:'UNVERIFIED',
    notificationDelivery:'NOT_VERIFIED',
    canAcknowledge:false,
  });
}
