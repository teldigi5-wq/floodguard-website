// H9 exact authorization-delta test, offline and no Firebase operations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const prior=read('../docs/firebase/r3-h8-readback-observer-lab.rules.json');
const candidate=read('../docs/firebase/r3-h9-atomic-incident-lab.rules.json');
const config=read('../firebase.r3-h9-atomic-incident-lab.json');
const a=candidate.rules.floodguard;
test('the only Rules addition is a private atomic incident plus publication node',()=>{
  const clone=structuredClone(candidate);
  delete clone.rules.floodguard.atomicPublicationLab;
  assert.deepEqual(clone,prior);
});
test('new atomic root denies all clients writing and only grants scoped observer read',()=>{
  const n=a.atomicPublicationLab;
  assert.equal(n['.read'],false);
  assert.equal(n['.write'],false);
  const row=n['device-stage-a'];
  assert.equal(row['.write'],false);
  for(const x of [
    "auth.uid === 'readback-observer-stage'",
    "auth.token.fg_readback_v1 === true",
    "auth.token.fg_readback_generation",
    "publicationObserverAuthorization/readback-observer-stage/enabled",
    "publicationObserverAuthorization/readback-observer-stage/scope"
  ])assert.ok(row['.read'].includes(x),x);
  assert.equal(row.current['.read'],false);
  assert.equal(row.checkpoint['.read'],false);
  assert.equal(row.control['$other']['.validate'],false);
});
test('original public reads, private ESP and client publication writes remain unchanged',()=>{
  assert.equal(a.live['.write'],false);
  assert.equal(a.live.esp8266.ip['.read'],false);
  assert.equal(a.live.esp8266.wifi['.read'],false);
  assert.equal(a.publicationLab.water['.write'],false);
  assert.equal(a.publicationAdmission['device-stage-a']['.write'],false);
  assert.equal(a.publicationLab.water.current['.read'],true);
  assert.equal(candidate.rules['.write'],false);
});
test('worker has hard-coded demo-only endpoint, one CAS writer, and no deploy or gate interface',()=>{
  const source=readFileSync(new URL(
    '../experiments/r3-h9-single-node-worker.mjs',import.meta.url),'utf8');
  assert.match(source,/PROJECT='demo-r3-h9-atomic'/);
  assert.match(source,/BASE='http:\/\/127\.0\.0\.1:9000'/);
  assert.match(source,/headers\['if-match'\]=etag/);
  assert.match(source,/createH4OfflineAdmissionIssuer/);
  assert.match(source,/releaseDecision:'NO_GO'/);
  assert.doesNotMatch(source,/from 'firebase-admin|from 'node:https|from 'node:http|from 'node:net/);
  assert.doesNotMatch(source,/\bservo\.write\s*\(|\.listen\s*\(|\bwriteFileSync\s*\(/);
  assert.doesNotMatch(source,/GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG/);
});
test('H9 is isolated in a separate fixed localhost Emulator configuration',()=>{
  assert.equal(config.database.rules,
    'docs/firebase/r3-h9-atomic-incident-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.ui.enabled,false);
  assert.equal(config.emulators.singleProjectMode,true);
});
