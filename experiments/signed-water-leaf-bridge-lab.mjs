// FloodGuard R2 -> R3: test-only bridge from the existing Stage 7/8/9
// signed/confirmed projection planner to PR #34's isolated scalar-leaf layout.
// NO Firebase client, privileged publisher, network, device credential,
// physical gate command, alert send, or side effect. The caller's registry,
// receipt signer and DATABASE_CONFIRMED evidence are NOT independently sourced.
import {
  planStrictSyntheticPublicProjection,
  STRICT_SYNTHETIC_PUBLIC_PATHS,
} from './strict-signed-projection-gate.mjs';

export const SIGNED_WATER_LEAF_LAB_ROOT = '/floodguard/publicTelemetryLabV1';
export const SIGNED_WATER_LEAF_LAB_FIELDS = Object.freeze([
  'water/distanceCm',
  'water/levelCm',
  'water/status',
  'system/lastUpdate',
  'system/overallRisk',
]);

const EXACT_LEGACY = Object.freeze([
  'water/distanceCm','water/levelCm','water/status',
  'system/lastUpdate','system/overallRisk',
]);
const WATER_STATUS = new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const fail = reason => Object.freeze({planned:false,reason});
const plain = x => x!==null && typeof x==='object' && !Array.isArray(x) &&
  Object.getPrototypeOf(x)===Object.prototype;
function exactScalarSet(value,keys) {
  return plain(value) && Object.keys(value).length===keys.length &&
    keys.every(k=>Object.hasOwn(value,k));
}

/**
 * IMPORTANT: an offline proposal is not an authenticated database operation.
 * The caller must obtain trusted registry, receipt signer and durable
 * DATABASE_CONFIRMED evidence independently, not from an HTTP request body.
 */
export function planSignedWaterLeafBridgeLab(source) {
  let upstream;
  try {upstream=planStrictSyntheticPublicProjection(source);}
  catch {return fail('upstream-unavailable');}
  if (upstream?.allowed!==true) return fail(typeof upstream?.reason==='string'
    ? upstream.reason : 'upstream-denied');
  if (upstream.kind!=='OFFLINE_PROJECTION_PLAN_NOT_APPLIED' ||
      !Array.isArray(STRICT_SYNTHETIC_PUBLIC_PATHS) ||
      STRICT_SYNTHETIC_PUBLIC_PATHS.join('|')!==EXACT_LEGACY.join('|') ||
      !exactScalarSet(upstream.proposedPublicChanges,EXACT_LEGACY))
    return fail('upstream-contract-drift');

  const values=upstream.proposedPublicChanges;
  const distance=values['water/distanceCm'];
  const level=values['water/levelCm'];
  const status=values['water/status'];
  const observed=values['system/lastUpdate'];
  if(typeof distance!=='number'||!Number.isFinite(distance)||
     distance<=0||distance>25 ||
     typeof level!=='number'||!Number.isFinite(level)||level<0||level>25||
     Math.abs(level-(25-distance))>0.05||
     !WATER_STATUS.has(status) ||
     !Number.isSafeInteger(observed) || observed<946684800000 ||
     values['system/overallRisk']!=='UNKNOWN')
    return fail('isolated-leaf-contract-drift');
  const expectedRisk=level>=11?'DANGER':level>=8.5?'WARNING':'SAFE';
  if(status!=='SENSOR_ERROR'&&status!==expectedRisk)
    return fail('water-risk-contradiction');

  const checkpoint=upstream.nextCheckpoint;
  if(!plain(checkpoint) ||
     Object.keys(checkpoint).sort().join('|')!=='digest|epoch|initialized|sequence'||
     checkpoint.initialized!==true ||
     !Number.isSafeInteger(checkpoint.epoch)||checkpoint.epoch<1||
     !Number.isSafeInteger(checkpoint.sequence)||checkpoint.sequence<1||
     typeof checkpoint.digest!=='string'||!/^[a-f0-9]{64}$/.test(checkpoint.digest))
    return fail('publication-checkpoint-unverified');

  // Explicitly no gate/alarm fields: a water-only signed frame cannot prove
  // physical actuator position, rain status, global safety or delivery.
  const leaves=Object.freeze(Object.fromEntries(SIGNED_WATER_LEAF_LAB_FIELDS
    .map(name=>[name,values[name]])));
  return Object.freeze({
    planned:true,
    kind:'OFFLINE_ISOLATED_LEAF_PLAN_NOT_PUBLISHED',
    root:SIGNED_WATER_LEAF_LAB_ROOT,
    proposedLeaves:leaves,
    nextCheckpoint:Object.freeze({...checkpoint}),
    // A valid synthetic receipt does NOT certify physical sensor reliability.
    sourceTrust:'SYNTHETIC_EVIDENCE_ONLY',
    floodClearance:'UNKNOWN',
    physicalGatePosition:'UNVERIFIED',
    notificationDelivery:'NOT_VERIFIED',
    readyForActuation:false,
  });
}
