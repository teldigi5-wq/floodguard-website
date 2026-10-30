// FloodGuard Stage 16: PROPOSED uncertainty-first UI contract (TEST ONLY).
// Pure offline analysis; no Firebase, bot, Flutter runtime, alerts or actuator.
// Output is not a trusted safety assessment: production anonymous writes persist.
import {parseFieldTimestamp,ageSeconds} from '../lib/telemetry-health.mjs';
import {compareStage13SyntheticFreshness} from './stage13-security-gap-review.mjs';

const WATER_STATES=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const RAIN_STATES=new Set(['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME','CRITICAL']);
const RISK_STATES=new Set(['LOW','MODERATE','HIGH','SEVERE','CRITICAL']);
const GATE_STATES=new Set(['CLOSED','OPEN','OPENING','CLOSING','COUNTDOWN','OPENING_WARNING']);
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max?n:null;
const upper=s=>typeof s==='string'?s.trim().toUpperCase():'';
const grade=level=>level>=11?'DANGER':level>=8.5?'WARNING':'SAFE';
function reviewWater(water,issues){
  if(!isRecord(water)){issues.add('WATER_SOURCE_MISSING');return {label:'UNAVAILABLE',inferred:null};}
  const d=number(water.distanceCm,0,400);
  const l=number(water.levelCm,0,25);
  const raw=upper(water.status);
  if(raw==='SENSOR_ERROR'){
    issues.add('EXPLICIT_WATER_SENSOR_ERROR');
    return {label:'UNVERIFIED_WATER',inferred:null};
  }
  if(d===0){
    issues.add('ZERO_GAP_PHYSICAL_MEANING_UNVERIFIED');
    return {label:'UNVERIFIED_WATER',inferred:null};
  }
  if(d===null){
    issues.add(l!==null?'LEVEL_ONLY_NOT_CORROBORATED':'WATER_MEASUREMENT_MISSING_OR_INVALID');
    return {label:l!==null?'UNVERIFIED_WATER':'UNAVAILABLE',inferred:null};
  }
  const calculated=Math.max(0,Math.min(25,25-d));
  if(l!==null&&Math.abs(l-calculated)>0.001){
    issues.add('WATER_DISTANCE_AND_LEVEL_CONFLICT');
    return {label:'UNVERIFIED_WATER',inferred:null};
  }
  const inferred=grade(calculated);
  if(!WATER_STATES.has(raw)){
    issues.add('WATER_SOURCE_STATUS_UNKNOWN');
    return {label:'UNVERIFIED_WATER',inferred:null};
  }
  if(raw!==inferred){
    issues.add('WATER_STATUS_CONTRADICTS_MEASUREMENT');
    return {label:'UNVERIFIED_WATER',inferred:null};
  }
  return {label:inferred+'_REPORTED_ONLY',inferred};
}
function reviewRain(rain,issues){
  if(!isRecord(rain)){issues.add('RAIN_SOURCE_MISSING');return null;}
  const raw=upper(rain.status);
  if(!RAIN_STATES.has(raw)){
    issues.add(raw==='ONLINE'?'LEGACY_ONLINE_RAIN_CATEGORY_UNVERIFIED':'RAIN_CATEGORY_UNAVAILABLE');
    return null;
  }
  return raw;
}
function reviewedRisk(water,rain,backend,issues){
  if(!water.inferred||!rain){
    issues.add('RISK_REQUIRES_VERIFIED_INPUT_CONTRACT');
    return 'REVIEW_REQUIRED';
  }
  const derived=water.inferred==='DANGER'||rain==='CRITICAL'?'CRITICAL'
    :(water.inferred==='WARNING'&&rain==='FLOOD_WARNING')||rain==='EXTREME'?'SEVERE'
    :water.inferred==='WARNING'||rain==='FLOOD_WARNING'?'HIGH'
    :rain==='HEAVY_RAIN'?'MODERATE':'LOW';
  const reported=upper(backend);
  if(!RISK_STATES.has(reported)||reported!==derived){
    issues.add('BACKEND_RISK_CONFLICT_OR_UNKNOWN');
    return 'REVIEW_REQUIRED';
  }
  return derived+'_REPORTED_ONLY';
}
function reviewGate(gate,issues){
  if(!isRecord(gate)){issues.add('GATE_TELEMETRY_MISSING');return 'UNVERIFIED_POSITION';}
  const raw=upper(gate.status);
  const angle=number(gate.angle,0,180),countdown=number(gate.countdownSeconds,0,3600);
  if(!GATE_STATES.has(raw)||angle===null||countdown===null){
    issues.add('GATE_STATUS_ANGLE_OR_COUNTDOWN_UNAVAILABLE');
    return 'UNVERIFIED_POSITION';
  }
  const awaiting=raw==='COUNTDOWN'||raw==='OPENING_WARNING';
  if(awaiting&&countdown>0&&angle<=2)return 'COUNTDOWN_REPORTED_ONLY';
  if(raw==='CLOSED'&&angle<=2&&countdown===0)return 'CLOSED_REPORTED_ONLY';
  if(raw==='OPEN'&&angle>=80&&countdown===0)return 'OPEN_REPORTED_ONLY';
  if((raw==='OPENING'||raw==='CLOSING')&&angle>2&&angle<80&&countdown===0)
    return 'TRANSITION_REPORTED_ONLY';
  issues.add('GATE_STATUS_ANGLE_COUNTDOWN_CONFLICT');
  return 'POSITION_CONFLICT';
}
export function assessStage16ProposedUi({snapshot,nowMs,connected=true}={}){
  if(!isRecord(snapshot)||!Number.isSafeInteger(nowMs)||nowMs<0)
    throw new TypeError('Synthetic object and explicit fixed test clock required');
  const issues=new Set(['AUTHENTICATED_FIELD_SOURCE_UNVERIFIED']);
  const water=reviewWater(snapshot.water,issues);
  const rain=reviewRain(snapshot.rain,issues);
  const risk=reviewedRisk(water,rain,snapshot.system?.overallRisk,issues);
  const gate=reviewGate(snapshot.gate,issues);
  const timestamp=parseFieldTimestamp(snapshot.system?.lastUpdate,nowMs);
  const age=ageSeconds(timestamp,nowMs);
  const comparison=compareStage13SyntheticFreshness({
    timestamp:snapshot.system?.lastUpdate,nowMs,connected,
    hasData:isRecord(snapshot.water)
  });
  let freshness='RECENT_FIELD_TIMESTAMP_ONLY';
  if(connected!==true){
    freshness='DISCONNECTED_LAST_REPORTED_ONLY';
    issues.add('DATABASE_CONNECTION_NOT_ESTABLISHED');
  }else if(timestamp===null){
    freshness='INVALID_OR_MISSING_FIELD_TIMESTAMP';
    issues.add('FIELD_CLOCK_INVALID_OR_MISSING');
  }else if(Object.values(comparison.windowClassification).some(v=>v==='stale'||v==='unavailable')){
    freshness='STALE_UNDER_AT_LEAST_ONE_EXISTING_CLIENT_WINDOW';
    issues.add('CROSS_CLIENT_FRESHNESS_POLICY_NOT_UNIFIED');
  }
  if(comparison.clientsDisagree)issues.add('CROSS_CLIENT_FRESHNESS_POLICY_NOT_UNIFIED');
  return Object.freeze({
    kind:'STAGE16_PROPOSED_DISPLAY_ONLY_NOT_A_RUNTIME_PATCH',
    waterDisplay:water.label,riskDisplay:risk,gateDisplay:gate,freshnessDisplay:freshness,
    timestampAgeSeconds:age,
    comparativeCurrentWindows:Object.freeze({...comparison.windowClassification}),
    reviewReasons:Object.freeze([...issues].sort()),
    nextAction:'SEEK_SUPERVISED_FIELD_EVIDENCE_AND_SECURITY_APPROVAL',
    decision:'NO_GO',
    deviceIdentityVerified:false,physicalGatePositionVerified:false,
    realAlertDeliveryVerified:false,canActuate:false,canSendAlerts:false,canDeploy:false
  });
}
