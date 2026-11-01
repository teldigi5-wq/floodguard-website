import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_MONITOR_LAB_LEAF_PATHS, createPublicLeafMonitorLab,
  applyPublicLeafEventLab, summarizePublicLeafMonitorLab,
} from '../experiments/public-leaf-monitor-lab.mjs';
const prefix='/floodguard/publicTelemetryLabV1/';
const apply=(s,path,value,atMs=1000)=>applyPublicLeafEventLab(s,{kind:'value',path:prefix+path,value,atMs,generation:s.generation});
const report=(s,nowMs=1000)=>summarizePublicLeafMonitorLab(s,nowMs);

test('exact 24 primitive leaves only; forbid parents, ESP private metadata and commands',()=>{
  assert.equal(PUBLIC_MONITOR_LAB_LEAF_PATHS.length,24);
  assert.equal(new Set(PUBLIC_MONITOR_LAB_LEAF_PATHS).size,24);
  const s=createPublicLeafMonitorLab();
  for(const path of ['/floodguard/live','/floodguard/publicTelemetryLabV1',
    prefix+'water',prefix+'esp8266/ip',prefix+'esp8266/wifi',
    prefix+'gate/openCommand'])
    assert.throws(()=>applyPublicLeafEventLab(s,{kind:'value',path,value:1,atMs:1000}),/Unapproved/);
});

test('unsigned SAFE, LOW and CLOSED never establish flood clearance or physical gate',()=>{
  let s=createPublicLeafMonitorLab();
  for(const [path,value] of [['water/status','SAFE'],['system/overallRisk','LOW'],
    ['gate/status','CLOSED'],['alarm/active',false]]) s=apply(s,path,value);
  const r=report(s);
  assert.equal(r.transport,'PARTIAL_UNVERIFIED');
  assert.equal(r.sourceTrust,'UNVERIFIED');
  assert.equal(r.floodClearance,'UNKNOWN');
  assert.equal(r.physicalGatePosition,'UNVERIFIED');
  assert.equal(r.safetyAutomationReady,false);
});

test('invalid numeric or object values evict matching records and flag INVALID',()=>{
  let s=apply(createPublicLeafMonitorLab(),'water/levelCm',10);
  s=apply(s,'water/levelCm',-3,1001);
  assert.equal(s.records[prefix+'water/levelCm'],undefined);
  assert.equal(s.faults[prefix+'water/levelCm'],'INVALID');
  s=apply(s,'water/status',{status:'SAFE'},1002);
  assert.equal(s.faults[prefix+'water/status'],'INVALID');
});

test('permission denied and null leaf do not retain old safe-looking snapshot',()=>{
  let s=apply(createPublicLeafMonitorLab(),'water/status','SAFE');
  s=applyPublicLeafEventLab(s,{kind:'permission_denied',path:prefix+'water/status',atMs:1100});
  assert.equal(s.records[prefix+'water/status'],undefined);
  assert.equal(s.faults[prefix+'water/status'],'PERMISSION_DENIED');
  s=apply(s,'rain/status',null,1200);
  assert.equal(s.faults[prefix+'rain/status'],'MISSING');
  assert.equal(report(s).floodClearance,'UNKNOWN');
});

test('reconnection must discard prior snapshots; old observation cannot overwrite new',()=>{
  let s=apply(createPublicLeafMonitorLab(),'water/status','DANGER',2000);
  const same=apply(s,'water/status','SAFE',1000);
  assert.equal(same,s);
  s=applyPublicLeafEventLab(s,{kind:'disconnect',atMs:3000});
  assert.equal(s.records[prefix+'water/status'],undefined);
  assert.equal(report(s,3000).transport,'DISCONNECTED');
  const late=applyPublicLeafEventLab(s,{kind:'value',path:prefix+'water/status',value:'SAFE',atMs:3100,generation:0});
  assert.equal(late,s,'cancelled subscription must not rejoin after disconnect');
  assert.equal(report(s,3000).lastReportedHazard,'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR');
  s=apply(s,'water/status','SAFE',3200);
  assert.equal(report(s,3200).lastReportedHazard,'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR');
});

test('hazard and sensor error stay flagged despite later reported SAFE',()=>{
  let s=createPublicLeafMonitorLab();
  s=apply(s,'water/status','SENSOR_ERROR',100);
  s=apply(s,'water/status','DANGER',101);
  s=apply(s,'water/status','SAFE',102);
  assert.equal(report(s,103).lastReportedHazard,'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR');
});

test('browser receipt age alone is never trusted sensor freshness',()=>{
  const s=apply(createPublicLeafMonitorLab(),'water/status','WARNING',1000);
  const recent=report(s,1000);
  const stale=report(s,17001);
  assert.equal(recent.sourceTrust,'UNVERIFIED');
  assert.equal(stale.transport,'NO_RECENT_LEAVES');
  assert.equal(stale.floodClearance,'UNKNOWN');
  assert.throws(()=>summarizePublicLeafMonitorLab(s,NaN));
});

test('strict lab never fetches, writes to Firebase or commands an actuator',()=>{
  const src=readFileSync('experiments/public-leaf-monitor-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|fetch\s*\(|\.set\s*\(|\.update\s*\(|\.remove\s*\(|servo\.write/);
});
