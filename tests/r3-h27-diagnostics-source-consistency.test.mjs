import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicMonitorView} from '../lib/public-monitor-view.mjs';
import {describePublicRainObservation} from '../lib/public-health-observation.mjs';

const src=readFileSync('app/diagnostics/page.tsx','utf8');

test('diagnostics uses the same qualified ESP and rain reports as other H26 pages',()=>{
  assert.match(src,/describePublicMonitorView\(\{data,freshness\}\)/);
  assert.match(src,/describePublicRainObservation\(\{/);
  assert.match(src,/monitor\.espLabel/);
  assert.match(src,/rainView\.categoryLabel/);
  assert.match(src,/rainView\.currentMm !== null/);
  assert.doesNotMatch(src,/label\(data\?\.esp8266\?\.status/);
  assert.doesNotMatch(src,/data\?\.esp8266\?\.status\s*\?\?/);
  assert.doesNotMatch(src,/fmt\(data\?\.rain\?\.currentMm/);
  assert.doesNotMatch(src,/const espDisplay=freshness/);
});

test('conflicting optional ESP inventory withholds ONLINE and RSSI, never proves installed hardware',()=>{
  const x=describePublicMonitorView({
    freshness:'live',
    data:{
      esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-62},
      devices:{esp8266:'NOT_INSTALLED'}
    }
  });
  assert.equal(x.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
  assert.equal(x.espSignalDbm,null);
  assert.equal(x.authenticatedFieldSource,false);
  assert.equal(x.canOperateGate,false);
});

test('missing/uninstalled/offline rain gauge cannot supply current normal numerics to diagnostics',()=>{
  for(const device of ['NOT_INSTALLED','UNKNOWN','OFFLINE']){
    const rain=describePublicRainObservation({
      rain:{status:'NORMAL',currentMm:0,dailyMm:0,sensorStatus:'ONLINE'},
      device,freshness:'live'
    });
    assert.equal(rain.currentMm,null);
    assert.equal(rain.dailyMm,null);
    assert.equal(rain.categoryLabel,'SENSOR UNAVAILABLE · MEASUREMENTS WITHHELD');
    assert.equal(rain.canDeclareNormal,false);
    assert.equal(rain.canSendAlert,false);
  }
});

test('stale source cannot show current numeric water/rain or matching ESP online in diagnostics',()=>{
  const data={
    water:{levelCm:5,distanceCm:20,status:'SAFE'},
    esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-62},
    rain:{status:'NORMAL',currentMm:0,dailyMm:0,sensorStatus:'ONLINE'},
    devices:{esp8266:'ONLINE',rainGauge:'ONLINE'}
  };
  const monitor=describePublicMonitorView({data,freshness:'stale'});
  const rain=describePublicRainObservation({rain:data.rain,device:data.devices.rainGauge,freshness:'stale'});
  assert.equal(monitor.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
  assert.equal(monitor.espSignalDbm,null);
  assert.equal(monitor.waterLevelCm,null);
  assert.equal(rain.currentMm,null);
  assert.equal(rain.categoryLabel,'LAST REPORTED NORMAL · NOT CURRENT');
  assert.equal(monitor.canDeclareSafe,false);
});

test('real emulator workflow must exercise H27 diagnostics transitions, retaining restrictive Rules checks',()=>{
  const browser=readFileSync('tests/browser/h25-sdk-emulator-chromium.test.mjs','utf8');
  const workflow=readFileSync('.github/workflows/r3-h27-diagnostics-source-assurance.yml','utf8');
  assert.match(browser,/H27: real SDK diagnostics withholds ESP ONLINE/);
  assert.match(browser,/H27: diagnostics follows installed-only/);
  assert.match(browser,/adminPut\('floodguard\/live\/esp8266\/connection','DISCONNECTED'\)/);
  assert.match(browser,/adminPut\('floodguard\/live\/rain\/sensorStatus','OFFLINE'\)/);
  assert.match(workflow,/safety\/r3-h27-diagnostics-source-consistency-20261104/);
  assert.match(workflow,/safety\/r3-h26-inventory-installation-veto-20261104/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/FG_H25_BROWSER_LAB=1 bash scripts\/r3-h25-browser-emulator-lab\.sh/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
