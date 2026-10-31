import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isExplicitWaterFault,reconcileCalibratedWaterMeasurement,reconcileReportedGateStatus,reconcileWaterStatusWithoutMeasurement} from '../lib/telemetry-safety.mjs';

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
test('malformed servo angles and countdowns cannot be reported as confirmed gate states',()=>{
  for(const bad of [-1,1.2,11,60,3600,Number.NaN,Number.POSITIVE_INFINITY,'0']) {
    assert.equal(reconcileReportedGateStatus({
      status:'CLOSED',angle:0,countdownSeconds:bad
    }),'UNKNOWN',String(bad));
  }
  for(const badAngle of [-1,0.5,91,Number.POSITIVE_INFINITY,'0']) {
    assert.equal(reconcileReportedGateStatus({
      status:'CLOSED',angle:badAngle,countdownSeconds:0
    }),'UNKNOWN',String(badAngle));
  }
  assert.equal(reconcileReportedGateStatus({
    status:'COUNTDOWN',angle:0,countdownSeconds:10
  }),'COUNTDOWN');
  assert.equal(reconcileReportedGateStatus({
    status:'COUNTDOWN',angle:0,countdownSeconds:10.5
  }),'UNKNOWN');
});

test('missing controller angle never proves OPEN or CLOSED',()=>{
  for(const status of ['OPEN','CLOSED']) {
    for(const angle of [undefined,null]) {
      assert.equal(reconcileReportedGateStatus({
        status,angle,countdownSeconds:0
      }),'UNKNOWN',status);
    }
  }
  assert.equal(gate('CLOSED',0,0),'CLOSED');
  assert.equal(gate('OPEN',90,0),'OPEN');
});

test('explicit water sensor error cannot be overridden by numeric value',()=>{
  for(const status of ['SENSOR_ERROR','ERROR','OFFLINE','INVALID',' sensor_error '])
    assert.equal(isExplicitWaterFault(status),true);
  for(const status of [null,'SAFE','WARNING','DANGER'])
    assert.equal(isExplicitWaterFault(status),false);
});
test('missing water measurement cannot turn a stored SAFE flag into clearance',()=>{
  assert.equal(reconcileWaterStatusWithoutMeasurement('SAFE'),'UNKNOWN');
  assert.equal(reconcileWaterStatusWithoutMeasurement(null),'UNKNOWN');
  assert.equal(reconcileWaterStatusWithoutMeasurement('UNKNOWN'),'UNKNOWN');
  assert.equal(reconcileWaterStatusWithoutMeasurement('DANGER'),'DANGER');
  assert.equal(reconcileWaterStatusWithoutMeasurement('WARNING'),'WARNING');
  assert.equal(reconcileWaterStatusWithoutMeasurement('SENSOR_ERROR'),'SENSOR_ERROR');
});

test('out-of-installation air gap cannot produce SAFE through clamping',()=>{
  for(const invalid of [25.0001,26,400,-1,Number.NaN,Number.POSITIVE_INFINITY,null,'25']) {
    const x=reconcileCalibratedWaterMeasurement({
      distanceCm:invalid,levelCm:0,status:'SAFE'
    });
    assert.deepEqual(x,{distanceCm:null,levelCm:null,status:'UNKNOWN'},String(invalid));
  }
  assert.deepEqual(reconcileCalibratedWaterMeasurement({
    distanceCm:26,levelCm:0,status:'DANGER'
  }),{distanceCm:null,levelCm:null,status:'DANGER'});
});

test('valid calibrated readings retain previously reported hazards',()=>{
  const read=(distanceCm,status)=>reconcileCalibratedWaterMeasurement({distanceCm,status});
  assert.deepEqual(read(25,'SAFE'),{distanceCm:25,levelCm:0,status:'SAFE'});
  assert.equal(read(16.5,'SAFE').status,'WARNING');
  assert.equal(read(14,'SAFE').status,'DANGER');
  assert.equal(read(0,'SAFE').status,'DANGER'); // provisional website zero-echo semantics
  assert.equal(read(25,'WARNING').status,'WARNING');
  assert.equal(read(25,'DANGER').status,'DANGER');
  assert.equal(read(14,'SENSOR_ERROR').status,'SENSOR_ERROR');
  assert.equal(read(25,'DISCONNECTED').status,'SENSOR_ERROR');
  assert.equal(reconcileCalibratedWaterMeasurement({levelCm:12,status:'SAFE'}).status,'DANGER');
  assert.equal(reconcileCalibratedWaterMeasurement({status:'SAFE'}).status,'UNKNOWN');
});

test('live provider uses the safety helper for sensor and gate normalization',()=>{
  const source=readFileSync('providers/flood-provider.tsx','utf8');
  assert.match(source,/reconcileCalibratedWaterMeasurement\(source\)/);
  assert.doesNotMatch(source,/Math\.max\(0, Math\.min\(WATER_SENSOR_TO_BOTTOM_CM/);
  assert.ok(source.includes('reconcileReportedGateStatus({'));
  assert.ok(source.includes('angle: source.angle'));
  assert.ok(source.includes('countdownSeconds: source.countdownSeconds'));
  assert.ok(!source.includes('Math.max(0, source.countdownSeconds)'));
  assert.doesNotMatch(source,/status = "CLOSED";/);
});
test('the helper cannot access production services or actuate hardware',()=>{
  const source=readFileSync('lib/telemetry-safety.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|serviceAccount|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:https|node:http|node:net|writeFileSync/);
});
