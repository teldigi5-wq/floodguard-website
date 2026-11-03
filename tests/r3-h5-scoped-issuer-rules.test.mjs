// H5 source-only audit: the alternative published-candidate delta is exact.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const old=read('../docs/firebase/r3-h3-publisher-commit-fence-lab.rules.json');
const candidate=read('../docs/firebase/r3-h5-scoped-issuer-lab.rules.json');
const config=read('../firebase.r3-h5-scoped-issuer-lab.json');
const r=candidate.rules.floodguard;
const ticket=r.publicationAdmission['device-stage-a'];
const baseline=old.rules.floodguard;
test('exact H5 permissions delta: no other old Rules were changed',()=>{
  const restored=structuredClone(candidate);
  const f=restored.rules.floodguard;
  f.deviceAuthorization['$deviceId']['.read']=
    baseline.deviceAuthorization['$deviceId']['.read'];
  f.incidentQuarantine['$deviceId']['.read']=
    baseline.incidentQuarantine['$deviceId']['.read'];
  delete f.publisherLabAuthorization['publisher-water-stage'];
  f.publicationLab.water.checkpoint['.read']=
    baseline.publicationLab.water.checkpoint['.read'];
  delete f.admissionIssuerAuthorization;
  f.publicationAdmission['device-stage-a']=
    structuredClone(baseline.publicationAdmission['device-stage-a']);
  assert.deepEqual(restored,old);
});
test('issuer has explicit generation and role while all public live writes remain denied',()=>{
  const t=ticket['.write'];
  for(const term of [
    "auth.uid === 'admission-issuer-stage'",
    "auth.token.fg_issue_admission_v1 === true",
    "auth.token.fg_issuer_generation",
    "admissionIssuerAuthorization/admission-issuer-stage/generation",
    "incidentQuarantine/device-stage-a/blocked",
    "publisherLabAuthorization/publisher-water-stage/enabled",
    "deviceAuthorization/device-stage-a/enabled",
    "!data.exists()","newData.exists()","newData.child('sequence').val()",
    "newData.child('issuedAtMs').val() >= now - 2000",
    "newData.child('expiresAtMs').val() <= newData.child('issuedAtMs').val() + 4000"
  ])assert.ok(t.includes(term),term);
  assert.equal(candidate.rules['.write'],false);
  assert.equal(r.live['.write'],false);
  assert.equal(r.publicationLab['.write'],false);
  assert.equal(r.publicationLab.water['.write'],baseline.publicationLab.water['.write']);
  assert.equal(r.publicationAdmission['.write'],false);
});
test('issuer read grants are restricted to one device and no Admin SDK roles',()=>{
  assert.match(r.deviceAuthorization['$deviceId']['.read'],
    /\$deviceId === 'device-stage-a' && auth != null && auth.uid === 'admission-issuer-stage'/);
  assert.match(r.incidentQuarantine['$deviceId']['.read'],
    /\$deviceId === 'device-stage-a'/);
  assert.equal(r.publisherLabAuthorization['publisher-water-stage']['.write'],false);
  assert.equal(r.admissionIssuerAuthorization['.write'],false);
  assert.equal(r.admissionIssuerAuthorization['admission-issuer-stage']['.write'],false);
  assert.ok(Object.keys(r.publicationAdmission).includes('device-stage-a'));
  assert.equal(ticket['$other']['.validate'],false);
});
test('fixed localhost Auth + RTDB Emulator, no prod project',()=>{
  assert.equal(config.database.rules,
    'docs/firebase/r3-h5-scoped-issuer-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.singleProjectMode,true);
  assert.equal(config.emulators.ui.enabled,false);
});
test('child process cannot provision or send tokens or real gate commands',()=>{
  const s=readFileSync(new URL(
    '../experiments/r3-h5-scoped-issuer-worker.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/from 'firebase-admin|from 'node:https|from 'node:http/);
  assert.doesNotMatch(s,/\bcreateUser\s*\(|\bsetCustomUserClaims\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/\bservo\.write\s*\(|\bSerial\.write\s*\(/);
  assert.match(s,/fd:4/);
  assert.match(s,/releaseDecision:'NO_GO'/);
});
