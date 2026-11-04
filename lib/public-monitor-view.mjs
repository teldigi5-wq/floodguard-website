// FloodGuard H19: read-only, unsigned public presentation contract.
// A recent Firebase timestamp is not authenticated field or actuator evidence.
import {describeWaterObservation} from './dashboard-water-observation.mjs';
import {describeGateObservation} from './gate-observation-view.mjs';
import {reconcileDisplayedAlarmState} from './telemetry-safety.mjs';
import {describePublicEspObservation,describePublicRainObservation} from './public-health-observation.mjs';

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

  // Same source/health decisions on home, ribbon, dashboard and devices.
  const esp = describePublicEspObservation({
    esp:data?.esp8266,inventory:data?.devices?.esp8266,freshness
  });
  const rain = describePublicRainObservation({
    rain:data?.rain,device:data?.devices?.rainGauge,freshness
  });
  const rainLabel = rain.currentMm !== null
    ? 'REPORTED ' + rain.currentMm.toFixed(1) + ' mm · UNVERIFIED'
    : rain.categoryLabel;

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
    espLabel:esp.label,
    espState:esp.state,
    espSignalDbm:esp.signalDbm,
    rainCurrentMm:rain.currentMm,
    rainLabel,
    authenticatedFieldSource:false,
    physicalGateVerified:false,
    canDeclareSafe:false,
    canOperateGate:false,
    canSendAlert:false
  });
}
