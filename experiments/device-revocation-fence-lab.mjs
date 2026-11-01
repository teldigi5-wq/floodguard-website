// FloodGuard R2/R3 — in-transaction DEVICE revocation fence (V4 lab only).
// No Firebase SDK, token issuance, service credential, HTTP endpoint, ACK,
// notification, or physical gate control. Never deploy the lab rule fixture.
import {createHash,KeyObject} from 'node:crypto';
import {deriveFencedPublicationCapsuleLab,observeFencedPublicationCapsuleLab}
  from './publisher-revocation-fence-lab.mjs';

export const DEVICE_FENCED_CAPSULE_ROOT='/floodguardPublicationLabV4';
const DEVICE_FIELDS=['deviceId','epoch','enabled','sourceKeyFingerprint'];
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,ks)=>object(x)&&Object.keys(x).length===ks.length&&
  ks.every(k=>Object.hasOwn(x,k));
const key=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
export const sourceKeyFingerprintLab=k=>key(k)
  ?createHash('sha256').update(k.export({format:'der',type:'spki'})).digest('hex')
  :null;
const deny=reason=>Object.freeze({allowed:false,reason,canAcknowledge:false});
const reject=reason=>Object.freeze({observed:false,reason,canAcknowledge:false});
const strip=c=>({
  authority:c.authority,public:c.public,checkpoint:c.checkpoint,
  ...(Object.hasOwn(c,'history')?{history:c.history}:{})
});
function deviceAuthorized(c,sourceBinding,pending){
  const d=c.device;
  if(!exact(d,DEVICE_FIELDS)||!UID.test(d.deviceId)||
     !Number.isSafeInteger(d.epoch)||d.epoch<1||d.epoch>10000||
     d.enabled!==true||!HEX.test(d.sourceKeyFingerprint)||
     !object(sourceBinding)||!key(sourceBinding.publicKey)||
     sourceBinding.enabled!==true||
     sourceBinding.scope!=='prototype-ingest-v1'||
     d.deviceId!==sourceBinding.deviceId||
     d.epoch!==sourceBinding.epoch||
     d.sourceKeyFingerprint!==sourceKeyFingerprintLab(sourceBinding.publicKey)||
     !object(pending)||!object(pending.envelope)||
     pending.envelope.deviceId!==d.deviceId||
     pending.envelope.epoch!==d.epoch)
    return false;
  return true;
}
function shaped(c){
  return object(c)&&exact(c,Object.hasOwn(c,'history')
    ?['authority','device','public','checkpoint','history']
    :['authority','device','public','checkpoint']);
}
/**
 * V4's device.enabled and public-key fingerprint belong to the SAME RTDB
 * transaction root as the signed publication. Separate Emulator Rules protect
 * that record against publisher changes and operator revocation races.
 *
 * The sourceBinding must still be independently provisioned in a future
 * production service. The test cannot attest actual field-device identity.
 */
export function deriveDeviceRevocationCapsuleLab({
  current,pending,sourceBinding,trustedReceiptKey,publisherLease,
  receipt,receiptSignature,nowMs
}={}){
  if(!shaped(current))return deny('device-capsule-shape-invalid');
  if(!deviceAuthorized(current,sourceBinding,pending))
    return deny('device-disabled-epoch-or-key-mismatch');
  const base=deriveFencedPublicationCapsuleLab({
    current:strip(current),pending,sourceBinding,trustedReceiptKey,
    publisherLease,receipt,receiptSignature,nowMs
  });
  if(base.allowed!==true)return deny(base.reason||'publisher-denied');
  return Object.freeze({
    allowed:true,kind:'DEVICE_FENCED_EMULATOR_CANDIDATE_ONLY',
    next:{...base.next,device:{...current.device}},
    sequence:base.sequence,digest:base.digest,canAcknowledge:false
  });
}
/** No remotely trusted DB receipt, human alert delivery, or outbox ACK. */
export function observeDeviceRevocationCapsuleLab({
  current,pending,sourceBinding,trustedReceiptKey,publisherLease,nowMs
}={}){
  if(!shaped(current)||!deviceAuthorized(current,sourceBinding,pending))
    return reject('device-disabled-epoch-or-key-mismatch');
  const base=observeFencedPublicationCapsuleLab({
    current:strip(current),pending,sourceBinding,trustedReceiptKey,
    publisherLease,nowMs
  });
  return base.observed===true
    ?Object.freeze({...base,kind:'DEVICE_FENCED_SIGNED_HISTORY_NO_ACK',canAcknowledge:false})
    :reject(base.reason||'history-not-proven');
}
