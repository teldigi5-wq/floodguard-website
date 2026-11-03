// Structural audit of the unpublished H2 candidate. No network or devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const initial=JSON.parse(readFileSync(new URL(
  '../docs/firebase/r3-service-session-fence-lab.rules.json',import.meta.url),'utf8'));
const candidate=JSON.parse(readFileSync(new URL(
  '../docs/firebase/r3-h2-incident-quarantine-lab.rules.json',import.meta.url),'utf8'));
const config=JSON.parse(readFileSync(new URL(
  '../firebase.r3-h2-incident-quarantine-lab.json',import.meta.url),'utf8'));
const original=initial.rules.floodguard;
const newRoot=candidate.rules.floodguard;
const locations=[
  ['deviceAuthorization','$deviceId'],
  ['staging','ingestV1','$deviceId'],
  ['attestorLabAuthorization','attestor-stage'],
  ['confirmedLab','records','$deviceId','$sequence'],
];
const word="auth.token.fg_attest_ingest_v1 === true";
const fixed="root.child('floodguard/incidentQuarantine/device-stage-a/blocked').val() === false";
const dynamic="root.child('floodguard/incidentQuarantine').child($deviceId).child('blocked').val() === false";
const get=(r,parts)=>parts.reduce((o,k)=>o?.[k],r);

test('exactly four existing attestor reads gain a fail-closed incident condition',()=>{
  for(const location of locations){
    const oldExpr=get(original,location)?.['.read'];
    const next=get(newRoot,location)?.['.read'];
    assert.equal(typeof oldExpr,'string');
    assert.equal(oldExpr.split(word).length,2,location.join('/'));
    const condition=location[0]==='attestorLabAuthorization'?fixed:dynamic;
    assert.equal(next,oldExpr.replace(word,word+' && '+condition),location.join('/'));
    assert.match(next,/\.val\(\) === false/);
  }
});

test('all other Rules are exactly unchanged from the earlier emulator-only candidate',()=>{
  const copied=structuredClone(candidate);
  delete copied.rules.floodguard.incidentQuarantine;
  for(const where of locations)get(copied.rules.floodguard,where)['.read']=
    get(original,where)['.read'];
  assert.deepEqual(copied,initial);
});

test('quarantine subtree is private and cannot be written by any Firebase client role',()=>{
  const q=newRoot.incidentQuarantine;
  assert.deepEqual(q,{
    '.read':false,'.write':false,
    '$deviceId':{
      '.read':false,'.write':false,
      blocked:{'.validate':'newData.isBoolean()'},
    }
  });
  assert.equal(candidate.rules['.read'],false);
  assert.equal(candidate.rules['.write'],false);
  assert.equal(newRoot.live['.write'],false);
});

test('lab is pinned to Auth+RTDB loopback emulator with disposable demo project',()=>{
  assert.equal(config.database.rules,'docs/firebase/r3-h2-incident-quarantine-lab.rules.json');
  assert.deepEqual(config.emulators.auth,{host:'127.0.0.1',port:9099});
  assert.deepEqual(config.emulators.database,{host:'127.0.0.1',port:9000});
  assert.equal(config.emulators.singleProjectMode,true);
  assert.equal(config.emulators.ui.enabled,false);
});
