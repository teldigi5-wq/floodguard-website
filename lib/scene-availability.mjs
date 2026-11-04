// H20 display-only scene admission. Inputs must already be qualified by H19.
// This cannot authenticate a physical sensor, gate position or field safety.
const measuredAngle = v => typeof v === 'number' && Number.isInteger(v) &&
  v >= 0 && v <= 90 ? v : null;
const measuredGap = v => typeof v === 'number' && Number.isFinite(v) &&
  v >= 0 && v <= 25 ? v : null;

export function describeSceneAvailability({
  angle = null, waterDistance = null, reducedMotion = false
} = {}) {
  const gateAngleDeg = measuredAngle(angle);
  const waterDistanceCm = measuredGap(waterDistance);
  const complete = gateAngleDeg !== null && waterDistanceCm !== null;
  // The accessibility preference remains visible even when source inputs
  // are unavailable; neither condition can enable the 3D gate illustration.
  const mode = reducedMotion === true ? 'reduced-motion' :
    !complete ? 'unavailable' : 'illustrative-3d';
  return Object.freeze({
    mode,
    render3D: mode === 'illustrative-3d',
    gateAngleDeg,
    waterDistanceCm,
    physicalGateVerified: false,
    waterLevelVerified: false,
    physicalFloodSafety: 'UNKNOWN · UNVERIFIED',
    gateLabel: gateAngleDeg === null
      ? 'POSITION UNKNOWN · SOURCE UNVERIFIED'
      : 'REPORTED ' + gateAngleDeg + '° · UNVERIFIED',
    waterLabel: waterDistanceCm === null
      ? 'WATER READING UNKNOWN · SOURCE UNVERIFIED'
      : 'REPORTED ' + waterDistanceCm.toFixed(1) + ' cm air gap · UNVERIFIED'
  });
}
