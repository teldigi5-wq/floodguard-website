// FloodGuard H16 — presentation-only boundaries for unsigned Firebase RTDB.
// Timestamp recency, a low risk, and plausible distance/level cannot establish
// physical safety, source authenticity, or certified gate/controller operation.
// No network, Firebase SDK, secrets, alerts, or hardware capabilities.
const RISK_LEVELS = new Set(['LOW','MODERATE','HIGH','SEVERE','CRITICAL']);
const WATER_STATES = new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const asLabel = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const asLevel = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= 25 ? value : null;

export function describeRiskObservation({reportedRisk, freshness}={}) {
  const risk = asLabel(reportedRisk);
  const valid = RISK_LEVELS.has(risk);
  const recent = freshness === 'live';
  const reportedRiskLabel = valid
    ? (recent ? 'REPORTED ' + risk + ' · UNVERIFIED'
      : 'LAST RECORDED ' + risk + ' · NOT CURRENT')
    : 'NO VERIFIED RISK READING';
  return Object.freeze({
    currentPhysicalRisk: 'UNKNOWN · UNVERIFIED',
    reportedRiskLabel,
    // Only unverified elevated leads may be highlighted on the spectrum.
    // LOW is never highlighted as an operational safety clearance.
    reportedElevation: recent && valid && risk !== 'LOW' ? risk : null,
    sourceAuthenticated: false, physicalSafetyVerified: false,
    canDeclareSafe: false, canOperateGate: false, canSendAlert: false
  });
}

export function describeWaterObservation({water, freshness}={}) {
  const recent = freshness === 'live';
  const status = asLabel(water?.status);
  const knownStatus = WATER_STATES.has(status);
  // An explicit sensor fault invalidates any accompanying numeric placeholder.
  // A danger-range normalized reading also takes precedence over stale SAFE
  // text from an independently updated Firebase child.
  const sensorFault = status === 'SENSOR_ERROR';
  const level = sensorFault ? null : asLevel(water?.levelCm);
  const gap = sensorFault ? null : asLevel(water?.distanceCm);
  const dangerReport = recent && !sensorFault &&
    (status === 'DANGER' || (level !== null && level >= 11));
  const warningReport = recent && !sensorFault && !dangerReport &&
    (status === 'WARNING' || (level !== null && level >= 8.5 && level < 11));
  const reportStatusLabel = !recent
    ? (knownStatus ? 'LAST RECORDED ' + status + ' · NOT CURRENT'
      : 'CURRENT WATER STATE UNKNOWN')
    : dangerReport ? 'POSSIBLE DANGER · UNVERIFIED'
    : warningReport ? 'POSSIBLE WARNING · UNVERIFIED'
    : knownStatus ? 'REPORTED ' + status + ' · UNVERIFIED'
    : 'UNKNOWN · SOURCE UNVERIFIED';
  return Object.freeze({
    currentLevel: recent ? level : null,
    lastRecordedLevel: !recent ? level : null,
    currentAirGap: recent ? gap : null,
    lastRecordedAirGap: !recent ? gap : null,
    reportStatusLabel,
    // Never highlight "SAFE" as verified; warning/danger still draw attention.
    safeBandActive: false,
    warningBandActive: warningReport,
    dangerBandActive: dangerReport,
    sourceAuthenticated: false, physicalSafetyVerified: false,
    canDeclareSafe: false, canOperateGate: false, canSendAlert: false
  });
}
