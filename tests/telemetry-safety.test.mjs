import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isExplicitWaterFault,reconcileReportedGateStatus} from '../lib/telemetry-safety.mjs';

const gate=(status,angle,countdownSeconds=0)=>
  reconcileReportedGateStatus({status,angle,countdownSeconds});

test('contradictory OPEN with zero degrees never silently becomes CLOSED',()=>{
  assert.equal(gate('OPEN',0),'UNKNOWN');
  assert.equal(gate('CLOSED',90),'UNKNOWN');
  assert.equal(gate('OPEN',45),'UNKNOWN');
  assert.equal(gate('CLOSED',45),'UNKNOWN');
});
test('expired countdown and incoherent countdown never invent safe gate state',()=>{
  assert.equal(gate('COUNTDOWN',0,0),'UNKNOWN');
  assert.equal(gate('OPEN',90,5),'UNKNOWN');
  assert.equal(gate('CLOSED',0,5),'UNKNOWN');
  assert.equal(gate('COUNTDOWN',0,5),'COUNTDOWN');
  assert.equal(gate('OPENING_WARNING',0,5),'COUNTDOWN');
});
test('consistent reports remain available as explicitly reported, not independently verified',()=>{
  assert.equal(gate('CLOSED',0),'CLOSED');
  assert.equal(gate('CLOSED',2),'CLOSED');
  assert.equal(gate('OPEN',90),'OPEN');
  assert.equal(gate('OPEN',80),'OPEN');
  assert.equal(gate('OPENING',40),'OPENING');
  assert.equal(gate('CLOSING',45),'CLOSING');
});
test('missing, malformed or unknown position/status cannot assert CLOSED',()=>{
  for(const input of [
    {status:'UNKNOWN',angle:0,countdownSeconds:0},
    {status:null,angle:0,countdownSeconds:0},
    {status:'ERROR',angle:0,countdownSeconds:0},
    {status:'OPEN',angle:91,countdownSeconds:0},
    {status:'CLOSED',angle:-1,countdownSeconds:0}
  ])assert.equal(reconcileReportedGateStatus(input),'UNKNOWN');
});
test('explicit water sensor error cannot be overridden by numeric value',()=>{
  for(const status of ['SENSOR_ERROR','ERROR','OFFLINE','INVALID',' sensor_error '])
    assert.equal(isExplicitWaterFault(status),true);
  for(const status of [null,'SAFE','WARNING','DANGER'])
    assert.equal(isExplicitWaterFault(status),false);
});
test('live provider uses the safety helper for sensor and gate normalization',()=>{
  const source=readFileSync('providers/flood-provider.tsx','utf8');
  assert.match(source,/if \(isExplicitWaterFault\(source\.status\)\)/);
  assert.match(source,/reconcileReportedGateStatus\(\{status:rawStatus,angle,countdownSeconds:countdown\}\)/);
  assert.doesNotMatch(source,/status = "CLOSED";/);
});
test('the helper cannot access production services or actuate hardware',()=>{
  const source=readFileSync('lib/telemetry-safety.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|serviceAccount|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:https|node:http|node:net|writeFileSync/);
});
