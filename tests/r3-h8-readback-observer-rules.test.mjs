// H8 exact H6-to-H8 Rules authorization delta — no network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const before=load('../docs/firebase/r3-h6-mandatory-publication-lab.rules.json');
const after=load('../docs/firebase/r3-h8-readback-observer-lab.rules.json');
const config=load('../firebase.r3-h8-readback-lab.json');
const old=before.rules.floodguard;
const root=after.rules.floodguard;

test('only scoped water read and private observer authorization were added',()=>{
  const clone=structuredClone(after);
  clone.rules.floodguard.publicationLab.water['.read']=
    old.publicationLab.water['.read'];
  delete clone.rules.floodguard.publicationObserverAuthorization;
  assert.deepEqual(clone,before);
});
test('observer read grant requires exact UID, custom claim, generation and enabled scope',()=>{
  const policy=root.publicationLab.water['.read'];
  for(const phrase of [
    "auth.uid === 'readback-observer-stage'",
    "auth.token.fg_readback_v1 === true",
    "auth.token.fg_readback_generation",
    "publicationObserverAuthorization/readback-observer-stage/generation",
    "publicationObserverAuthorization/readback-observer-stage/enabled",
    "publicationObserverAuthorization/readback-observer-stage/scope",
    "'publication-readback-v1'"
  ])assert.ok(policy.includes(phrase),phrase);
  assert.ok(policy.includes(old.publicationLab.water['.read']));
  assert.deepEqual(root.publicationObserverAuthorization,{
    '.read':false,'.write':false,
    'readback-observer-stage':{'.read':false,'.write':false}
  });
});
test('all prior client write denials and public/private leaf policy preserved',()=>{
  assert.equal(after.rules['.write'],false);
  assert.equal(root.live['.write'],false);
  assert.equal(root.publicationLab.water['.write'],false);
  assert.equal(root.publicationAdmission['device-stage-a']['.write'],false);
  assert.equal(root.publicationLab.water.current['.read'],true);
  assert.equal(root.live.esp8266.ip['.read'],false);
  assert.equal(root.live.esp8266.wifi['.read'],false);
});
test('H8 Emulator uses same verified demo H6 worker project and only local ports',()=>{
  assert.equal(config.database.rules,'docs/firebase/r3-h8-readback-observer-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.ui.enabled,false);
  assert.equal(config.emulators.singleProjectMode,true);
});
