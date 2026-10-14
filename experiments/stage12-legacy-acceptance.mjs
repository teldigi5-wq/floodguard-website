// Stage 12: offline, synthetic-only firmware-shape acceptance fixture.
// This file is NEVER imported by the website runtime or bot, and makes no
// network, filesystem write, Firebase, WhatsApp or physical-device calls.
// A safe projection is only for local testing; it is NOT an authenticated upload.
import {parseFieldTimestamp,ageSeconds,classifyTelemetryFreshness}
  from '../lib/telemetry-health.mjs';

const ROOT='/floodguard/live';
const BAD_KEYS=new Set(['__proto__','constructor','prototype']);
const FIELDS=Object.freeze({
  water:['distanceCm','levelCm','status'],
  rain:['currentMm','dailyMm','rawValue','weightGrams','waterDepthCm','measurementType','sensorStatus','calibrationLimited','status'],
  gate:['status','angle','countdownSeconds','reason'],
  alarm:['active','type'],
  devices:['arduino','esp8266','ultrasonic','rainGauge','rtc','servo','gsm','microSD'],
  system:['lastUpdate','overallRisk'],
  esp8266:['connection','rssi','status']
});
const ALLOWED=new Set(Object.entries(FIELDS).flatMap(([group,children])=>children.map(child=>group+'/'+child)));
const PRIVATE=new Set(['esp8266/ip','esp8266/wifi']);
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function flattenPut(root){
  const entries=[];
  function walk(value,segments,depth){
    if(depth>3||entries.length>64)throw new TypeError('Synthetic payload too complex');
    if(!isRecord(value)){entries.push([segments.join('/'),value]);return;}
    for(const [key,child] of Object.entries(value)){
      if(!key||BAD_KEYS.has(key)||key.includes('/'))throw new TypeError('Unsafe synthetic key');
      walk(child,[...segments,key],depth+1);
    }
  }
  walk(root,[],0);
  return entries;
}
function flattenPatch(root){
  const entries=[];
  for(const [name,value] of Object.entries(root)){
    const parts=name.split('/');
    if(parts.length!==2||parts.some(k=>!k||BAD_KEYS.has(k))
      ||isRecord(value)||Array.isArray(value))throw new TypeError('Unsupported synthetic PATCH');
    entries.push([name,value]);
  }
  return entries;
}
/**
 * Interpret synthetic sketches' legacy root PUT / multi-location PATCH without
 * transmitting or trusting data. Return only allowlisted public sensor fields.
 * No raw IP/Wi-Fi keys, values, SSIDs, credentials or arbitrary descendants.
 */
export function inspectStage12SyntheticLegacy({method,path,payload,connected=false,nowMs}={}){
  const empty={kind:'OFFLINE_SYNTHETIC_FIXTURE_ONLY',recognized:false,
    canForward:false,canAuthenticate:false,hasPrivateMetadata:false,
    hasUnreviewedDescendants:false,websiteFixtureFreshness:'unavailable',
    ageSeconds:null,publicProjection:{}};
  if(path!==ROOT||(method!=='PUT'&&method!=='PATCH')||!isRecord(payload)
    ||!Number.isSafeInteger(nowMs)||nowMs<0)return empty;
  let entries;
  try{
    if(Buffer.byteLength(JSON.stringify(payload),'utf8')>8192)return empty;
    entries=method==='PUT'?flattenPut(payload):flattenPatch(payload);
  }catch{return empty;}
  if(entries.length===0||entries.length>64)return empty;
  let hasPrivateMetadata=false,hasUnreviewedDescendants=false;
  const projection={};
  for(const [key,value] of entries){
    if(PRIVATE.has(key)){hasPrivateMetadata=true;continue;}
    if(!ALLOWED.has(key)){hasUnreviewedDescendants=true;continue;}
    const [group,field]=key.split('/');
    if(!projection[group])projection[group]={};
    projection[group][field]=value;
  }
  const clock=projection.system?.lastUpdate;
  const timestamp=parseFieldTimestamp(clock,nowMs);
  const seconds=timestamp===null?null:ageSeconds(timestamp,nowMs);
  const hasData=projection.water?.distanceCm!==undefined
    ||projection.water?.levelCm!==undefined;
  const freshness=classifyTelemetryFreshness({
    loading:false,hasData,connected:connected===true,error:false,ageSeconds:seconds
  });
  return {kind:'OFFLINE_SYNTHETIC_FIXTURE_ONLY',recognized:true,
    canForward:false,canAuthenticate:false,hasPrivateMetadata,
    hasUnreviewedDescendants,websiteFixtureFreshness:freshness,
    ageSeconds:seconds,publicProjection:projection};
}
