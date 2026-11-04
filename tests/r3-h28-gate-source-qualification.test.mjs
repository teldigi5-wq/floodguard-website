import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicMonitorView} from '../lib/public-monitor-view.mjs';
import {describeRiskObservation,describeWaterObservation} from '../lib/dashboard-water-observation.mjs';

const page=readFileSync('app/gate/page.tsx','utf8');

test('gate scene accepts only shared source-qualified water/rain and gate values',()=>{
  assert.match(page,/const monitor=describePublicMonitorView\(\{data,freshness\}\)/);
  assert.match(page,/describeWaterObservation\(\{water,freshness\}\)/);
  assert.match(page,/describeRiskObservation\(\{/);
  assert.match(page,/angle=\{angle\}/);
  assert.match(page,/rain=\{monitor\.rainCurrentMm\}/);
  assert.match(page,/waterDistance=\{monitor\.waterDistanceCm\}/);
  assert.doesNotMatch(page,/rain=\{freshness === "live" \? data\?\.rain\?\.currentMm/);
  assert.doesNotMatch(page,/waterDistance=\{freshness === "live" \? water\?\.distanceCm/);
});
test('gate panels and inline metrics cannot read raw source ESP, water or LOW risk',()=>{
  assert.match(page,/monitor\.espLabel/);
  assert.match(page,/monitor\.espSignalDbm/);
  assert.match(page,/waterObservation\.currentLevel/);
  assert.match(page,/waterObservation\.reportStatusLabel/);
  assert.match(page,/riskObservation\.reportedRiskLabel/);
  assert.doesNotMatch(page,/data\?\.esp8266\?\.status\s*\?\?/);
  assert.doesNotMatch(page,/data\?\.esp8266\?\.rssi/);
  assert.doesNotMatch(page,/fmt\(water\?\.levelCm/);
  assert.doesNotMatch(page,/label\(data\?\.system\?\.overallRisk\)/);
  assert.doesNotMatch(page,/REPORTED \$\{label\(waterState\)\}/);
});
test('stale or sensor-faulted water is withheld from the gate surface and scene',()=>{
  const data={
    water:{status:'SENSOR_ERROR',distanceCm:20,levelCm:5},
    gate:{status:'CLOSED',angle:0,countdownSeconds:0},
    rain:{status:'NORMAL',currentMm:0,dailyMm:0,sensorStatus:'ONLINE'},
    devices:{rainGauge:'ONLINE',esp8266:'NOT_INSTALLED'},
    esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-62},
    system:{overallRisk:'LOW'}
  };
  for(const freshness of ['live','stale']){
    const monitor=describePublicMonitorView({data,freshness});
    const water=describeWaterObservation({water:data.water,freshness});
    const risk=describeRiskObservation({reportedRisk:data.system.overallRisk,freshness});
    assert.equal(monitor.waterLevelCm,null);
    assert.equal(monitor.waterDistanceCm,null);
    assert.equal(water.currentLevel,null);
    assert.equal(water.dangerBandActive,false);
    assert.equal(risk.currentPhysicalRisk,'UNKNOWN · UNVERIFIED');
    assert.equal(monitor.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
    assert.equal(monitor.espSignalDbm,null);
    assert.equal(monitor.physicalGateVerified,false);
  }
});
test('controller reason is not shown as current if the report is stale or gate state unknown',()=>{
  assert.match(page,/const reportedReason=freshness==="live" && gateState!=="UNKNOWN"/);
  assert.match(page,/Object\.hasOwn\(reasons,reportedReason\)/);
  assert.match(page,/REASON UNKNOWN · UNVERIFIED/);
  assert.doesNotMatch(page,/label\(gate\?\.reason \?\? "NONE"\)/);
  assert.doesNotMatch(page,/reasons\[\(gate\?\.reason \?\? "NONE"\)/);
  assert.match(page,/const releaseActive = false;/);
});
test('H28 no-cloud CI runs real gate page SDK transitions and inherits restrictive Rules',()=>{
  const browser=readFileSync('tests/browser/h25-sdk-emulator-chromium.test.mjs','utf8');
  const workflow=readFileSync('.github/workflows/r3-h28-gate-page-trust.yml','utf8');
  assert.match(browser,/H28: real SDK gate view revokes/);
  assert.match(browser,/H28: stale gate view withholds/);
  assert.match(workflow,/safety\/r3-h28-gate-page-trust-20261104/);
  assert.match(workflow,/safety\/r3-h27-diagnostics-source-consistency-20261104/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/FG_H25_BROWSER_LAB=1 bash scripts\/r3-h25-browser-emulator-lab\.sh/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
