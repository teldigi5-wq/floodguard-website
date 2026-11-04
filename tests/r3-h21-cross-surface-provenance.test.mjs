import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicEspObservation,describePublicRainObservation} from '../lib/public-health-observation.mjs';
import {describePublicMonitorView} from '../lib/public-monitor-view.mjs';

const sensor={status:'ONLINE',connection:'CONNECTED',rssi:-62};
const rain={status:'NORMAL',currentMm:0,dailyMm:0,sensorStatus:'ONLINE',rawValue:388};
function deny(x) {
  assert.equal(Object.isFrozen(x),true);
  if ('physicalLinkVerified' in x) {
    assert.equal(x.physicalLinkVerified,false);
    assert.equal(x.deviceIdentityVerified,false);
  }
  if ('physicalRainVerified' in x) {
    assert.equal(x.physicalRainVerified,false);
    assert.equal(x.calibratedMeasurementVerified,false);
    assert.equal(x.canDeclareNormal,false);
    assert.equal(x.canSendAlert,false);
  }
}

test('ESP legacy CONNECTED and canonical ONLINE agree only as unsigned reports',()=>{
  for(const status of ['CONNECTED','ONLINE','ACTIVE']) {
    const x=describePublicEspObservation({esp:{...sensor,connection:status},freshness:'live'});
    deny(x);
    assert.equal(x.state,'ONLINE');
    assert.equal(x.label,'REPORTED ONLINE · UNVERIFIED');
    assert.equal(x.signalDbm,-62);
  }
  const x=describePublicMonitorView({data:{esp8266:sensor},freshness:'live'});
  assert.equal(x.espLabel,'REPORTED ONLINE · UNVERIFIED');
  assert.equal(x.espSignalDbm,-62);
  assert.equal(x.canDeclareSafe,false);
});
test('a contradicted, incomplete, unknown or stale ESP never displays ONLINE or signal',()=>{
  for(const input of [
    {esp:{...sensor,connection:'OFFLINE'},freshness:'live'},
    {esp:{status:'ONLINE',rssi:-62},freshness:'live'},
    {esp:{...sensor,status:'INVALID'},freshness:'live'},
    {esp:sensor,inventory:'OFFLINE',freshness:'live'},
    {esp:sensor,inventory:'UNKNOWN',freshness:'live'},
    {esp:sensor,inventory:{online:false},freshness:'live'},
    {esp:sensor,freshness:'stale'},
    {esp:null,freshness:'live'},
  ]) {
    const x=describePublicEspObservation(input);deny(x);
    assert.equal(x.label,'UNKNOWN · SOURCE UNVERIFIED');
    assert.equal(x.state,'UNKNOWN');
    assert.equal(x.signalDbm,null);
  }
});
test('offline, failed or nononline ESP cannot retain old RSSI',()=>{
  for(const x of [
    {status:'OFFLINE',connection:'DISCONNECTED',rssi:-50},
    {status:'ERROR',connection:'FAULT',rssi:-50},
    {status:'NOT_INSTALLED',connection:'REMOVED',rssi:-50},
    {status:'ONLINE',connection:'CONNECTED',rssi:999},
    {status:'ONLINE',connection:'CONNECTED',rssi:-150},
  ]) {
    const r=describePublicEspObservation({esp:x,freshness:'live'});deny(r);
    assert.equal(r.signalDbm,null);
  }
});
test('valid normal rain is only a reported category, never certified all-clear',()=>{
  const x=describePublicRainObservation({rain,device:'CONNECTED',freshness:'live'});
  deny(x);
  assert.equal(x.category,'NORMAL');
  assert.equal(x.categoryLabel,'REPORTED NORMAL · UNVERIFIED');
  assert.equal(x.currentMm,0);
  assert.equal(x.dailyMm,0);
  assert.equal(x.adcValue,388);
  assert.equal(x.gaugeLabel,'REPORTED ONLINE · UNVERIFIED');
  assert.equal(x.gaugeWeightGrams,null);
});
test('explicit rain faults and contradictory gauge health suppress all numeric placeholders',()=>{
  for(const faulty of [
    {rain:{...rain,status:'SENSOR_ERROR'},device:'ONLINE'},
    {rain:{...rain,sensorStatus:'OFFLINE'},device:'ONLINE'},
    {rain,device:'OFFLINE'},
    {rain,device:'UNKNOWN'},
    {rain:{...rain,sensorStatus:'DISCONNECTED'},device:'ONLINE'},
    {rain:{...rain,sensorStatus:'INVALID'},device:'ONLINE'},
    {rain:{...rain,sensorStatus:'REMOVED'},device:'ONLINE'},
    {rain:{...rain,sensorStatus:'NOT_INSTALLED'},device:'ONLINE'},
  ]) {
    const x=describePublicRainObservation({...faulty,freshness:'live'});deny(x);
    assert.equal(x.category,'UNKNOWN',JSON.stringify(faulty));
    assert.equal(x.currentMm,null);
    assert.equal(x.dailyMm,null);
    assert.equal(x.adcValue,null);
    assert.equal(x.waterDepthCm,null);
    assert.match(x.categoryLabel,/SENSOR UNAVAILABLE/);
  }
});
test('missing daily rainfall cannot certify NORMAL; numeric hazard cannot be downgraded',()=>{
  for(const v of [
    {status:'NORMAL',currentMm:0},
    {status:'ONLINE',currentMm:0},
    {status:'NORMAL',currentMm:0,dailyMm:'0'},
  ]) {
    const x=describePublicRainObservation({rain:v,freshness:'live'});deny(x);
    assert.equal(x.category,'UNKNOWN');
    assert.equal(x.dailyMm,null);
    assert.doesNotMatch(x.categoryLabel,/REPORTED NORMAL/);
  }
  const elevated=describePublicRainObservation({rain:{...rain,dailyMm:300},freshness:'live'});
  assert.equal(elevated.category,'CRITICAL');
  assert.equal(elevated.categoryLabel,'POSSIBLE CRITICAL · UNVERIFIED');
  const unknown=describePublicRainObservation({rain:{status:'UNKNOWN',dailyMm:150},freshness:'live'});
  assert.equal(unknown.category,'UNKNOWN','explicit UNKNOWN is fail-closed sensor health');
});
test('unavailable categorical rain with valid elevated numeric remains a hazard lead',()=>{
  const x=describePublicRainObservation({rain:{currentMm:4,dailyMm:200},freshness:'live'});
  deny(x);
  assert.equal(x.category,'EXTREME');
  assert.equal(x.categoryLabel,'POSSIBLE EXTREME · UNVERIFIED');
  assert.equal(x.currentMm,4);
  assert.equal(x.dailyMm,200);
  const low=describePublicRainObservation({rain:{currentMm:0,dailyMm:0},freshness:'live'});
  assert.equal(low.category,'UNKNOWN');
});
test('stale rain hides raw values but retains historical high-risk text',()=>{
  const x=describePublicRainObservation({rain:{...rain,status:'CRITICAL',currentMm:999,dailyMm:350},freshness:'stale'});
  deny(x);
  assert.equal(x.currentMm,null);
  assert.equal(x.dailyMm,null);
  assert.equal(x.category,'UNKNOWN');
  assert.equal(x.categoryLabel,'LAST REPORTED CRITICAL · NOT CURRENT');
  assert.equal(x.calibrationLabel,'UNKNOWN · UNVERIFIED');
});
test('forged authority metadata cannot enter fixed public reporting outputs',()=>{
  const x=describePublicRainObservation({rain:{...rain,authToken:'SECRET',sourceVerified:true},freshness:'live'});
  deny(x);
  assert.doesNotMatch(JSON.stringify(x),/SECRET|sourceVerified/);
  const y=describePublicMonitorView({data:{esp8266:sensor,rain,
    canSendAlert:true,signingKey:'S3CR3T'},freshness:'live'});
  assert.equal(y.canSendAlert,false);
  assert.doesNotMatch(JSON.stringify(y),/S3CR3T|signingKey/);
});
test('homepage, metrics, dashboard, devices and rainfall page use one health policy',()=>{
  const helper=readFileSync('lib/public-monitor-view.mjs','utf8');
  const kit=readFileSync('components/page-kit.tsx','utf8');
  const dash=readFileSync('app/dashboard/page.tsx','utf8');
  const devices=readFileSync('app/devices/page.tsx','utf8');
  const rainfall=readFileSync('app/rainfall/page.tsx','utf8');
  assert.match(helper,/describePublicEspObservation/);
  assert.match(helper,/describePublicRainObservation/);
  assert.match(kit,/monitor\.espLabel/);
  assert.match(dash,/monitor\.espSignalDbm/);
  assert.match(dash,/monitor\.espLabel/);
  assert.match(devices,/monitor\.espState/);
  assert.match(devices,/monitor\.espLabel/);
  assert.match(devices,/monitor\.espSignalDbm/);
  assert.match(rainfall,/describePublicRainObservation/);
  assert.match(rainfall,/view\.categoryLabel/);
  assert.match(rainfall,/view\.dailyMm/);
  for(const src of [kit,dash,devices]) {
    assert.doesNotMatch(src,/data\?\.esp8266\?\.status\s*\?\?/);
    assert.doesNotMatch(src,/fmt\(data\?\.esp8266\?\.rssi/);
  }
  assert.doesNotMatch(rainfall,/fmt\(rain\?\.currentMm/);
  assert.doesNotMatch(rainfall,/label\(rain\?\.status/);
});
test('pure health helper cannot access Firebase, secrets, disk or gate actuators',()=>{
  const src=readFileSync('lib/public-health-observation.mjs','utf8');
  for(const term of ['firebase-admin','firebase/database','fetch(','WebSocket(',
    'sendMessage(','digitalWrite(','process.env','node:http','node:https',
    'writeFileSync(']) assert.equal(src.includes(term),false,term);
});
