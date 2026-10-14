// Stage 14: review-only comparative models transcribed from INSPECTED code.
// These are NOT imports or executions of the bot's CommonJS or Flutter runtime.
// Source snapshots are pinned in stage14-cross-client-fixtures.json. No I/O.
import {compareStage13SyntheticFreshness} from './stage13-security-gap-review.mjs';

const cap=(n,min,max)=>Math.max(min,Math.min(max,n));
const upper=v=>typeof v==='string' ? v.trim().toUpperCase() : '';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const DAM=v=>v>=11?'DANGER':v>=8.5?'WARNING':'SAFE';
const RAIN=new Set(['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME','CRITICAL']);
const RISK=new Set(['LOW','MODERATE','HIGH','SEVERE','CRITICAL']);
const normalRain=(status,daily)=>{
  const v=upper(status);
  if(v==='ONLINE'&&number(daily)!==null){
    return daily>=300?'CRITICAL':daily>=200?'EXTREME':daily>=150
      ?'FLOOD_WARNING':daily>=100?'HEAVY_RAIN':'NORMAL';
  }
  return RAIN.has(v)?v:'UNKNOWN';
};
function webModel(state){
  const water=state.water||{},rain=state.rain||{},gate=state.gate||{},system=state.system||{};
  const distance=number(water.distanceCm);
  const given=number(water.levelCm);
  const level=distance!==null?cap(25-distance,0,25):given;
  const raw=upper(water.status);
  const waterStatus=level===null?(raw==='SENSOR_ERROR'?'SENSOR_ERROR':
    ['SAFE','WARNING','DANGER'].includes(raw)?raw:'UNKNOWN'):DAM(level);
  const countdown=number(gate.countdownSeconds);
  const angle=number(gate.angle);
  let gateStatus=['CLOSED','COUNTDOWN','OPENING','OPEN','CLOSING'].includes(upper(gate.status))
    ?upper(gate.status):upper(gate.status)==='OPENING_WARNING'?'COUNTDOWN':'UNKNOWN';
  if(countdown!==null&&countdown>0)gateStatus='COUNTDOWN';
  else if(angle!==null&&angle<=2)gateStatus='CLOSED';
  else if(angle!==null&&angle>=80)gateStatus='OPEN';
  else if(angle!==null&&angle>2&&angle<80)gateStatus=gateStatus==='CLOSING'?'CLOSING':'OPENING';
  else if(gateStatus==='COUNTDOWN')gateStatus='CLOSED';
  return {water:waterStatus,waterLevelCm:level,gate:gateStatus,
    rain:normalRain(rain.status,rain.dailyMm),
    risk:RISK.has(upper(system.overallRisk))?upper(system.overallRisk):'UNAVAILABLE'};
}
function botModel(state){
  const water=state.water||{},rain=state.rain||{},gate=state.gate||{},system=state.system||{};
  // Bot uses Number(value) and requires distance > 0; a 0 cm distance
  // deliberately exposes a mismatch with the website and mobile clients.
  const distance=Number(water.distanceCm);
  const levelFromDistance=Number.isFinite(distance)&&distance>0?cap(25-distance,0,25):null;
  const direct=Number(water.levelCm);
  const level=levelFromDistance!==null?levelFromDistance:
    Number.isFinite(direct)&&direct>=0?cap(direct,0,25):null;
  const status=level!==null?DAM(level):['SAFE','WARNING','DANGER','SENSOR_ERROR'].includes(upper(water.status))
    ?upper(water.status):'UNKNOWN';
  const countdown=Number(gate.countdownSeconds),angle=Number(gate.angle);
  let gateStatus=upper(gate.status)==='OPENING_WARNING'?'COUNTDOWN':upper(gate.status);
  gateStatus=['CLOSED','COUNTDOWN','OPEN'].includes(gateStatus)?gateStatus:'UNKNOWN';
  if(Number.isFinite(countdown)&&countdown>0)gateStatus='COUNTDOWN';
  else if(Number.isFinite(angle)&&angle>=80)gateStatus='OPEN';
  else if(Number.isFinite(angle)&&angle<=2)gateStatus='CLOSED';
  return {water:status,waterLevelCm:level,gate:gateStatus,
    rain:upper(rain.status)||'UNKNOWN',
    risk:RISK.has(upper(system.overallRisk))?upper(system.overallRisk):'UNKNOWN'};
}
function mobileModel(state){
  const water=state.water||{},rain=state.rain||{},gate=state.gate||{};
  const distance=number(water.distanceCm),provided=number(water.levelCm);
  const level=distance!==null?cap(25-distance,0,25):provided!==null?cap(provided,0,25):null;
  const status=level!==null?DAM(level):
    ['SAFE','WARNING','DANGER'].includes(upper(water.status))?upper(water.status):'UNKNOWN';
  const r=normalRain(rain.status,rain.dailyMm);
  const risk=status==='DANGER'||r==='CRITICAL'?'CRITICAL'
    :(status==='WARNING'&&r==='FLOOD_WARNING')||r==='EXTREME'?'SEVERE'
    :status==='WARNING'||r==='FLOOD_WARNING'?'HIGH'
    :r==='HEAVY_RAIN'?'MODERATE':'LOW';
  const raw=upper(gate.status);
  const gateStatus=['CLOSED','OPEN','CLOSING'].includes(raw)?raw
    :['OPENING','OPENING_WARNING','COUNTDOWN'].includes(raw)?'OPENING_WARNING':'UNKNOWN';
  return {water:status,waterLevelCm:level,gate:gateStatus,rain:r,risk};
}
export function compareStage14SyntheticClients({state,nowMs,connected=true}={}){
  if(!state||typeof state!=='object'||Array.isArray(state)
    ||!Number.isSafeInteger(nowMs)||nowMs<0)throw new TypeError('Synthetic snapshot and fixed time required');
  const models={website:webModel(state),bot:botModel(state),mobile:mobileModel(state)};
  const timing=compareStage13SyntheticFreshness({
    timestamp:state.system?.lastUpdate,nowMs,connected,
    hasData:state.water!==null&&typeof state.water==='object'
  });
  const differing=[];
  for(const field of ['water','gate','rain','risk']){
    const values=Object.values(models).map(x=>x[field]);
    if(values.some(v=>v!==values[0]))differing.push(field);
  }
  return Object.freeze({
    kind:'OFFLINE_REVIEW_MODELS_NOT_ACTUAL_CLIENT_EXECUTION',
    modelResults:models,
    freshnessWindows:timing.windowClassification,
    clientsDisagreeAboutFreshness:timing.clientsDisagree,
    differentFields:differing,
    deploymentApproved:false,hardwareTested:false,alertsSent:false
  });
}
