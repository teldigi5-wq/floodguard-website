// H21: source-qualification for public status displays only.
// No Firebase connections, alerts, certificates, actuators or authentication.
import {reconcileReportedRainStatus} from './telemetry-safety.mjs';

const canonical = value => typeof value === 'string' ? value.trim().toUpperCase() : null;
const knownRain = new Set(['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME','CRITICAL']);
const fault = new Set(['ERROR','SENSOR_ERROR','INVALID','OFFLINE','DISCONNECTED',
  'UNAVAILABLE','UNKNOWN','NOT_INSTALLED','REMOVED','DISABLED','FAULT']);
const bounded = (value,max) => typeof value === 'number' &&
  Number.isFinite(value) && value >= 0 && value <= max ? value : null;

function deviceToken(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.installed === false) return 'NOT_INSTALLED';
    value = value.status ?? value.state ?? value.online;
  }
  if (value === true) return 'ONLINE';
  if (value === false) return 'OFFLINE';
  const state=canonical(value);
  if (['ONLINE','CONNECTED','ACTIVE'].includes(state)) return 'ONLINE';
  if (['OFFLINE','DISCONNECTED','INACTIVE'].includes(state)) return 'OFFLINE';
  if (['ERROR','FAULT'].includes(state)) return 'ERROR';
  if (['NOT_INSTALLED','NOT INSTALLED','REMOVED','DISABLED'].includes(state))
    return 'NOT_INSTALLED';
  if (['UNKNOWN','UNAVAILABLE'].includes(state)) return 'UNKNOWN';
  return null;
}

function displayDevice(state) {
  return state && state!=='UNKNOWN'
    ? 'REPORTED ' + state + ' · UNVERIFIED' : 'UNKNOWN · SOURCE UNVERIFIED';
}

/** Require both ESP child reports. Optional devices.esp8266 may only veto. */
export function describePublicEspObservation({esp=null,inventory=null,freshness='unavailable'}={}) {
  const a=deviceToken(esp?.status),b=deviceToken(esp?.connection);
  const auxiliary=deviceToken(inventory);
  const recent=freshness==='live';
  const consistent=recent && a!==null && b!==null && a===b &&
    a!=='UNKNOWN' && (inventory===null || inventory===undefined ||
      (auxiliary!==null && auxiliary===a));
  const state=consistent?a:null;
  const rssi=state==='ONLINE' && typeof esp?.rssi==='number' &&
    Number.isFinite(esp.rssi) && esp.rssi>=-130 && esp.rssi<=0
      ? esp.rssi:null;
  return Object.freeze({
    label:displayDevice(state),
    state:state??'UNKNOWN',
    signalDbm:rssi,
    physicalLinkVerified:false,
    deviceIdentityVerified:false
  });
}

/** Read-only rain display; faults and contradictory health suppress placeholders. */
export function describePublicRainObservation({rain=null,device=null,freshness='unavailable'}={}) {
  const recent=freshness==='live';
  const raw=canonical(rain?.status);
  const rawSensor=canonical(rain?.sensorStatus);
  const sensor=deviceToken(rain?.sensorStatus);
  const inventory=deviceToken(device);
  const failed=fault.has(raw) || fault.has(rawSensor) ||
    (sensor!==null && sensor!=='ONLINE') ||
    (inventory!==null && inventory!=='ONLINE') ||
    (sensor!==null && inventory!==null && sensor!==inventory) ||
    (device!==null && device!==undefined && inventory===null);
  const usable=recent && !failed && !!rain && typeof rain==='object';
  const current=usable?bounded(rain.currentMm,10000):null;
  const daily=usable?bounded(rain.dailyMm,10000):null;
  const waterDepth=usable?bounded(rain.waterDepthCm,10000):null;
  const adc=usable&&typeof rain.rawValue==='number' &&
    Number.isInteger(rain.rawValue)&&rain.rawValue>=0?rain.rawValue:null;
  const coherentSensor=recent&&!failed &&
    (sensor!==null || inventory!==null);
  const deviceState=coherentSensor ? (sensor??inventory) : null;

  let category='UNKNOWN';
  if (usable) {
    category=reconcileReportedRainStatus({status:raw,dailyMm:daily});
    if (category==='NORMAL' && daily===null) category='UNKNOWN';
    // Match mobile: a numeric elevated risk can still be a warning lead
    // when a categorical field is absent. It can NEVER infer NORMAL from it.
    if (category==='UNKNOWN' && daily!==null && daily>=100)
      category=reconcileReportedRainStatus({status:'ONLINE',dailyMm:daily});
  }
  const staleCategory=!recent && knownRain.has(raw)
    ? 'LAST REPORTED ' + raw + ' · NOT CURRENT' : null;
  const categoryLabel=usable && category!=='UNKNOWN'
    ? (category==='NORMAL'?'REPORTED NORMAL · UNVERIFIED'
      :'POSSIBLE '+category+' · UNVERIFIED')
    : staleCategory??(failed?'SENSOR UNAVAILABLE · MEASUREMENTS WITHHELD'
      : recent?'UNKNOWN · SOURCE UNVERIFIED':'NOT CURRENT · SOURCE UNVERIFIED');

  return Object.freeze({
    category,
    categoryLabel,
    currentMm:current,
    dailyMm:daily,
    waterDepthCm:waterDepth,
    adcValue:adc,
    gaugeWeightGrams:null, // Current prototype does not use a load cell.
    gaugeLabel:displayDevice(deviceState),
    sensorLabel:failed?'SENSOR UNAVAILABLE · SOURCE UNVERIFIED'
      :displayDevice(deviceState),
    calibrationLimited:usable && rain.calibrationLimited===true,
    calibrationLabel:usable
      ? rain.calibrationLimited===true?'REPORTED LIMITED · UNVERIFIED'
        :'NOT FIELD VERIFIED'
      :'UNKNOWN · UNVERIFIED',
    physicalRainVerified:false,
    calibratedMeasurementVerified:false,
    canDeclareNormal:false,
    canSendAlert:false
  });
}
