import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicEspObservation,describePublicRainObservation} from '../lib/public-health-observation.mjs';

const provider=readFileSync('providers/flood-provider.tsx','utf8');
const fixtureEsp={status:'ONLINE',connection:'CONNECTED',rssi:-62};
const fixtureRain={status:'NORMAL',sensorStatus:'ONLINE',currentMm:0,dailyMm:0};

test('provider must preserve optional public ESP inventory to honor its conservative veto',()=>{
  assert.match(provider,/esp8266:\s*deviceValue\.optional\(\)/);
  assert.match(provider,/const raw = source\.status \?\? source\.state \?\? source\.online;/);
  assert.doesNotMatch(provider,/source\.status \?\? source\.state \?\? source\.online \?\? source\.installed/);
});
test('explicit installed:false overrides cached device status before normalizing',()=>{
  assert.match(provider,/if \(source\.installed === false\) return "NOT_INSTALLED";/);
  const k=provider.indexOf('if (source.installed === false) return "NOT_INSTALLED"');
  const j=provider.indexOf('const raw = source.status ?? source.state ?? source.online;');
  assert.ok(k>0 && j>k,'Uninstalled guard must precede status promotion');
});
test('optional inventory can veto coherent unsigned ESP child reports',()=>{
  for(const inventory of ['NOT_INSTALLED','OFFLINE','ERROR','UNKNOWN',{installed:false,status:'ONLINE'}]){
    const report=describePublicEspObservation({esp:fixtureEsp,inventory,freshness:'live'});
    assert.equal(report.state,'UNKNOWN');
    assert.equal(report.signalDbm,null);
    assert.equal(report.label,'UNKNOWN · SOURCE UNVERIFIED');
    assert.equal(report.physicalLinkVerified,false);
  }
  const recovered=describePublicEspObservation({
    esp:fixtureEsp,inventory:'ONLINE',freshness:'live'
  });
  assert.equal(recovered.label,'REPORTED ONLINE · UNVERIFIED');
  assert.equal(recovered.signalDbm,-62);
  assert.equal(recovered.deviceIdentityVerified,false);
});
test('reported not-installed rain gauge withholds zero and NORMAL regardless of unsigned rain status',()=>{
  for(const inventory of ['NOT_INSTALLED','UNKNOWN',{installed:false,status:'ONLINE'}]){
    const report=describePublicRainObservation({
      rain:fixtureRain,device:inventory,freshness:'live'
    });
    assert.equal(report.category,'UNKNOWN');
    assert.equal(report.categoryLabel,'SENSOR UNAVAILABLE · MEASUREMENTS WITHHELD');
    assert.equal(report.currentMm,null);
    assert.equal(report.dailyMm,null);
    assert.equal(report.canDeclareNormal,false);
  }
  const recovered=describePublicRainObservation({
    rain:fixtureRain,device:'ONLINE',freshness:'live'
  });
  assert.equal(recovered.currentMm,0);
  assert.equal(recovered.categoryLabel,'REPORTED NORMAL · UNVERIFIED');
  assert.equal(recovered.physicalRainVerified,false);
});
test('CI must execute the real H26 inventory transitions with H25 emulator and browser gates',()=>{
  const browser=readFileSync('tests/browser/h25-sdk-emulator-chromium.test.mjs','utf8');
  const workflow=readFileSync('.github/workflows/r3-h26-inventory-install-veto.yml','utf8');
  assert.match(browser,/H26: real SDK refuses ESP ONLINE/);
  assert.match(browser,/H26: real SDK rain gauge installed=false/);
  assert.match(browser,/adminPut\('floodguard\/live\/devices\/esp8266',\{installed:false,status:'ONLINE'\}\)/);
  assert.match(browser,/adminPut\('floodguard\/live\/devices\/rainGauge',\{installed:false,status:'ONLINE'\}\)/);
  assert.match(workflow,/test\/r3-h25-sdk-emulator-browser-20261104/);
  assert.match(workflow,/safety\/r3-h26-inventory-installation-veto-20261104/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/FG_H25_BROWSER_LAB=1 bash scripts\/r3-h25-browser-emulator-lab\.sh/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
