// Fail-closed interpretation for displayed field telemetry.
// Pure, no device, Firebase, network, mutation, or gate-control capability.
const canonical = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
export function isExplicitWaterFault(reportedStatus) {
  return ['SENSOR_ERROR','ERROR','OFFLINE','INVALID','UNAVAILABLE','DISCONNECTED',
    'NOT_INSTALLED','REMOVED'].includes(canonical(reportedStatus));
}

export function reconcileWaterStatusWithoutMeasurement(reportedStatus) {
  const raw=canonical(reportedStatus);
  // An old categorical SAFE flag does not prove a water measurement exists.
  // Retain reported escalation, but never invent a non-hazard finding.
  return raw==='DANGER'||raw==='WARNING'||raw==='SENSOR_ERROR'
    ? raw : 'UNKNOWN';
}

/**
 * Conservative, display-only prototype water measurement contract.
 * 25 cm is the existing installation assumption, NOT HC-SR04's 400 cm
 * transducer range. Hardware calibration and zero-echo policy remain unverified.
 * A present but invalid air gap must NEVER fall back to a cached levelCm.
 * Preserve an independently reported WARNING/DANGER instead of clearing it.
 */
export function reconcileCalibratedWaterMeasurement(source = {}) {
  if (!source || typeof source !== 'object') source = {};
  const heightCm = 25;
  const reported = canonical(source.status);
  const escalation = reported === 'DANGER' ? 'DANGER'
    : reported === 'WARNING' ? 'WARNING' : null;
  const unknown = () => ({
    distanceCm: null, levelCm: null,
    status: escalation ?? reconcileWaterStatusWithoutMeasurement(reported)
  });

  if (isExplicitWaterFault(reported))
    return { distanceCm: null, levelCm: null, status: 'SENSOR_ERROR' };

  let distanceCm;
  let levelCm;
  if (Object.hasOwn(source, 'distanceCm')) {
    const distance = source.distanceCm;
    if (typeof distance !== 'number' || !Number.isFinite(distance) ||
        distance < 0 || distance > heightCm) return unknown();
    distanceCm = distance;
    levelCm = heightCm - distance;
  } else if (Object.hasOwn(source, 'levelCm')) {
    const level = source.levelCm;
    if (typeof level !== 'number' || !Number.isFinite(level) ||
        level < 0 || level > heightCm) return unknown();
    levelCm = level;
    distanceCm = heightCm - level;
  } else return unknown();

  let status = levelCm >= 11 ? 'DANGER'
    : levelCm >= 8.5 ? 'WARNING' : 'SAFE';
  if (escalation === 'DANGER' ||
      (escalation === 'WARNING' && status === 'SAFE'))
    status = escalation;
  // A literal 0 cm remains DANGER here for historical website compatibility.
  // Do not treat it as a hardware-verified flood observation or SAFE recovery.
  return { distanceCm, levelCm, status };
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
  // Match the integer 0–90° / 0–10s prototype wire contract already
  // enforced by mobile and the bot. Calibration does not prove physical motion.
  const a=typeof angle==='number'&&Number.isInteger(angle)
    &&angle>=0&&angle<=90?angle:null;
  const count=typeof countdownSeconds==='number'&&Number.isInteger(countdownSeconds)
    &&countdownSeconds>=0&&countdownSeconds<=10?countdownSeconds:null;
  // An explicitly present but invalid angle/countdown is a conflict,
  // not a missing optional observation to be ignored.
  if(angle!==undefined&&angle!==null&&a===null)return 'UNKNOWN';
  if(countdownSeconds!==undefined&&countdownSeconds!==null&&count===null)return 'UNKNOWN';
  // A positive countdown is compatible only with a reported pre-opening state.
  if(count!==null&&count>0)return raw==='COUNTDOWN'||raw==='OPENING'?'COUNTDOWN':'UNKNOWN';
  if(raw==='COUNTDOWN')return 'UNKNOWN'; // no active countdown: stale/conflict
  // A bare OPEN or CLOSED status is not evidence of a matching angle.
  // Refuse to render a confirmed-looking position from status alone.
  if(a===null&&['OPEN','CLOSED'].includes(raw))return 'UNKNOWN';
  if(a===null)return raw; // motion labels remain controller reports, not proof
  if(raw==='CLOSED')return a<=2?'CLOSED':'UNKNOWN';
  if(raw==='OPEN')return a>=80?'OPEN':'UNKNOWN';
  if(raw==='OPENING')return a>2&&a<80?'OPENING':'UNKNOWN';
  if(raw==='CLOSING')return a>2&&a<90?'CLOSING':'UNKNOWN';
  return 'UNKNOWN';
}


const RAIN_RANK=Object.freeze({
  NORMAL:0,HEAVY_RAIN:1,FLOOD_WARNING:2,EXTREME:3,CRITICAL:4
});
const RISK_LEVELS=Object.freeze(['LOW','MODERATE','HIGH','SEVERE','CRITICAL']);
export function reconcileReportedRainStatus({status,dailyMm}={}) {
  const raw=canonical(status);
  const validRain=typeof dailyMm==='number'&&Number.isFinite(dailyMm)
    &&dailyMm>=0&&dailyMm<=10000;
  const fromAmount=!validRain?null:dailyMm>=300?'CRITICAL'
    :dailyMm>=200?'EXTREME':dailyMm>=150?'FLOOD_WARNING'
    :dailyMm>=100?'HEAVY_RAIN':'NORMAL';
  // An explicitly faulty gauge cannot be rehabilitated by a cached number.
  if(['ERROR','SENSOR_ERROR','OFFLINE','INVALID','NOT_INSTALLED','REMOVED'].includes(raw))
    return 'UNKNOWN';
  if(Object.hasOwn(RAIN_RANK,raw)) {
    if(fromAmount!==null&&RAIN_RANK[fromAmount]>RAIN_RANK[raw])return fromAmount;
    return raw;
  }
  // A historical variant reported ONLINE as a rain category.
  if(raw==='ONLINE'&&fromAmount!==null)return fromAmount;
  return 'UNKNOWN';
}

/**
 * Conservative, display-only source reconciliation. Unauthenticated
 * Firebase values are NOT a safety certification: contradictory or missing
 * measurements cannot be promoted to a LOW flood risk by a backend label.
 * A higher reported risk is retained instead of being silently lowered.
 * verifiedClearance is a trusted CALLER-SUPPLIED PROVENANCE RESULT, not a
 * self-declared Firebase field; default false makes unsigned legacy data
 * incapable of showing LOW on the active dashboard.
 * @param {{waterStatus?:unknown,rainStatus?:unknown,reportedRisk?:unknown,
 *   freshness?:unknown,verifiedClearance?:boolean}} [options]
 */
export function reconcileDisplayedFloodRisk({
  waterStatus,rainStatus,reportedRisk,freshness,verifiedClearance=false
}={}) {
  if(freshness!=='live')return 'UNKNOWN'; // historical ≠ current risk
  const water=canonical(waterStatus),rain=canonical(rainStatus);
  let observed='UNKNOWN';
  if(water==='DANGER'||rain==='CRITICAL')observed='CRITICAL';
  else if(rain==='EXTREME')observed='SEVERE';
  else if(water==='WARNING'||rain==='FLOOD_WARNING')observed='HIGH';
  else if(rain==='HEAVY_RAIN')observed='MODERATE';
  else if(water==='SAFE'&&rain==='NORMAL')observed='LOW';
  const backend=canonical(reportedRisk);
  // The shared system heartbeat is NOT a water/rain source-specific freshness
  // proof. A LOW display needs separately authenticated, current evidence
  // from BOTH streams. This provider has not integrated that trust contract.
  // Keep higher reported/derived hazards visible, but fail closed on LOW.
  const merged = !RISK_LEVELS.includes(backend) ? observed
    : observed==='UNKNOWN' ? backend==='LOW'?'UNKNOWN':backend
    : RISK_LEVELS[Math.max(RISK_LEVELS.indexOf(observed),RISK_LEVELS.indexOf(backend))];
  return merged==='LOW'&&verifiedClearance!==true?'UNKNOWN':merged;
}

/**
 * An alarm may be declared CLEAR only when an explicit Boolean false was
 * observed and the shared field telemetry is fresh. Null, missing, malformed,
 * or disconnected readings are NOT evidence of an inactive physical alarm.
 * Historical ACTIVE is preserved as historical, never reported as live.
 * verifiedClearance must come from a separately validated alarm-source proof;
 * shared system.lastUpdate is insufficient. Legacy provider never sets it.
 * @param {{active?:unknown,freshness?:unknown,verifiedClearance?:boolean}} [options]
 */
export function reconcileDisplayedAlarmState({active,freshness,verifiedClearance=false}={}) {
  if(freshness==='stale'&&active===true)return 'LAST ACTIVE';
  if(freshness!=='live')return 'UNAVAILABLE';
  if(active===true)return 'ACTIVE';
  // An unrelated system timestamp cannot prove that this specific alarm
  // changed to a currently verified CLEAR state. Preserve the report without
  // asserting physical alarm clearance until an authenticated proof exists.
  if(active===false)return verifiedClearance===true?'CLEAR':'INACTIVE REPORTED';
  return 'UNAVAILABLE';
}
