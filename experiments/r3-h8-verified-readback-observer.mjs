// FloodGuard R3 H8 — synthetic independent publication readback observer.
// No network, cloud credentials, hardware, actuator, notifications or writes.
// The injected readPublication and private signing key are TEST-ONLY;
// a real independent witness/security domain has NOT been implemented.
import {isDeepStrictEqual} from 'node:util';
import {KeyObject,sign} from 'node:crypto';
import {canonicalH7Acknowledgement}
  from './r3-h7-external-witness-lab.mjs';

const DEVICE='device-stage-a';
const STALE_MS=30000;
const FUTURE_MS=2000;
const reject=reason=>Object.freeze({
  attested:false,reason,releaseDecision:'NO_GO',
  canWriteFirebase:false,canPublish:false,canOperateGate:false
});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||
    Object.getPrototypeOf(v)===null)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);

export function createH8OfflineReadbackObserver({
  witness,readPublication,acknowledgerPrivateKey,clock
}={}){
  if(!witness||!Object.isFrozen(witness)||typeof witness.snapshot!=='function'||
    typeof readPublication!=='function'||typeof clock!=='function'||
    !(acknowledgerPrivateKey instanceof KeyObject)||
    acknowledgerPrivateKey.type!=='private'||
    acknowledgerPrivateKey.asymmetricKeyType!=='ed25519')
    throw new TypeError('Explicit synthetic witness, reader, signer and clock required');
  return Object.freeze({
    async inspect({reservation,candidate}={}){
      try{
        if(!exact(reservation,['ok','reservationId','sequence','digest',
          'releaseDecision','canPublish'])||
          reservation.ok!==true||reservation.canPublish!==false||
          reservation.releaseDecision!=='NO_GO'||
          typeof reservation.reservationId!=='string'||
          !/^[0-9a-f]{32}$/.test(reservation.reservationId)||
          !integer(reservation.sequence,2,2147483647)||
          !hex(reservation.digest)||
          !exact(candidate,['current','checkpoint'])||
          !exact(candidate.current,['distanceCm','levelCm','status',
            'observedAtMs','overallRisk'])||
          !exact(candidate.checkpoint,['initialized','deviceId','epoch',
            'sequence','digest','observedAtMs']))
          return reject('untrusted-candidate-or-reservation');
        const start=witness.snapshot(); // externally anchored, fail closed
        if(start.quarantined!==false||!exact(start.pending,[
          'reservationId','epoch','sequence','digest','observedAtMs'
        ])||start.pending.reservationId!==reservation.reservationId||
          start.pending.sequence!==reservation.sequence||
          start.pending.digest!==reservation.digest||
          start.pending.sequence!==start.sequence+1||
          start.pending.epoch!==start.epoch||
          candidate.checkpoint.initialized!==true||
          candidate.checkpoint.deviceId!==DEVICE||
          candidate.checkpoint.epoch!==start.epoch||
          candidate.checkpoint.sequence!==start.pending.sequence||
          candidate.checkpoint.digest!==start.pending.digest||
          candidate.checkpoint.observedAtMs!==start.pending.observedAtMs||
          candidate.current.observedAtMs!==start.pending.observedAtMs||
          candidate.current.overallRisk!=='UNKNOWN')
          return reject('incident-or-pending-binding-refused');
        const firstTime=clock();
        if(!integer(firstTime,946684800000,Number.MAX_SAFE_INTEGER)||
          !integer(candidate.current.observedAtMs,946684800000,Number.MAX_SAFE_INTEGER)||
          candidate.current.observedAtMs<firstTime-STALE_MS||
          candidate.current.observedAtMs>firstTime+FUTURE_MS)
          return reject('stale-or-invalid-observation');
        // This callback MUST be separately authenticated and constrained in
        // a real deployment. This module cannot independently establish that.
        const actual=await readPublication();
        if(!exact(actual,['current','checkpoint'])||
          !isDeepStrictEqual(actual.current,candidate.current)||
          !isDeepStrictEqual(actual.checkpoint,candidate.checkpoint))
          return reject('actual-database-readback-does-not-match');
        const after=witness.snapshot();
        const later=clock();
        if(!isDeepStrictEqual(after,start)||after.quarantined!==false||
          !integer(later,firstTime,firstTime+2000)||
          candidate.current.observedAtMs<later-STALE_MS)
          return reject('incident-or-anchor-changed-after-readback');
        const ack=Object.freeze({
          kind:'SIGNED_PUBLICATION_CONFIRMED',deviceId:DEVICE,
          epoch:after.epoch,revision:after.revision+1,
          sequence:after.pending.sequence,digest:after.pending.digest,
          reservationId:after.pending.reservationId,atMs:later
        });
        const signature=sign(
          null,Buffer.from(canonicalH7Acknowledgement(ack)),
          acknowledgerPrivateKey).toString('base64url');
        // An ack is merely a controlled synthetic proof. The caller must
        // separately submit it to H7's signed-witness state machine.
        return Object.freeze({
          attested:true,kind:'SYNTHETIC_EMULATOR_READBACK_ONLY',
          acknowledgement:ack,signature,
          releaseDecision:'NO_GO',canWriteFirebase:false,
          canPublish:false,canOperateGate:false
        });
      }catch{
        return reject('observer-unavailable-or-uncertain');
      }
    }
  });
}
