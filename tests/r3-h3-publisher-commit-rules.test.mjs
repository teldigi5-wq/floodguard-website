// Source-only delta attestation: this H3 test candidate may grant only one
// narrowly scoped publisher path, never change deployed Rules or H2 behavior.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const before=load('../docs/firebase/r3-h2-incident-quarantine-lab.rules.json');
const after=load('../docs/firebase/r3-h3-publisher-commit-fence-lab.rules.json');
const config=load('../firebase.r3-h3-publisher-commit-lab.json');
const p=after.rules.floodguard.publicationLab.water;
const expression=p['.write'];
const deniedGroup=after.rules.floodguard.publicationAdmission;

test('only the exact publicationLab/water write fence and private admission row differ',()=>{
  const cloned=structuredClone(after);
  cloned.rules.floodguard.publicationLab.water['.write']=false;
  delete cloned.rules.floodguard.publicationAdmission;
  assert.deepEqual(cloned,before);
  assert.equal(typeof before.rules.floodguard.publicationLab.water['.write'],'boolean');
  assert.equal(before.rules.floodguard.publicationLab.water['.write'],false);
});
test('publisher token requires active independent ticket, incident clearance and device authorization',()=>{
  for(const term of [
    "auth.uid === 'publisher-water-stage'",
    "auth.token.fg_publish_water_v1 === true",
    "publisherLabAuthorization/publisher-water-stage/enabled",
    "publisherLabAuthorization/publisher-water-stage/scope",
    "publisherLabAuthorization/publisher-water-stage/deviceId",
    "deviceAuthorization/device-stage-a/enabled",
    "incidentQuarantine/device-stage-a/blocked",
    "publicationAdmission/device-stage-a",
    "child('issuedAtMs').val() <= now",
    "child('expiresAtMs').val() >= now",
    "child('sequence').val()",
    "newData.child('checkpoint/sequence').val()",
    "newData.child('current/distanceCm').val()",
    "newData.child('current/status').val()",
    "newData.child('current/overallRisk').val() === 'UNKNOWN'",
  ])assert.ok(expression.includes(term),term);
});
test('admission is client-private and public root, physical control, old live writes stay denied',()=>{
  assert.deepEqual(deniedGroup,{
    '.read':false,'.write':false,
    'device-stage-a':{'.read':false,'.write':false}
  });
  assert.equal(after.rules['.read'],false);
  assert.equal(after.rules['.write'],false);
  assert.equal(after.rules.floodguard.live['.write'],false);
  assert.equal(after.rules.floodguard.live.gate['.write'],undefined);
  assert.equal(after.rules.floodguard.publicationLab['.write'],false);
});
test('emulators use loopback only; never a production project or Rules file',()=>{
  assert.equal(config.database.rules,
    'docs/firebase/r3-h3-publisher-commit-fence-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.singleProjectMode,true);
  assert.equal(config.emulators.ui.enabled,false);
});
