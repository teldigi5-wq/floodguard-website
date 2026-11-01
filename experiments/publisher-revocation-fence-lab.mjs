// FloodGuard R2/R3: publisher-credential revocation fencing experiment.
// The authority record is within the SAME scoped RTDB transaction as public
// data, signed history and replay checkpoint, so a stale publisher transaction
// cannot commit after an operator revocation is durably visible at this root.
// This does NOT fence independent device/receipt issuer revocation, provision
// Firebase tokens, or grant any outbox ACK / safety or delivery guarantee.
import {createHash,KeyObject} from 'node:crypto';
import {deriveScopedPublicationCapsuleLab,observeScopedPublicationCapsuleLab}
  from './scoped-publication-capsule-lab.mjs';

export const FENCED_CAPSULE_ROOT='/floodguardPublicationLabV3';
const AUTH_KEYS=['deviceId','epoch','enabled','leaseId','receiptSignerFingerprint'];
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const LEASE=/^lease-stage-[a-z0-9-]{1,48}$/;
const HEX=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const key=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const fingerprint=x=>createHash('sha256').update(
  x.export({format:'der',type:'spki'})).digest('hex');
const deny=reason=>Object.freeze({allowed:false,reason,canAcknowledge:false});
const fail=reason=>Object.freeze({observed:false,reason,canAcknowledge:false});

function validateAuthority(authority,sourceBinding,trustedReceiptKey,publisherLease){
  if(!exact(authority,AUTH_KEYS)||!UID.test(authority.deviceId)||
     !Number.isSafeInteger(authority.epoch)||authority.epoch<1||
     authority.epoch>10000||authority.enabled!==true||
     !LEASE.test(authority.leaseId)||!HEX.test(authority.receiptSignerFingerprint)||
     !object(sourceBinding)||!key(trustedReceiptKey)||
     typeof publisherLease!=='string'||publisherLease!==authority.leaseId||
     authority.receiptSignerFingerprint!==fingerprint(trustedReceiptKey)||
     sourceBinding.deviceId!==authority.deviceId||
     sourceBinding.epoch!==authority.epoch)
    return false;
  return true;
}
const strip=c=>({
  public:c.public,checkpoint:c.checkpoint,
  ...(Object.hasOwn(c,'history')?{history:c.history}:{})
});
/**
 * The server-side transaction callback validates the latest in-capsule
 * authority. The test-only RTDB Rules separately compare BOTH the old and
 * new authority fields and authorize a minted lease claim on every write.
 * Source and receipt provisioning remain synthetic and externally injected.
 */
export function deriveFencedPublicationCapsuleLab({
  current,publisherLease,pending,sourceBinding,trustedReceiptKey,
  receipt,receiptSignature,nowMs
}={}){
  if(!object(current)||!exact(current,Object.hasOwn(current,'history')
     ?['authority','public','checkpoint','history']
     :['authority','public','checkpoint']))
    return deny('fenced-capsule-shape-invalid');
  if(!validateAuthority(current.authority,sourceBinding,
    trustedReceiptKey,publisherLease))
    return deny('publisher-lease-or-authority-revoked');
  const base=deriveScopedPublicationCapsuleLab({
    current:strip(current),pending,sourceBinding,trustedReceiptKey,
    receipt,receiptSignature,nowMs
  });
  if(base.allowed!==true)return deny(base.reason||'source-candidate-rejected');
  return Object.freeze({
    allowed:true,kind:'SCOPED_FENCED_PUBLICATION_LAB_ONLY',
    next:{authority:{...current.authority},...base.next},
    sequence:base.sequence,digest:base.digest,canAcknowledge:false
  });
}
/**
 * Re-read from the restricted capsule as its own authenticated observer;
 * missing/disabled or mismatching authority is never a positive result.
 */
export function observeFencedPublicationCapsuleLab({
  current,publisherLease,pending,sourceBinding,trustedReceiptKey,nowMs
}={}){
  if(!object(current)||!exact(current,['authority','public','checkpoint','history'])||
     !validateAuthority(current.authority,sourceBinding,
       trustedReceiptKey,publisherLease))
    return fail('publisher-lease-or-authority-revoked');
  const observed=observeScopedPublicationCapsuleLab({
    current:strip(current),pending,sourceBinding,trustedReceiptKey,nowMs
  });
  return observed.observed===true
    ?Object.freeze({...observed,kind:'FENCED_SIGNED_HISTORY_OBSERVED_NO_ACK',
      canAcknowledge:false})
    :fail(observed.reason||'signed-readback-unverified');
}
