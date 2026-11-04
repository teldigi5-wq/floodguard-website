import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const cfg=read('r3-firebase-emulator.json');
const rules=read('docs/firebase/R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json').rules;

test('H24 uses fixed local database host, demo-only project and no emulator UI',()=>{
  assert.equal(cfg.emulators.database.host,'127.0.0.1');
  assert.equal(cfg.emulators.database.port,19001);
  assert.equal(cfg.emulators.ui.enabled,false);
  assert.equal(cfg.emulators.singleProjectMode,true);
  assert.equal(cfg.database.rules,'docs/firebase/R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json');
  assert.doesNotMatch(JSON.stringify(cfg),/floodguard-e3215|asia-southeast1|https?:\/\/(?!127\.0\.0\.1)/);
});

test('current restrictive candidate never inherits ancestor read or write grants',()=>{
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(rules.floodguard.live['.read'],false);
  assert.equal(rules.floodguard.live['.write'],false);
  assert.equal(rules.floodguard.live.esp8266['.read'],false);
});

test('restrictive candidate permits only named public child reads, not private ESP parents',()=>{
  const l=rules.floodguard.live;
  for(const key of ['water','rain','gate','alarm','devices','system']) {
    assert.equal(l[key]['.read'],true,key);
  }
  for(const key of ['connection','status','rssi']) {
    assert.equal(l.esp8266[key]['.read'],true,key);
  }
  assert.equal(l.esp8266.ip['.read'],false);
  assert.equal(l.esp8266.wifi['.read'],false);
  for(const key of ['test','bot']) {
    assert.equal(rules.floodguard[key]['.read'],false,key);
    assert.equal(rules.floodguard[key]['.write'],false,key);
  }
});

test('actual RTDB acceptance suite rejects any nonlocal emulator/project argument',()=>{
  const src=readFileSync('tests/r3-firebase-emulator.test.mjs','utf8');
  assert.match(src,/const HOST = '127\.0\.0\.1'/);
  assert.match(src,/const PORT = 19001/);
  assert.match(src,/const PROJECT = 'demo-floodguard-r3'/);
  assert.match(src,/FIREBASE_DATABASE_EMULATOR_HOST/);
  assert.match(src,/GCLOUD_PROJECT/);
  assert.match(src,/const emulatorTest = emulatorConfigured \? test : test\.skip/);
  assert.match(src,/anonymous PATCH and DELETE remain denied/);
  assert.match(src,/privileged synthetic seed persists after unauthorized modifications/);
});

test('H24 CI keeps cloud authentication disabled and historical permissive Phase A isolated',()=>{
  const workflow=readFileSync('.github/workflows/r3-h24-restrictive-emulator.yml','utf8');
  assert.match(workflow,/GCLOUD_PROJECT: demo-floodguard-r3/);
  assert.match(workflow,/FIREBASE_TOKEN: ''/);
  assert.match(workflow,/GOOGLE_APPLICATION_CREDENTIALS: ''/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/--config r3-firebase-emulator\.json/);
  assert.match(workflow,/node --test tests\/r3-firebase-emulator\.test\.mjs/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|FG_EMULATOR=1|firebase\.phase-a\.json/);
});
