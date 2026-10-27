// Fail-closed interpretation for displayed field telemetry.
// Pure, no device, Firebase, network, mutation, or gate-control capability.
const canonical = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
export function isExplicitWaterFault(reportedStatus) {
  return ['SENSOR_ERROR','ERROR','OFFLINE','INVALID'].includes(canonical(reportedStatus));
}

export function reconcileWaterStatusWithoutMeasurement(reportedStatus) {
  const raw=canonical(reportedStatus);
  // An old categorical SAFE flag does not prove a water measurement exists.
  // Retain reported escalation, but never invent a non-hazard finding.
  return raw==='DANGER'||raw==='WARNING'||raw==='SENSOR_ERROR'
    ? raw : 'UNKNOWN';
}

/**
 * Reported gate status and reported servo angle are distinct telemetry
 * observations, NOT proof of physical gate position. Disagreement must never
 * be presented as confidently CLOSED (or confidently OPEN).
 */
export function reconcileReportedGateStatus({status,angle,countdownSeconds}={}) {
  const raw=canonical(status)==='OPENING_WARNING'?'COUNTDOWN':canonical(status);
  const states=new Set(['CLOSED','COUNTDOWN','OPENING','OPEN','CLOSING']);
  if(!states.has(raw))return 'UNKNOWN';
  const a=typeof angle==='number'&&Number.isFinite(angle)&&angle>=0&&angle<=90?angle:null;
  const count=typeof countdownSeconds==='number'&&Number.isFinite(countdownSeconds)
    &&countdownSeconds>=0&&countdownSeconds<=3600?countdownSeconds:null;
  // An explicitly present but invalid angle/countdown is a conflict,
  // not a missing optional observation to be ignored.
  if(angle!==undefined&&angle!==null&&a===null)return 'UNKNOWN';
  if(countdownSeconds!==undefined&&countdownSeconds!==null&&count===null)return 'UNKNOWN';
  // A positive countdown is compatible only with a reported pre-opening state.
  if(count!==null&&count>0)return raw==='COUNTDOWN'||raw==='OPENING'?'COUNTDOWN':'UNKNOWN';
  if(raw==='COUNTDOWN')return 'UNKNOWN'; // no active countdown: stale/conflict
  if(a===null)return raw; // reported status only, never position verification
  if(raw==='CLOSED')return a<=2?'CLOSED':'UNKNOWN';
  if(raw==='OPEN')return a>=80?'OPEN':'UNKNOWN';
  if(raw==='OPENING')return a>2&&a<80?'OPENING':'UNKNOWN';
  if(raw==='CLOSING')return a>2&&a<90?'CLOSING':'UNKNOWN';
  return 'UNKNOWN';
}
