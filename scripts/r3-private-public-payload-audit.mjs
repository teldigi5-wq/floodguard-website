// Private, offline-only FloodGuard public-value schema review.
// NO network, live Firebase access, firmware, credential logging, or mutation.
import {lstatSync, readFileSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_BYTES=128*1024;
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const number=(min,max)=>(x)=>finite(x)&&x>=min&&x<=max;
const whole=(min,max)=>(x)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const boolean=x=>typeof x==='boolean';
const member=values=>x=>typeof x==='string'&&values.includes(x);
const states=['ONLINE','OFFLINE','ERROR','FAULT','UNKNOWN','CONNECTED',
  'DISCONNECTED','ACTIVE','INACTIVE','UNAVAILABLE','NOT_INSTALLED',
  'NOT INSTALLED','REMOVED','DISABLED'];
const rainStates=['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME','CRITICAL',
  'UNKNOWN','SENSOR_ERROR','ERROR','OFFLINE','NOT_INSTALLED','REMOVED'];
const alarms=['NONE','DAM_WARNING','DAM_DANGER','HEAVY_RAIN','FLOOD_WARNING',
  'EXTREME_RAIN','CRITICAL_RAIN','GATE_OPENING_WARNING','GATE_OPENED',
  'SENSOR_ERROR','ESP_OFFLINE','COMMUNICATION_LOST'];
const risk=['UNKNOWN','LOW','MODERATE','HIGH','SEVERE','CRITICAL'];
const gateReasons=['NONE','UNKNOWN','SAFE_NO_ACTION','DANGER_WATER_LEVEL',
  'WATER_DANGER','WARNING_WATER_AND_HIGH_RAIN','HEAVY_RAIN_BUT_SAFE_WATER'];
const rules=Object.freeze({
  water:{
    distanceCm:number(0,400),levelCm:number(0,25),
    status:member(['SAFE','WARNING','DANGER','SENSOR_ERROR'])
  },
  rain:{
    currentMm:number(0,100000),dailyMm:number(0,100000),
    waterDepthCm:number(0,4),rawValue:number(0,1023),
    weightGrams:x=>x===null||finite(x),
    calibrationLimited:boolean,measurementType:member(['COLLECTOR_ACCUMULATED']),
    sensorStatus:member(states),status:member(rainStates)
  },
  gate:{
    status:member(['CLOSED','COUNTDOWN','OPEN','UNKNOWN','ERROR',
      'OPENING_WARNING','OPENING','CLOSING']),
    angle:whole(0,90),countdownSeconds:whole(0,10),reason:member(gateReasons)
  },
  alarm:{active:boolean,type:member(alarms)},
  devices:Object.fromEntries(['arduino','gsm','microSD','rainGauge',
    'rtc','servo','ultrasonic'].map(key=>[key,member(states)])),
  system:{
    lastUpdate:whole(946684800000,4102444800000),
    overallRisk:member(risk),waterSensorToBottomCm:number(0.1,400)
  },
  esp8266:{
    connection:member(states),rssi:number(-125,0),status:member(states)
  }
});
const required={
  water:['distanceCm','levelCm','status'],
  rain:['currentMm','dailyMm','status'],
  gate:['status','angle'],
  alarm:['active','type'],
  devices:['arduino','rainGauge','ultrasonic'],
  system:['lastUpdate'],
  esp8266:['connection','rssi','status']
};

export function auditPrivateExport(input,nowMs=Date.now()) {
  if(!Number.isFinite(nowMs))throw new TypeError('Invalid local audit clock');
  const errors={unknown:0,missing:0,invalid:0,nested:0};
  let fields=0,branches=0;
  const live=input?.floodguard?.live;
  for(const group of ['water','rain','gate','alarm','devices','system','esp8266']){
    const node=live?.[group];
    if(!isObj(node)){errors.missing++;continue;}
    branches++;
    for(const key of Object.keys(node)){
      // ip and wifi are private, are intentionally NOT inspected or logged.
      if(group==='esp8266' && (key==='ip'||key==='wifi'))continue;
      const value=node[key];fields++;
      if(!Object.hasOwn(rules[group],key)){errors.unknown++;continue;}
      if(isObj(value)||Array.isArray(value)){errors.nested++;continue;}
      if(!rules[group][key](value))errors.invalid++;
    }
    for(const needed of required[group]){
      if(!Object.hasOwn(node,needed))errors.missing++;
    }
  }
  const last=live?.system?.lastUpdate;
  const timestampPresent=Number.isSafeInteger(last)&&last>0;
  const snapshotRecentAtAuditTime=timestampPresent &&
    last<=nowMs+2000 && nowMs-last>=0 && nowMs-last<=30000;
  const schemaShapePass=Object.values(errors).every(n=>n===0)&&branches===7;
  return Object.freeze({
    schemaShapePass,publicBranchesInspected:branches,
    publicScalarFieldsInspected:fields,issueCounts:Object.freeze({...errors}),
    snapshotRecentAtAuditTime,
    liveDataSourceVerified:false,liveWriteAuthorizationVerified:false,
    publicDataPrivacyCertified:false,releaseDecision:'NO_GO'
  });
}
export function auditPrivateFile(path,nowMs=Date.now()){
  if(extname(path).toLowerCase()!=='.json')throw Error('audit_refused');
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||stat.size>MAX_BYTES)
    throw Error('audit_refused');
  const text=readFileSync(path,'utf8');
  const data=JSON.parse(text);
  return auditPrivateExport(data,nowMs);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  try{
    if(process.argv.length!==3)throw Error('audit_refused');
    const r=auditPrivateFile(process.argv[2]);
    console.log('schemaShapePass='+r.schemaShapePass);
    console.log('publicBranchesInspected='+r.publicBranchesInspected);
    console.log('publicScalarFieldsInspected='+r.publicScalarFieldsInspected);
    for(const key of ['unknown','missing','invalid','nested'])
      console.log('issue_'+key+'='+r.issueCounts[key]);
    console.log('snapshotRecentAtAuditTime='+r.snapshotRecentAtAuditTime);
    console.log('publicDataPrivacyCertified=false');
    console.log('liveDataSourceVerified=false');
    console.log('liveWriteAuthorizationVerified=false');
    console.log('releaseDecision=NO_GO');
    process.exitCode=r.schemaShapePass?0:2;
  }catch{
    // Never print user file contents, paths, keys, stack traces or values.
    console.error('audit_refused');
    process.exitCode=2;
  }
}
