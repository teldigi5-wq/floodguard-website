import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicMonitorView} from '../lib/public-monitor-view.mjs';

const source = {
  water:{status:'SAFE',levelCm:2,distanceCm:23},
  rain:{currentMm:0,status:'NORMAL'},
  gate:{status:'CLOSED',angle:0},
  alarm:{active:false},
  esp8266:{status:'ONLINE',connection:'ONLINE',rssi:-63}
};
const view=(data=source,freshness='live')=>describePublicMonitorView({data,freshness});
function deny(x) {
  assert.equal(Object.isFrozen(x),true);
  assert.equal(x.physicalFloodSafety,'UNKNOWN · UNVERIFIED');
  for(const k of ['authenticatedFieldSource','physicalGateVerified',
    'canDeclareSafe','canOperateGate','canSendAlert']) assert.equal(x[k],false,k);
}
test('recent LOW, CLOSED, alarm OFF and ESP ONLINE remain unsigned reports',()=>{
  const x=view(); deny(x);
  assert.equal(x.waterLevelCm,2);
  assert.equal(x.waterDistanceCm,23);
  assert.equal(x.waterLabel,'REPORTED SAFE · UNVERIFIED');
  assert.equal(x.gateAngleDeg,0);
  assert.equal(x.gateLabel,'REPORTED CLOSED · UNVERIFIED');
  assert.equal(x.alarmLabel,'REPORTED OFF · UNVERIFIED');
  assert.equal(x.espLabel,'REPORTED ONLINE · UNVERIFIED');
  assert.equal(x.rainLabel,'REPORTED 0.0 mm · UNVERIFIED');
});
test('stale and missing fields cannot animate current water or gate safety',()=>{
  for(const freshness of ['stale','loading','unavailable']) {
    const x=view(source,freshness); deny(x);
    assert.equal(x.waterLevelCm,null);
    assert.equal(x.waterDistanceCm,null);
    assert.equal(x.gateAngleDeg,null);
    assert.equal(x.gateLabel,'CURRENT POSITION UNKNOWN');
    assert.equal(x.alarmLabel,'UNAVAILABLE · SOURCE UNVERIFIED');
    assert.equal(x.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
    assert.equal(x.rainCurrentMm,null);
  }
  const absent=view(null,'live'); deny(absent);
  assert.equal(absent.gateAngleDeg,null);
  assert.equal(absent.waterLevelCm,null);
});
test('contradictory gate and ESP status fail closed',()=>{
  const x=view({...source,gate:{status:'CLOSED',angle:90},
    esp8266:{status:'ONLINE',connection:'OFFLINE',rssi:-63}});
  deny(x);
  assert.equal(x.gateAngleDeg,null);
  assert.equal(x.gateLabel,'UNKNOWN · UNVERIFIED');
  assert.equal(x.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
  assert.equal(x.espSignalDbm,null);
});
test('sensor faults suppress level while possible hazards remain visible',()=>{
  const faulty=view({...source,water:{status:'SENSOR_ERROR',levelCm:2,distanceCm:23}});
  assert.equal(faulty.waterLevelCm,null);
  assert.equal(faulty.waterDistanceCm,null);
  const danger=view({...source,water:{status:'SAFE',levelCm:12,distanceCm:13}});
  assert.match(danger.waterLabel,/POSSIBLE DANGER · UNVERIFIED/);
  const stale=view({...source,alarm:{active:true}},'stale');
  assert.equal(stale.alarmLabel,'LAST REPORTED ACTIVE · NOT CURRENT');
});
test('invalid values and forged metadata cannot upgrade authority or leak extras',()=>{
  const x=view({...source,rain:{currentMm:-5},
    esp8266:{status:'ONLINE',connection:'ONLINE',rssi:999},
    sourceAssurance:'CERTIFIED',canOperateGate:true,authToken:'SECRET'});
  deny(x);
  assert.equal(x.rainCurrentMm,null);
  assert.equal(x.espSignalDbm,null);
  assert.equal(JSON.stringify(x).includes('SECRET'),false);
  assert.equal(JSON.stringify(x).includes('CERTIFIED'),false);
});
test('actual homepage, ribbon, 3D and network preview use qualified source view',()=>{
  const home=readFileSync('app/page.tsx','utf8');
  const motion=readFileSync('components/advanced-motion.tsx','utf8');
  const scene=readFileSync('components/dam-scene.tsx','utf8');
  assert.match(home,/describePublicMonitorView\(\{data,freshness\}\)/);
  assert.match(home,/DamScene angle=\{monitor\.gateAngleDeg\} waterDistance=\{monitor\.waterDistanceCm\}/);
  for(const text of [home,motion]) {
    assert.doesNotMatch(text,/data\?\.gate\?\.status/);
    assert.doesNotMatch(text,/data\?\.esp8266\?\.status\?\?data/);
  }
  assert.match(motion,/monitor\.alarmLabel/);
  assert.match(motion,/monitor\.gateLabel/);
  assert.match(motion,/monitor\.waterLabel/);
  assert.match(scene,/waterState==="safe"\?"LOW · UNVERIFIED"/);
  assert.match(scene,/waterState=\{waterState==="safe"\?"unavailable":waterState\}/);
});
test('pure reporting module cannot access Firebase, messages, writes or actuators',()=>{
  const s=readFileSync('lib/public-monitor-view.mjs','utf8');
  for(const term of ['firebase-admin','firebase/database','fetch(','WebSocket(',
    'sendMessage(','digitalWrite(','process.env','node:http','node:https',
    'writeFileSync(']) assert.equal(s.includes(term),false,term);
});
