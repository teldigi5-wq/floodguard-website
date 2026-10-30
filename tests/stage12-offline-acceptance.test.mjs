import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectStage12SyntheticLegacy} from '../experiments/stage12-legacy-acceptance.mjs';
import {inspectStage11,readLocalStage11} from '../scripts/stage11-release-audit.mjs';
const fixture=JSON.parse(fs.readFileSync('docs/firebase/stage12-synthetic-fixtures.json','utf8'));
const getA=()=>JSON.parse(fs.readFileSync('docs/firebase/phase-a-privacy-candidate.rules.json','utf8'));
const getB=()=>JSON.parse(fs.readFileSync('docs/firebase/phase-b-authenticated-prototype.rules.json','utf8'));
const review=JSON.parse(fs.readFileSync('docs/firebase/stage11-cross-repo-readiness.json','utf8'));

test('legacy PUT and PATCH fixture shapes are synthetic and never authorized to forward',()=>{
  assert.equal(fixture.schema,'floodguard-stage12-synthetic-v1');
  assert.equal(fixture.cases.length,7);
  const seen=new Set();
  for(const scenario of fixture.cases){
    assert.ok(!seen.has(scenario.id));seen.add(scenario.id);
    const result=inspectStage12SyntheticLegacy({...scenario,nowMs:fixture.nowMs});
    assert.equal(result.recognized,true,scenario.id);
    assert.equal(result.canForward,false,scenario.id);
    assert.equal(result.canAuthenticate,false,scenario.id);
    assert.equal(result.kind,'OFFLINE_SYNTHETIC_FIXTURE_ONLY');
    assert.equal(result.websiteFixtureFreshness,scenario.expect.freshness,scenario.id);
    assert.equal(result.ageSeconds,scenario.expect.ageSeconds,scenario.id);
    assert.equal(result.hasPrivateMetadata,scenario.expect.private,scenario.id);
    assert.equal(result.hasUnreviewedDescendants,scenario.expect.unknown,scenario.id);
  }
});
test('synthetic IP, SSID and unreviewed public descendant never escape projected data',()=>{
  for(const scenario of fixture.cases){
    const result=inspectStage12SyntheticLegacy({...scenario,nowMs:fixture.nowMs});
    const shown=JSON.stringify(result);
    assert.doesNotMatch(shown,/192\.0\.2\.|SYNTHETIC-NETWORK|PRIVATE-CHILD|internalIdentifier|esp8266\/ip|esp8266\/wifi/);
    assert.deepEqual(Object.keys(result.publicProjection.esp8266||{}).sort(),
      ['connection','rssi','status'].sort(),scenario.id);
    assert.equal(result.publicProjection.system?.lastUpdate,scenario.payload["system/lastUpdate"]||
      scenario.payload.system?.lastUpdate);
  }
});
test('legacy parser fails closed on unsafe roots, unsupported methods and oversized payloads',()=>{
  const sample=fixture.cases[0];
  for(const change of [
    {method:'POST'}, {path:'/floodguard/bot'},
    {payload:null}, {payload:"not-object"},
    {payload:{'__proto__/pollution':true}},
    {payload:{'water/value':{nested:true}}},
    {payload:{'water/distanceCm':"X".repeat(10000)}}
  ]){
    const r=inspectStage12SyntheticLegacy({...sample,...change,nowMs:fixture.nowMs});
    assert.equal(r.recognized,false);
    assert.equal(r.canForward,false);
  }
});
test('20-second-old reading causes documented cross-client threshold disagreement',()=>{
  const windows=fixture.inspectedClientFreshnessWindowsSeconds;
  assert.deepEqual(windows,{website:10,bot:15,mobile:30});
  assert.equal(20>windows.website,true);
  assert.equal(20>windows.bot,true);
  assert.equal(20<=windows.mobile,true);
  assert.equal(readLocalStage11().status,'NO_GO');
});
test('every client freshness window treats a 31-second old field timestamp as stale',()=>{
  const windows=fixture.inspectedClientFreshnessWindowsSeconds;
  for(const [client,window] of Object.entries(windows)){
    assert.ok(31>window,client+' needs additional real-device freshness testing');
  }
  const old=fixture.cases.find(c=>c.id==='put-old-safe');
  assert.equal(inspectStage12SyntheticLegacy({...old,nowMs:fixture.nowMs}).websiteFixtureFreshness,'stale');
});
test('private child names under public ancestors are release-review hazards',()=>{
  const scenario=fixture.cases.find(c=>c.id==='patch-unreviewed-child');
  const result=inspectStage12SyntheticLegacy({...scenario,nowMs:fixture.nowMs});
  assert.equal(result.hasUnreviewedDescendants,true);
  const rules=getA().rules.floodguard.live;
  assert.equal(rules.water['.read'],true,'public water ancestor exposes all children');
  assert.equal(rules['.write'],true,'anonymous telemetry writes still permitted');
});
test('phase A and B remain distinct, with separate owner permission barriers',()=>{
  const x=inspectStage11({review,phaseA:getA(),phaseB:getB()});
  assert.equal(x.status,'NO_GO');
  assert.equal(x.phaseAAnonymousParentWrites,true);
  assert.equal(x.phaseBPrototypeSeparated,true);
  assert.ok(x.blockers.includes('PRODUCTION_RULES_NOT_PRIVATELY_VERIFIED'));
});
test('Stage 12 acceptance record cannot falsely clear real-world evidence gates',()=>{
  const gate=JSON.parse(fs.readFileSync('docs/firebase/STAGE12_ACCEPTANCE_GATES.json','utf8'));
  assert.equal(gate.releaseDecision,'NO_GO_REVIEW_ONLY');
  for(const item of gate.realWorldGates){
    assert.equal(item.status,'UNVERIFIED',item.id);
    assert.equal(item.approved,false,item.id);
  }
  assert.ok(gate.realWorldGates.some(x=>x.id==='firebase-anonymous-write-remediation'));
  assert.ok(gate.realWorldGates.some(x=>x.id==='real-device-hardware-and-tls'));
  assert.ok(gate.realWorldGates.some(x=>x.id==='mobile-physical-smoke'));
});
test('Stage 12 helper is offline, has no real transport or production credentials',()=>{
  const src=fs.readFileSync('experiments/stage12-legacy-acceptance.mjs','utf8');
  assert.doesNotMatch(src,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(src,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(src,/node:http|node:https|node:net|node:tls/);
});
