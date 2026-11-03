// H10: exact unpublished H9 -> H10 canonical authorization delta.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const base=load('../docs/firebase/r3-h9-atomic-incident-lab.rules.json');
const candidate=load('../docs/firebase/r3-h10-canonical-authority-lab.rules.json');
const cfg=load('../firebase.r3-h10-canonical-authority-lab.json');
const c=candidate.rules.floodguard.atomicPublicationLab['device-stage-a'].control;
test('only three canonical authorizers and their control child validators differ',()=>{
  const restored=structuredClone(candidate);
  const old=base.rules.floodguard.atomicPublicationLab['device-stage-a'].control;
  const ctrl=restored.rules.floodguard.atomicPublicationLab['device-stage-a'].control;
  ctrl['.validate']=old['.validate'];
  delete ctrl.device;
  delete ctrl.publisher;
  delete ctrl.issuer;
  assert.deepEqual(restored,base);
});
test('canonical controls enforce explicit enablement, pinned scopes and deny unexpected fields',()=>{
  assert.ok(c['.validate'].includes("'device','publisher','issuer'"));
  for(const role of ['device','publisher','issuer']){
    assert.equal(c[role].enabled['.validate'],'newData.isBoolean()');
    assert.equal(c[role]['$other']['.validate'],false);
  }
  assert.ok(c.device.scope['.validate'].includes('prototype-ingest-v1'));
  assert.ok(c.publisher.scope['.validate'].includes('publication-lab-water-v1'));
  assert.ok(c.issuer.scope['.validate'].includes('lab-signed-admission-v1'));
  assert.ok(c.issuer.generation['.validate'].includes('newData.val() % 1 === 0'));
  assert.equal(c['$other']['.validate'],false);
});
test('external read/write Rules unchanged including anonymous privacy and no client publication',()=>{
  const f=candidate.rules.floodguard;
  assert.equal(candidate.rules['.write'],false);
  assert.equal(f.live['.write'],false);
  assert.equal(f.live.esp8266.ip['.read'],false);
  assert.equal(f.live.esp8266.wifi['.read'],false);
  assert.equal(f.publicationLab.water['.write'],false);
  assert.equal(f.publicationAdmission['device-stage-a']['.write'],false);
  assert.equal(f.atomicPublicationLab['.write'],false);
  assert.equal(f.atomicPublicationLab['device-stage-a']['.write'],false);
  assert.equal(f.atomicPublicationLab['device-stage-a'].current['.read'],false);
});
test('H10 worker uses ONLY canonical node for authorization and CAS in pinned demo project',()=>{
  const s=readFileSync(new URL(
    '../experiments/r3-h10-canonical-authority-worker.mjs',import.meta.url),'utf8');
  assert.match(s,/PROJECT='demo-r3-h10-canonical'/);
  assert.match(s,/FG_R3_H10_TEST/);
  assert.match(s,/createH4OfflineAdmissionIssuer/);
  assert.match(s,/headers\['if-match'\]=etag/);
  assert.match(s,/const PATH=Object.freeze\(\{node:ROOT\+'\/atomicPublicationLab\/'\+DEVICE\}\)/);
  assert.doesNotMatch(s,/PATH\.publisher|PATH\.issuer|PATH\.device/);
  assert.doesNotMatch(s,/from 'firebase-admin|\.listen\s*\(|\bservo\.write\s*\(/);
  assert.match(s,/releaseDecision:'NO_GO'/);
});
test('config pins local Auth and RTDB and keeps original H9 candidate unmodified',()=>{
  assert.equal(cfg.database.rules,'docs/firebase/r3-h10-canonical-authority-lab.rules.json');
  assert.deepEqual(cfg.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(cfg.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(cfg.emulators.singleProjectMode,true);
  assert.equal(cfg.emulators.ui.enabled,false);
});
