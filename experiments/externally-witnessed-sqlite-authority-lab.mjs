// FloodGuard R3 — OFFLINE ONLY, external witness consistency protocol.
// SQLite authority from PR77 remains the transaction owner. A separately
// PROVIDED monotonic witness must compare-and-advance after its commit.
// DO NOT treat an injected JavaScript function as a trusted external service.
// Not real Firebase, a production rollback defense, or hardware provenance.
const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[0-9a-f]{64}$/;
const KEYS=['deviceId','epoch','enabled','sequence','digest','revision'];
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(v,k)=>isObject(v)&&Object.keys(v).length===k.length&&
  k.every(x=>Object.hasOwn(v,x));
const safeInt=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
function normalize(v){
  if(!isObject(v)||typeof v.deviceId!=='string'||!ID.test(v.deviceId)||
     !safeInt(v.epoch,1,10000)||typeof v.enabled!=='boolean'||
     !safeInt(v.sequence,1,2147483647)||
     typeof v.digest!=='string'||!HEX.test(v.digest)||
     !safeInt(v.revision,1,Number.MAX_SAFE_INTEGER)||
     ![6,7].includes(Object.keys(v).length)||
     (Object.keys(v).length===7&&v.productionGo!==false)||
     !Object.keys(v).every(k=>KEYS.includes(k)||k==='productionGo')||
     !KEYS.every(k=>Object.hasOwn(v,k)))return null;
  return Object.freeze(Object.fromEntries(KEYS.map(k=>[k,v[k]])));
}
const same=(a,b)=>Boolean(a&&b&&KEYS.every(k=>a[k]===b[k]));
const deny=(operation,reason)=>Object.freeze({
  operation,issued:false,revoked:false,reason,
  canPublish:false,canAcknowledge:false,canSendAlert:false,
  canOperateGate:false,productionGo:false
});
function isValidNext(before,after,operation){
  if(!before||!after||before.deviceId!==after.deviceId||
     before.epoch!==after.epoch||after.revision!==before.revision+1)
    return false;
  if(operation==='attest')return before.enabled===true&&after.enabled===true&&
    after.sequence===before.sequence+1&&after.digest!==before.digest;
  return operation==='revoke'&&before.enabled===true&&after.enabled===false&&
    after.sequence===before.sequence&&after.digest===before.digest;
}
/**
 * witness.read() => previously independently anchored state.
 * witness.compareAndAdvance(expected, next) => true only for atomic durable
 * monotonic CAS, NEVER from an HTTP client. The source in this PR only tests
 * a synthetic injected witness; it CANNOT authenticate or persist one.
 *
 * The independent witness must not share the authority's rollback domain.
 * Neither invocation nor Object.freeze proves that requirement.
 *
 * All authority operations MUST go through this wrapper for a meaningful
 * consistency check. Raw PR77 methods can bypass it; no trusted production
 * issuer exists yet. Inconsistency is terminal NO-GO, never auto-repair.
 */
export function createExternallyWitnessedSqliteAuthorityLab({
  authority,witness,failPoint
}={}){
  if(!authority||!Object.isFrozen(authority)||
     typeof authority.snapshot!=='function'||
     typeof authority.attest!=='function'||
     typeof authority.revoke!=='function'||
     !witness||!Object.isFrozen(witness)||
     typeof witness.read!=='function'||
     typeof witness.compareAndAdvance!=='function'||
     ![undefined,'after-db-before-witness','after-witness-before-response']
       .includes(failPoint))
    throw TypeError('Explicit local authority, external witness and fail point required');
  function operate(operation,input){
    try {
      const deviceId=operation==='revoke'?input:input?.receipt?.deviceId;
      if(typeof deviceId!=='string'||!ID.test(deviceId))
        return deny(operation,'invalid-device-id');
      // Unauthenticated witness claims are not admissible; in production,
      // these methods must be capabilities supplied by a separately secured
      // monotonic authority, not request fields.
      const before=normalize(authority.snapshot(deviceId));
      const anchored=normalize(witness.read(deviceId));
      if(!before||!anchored||!same(before,anchored))
        return deny(operation,'authority-witness-diverged');
      const response=operation==='revoke'?
        authority.revoke(deviceId):authority.attest(input);
      if(operation==='revoke'?response?.revoked!==true:response?.issued!==true)
        return deny(operation,response?.reason||'underlying-authority-denied');
      const after=normalize(authority.snapshot(deviceId));
      if(!isValidNext(before,after,operation))
        return deny(operation,'unexpected-authority-transition');
      if(failPoint==='after-db-before-witness')
        return deny(operation,'simulated-crash-before-witness-cas');
      // CAS must itself be durable and rollback-resistant for this to offer
      // security. In tests it is only a synthetic in-memory witness.
      if(witness.compareAndAdvance(anchored,after)!==true)
        return deny(operation,'witness-refused-advance');
      const confirmed=normalize(witness.read(deviceId));
      if(!confirmed||!same(confirmed,after))
        return deny(operation,'witness-postcheck-unverified');
      if(failPoint==='after-witness-before-response')
        return deny(operation,'simulated-crash-after-witness-cas');
      return Object.freeze({
        ...response,operation,witnessCompared:true,productionGo:false,
        canPublish:false,canAcknowledge:false,canSendAlert:false,
        canOperateGate:false,physicalSourceVerified:false
      });
    }catch{
      return deny(operation,'external-witness-unavailable');
    }
  }
  return Object.freeze({
    attest:request=>operate('attest',request),
    revoke:deviceId=>operate('revoke',deviceId),
    check(deviceId){
      try{
        if(typeof deviceId!=='string'||!ID.test(deviceId))
          return Object.freeze({consistent:false,reason:'invalid-device-id',
            productionGo:false});
        const local=normalize(authority.snapshot(deviceId));
        const anchored=normalize(witness.read(deviceId));
        return Object.freeze({consistent:Boolean(same(local,anchored)),
          reason:same(local,anchored)?'OFFLINE_CLAIMS_AGREE_NOT_PHYSICAL_PROOF':
            'authority-witness-diverged',productionGo:false});
      }catch{
        return Object.freeze({consistent:false,reason:'external-witness-unavailable',
          productionGo:false});
      }
    }
  });
}
