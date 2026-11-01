// FloodGuard test-only read-side reconciliation of isolated public RTDB leaves.
// No network/Firebase/auth/publishing/actuation code. Not an emergency system.
import {
  PUBLIC_TELEMETRY_LAB_FIELDS,
  PUBLIC_TELEMETRY_LAB_ROOT,
  projectPublicTelemetryLabV1,
} from './public-telemetry-leaf-projection-lab.mjs';

export const PUBLIC_MONITOR_LAB_LEAF_PATHS = Object.freeze(
  Object.entries(PUBLIC_TELEMETRY_LAB_FIELDS).flatMap(([group, fields]) =>
    fields.map(field => `${PUBLIC_TELEMETRY_LAB_ROOT}/${group}/${field}`)),
);
const allowed = new Set(PUBLIC_MONITOR_LAB_LEAF_PATHS);
const HAZARD = Object.freeze({
  'water.status': ['DANGER', 'WARNING', 'SENSOR_ERROR'],
  'rain.status': ['HEAVY_RAIN', 'FLOOD_WARNING', 'EXTREME', 'CRITICAL'],
  'system.overallRisk': ['MODERATE', 'HIGH', 'SEVERE', 'CRITICAL'],
  'alarm.active': [true],
});
const clone = obj => Object.assign(Object.create(null), obj);
const validMs = n => Number.isSafeInteger(n) && n >= 0;

export function createPublicLeafMonitorLab() {
  return { records: Object.create(null), faults: Object.create(null),
    lastReportedHazards: [], disconnected: false, generation: 0 };
}

// A value event is only an arrival in the browser; it is not verified sensor
// freshness. Missing/invalid/denied/disconnected values are not "SAFE".
export function applyPublicLeafEventLab(previous, event) {
  if (!previous || typeof previous !== 'object' || !event || typeof event !== 'object')
    throw new TypeError('Invalid monitor event');
  const { path, kind, atMs } = event;
  if (!validMs(atMs)) throw new TypeError('Invalid local receipt timestamp');
  if (kind === 'disconnect') {
    return { records: Object.create(null), faults: clone(previous.faults),
      lastReportedHazards: [...previous.lastReportedHazards], disconnected: true,
      generation: previous.generation + 1 };
  }
  if (!allowed.has(path)) throw new Error('Unapproved public leaf path');
  // Ignore callbacks from a cancelled Firebase subscription generation.
  if ((event.generation ?? 0) !== previous.generation) return previous;
  if (!['value', 'permission_denied', 'transport_error'].includes(kind))
    throw new Error('Unsupported public leaf event');
  const records = clone(previous.records);
  const faults = clone(previous.faults);
  const lastReportedHazards = [...previous.lastReportedHazards];
  const existing = records[path];
  // Do not accept an older callback over a newer observed value; this does
  // not replace authenticated device sequence / rollback protection.
  if (existing && atMs < existing.atMs) return previous;
  if (kind !== 'value' || event.value === null) {
    delete records[path];
    faults[path] = kind === 'value' ? 'MISSING' : kind.toUpperCase();
    return { records, faults, lastReportedHazards, disconnected: false, generation: previous.generation };
  }
  const relative = path.slice(PUBLIC_TELEMETRY_LAB_ROOT.length + 1);
  const [group, field] = relative.split('/');
  try {
    // Reuse the exact PR #34 primitive whitelist and validators.
    const projected = projectPublicTelemetryLabV1({ [group]: { [field]: event.value } });
    const value = projected[group][field];
    records[path] = { value, atMs };
    delete faults[path];
    const signal = `${group}.${field}`;
    if (HAZARD[signal]?.includes(value) && !lastReportedHazards.includes(signal))
      lastReportedHazards.push(signal);
  } catch {
    delete records[path];
    faults[path] = 'INVALID';
  }
  return { records, faults, lastReportedHazards, disconnected: false, generation: previous.generation };
}

export function summarizePublicLeafMonitorLab(state, nowMs, maxReceiptAgeMs = 15000) {
  if (!validMs(nowMs) || !validMs(maxReceiptAgeMs) || maxReceiptAgeMs === 0)
    throw new TypeError('Invalid summary clock');
  const recent = Object.entries(state.records).filter(([, record]) =>
    record && validMs(record.atMs) && record.atMs <= nowMs &&
    nowMs - record.atMs <= maxReceiptAgeMs).length;
  const received = Object.keys(state.records).length;
  const missingOrDenied = PUBLIC_MONITOR_LAB_LEAF_PATHS.length - recent;
  return {
    transport: state.disconnected ? 'DISCONNECTED' : recent === 0 ? 'NO_RECENT_LEAVES' :
      missingOrDenied > 0 ? 'PARTIAL_UNVERIFIED' : 'RECEIVED_UNVERIFIED',
    recentlyReceivedLeafCount: recent,
    totalLeafCount: PUBLIC_MONITOR_LAB_LEAF_PATHS.length,
    recordedLeafCount: received,
    lastReportedHazard: state.lastReportedHazards.length > 0 ?
      'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR' : 'NOT_ESTABLISHED',
    // Deliberately never infer physical clearance, emergency readiness or
    // actual gate position from unsigned RTDB scalar values / browser clocks.
    sourceTrust: 'UNVERIFIED',
    floodClearance: 'UNKNOWN',
    physicalGatePosition: 'UNVERIFIED',
    safetyAutomationReady: false,
  };
}
