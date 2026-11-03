// Exact H5-to-H6 alternative Rules delta, no live Firebase access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const old=read('../docs/firebase/r3-h5-scoped-issuer-lab.rules.json');
const now=read('../docs/firebase/r3-h6-mandatory-publication-lab.rules.json');
const config=read('../firebase.r3-h6-mandatory-publication-lab.json');
const root=now.rules.floodguard;
test('only the two client write grants become false; no other Rules differ',()=>{
  const previous=structuredClone(now);
  previous.rules.floodguard.publicationAdmission['device-stage-a']['.write']=
    old.rules.floodguard.publicationAdmission['device-stage-a']['.write'];
  previous.rules.floodguard.publicationLab.water['.write']=
    old.rules.floodguard.publicationLab.water['.write'];
  assert.equal(typeof old.rules.floodguard.publicationAdmission['device-stage-a']['.write'],'string');
  assert.equal(typeof old.rules.floodguard.publicationLab.water['.write'],'string');
  assert.deepEqual(previous,old);
});
test('all client ticket, water, root and live writes stay denied',()=>{
  assert.equal(root.publicationAdmission['device-stage-a']['.write'],false);
  assert.equal(root.publicationLab.water['.write'],false);
  assert.equal(root.publicationLab['.write'],false);
  assert.equal(root.live['.write'],false);
  assert.equal(now.rules['.write'],false);
  assert.equal(root.incidentQuarantine['.write'],false);
  assert.equal(root.admissionIssuerAuthorization['.write'],false);
  assert.equal(root.live.gate['.write'],undefined);
});
test('client private network reads and admission secrecy remain as before',()=>{
  assert.equal(root.publicationAdmission['device-stage-a']['.read'],
    old.rules.floodguard.publicationAdmission['device-stage-a']['.read']);
  assert.equal(root.live.esp8266.ip['.read'],undefined);
  assert.equal(root.live.esp8266.wifi['.read'],undefined);
  assert.equal(root.live['.read'],false);
  assert.equal(root.live.esp8266['.read'],false);
});
test('H6 worker only uses known demo-only loopback endpoint and CAS, not Admin SDK',()=>{
  const s=readFileSync(new URL(
    '../experiments/r3-h6-mandatory-publication-worker.mjs',import.meta.url),'utf8');
  assert.match(s,/const PROJECT='demo-r3-h6-publication'/);
  assert.match(s,/const BASE='http:\/\/127\.0\.0\.1:9000'/);
  assert.match(s,/headers\['if-match'\]=etag/);
  assert.match(s,/createH4OfflineAdmissionIssuer/);
  assert.match(s,/releaseDecision:'NO_GO'/);
  assert.doesNotMatch(s,/from 'firebase-admin|\.listen\s*\(|\bservo\.write\s*\(/);
  assert.doesNotMatch(s,/process\.env\.(?:FIREBASE_CONFIG|GOOGLE_APPLICATION_CREDENTIALS)/);
  assert.doesNotMatch(s,/\bwriteFileSync\s*\(|\bchild_process\b/);
});
test('no alternate target or production project can be configured in H6 lab',()=>{
  assert.equal(config.database.rules,
    'docs/firebase/r3-h6-mandatory-publication-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.ui.enabled,false);
  assert.equal(config.emulators.singleProjectMode,true);
});
