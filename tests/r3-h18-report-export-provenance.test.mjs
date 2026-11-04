import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  buildPublicObservationExport,formatPublicObservationSummary
} from '../lib/public-observation-export.mjs';

const source={
  water:{levelCm:2,distanceCm:23,status:'SAFE'},
  rain:{currentMm:0,dailyMm:0,status:'NORMAL'},
  gate:{status:'CLOSED',angle:0,countdownSeconds:0,reason:'NONE'},
  alarm:{active:false,type:'NONE'},
  system:{overallRisk:'LOW'},
  esp8266:{connection:'ONLINE',status:'ONLINE',rssi:-63,ip:'192.0.2.1',wifi:'PRIVATE_WIFI'},
  adminToken:'DO_NOT_EXPORT_PRIVATE_TOKEN'
};
const make=(freshness='live',data=source)=>
  buildPublicObservationExport({
    data,freshness,ageSeconds:3,
    lastUpdateMs:Date.UTC(2026,10,4,8,0,0),
    generatedAt:'2026-11-04T08:00:03.000Z'
  });
function neverAuthorizes(x){
  assert.equal(x.sourceAssurance,'UNSIGNED_FIREBASE · UNVERIFIED');
  assert.equal(x.physicalFloodSafety,'UNKNOWN · UNVERIFIED');
  assert.equal(x.authenticatedFieldSource,false);
  assert.equal(x.physicalConditionsVerified,false);
  for(const field of ['canDeclareSafe','canOperateGate','canSendAlert'])
    assert.equal(x[field],false,field);
  assert.equal(x.gate.physicalGateVerified,false);
  assert.equal(x.water.currentPhysicalLevelVerified,false);
  assert.equal(x.alarm.physicalAlarmVerified,false);
  assert.equal(x.esp8266.physicalConnectivityVerified,false);
}
test('recent LOW/SAFE, CLOSED, alarm OFF and ESP ONLINE export only unsigned reports',()=>{
  const x=make();
  neverAuthorizes(x);
  assert.equal(x.risk.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
  assert.equal(x.risk.reportedLabel,'REPORTED LOW · UNVERIFIED');
  assert.match(x.water.reportLabel,/REPORTED SAFE · UNVERIFIED/);
  assert.equal(x.gate.reportLabel,'REPORTED CLOSED · UNVERIFIED');
  assert.equal(x.alarm.active,false,'retain source flag for offline diagnostics');
  assert.equal(x.alarm.displayState,'REPORTED OFF · UNVERIFIED');
  assert.equal(x.esp8266.reportLabel,'REPORTED ONLINE · UNVERIFIED');
  assert.equal(x.schema,'floodguard-browser-observation-v2');
  assert.equal(x.purpose,'NON_OPERATIONAL_OBSERVATION_ONLY');
  for(const segment of [x,x.water,x.gate,x.alarm,x.esp8266,x.risk])
    assert.equal(Object.isFrozen(segment),true);
});
test('clipboard summary never calls raw false alarm CLEAR or physical gate CLOSED',()=>{
  const report=formatPublicObservationSummary(make());
  assert.match(report,/UNSIGNED observation/);
  assert.match(report,/Physical flood safety: UNKNOWN · UNVERIFIED/);
  assert.match(report,/Reported risk: REPORTED LOW · UNVERIFIED/);
  assert.match(report,/Alarm: REPORTED OFF · UNVERIFIED/);
  assert.match(report,/Gate: REPORTED CLOSED · UNVERIFIED · physical position unknown/);
  assert.match(report,/ESP8266: REPORTED ONLINE · UNVERIFIED/);
  assert.match(report,/NO ALL-CLEAR · NO VERIFIED DEVICE OR GATE AUTHORITY/);
  assert.doesNotMatch(report,/\nAlarm: CLEAR\n|\nGate: CLOSED\b/);
});
test('stale observations stay historical even with old ON and high hazard reports',()=>{
  const x=make('stale',{
    ...source,
    water:{levelCm:24,distanceCm:1,status:'DANGER'},
    system:{overallRisk:'CRITICAL'},
    alarm:{active:true,type:'FLOOD'}
  });
  neverAuthorizes(x);
  assert.equal(x.risk.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
  assert.match(x.risk.reportedLabel,/LAST RECORDED CRITICAL · NOT CURRENT/);
  assert.match(x.water.reportLabel,/LAST RECORDED DANGER · NOT CURRENT/);
  assert.equal(x.gate.reportLabel,'CURRENT POSITION UNKNOWN');
  assert.equal(x.alarm.displayState,'LAST REPORTED ACTIVE · NOT CURRENT');
  assert.match(x.esp8266.reportLabel,/LAST RECORDED ONLINE · NOT CURRENT/);
  assert.match(formatPublicObservationSummary(x),/Record freshness: stale \(timestamp only\)/);
});
test('malformed/missing observations cannot create clearance or fake a valid timestamp',()=>{
  const x=buildPublicObservationExport({
    data:null,freshness:'loading',ageSeconds:-5,lastUpdateMs:Infinity,
    generatedAt:'2026-11-04T08:00:03.000Z'
  });
  neverAuthorizes(x);
  assert.equal(x.ageSeconds,null);
  assert.equal(x.lastRecordedAt,null);
  assert.equal(x.alarm.displayState,'UNAVAILABLE');
  assert.equal(x.water.reportLabel,'CURRENT WATER STATE UNKNOWN');
  assert.equal(x.esp8266.reportLabel,'UNKNOWN · SOURCE UNVERIFIED');
  assert.equal(x.gate.reportLabel,'CURRENT POSITION UNKNOWN');
});
test('ESP mismatches, private network details and out-of-schema data are never exported',()=>{
  const x=make('live',{
    ...source,
    esp8266:{
      ...source.esp8266,
      status:'ONLINE',connection:'OFFLINE',
      wifi:'SECRET_NETWORK',ip:'192.0.2.88',
      password:'SHOULD_NOT_EXPORT'
    },
    apiKey:'SHOULD_NOT_EXPORT',
    private:{subscriber:'SHOULD_NOT_EXPORT'}
  });
  neverAuthorizes(x);
  assert.equal(x.esp8266.status,null);
  assert.equal(x.esp8266.connection,null);
  assert.equal(x.esp8266.reportLabel,'UNKNOWN · SOURCE UNVERIFIED');
  const exported=JSON.stringify(x);
  for(const term of ['SECRET_NETWORK','192.0.2.88','SHOULD_NOT_EXPORT','apiKey','wifi','password','subscriber'])
    assert.equal(exported.includes(term),false,term);
});
test('report schema prevents unrecognized metadata from overriding fixed denial',()=>{
  const x=make('live',{
    ...source,
    canDeclareSafe:true,sourceAssurance:'CERTIFIED',
    physicalConditionsVerified:true,gate:{status:'CLOSED',angle:90}
  });
  neverAuthorizes(x);
  assert.equal(x.gate.reportLabel,'UNKNOWN · UNVERIFIED');
  assert.equal(x.canDeclareSafe,false);
});
test('actual UI exports and diagnostics call trusted presentation functions',()=>{
  const component=readFileSync('components/status-snapshot.tsx','utf8');
  const quick=readFileSync('components/page-kit.tsx','utf8');
  const diag=readFileSync('app/diagnostics/page.tsx','utf8');
  assert.match(component,/buildPublicObservationExport\(/);
  assert.match(component,/formatPublicObservationSummary\(snapshot\(\)\)/);
  assert.match(component,/JSON\.stringify\(snapshot\(\),null,2\)/);
  assert.match(component,/describePublicObservation\(freshness\)\.label/);
  assert.doesNotMatch(component,/displayState:reconcileDisplayedAlarmState/);
  assert.match(quick,/describeGateObservation\(/);
  assert.match(quick,/describeWaterObservation\(/);
  assert.match(quick,/title="Alarm report" value=\{alarmDisplay\}/);
  assert.doesNotMatch(quick,/title="Alarm" value=\{alarmState\}/);
  assert.match(diag,/describeRiskObservation\(/);
  assert.match(diag,/describeGateObservation\(/);
  assert.match(diag,/value:alarmDisplay/);
  assert.doesNotMatch(diag,/Reported clear/);
});
test('export formatter has no network, Firebase SDK, filesystem writes or actuators',()=>{
  const s=readFileSync('lib/public-observation-export.mjs','utf8');
  for(const term of ['firebase-admin','firebase/database','fetch(','WebSocket(',
    'XMLHttpRequest(','writeFileSync(','process.env','sendMessage(',
    'digitalWrite(','servo.write','node:https','node:http'])
    assert.equal(s.includes(term),false,term);
});
