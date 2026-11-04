// H16 active dashboard/water UI safety boundary: synthetic-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeRiskObservation,describeWaterObservation}
  from '../lib/dashboard-water-observation.mjs';

function noSafetyAuthority(result) {
  assert.ok(Object.isFrozen(result));
  for (const key of ['sourceAuthenticated','physicalSafetyVerified',
    'canDeclareSafe','canOperateGate','canSendAlert'])
    assert.equal(result[key],false,key);
}
test('timestamp-recent LOW is not a real-world SAFE or LOW clearance',()=>{
  const x=describeRiskObservation({reportedRisk:'LOW',freshness:'live'});
  assert.equal(x.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
  assert.equal(x.reportedRiskLabel,'REPORTED LOW · UNVERIFIED');
  assert.equal(x.reportedElevation,null);
  noSafetyAuthority(x);
});
test('recent elevated danger reports remain prominent as unverified investigation leads',()=>{
  for (const risk of ['MODERATE','HIGH','SEVERE','CRITICAL']) {
    const x=describeRiskObservation({reportedRisk:risk,freshness:'live'});
    assert.equal(x.reportedElevation,risk);
    assert.match(x.reportedRiskLabel,/REPORTED .* · UNVERIFIED/);
    assert.equal(x.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
    noSafetyAuthority(x);
  }
});
test('stale CRITICAL is historical, while no known risk can claim safety',()=>{
  const old=describeRiskObservation({reportedRisk:'CRITICAL',freshness:'stale'});
  assert.equal(old.reportedRiskLabel,'LAST RECORDED CRITICAL · NOT CURRENT');
  assert.equal(old.reportedElevation,null);
  noSafetyAuthority(old);
  for(const freshness of ['loading','unavailable','stale']) {
    const x=describeRiskObservation({reportedRisk:'LOW',freshness});
    assert.equal(x.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
    assert.equal(x.reportedElevation,null);
    noSafetyAuthority(x);
  }
  for(const malformed of [null,undefined,{},'CERTIFIED_SAFE','']) {
    const x=describeRiskObservation({reportedRisk:malformed,freshness:'live'});
    assert.equal(x.reportedRiskLabel,'NO VERIFIED RISK READING');
    noSafetyAuthority(x);
  }
});
test('recent SAFE water can be reported but never highlighted as physical SAFE',()=>{
  const x=describeWaterObservation({
    water:{levelCm:2,distanceCm:23,status:'SAFE'},freshness:'live'
  });
  assert.equal(x.safeBandActive,false);
  assert.match(x.reportStatusLabel,/REPORTED SAFE · UNVERIFIED/);
  noSafetyAuthority(x);
});
test('contradictory SAFE flag cannot override a 25 cm danger-range level',()=>{
  const x=describeWaterObservation({
    water:{levelCm:25,distanceCm:0,status:'SAFE'},freshness:'live'
  });
  assert.equal(x.dangerBandActive,true);
  assert.equal(x.safeBandActive,false);
  assert.equal(x.reportStatusLabel,'POSSIBLE DANGER · UNVERIFIED');
  noSafetyAuthority(x);
});
test('explicit sensor error rejects numeric placeholder instead of making danger or SAFE',()=>{
  const x=describeWaterObservation({
    water:{levelCm:12,distanceCm:13,status:'SENSOR_ERROR'},freshness:'live'
  });
  assert.equal(x.currentLevel,null);
  assert.equal(x.currentAirGap,null);
  assert.equal(x.dangerBandActive,false);
  assert.equal(x.warningBandActive,false);
  assert.match(x.reportStatusLabel,/REPORTED SENSOR_ERROR · UNVERIFIED/);
  noSafetyAuthority(x);
});
test('warning/danger observations remain visible and can escalate',()=>{
  for(const [water,warning,danger] of [
    [{levelCm:8.5,status:'WARNING'},true,false],
    [{levelCm:11,status:'DANGER'},false,true],
    [{levelCm:null,status:'DANGER'},false,true],
    [{levelCm:2,status:'DANGER'},false,true],
    [{levelCm:0,status:'SENSOR_ERROR'},false,false]
  ]) {
    const x=describeWaterObservation({water,freshness:'live'});
    assert.equal(x.warningBandActive,warning);
    assert.equal(x.dangerBandActive,danger);
    assert.equal(x.safeBandActive,false);
    noSafetyAuthority(x);
  }
});
test('stale readings never populate a current gauge or active safety band',()=>{
  for(const freshness of ['stale','unavailable','loading']) {
    const x=describeWaterObservation({
      water:{levelCm:2,distanceCm:23,status:'SAFE'},freshness
    });
    assert.equal(x.currentLevel,null);
    assert.equal(x.currentAirGap,null);
    assert.equal(x.lastRecordedLevel,2);
    assert.equal(x.lastRecordedAirGap,23);
    assert.equal(x.warningBandActive,false);
    assert.equal(x.dangerBandActive,false);
    assert.equal(x.safeBandActive,false);
    assert.match(x.reportStatusLabel,/NOT CURRENT/);
    noSafetyAuthority(x);
  }
});
test('malformed readings and missing data remain unavailable',()=>{
  for(const water of [null,undefined,{levelCm:-1,distanceCm:26,status:'SAFE'},
    {levelCm:'2',distanceCm:'23',status:'SAFE'},
    {levelCm:NaN,distanceCm:Infinity,status:'UNKNOWN'}]) {
    const x=describeWaterObservation({water,freshness:'live'});
    assert.equal(x.currentLevel,null);
    assert.equal(x.currentAirGap,null);
    assert.equal(x.safeBandActive,false);
    noSafetyAuthority(x);
  }
});
test('real dashboard and water pages consume the policy rather than raw all-clear labels',()=>{
  const dash=readFileSync('app/dashboard/page.tsx','utf8');
  const water=readFileSync('app/water/page.tsx','utf8');
  assert.match(dash,/describeRiskObservation\(/);
  assert.match(dash,/describeWaterObservation\(/);
  assert.match(dash,/riskView\.currentPhysicalRisk/);
  assert.match(dash,/riskView\.reportedElevation/);
  assert.match(dash,/gateView\.displayLabel/);
  assert.match(dash,/riskView\.reportedRiskLabel/);
  assert.doesNotMatch(dash,/<strong>\{risk\}<\/strong>/);
  assert.doesNotMatch(dash,/\?"LIVE":data/);
  assert.match(water,/describeWaterObservation\(/);
  assert.match(water,/observation\.safeBandActive/);
  assert.match(water,/observation\.warningBandActive/);
  assert.match(water,/observation\.dangerBandActive/);
  assert.doesNotMatch(water,/Actual dam water level|Actual water level/);
  assert.doesNotMatch(water,/controller confirms DANGER, starts the real countdown/);
});
test('presentation-only implementation cannot connect, write, publish or actuate',()=>{
  const source=readFileSync('lib/dashboard-water-observation.mjs','utf8');
  for(const unsafe of ['firebase/database','node:https','node:http',
    'fetch(','WebSocket(','writeFileSync(','sendMessage(','servo.write',
    'digitalWrite(','process.env','SERVICE_ACCOUNT'])
    assert.equal(source.includes(unsafe),false,unsafe);
});
