// FloodGuard H15: pure presentation policy for UNSIGNED gate telemetry.
// A recent Firebase timestamp is not authenticated actuator feedback.
// No network, Firebase SDK, production keys, gate or alarm commands.
import {reconcileReportedGateStatus} from './telemetry-safety.mjs';

/**
 * @param {{gate?: {status?: unknown,angle?: unknown,countdownSeconds?: unknown}|null,
 *   freshness?: string}} [input]
 */
export function describeGateObservation({gate=null,freshness='unavailable'}={}) {
  const recent = freshness==='live';
  const reportedState=reconcileReportedGateStatus({
    status:gate?.status,angle:gate?.angle,countdownSeconds:gate?.countdownSeconds
  });
  const state=recent?reportedState:'UNKNOWN';
  const angle=recent&&state!=='UNKNOWN'&&
    typeof gate?.angle==='number'&&Number.isInteger(gate.angle)&&
    gate.angle>=0&&gate.angle<=90?gate.angle:null;
  const countdown=recent&&state==='COUNTDOWN'&&
    typeof gate?.countdownSeconds==='number'&&
    Number.isInteger(gate.countdownSeconds)&&
    gate.countdownSeconds>=1&&gate.countdownSeconds<=10
      ?gate.countdownSeconds:null;
  const lift=angle===null?null:Math.round(angle/90*100);
  const displayLabel=!recent?'CURRENT POSITION UNKNOWN':
    state==='UNKNOWN'?'UNKNOWN · UNVERIFIED':
      'REPORTED '+state+' · UNVERIFIED';
  return Object.freeze({
    state,reportedState,displayLabel,angle,countdown,lift,
    recentCountdownReport:countdown!==null,
    authenticatedSource:false,
    physicalGateVerified:false,
    physicalCountdownVerified:false,
    physicalDischargeVerified:false,
    canDeclareClosed:false,
    canOperateGate:false
  });
}
