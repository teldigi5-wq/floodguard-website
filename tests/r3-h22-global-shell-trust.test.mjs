import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicMonitorView} from '../lib/public-monitor-view.mjs';

const chrome=readFileSync('components/site-chrome.tsx','utf8');
const layout=readFileSync('app/layout.tsx','utf8');
const css=readFileSync('app/globals.css','utf8');
const observed={
  water:{status:'SAFE',levelCm:1,distanceCm:24},
  gate:{status:'CLOSED',angle:0,countdownSeconds:0},
  esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-62},
  alarm:{active:false}
};
const view=(data=observed,freshness='live')=>describePublicMonitorView({data,freshness});

test('global site shell reads the same immutable qualified source contract as H21 pages',()=>{
  assert.match(chrome,/describePublicMonitorView\(\{data,freshness\}\)/);
  assert.match(chrome,/monitor\.waterLevelCm/);
  assert.match(chrome,/monitor\.waterLabel/);
  assert.match(chrome,/monitor\.espLabel/);
  assert.match(chrome,/monitor\.gateLabel/);
  assert.doesNotMatch(chrome,/fmt\(data\?\.water\?\.levelCm/);
  assert.doesNotMatch(chrome,/label\(data\?\.esp8266\?\.status/);
  assert.doesNotMatch(chrome,/data\?\.esp8266\?\.status\s*\?\?/);
  assert.doesNotMatch(chrome,/label\(data\?\.gate\?\.status/);
});
test('stale or disconnected source cannot produce current gate, water or ESP labels in shell',()=>{
  for(const freshness of ['stale','unavailable','loading']) {
    const a=view(observed,freshness);
    assert.equal(a.waterLevelCm,null);
    assert.equal(a.gateAngleDeg,null);
    assert.equal(a.espLabel,'UNKNOWN · SOURCE UNVERIFIED');
    assert.equal(a.canDeclareSafe,false);
    assert.equal(a.canOperateGate,false);
  }
  for(const data of [
    {...observed,gate:{status:'OPEN',angle:0}},
    {...observed,esp8266:{status:'ONLINE',connection:'OFFLINE',rssi:-40}},
    {...observed,water:{status:'SENSOR_ERROR',levelCm:1,distanceCm:24}}
  ]) {
    const r=view(data,'live');
    assert.equal(r.canDeclareSafe,false);
    assert.equal(r.canOperateGate,false);
  }
});
test('no global alarm escalation to verified physical siren or delivery is possible',()=>{
  assert.match(chrome,/data\?\.alarm\?\.active===true/);
  assert.match(chrome,/role=\{freshness==="live"\?"alert":"status"\}/);
  assert.match(chrome,/freshness==="live"\?monitor\.alarmLabel:"LAST REPORTED ACTIVE · NOT CURRENT"/);
  assert.match(chrome,/physical siren and notification delivery unverified/);
  assert.doesNotMatch(chrome,/data\.alarm\.type\?\.replaceAll/);
  assert.equal(view({...observed,alarm:{active:true}},'stale').alarmLabel,
    'LAST REPORTED ACTIVE · NOT CURRENT');
  assert.equal(view({...observed,alarm:{active:true}},'live').alarmLabel,
    'REPORTED ACTIVE · UNVERIFIED');
  assert.equal(view({...observed,alarm:{active:false}},'live').alarmLabel,
    'REPORTED OFF · UNVERIFIED');
});
test('skip link points to keyboard-focusable route wrapper',()=>{
  assert.match(layout,/className="skip" href="#main-content"/);
  assert.match(chrome,/id="main-content" tabIndex=\{-1\}/);
  assert.match(css,/#main-content:focus-visible\{/);
  assert.match(css,/\.status-dock \.dock-grid b\{/);
});
test('source labels remain bounded and never pass through arbitrary record fields',()=>{
  const injected={...observed,authToken:'SECRET_H22',authority:'CERTIFIED',
    gate:{...observed.gate,privateToken:'SECRET_GATE'},
    esp8266:{...observed.esp8266,privateWifi:'SECRET_WIFI'}};
  const report=view(injected);
  assert.equal(report.authenticatedFieldSource,false);
  assert.equal(report.canSendAlert,false);
  assert.equal(report.physicalGateVerified,false);
  assert.doesNotMatch(JSON.stringify(report),/SECRET_H22|SECRET_GATE|SECRET_WIFI|CERTIFIED/);
});
test('H22 is a presentation-only shell change; no runtime side-effect hook is introduced',()=>{
  const delta=chrome.match(/describePublicMonitorView/g)||[];
  assert.equal(delta.length,2);
  assert.doesNotMatch(chrome,/firebase-admin|sendMessage\(|gateCommand\(|writeFileSync\(/);
});
