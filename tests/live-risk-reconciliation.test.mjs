import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileReportedRainStatus,reconcileDisplayedFloodRisk} from '../lib/telemetry-safety.mjs';

const rain=(status,dailyMm)=>reconcileReportedRainStatus({status,dailyMm});
const risk=(waterStatus,rainStatus,reportedRisk='LOW',freshness='live')=>
  reconcileDisplayedFloodRisk({waterStatus,rainStatus,reportedRisk,freshness});

test('confirmed dam DANGER or critical rain overrides a falsely LOW backend risk',()=>{
  assert.equal(risk('DANGER','NORMAL'),'CRITICAL');
  assert.equal(risk('SAFE','CRITICAL'),'CRITICAL');
  assert.equal(risk('WARNING','NORMAL'),'HIGH');
  assert.equal(risk('SAFE','FLOOD_WARNING'),'HIGH');
  assert.equal(risk('SAFE','EXTREME'),'SEVERE');
  assert.equal(risk('SAFE','HEAVY_RAIN'),'MODERATE');
});
test('unknown and sensor-fault states never become LOW based on a separate risk flag',()=>{
  for(const water of [null,'UNKNOWN','SENSOR_ERROR','OFFLINE']){
    assert.equal(risk(water,'NORMAL'),'UNKNOWN');
    assert.equal(risk(water,'UNKNOWN'),'UNKNOWN');
  }
  assert.equal(risk('SAFE','UNKNOWN'),'UNKNOWN');
  assert.equal(risk('SAFE',null),'UNKNOWN');
  assert.equal(risk(null,null,'SAFE'),'UNKNOWN');
  assert.equal(risk('SAFE','NORMAL','LOW'),'UNKNOWN');
});
test('backend elevated risk never gets silently lowered but low cannot hide missing evidence',()=>{
  assert.equal(risk('SAFE','NORMAL','HIGH'),'HIGH');
  assert.equal(risk('WARNING','NORMAL','CRITICAL'),'CRITICAL');
  assert.equal(risk('UNKNOWN','NORMAL','HIGH'),'HIGH');
  assert.equal(risk('UNKNOWN','NORMAL','LOW'),'UNKNOWN');
  assert.equal(risk('SAFE','NORMAL','???'),'UNKNOWN');
});
test('stale, disconnected or initial data never yields a current risk clearance',()=>{
  for(const freshness of ['loading','stale','unavailable',null]){
    assert.equal(risk('SAFE','NORMAL','LOW',freshness),'UNKNOWN');
    assert.equal(risk('DANGER','CRITICAL','CRITICAL',freshness),'UNKNOWN');
  }
  // Test missing freshness directly instead of applying the fixture helper's
  // default 'live' argument to an explicit undefined value.
  assert.equal(reconcileDisplayedFloodRisk({
    waterStatus:'SAFE',rainStatus:'NORMAL',reportedRisk:'LOW'
  }),'UNKNOWN');
  assert.equal(risk('SAFE','NORMAL','LOW','live'),'UNKNOWN');
});
test('heavy numerical rainfall overrides NORMAL or lower categorical status',()=>{
  assert.equal(rain('NORMAL',305),'CRITICAL');
  assert.equal(rain('NORMAL',200),'EXTREME');
  assert.equal(rain('HEAVY_RAIN',150),'FLOOD_WARNING');
  assert.equal(rain('NORMAL',100),'HEAVY_RAIN');
  assert.equal(rain('NORMAL',0),'NORMAL');
  assert.equal(rain('ONLINE',305),'CRITICAL');
  assert.equal(rain('CRITICAL',2),'CRITICAL');
});
test('a faulty or unsupported gauge cannot be rehabilitated by a cached number',()=>{
  for(const status of ['ERROR','SENSOR_ERROR','OFFLINE','NOT_INSTALLED','INVALID']){
    assert.equal(rain(status,320),'UNKNOWN');
  }
  assert.equal(rain('UNKNOWN',null),'UNKNOWN');
  assert.equal(rain('UNKNOWN',300),'UNKNOWN');
  assert.equal(rain('NORMAL',Number.POSITIVE_INFINITY),'NORMAL');
});
test('the actual live provider applies risk and rain reconciliation before rendering',()=>{
  const source=readFileSync('providers/flood-provider.tsx','utf8');
  assert.match(source,/reconcileReportedRainStatus\(\{status:source\.status,dailyMm:source\.dailyMm\}\)/);
  assert.match(source,/overallRisk: reconcileDisplayedFloodRisk\(\{/);
  assert.match(source,/waterStatus: data\.water\?\.status/);
  assert.match(source,/rainStatus: data\.rain\?\.status/);
  assert.match(source,/reportedRisk: data\.system\?\.overallRisk/);
  assert.match(source,/freshness,/);
  assert.doesNotMatch(source,/function normalizeRainStatus\(/);
});

test('LOW risk requires both live shared state and explicit trusted source clearance',()=>{
  const evaluate=(verifiedClearance,extra={})=>reconcileDisplayedFloodRisk({
    waterStatus:'SAFE',rainStatus:'NORMAL',
    reportedRisk:'LOW',freshness:'live',verifiedClearance,...extra
  });
  assert.equal(evaluate(false),'UNKNOWN');
  assert.equal(evaluate(null),'UNKNOWN');
  assert.equal(evaluate(true),'LOW');
  assert.equal(evaluate(true,{freshness:'stale'}),'UNKNOWN');
  assert.equal(evaluate(true,{waterStatus:'UNKNOWN'}),'UNKNOWN');
  assert.equal(evaluate(true,{rainStatus:'SENSOR_ERROR'}),'UNKNOWN');
  assert.equal(evaluate(false,{waterStatus:'DANGER'}),'CRITICAL',
    'Fail closed on LOW without hiding reported hazards');
  const provider=readFileSync('providers/flood-provider.tsx','utf8');
  assert.doesNotMatch(provider,/verifiedClearance:\s*true/,
    'The legacy public RTDB provider cannot fabricate attestation');
});
