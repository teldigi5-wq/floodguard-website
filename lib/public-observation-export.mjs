// FloodGuard H18 — read-only, explicitly non-operational browser export.
// Preserve whitelisted *reports* while refusing to turn unsigned timestamps,
// LOW/SAFE, CLEAR, gate CLOSED or ESP ONLINE into field safety assertions.
import {describeRiskObservation,describeWaterObservation}
  from './dashboard-water-observation.mjs';
import {describeGateObservation} from './gate-observation-view.mjs';
import {reconcileDisplayedAlarmState} from './telemetry-safety.mjs';

const finite=(value)=>typeof value==='number'&&Number.isFinite(value);
const measured=value=>finite(value)?value:null;
const cleanText=value=>typeof value==='string'
  ? value.trim().toUpperCase().replace(/[^A-Z0-9_ -]/g,'').slice(0,80)||null
  : null;
const observedStatus=(value,recency)=>value===null
  ? 'UNAVAILABLE'
  : recency==='live'
    ? 'REPORTED '+value+' · UNVERIFIED'
    : 'LAST RECORDED '+value+' · NOT CURRENT';

function describeEspGroup(esp, freshness){
  const status=cleanText(esp?.status);
  const connection=cleanText(esp?.connection);
  const rssi=measured(esp?.rssi);
  if (status === null || connection === null ||
      (status === 'ONLINE') !== (connection === 'ONLINE')) {
    return Object.freeze({
      status:null,connection:null,rssi:null,
      reportLabel:'UNKNOWN · SOURCE UNVERIFIED',
      physicalConnectivityVerified:false
    });
  }
  return Object.freeze({
    status,connection,rssi,
    reportLabel:observedStatus(status,freshness),
    physicalConnectivityVerified:false
  });
}

export function buildPublicObservationExport({
  data=null,freshness='unavailable',ageSeconds=null,lastUpdateMs=null,
  generatedAt='UNKNOWN'
}={}) {
  // No caller-controlled claim can authorize the exported record as a
  // physical warning, all-clear, gate instruction or field certificate.
  const water=describeWaterObservation({water:data?.water,freshness});
  const risk=describeRiskObservation({
    reportedRisk:data?.system?.overallRisk,freshness
  });
  const gate=describeGateObservation({gate:data?.gate,freshness});
  const alarm=reconcileDisplayedAlarmState({
    active:data?.alarm?.active,freshness
  });
  const alarmDisplay=alarm==='CLEAR'?'REPORTED OFF · UNVERIFIED'
    :alarm==='ACTIVE'?'REPORTED ACTIVE · UNVERIFIED'
    :alarm==='LAST ACTIVE'?'LAST REPORTED ACTIVE · NOT CURRENT'
    :'UNAVAILABLE';
  const date=finite(lastUpdateMs)&&lastUpdateMs>=0&&lastUpdateMs<=8.64e15
    ?new Date(lastUpdateMs).toISOString():null;
  const record=Object.freeze({
    schema:'floodguard-browser-observation-v2',
    purpose:'NON_OPERATIONAL_OBSERVATION_ONLY',
    generatedAt:typeof generatedAt==='string'?generatedAt:'UNKNOWN',
    freshness,
    ageSeconds:finite(ageSeconds)&&ageSeconds>=0?ageSeconds:null,
    lastRecordedAt:date,
    sourceAssurance:'UNSIGNED_FIREBASE · UNVERIFIED',
    physicalFloodSafety:'UNKNOWN · UNVERIFIED',
    authenticatedFieldSource:false,
    physicalConditionsVerified:false,
    canDeclareSafe:false,canOperateGate:false,canSendAlert:false,
    risk:Object.freeze({
      currentPhysicalRisk:risk.currentPhysicalRisk,
      reportedLabel:risk.reportedRiskLabel
    }),
    water:Object.freeze({
      levelCm:measured(data?.water?.levelCm),
      distanceCm:measured(data?.water?.distanceCm),
      status:cleanText(data?.water?.status),
      reportLabel:water.reportStatusLabel,
      currentPhysicalLevelVerified:false
    }),
    rain:Object.freeze({
      currentMm:measured(data?.rain?.currentMm),
      dailyMm:measured(data?.rain?.dailyMm),
      status:cleanText(data?.rain?.status),
      reportLabel:observedStatus(cleanText(data?.rain?.status),freshness)
    }),
    gate:Object.freeze({
      status:cleanText(data?.gate?.status),
      angle:measured(data?.gate?.angle),
      reason:cleanText(data?.gate?.reason),
      reportLabel:gate.displayLabel,
      physicalGateVerified:false
    }),
    alarm:Object.freeze({
      active:typeof data?.alarm?.active==='boolean'?data.alarm.active:null,
      type:cleanText(data?.alarm?.type),
      displayState:alarmDisplay,
      physicalAlarmVerified:false
    }),
    esp8266:describeEspGroup(data?.esp8266,freshness)
  });
  return record;
}

export function formatPublicObservationSummary(s) {
  // Use only qualified labels; do not echo raw SAFE/CLOSED/ONLINE as if verified.
  const numberUnit=(v,unit)=>v===null?'unavailable':v+' '+unit;
  return [
    'FloodGuard UNSIGNED observation — '+s.generatedAt,
    'Source: '+s.sourceAssurance,
    'Physical flood safety: '+s.physicalFloodSafety,
    'Database timestamp: '+(s.lastRecordedAt??'unavailable'),
    'Record freshness: '+s.freshness+' (timestamp only)',
    'Reported risk: '+s.risk.reportedLabel,
    'Water: '+s.water.reportLabel+' · '+numberUnit(s.water.levelCm,'cm')+' (not verified)',
    'Rain: '+s.rain.reportLabel+' · '+numberUnit(s.rain.currentMm,'mm')+' (not verified)',
    'Gate: '+s.gate.reportLabel+' · physical position unknown',
    'Alarm: '+s.alarm.displayState,
    'ESP8266: '+s.esp8266.reportLabel,
    'NO ALL-CLEAR · NO VERIFIED DEVICE OR GATE AUTHORITY'
  ].join('\n');
}
