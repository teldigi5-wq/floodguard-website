// FloodGuard R3 — SINGLE OWNER, COOPERATIVE LOCAL FILE LOCK LAB ONLY.
// Both revoke() and attest() must use this same coordinator + directory.
// Direct access to registry.revoke() bypasses this lock and is NOT blocked.
// No Firebase service, network listener, real device, gate or alert.
// No atomic authority across processes not honoring this lock, and no
// protection against restoring old HMAC-sealed files or signer key theft.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,KeyObject} from 'node:crypto';

const NAME='r3-local-authority-coordinator.lock';
const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,ks)=>obj(x)&&Object.keys(x).length===ks.length&&
  ks.every(k=>Object.hasOwn(x,k));
const publicKey=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const fp=k=>createHash('sha256').update(k.export({format:'der',type:'spki'})).digest('hex');
const deny=(operation,reason)=>Object.freeze({
  operation,issued:false,revoked:false,reason,
  canPublish:false,canAcknowledge:false,canSendAlert:false,
  canOperateGate:false,productionGo:false
});

/** Only an explicitly commissioned offline test registry+ledger, with ALL
 *  revokes and attestations routed through this shared coordinator. */
export function createSerializedOfflineAuthorityLab({directory,registry,ledger}={}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !registry||!Object.isFrozen(registry)||
     typeof registry.status!=='function'||typeof registry.get!=='function'||
     typeof registry.revoke!=='function'||
     !ledger||!Object.isFrozen(ledger)||typeof ledger.attest!=='function'||
     typeof ledger.checkpoint!=='function')
    throw TypeError('Explicit test-only serialized authority dependencies required');
  const root=fs.lstatSync(directory);
  if(!root.isDirectory()||root.isSymbolicLink())
    throw Error('Unsafe offline authority directory');
  const lockFile=path.join(directory,NAME);

  function underLock(callback) {
    const fd=fs.openSync(lockFile,'wx',0o600);
    try{return callback();}
    finally{
      fs.closeSync(fd);
      // An abandoned or inaccessible lock must be handled by a supervised
      // recovery review. Never remove a lock when acquisition failed.
      fs.unlinkSync(lockFile);
    }
  }
  function bindingFor(deviceId,epoch){
    const status=registry.status();
    const binding=registry.get(deviceId);
    if(!Number.isSafeInteger(status?.revision)||status.revision<1||
       !binding?.enabled||binding.scope!=='prototype-ingest-v1'||
       binding.epoch!==epoch||!publicKey(binding.publicKey))return null;
    return {revision:status.revision,epoch:binding.epoch,
      fingerprint:fp(binding.publicKey)};
  }
  function stillSame(before,deviceId,epoch){
    const after=bindingFor(deviceId,epoch);
    return Boolean(after&&after.revision===before.revision&&
      after.epoch===before.epoch&&after.fingerprint===before.fingerprint);
  }
  return Object.freeze({
    attest(request) {
      try {
        return underLock(()=>{
          if(!exact(request,['receipt','receiptSignature'])||
             !exact(request.receipt,['version','deviceId','epoch','sequence','digest','acceptedAtMs']))
            return deny('attest','request-shape-invalid');
          const {deviceId,epoch}=request.receipt;
          if(typeof deviceId!=='string'||!ID.test(deviceId)||
             !Number.isSafeInteger(epoch)||epoch<1||epoch>10000)
            return deny('attest','identity-invalid');
          const before=bindingFor(deviceId,epoch);
          if(!before)return deny('attest','operator-not-authorized');
          const checkpoint=ledger.checkpoint();
          if(checkpoint?.deviceId!==deviceId||checkpoint?.epoch!==epoch||
             checkpoint.releaseAuthorized!==false)
            return deny('attest','issuance-history-not-authoritative');
          const result=ledger.attest(request);
          if(result?.issued!==true)
            return deny('attest',result?.reason||'sealed-issuer-denied');
          // This catches bypassing direct registry writes that occurred
          // while a test-only inner reader/signer ran. It cannot remove
          // already committed local issuance history, so never return the
          // signature if the authorization fence was invalidated.
          if(!stillSame(before,deviceId,epoch))
            return deny('attest','operator-changed-before-response');
          return Object.freeze({...result,
            operation:'attest',serializedOwner:true,productionGo:false});
        });
      }catch{
        return deny('attest','serialized-authority-unavailable');
      }
    },
    revoke(deviceId) {
      try {
        return underLock(()=>{
          if(typeof deviceId!=='string'||!ID.test(deviceId))
            return deny('revoke','invalid-device-id');
          const before=registry.get(deviceId);
          if(!before?.enabled)return deny('revoke','device-not-enabled');
          const result=registry.revoke(deviceId);
          if(result?.revoked!==true)return deny('revoke','revocation-not-committed');
          const after=registry.get(deviceId);
          if(after?.enabled!==false||after.epoch!==before.epoch)
            return deny('revoke','revocation-postcheck-failed');
          return Object.freeze({
            operation:'revoke',issued:false,revoked:true,
            deviceId,epoch:after.epoch,serializedOwner:true,
            canPublish:false,canAcknowledge:false,canSendAlert:false,
            canOperateGate:false,productionGo:false
          });
        });
      }catch{
        return deny('revoke','serialized-authority-unavailable');
      }
    }
  });
}
