// FloodGuard H19: read-only, unsigned public presentation contract.
// A recent Firebase timestamp is not authenticated field or actuator evidence.
import {describeWaterObservation} from './dashboard-water-observation.mjs';
import {describeGateObservation} from './gate-observation-view.mjs';
import {reconcileDisplayedAlarmState} from './telemetry-safety.mjs';

const ESP_STATES = new Set(['ONLINE','OFFLINE','ERROR','UNKNOWN','NOT_INSTALLED']);
const canonical = value => typeof value === 'string' ? value.trim().toUpperCase() : null;
const validRain = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= 10000 ? value : null;
const validRssi = value => typeof value === 'number' && Number.isFinite(value)
  && value >= -130 && value <= 0 ? value : null;

/**
 * Only signed-off *presentation*, never source authority. The live freshness
 * classification refers to an unsigned DATABASE timestamp, not the device.
 */
export function describePublicMonitorView({data=null,freshness='unavailable'}={}) {
  const recent = freshness === 'live';
  const water = describeWaterObservation({water:data?.water,freshness});
  const gate = describeGateObservation({gate:data?.gate,freshness});
  const reportedAlarm = reconcileDisplayedAlarmState({
    active:data?.alarm?.active,freshness
  });
  const alarmLabel = reportedAlarm === 'CLEAR' ? 'REPORTED OFF · UNVERIFIED'
    : reportedAlarm === 'ACTIVE' ? 'REPORTED ACTIVE · UNVERIFIED'
    : reportedAlarm === 'LAST ACTIVE' ? 'LAST REPORTED ACTIVE · NOT CURRENT'
    : 'UNAVAILABLE · SOURCE UNVERIFIED';

  // H17 assembled the three ESP children as one failure-contained epoch.
  // The public view also refuses to promote conflicting or incomplete values.
  const status = canonical(data?.esp8266?.status);
  const connection = canonical(data?.esp8266?.connection);
  const coherentEsp = recent && ESP_STATES.has(status) && status === connection;
  const espLabel = coherentEsp
    ? 'REPORTED ' + status + ' · UNVERIFIED'
    : 'UNKNOWN · SOURCE UNVERIFIED';

  const rainCurrentMm = recent ? validRain(data?.rain?.currentMm) : null;
  const rainLabel = rainCurrentMm !== null
    ? 'REPORTED ' + rainCurrentMm.toFixed(1) + ' mm · UNVERIFIED'
    : recent ? 'UNKNOWN · SOURCE UNVERIFIED' : 'NOT CURRENT · SOURCE UNVERIFIED';

  return Object.freeze({
    physicalFloodSafety:'UNKNOWN · UNVERIFIED',
    freshnessLabel:recent ? 'RECENT DATABASE REPORT · SOURCE UNVERIFIED'
      : 'NO CURRENT FIELD ASSURANCE',
    waterLevelCm:water.currentLevel,
    waterDistanceCm:water.currentAirGap,
    waterLabel:water.reportStatusLabel,
    gateAngleDeg:gate.angle,
    gateLabel:gate.displayLabel,
    alarmLabel,
    espLabel,
    espSignalDbm:coherentEsp ? validRssi(data?.esp8266?.rssi) : null,
    rainCurrentMm,
    rainLabel,
    authenticatedFieldSource:false,
    physicalGateVerified:false,
    canDeclareSafe:false,
    canOperateGate:false,
    canSendAlert:false
  });
}
