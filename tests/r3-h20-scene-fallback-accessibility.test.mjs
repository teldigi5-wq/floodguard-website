import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeSceneAvailability} from '../lib/scene-availability.mjs';

function denied(x) {
  assert.equal(Object.isFrozen(x),true);
  assert.equal(x.physicalFloodSafety,'UNKNOWN · UNVERIFIED');
  assert.equal(x.physicalGateVerified,false);
  assert.equal(x.waterLevelVerified,false);
}
test('explicitly qualified values can drive only a labeled illustrative 3D model',()=>{
  const x=describeSceneAvailability({angle:0,waterDistance:23});
  denied(x);
  assert.equal(x.mode,'illustrative-3d');
  assert.equal(x.render3D,true);
  assert.equal(x.gateAngleDeg,0);
  assert.equal(x.waterDistanceCm,23);
  assert.match(x.gateLabel,/REPORTED 0° · UNVERIFIED/);
  assert.match(x.waterLabel,/REPORTED 23\.0 cm air gap · UNVERIFIED/);
});
test('missing or invalid gate cannot be silently converted to a CLOSED 0° pose',()=>{
  for(const angle of [undefined,null,-1,91,5.4,'0','90',Infinity,NaN,{},[]]) {
    const x=describeSceneAvailability({angle,waterDistance:23});
    denied(x);
    assert.equal(x.mode,'unavailable');
    assert.equal(x.render3D,false);
    assert.equal(x.gateAngleDeg,null);
    assert.equal(x.gateLabel,'POSITION UNKNOWN · SOURCE UNVERIFIED');
  }
  const x=describeSceneAvailability();
  denied(x);
  assert.equal(x.render3D,false);
  assert.equal(x.gateAngleDeg,null);
  assert.equal(x.waterDistanceCm,null);
});
test('missing and implausible water inputs prevent fake visual level or release',()=>{
  for(const waterDistance of [undefined,null,-1,25.01,Infinity,NaN,'23',{},[]]) {
    const x=describeSceneAvailability({angle:90,waterDistance});
    denied(x);
    assert.equal(x.render3D,false);
    assert.equal(x.waterDistanceCm,null);
    assert.equal(x.waterLabel,'WATER READING UNKNOWN · SOURCE UNVERIFIED');
  }
  assert.equal(describeSceneAvailability({angle:90,waterDistance:25}).render3D,true);
  assert.equal(describeSceneAvailability({angle:90,waterDistance:0}).render3D,true);
});
test('reduced-motion preference disables Canvas even with present inputs',()=>{
  const x=describeSceneAvailability({angle:45,waterDistance:8,reducedMotion:true});
  denied(x);
  assert.equal(x.mode,'reduced-motion');
  assert.equal(x.render3D,false);
  assert.match(x.gateLabel,/REPORTED 45° · UNVERIFIED/);
  assert.match(x.waterLabel,/UNVERIFIED/);
});
test('actual scene has no raw Firebase input fallback and no 3D for unknown state',()=>{
  const scene=readFileSync('components/dam-scene.tsx','utf8');
  const home=readFileSync('app/page.tsx','utf8');
  assert.match(home,/DamScene angle=\{monitor\.gateAngleDeg\} waterDistance=\{monitor\.waterDistanceCm\}/);
  assert.match(scene,/describeSceneAvailability\(\{angle,waterDistance,reducedMotion\}\)/);
  assert.match(scene,/if\(!availability\.render3D\) return <section/);
  assert.match(scene,/3D visualization withheld/);
  assert.match(scene,/Unknown is not closed/);
  assert.match(scene,/className="scene scene-static-assurance"/);
  assert.doesNotMatch(scene,/useLive|waterDistance===undefined\?data|angle=0,rain=0/);
  assert.match(scene,/fallback=\{<div className="scene-webgl-unavailable"/);
});
test('actual scene does not force continuous animation under reduced motion',()=>{
  const scene=readFileSync('components/dam-scene.tsx','utf8');
  assert.match(scene,/window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(scene,/query\.addEventListener\("change",onChange\)/);
  assert.match(scene,/query\.removeEventListener\("change",onChange\)/);
  assert.match(scene,/if\(!availability\.render3D\)\{setAnimate\(false\);return;\}/);
  assert.match(scene,/!tour\|\|reducedMotion\|\|!availability\.render3D/);
});
test('green SAFE low band does not reappear in the scene meter or section',()=>{
  const scene=readFileSync('components/dam-scene.tsx','utf8');
  assert.match(scene,/scene-water-level \$\{waterState==="safe"\?"unavailable":waterState\}/);
  assert.match(scene,/waterState==="safe"\?"LOW · UNVERIFIED"/);
  assert.doesNotMatch(scene,/\{waterState\.toUpperCase\(\)\}<\/b><\/header>/);
});
test('helper cannot read network, env, filesystem or mutate device and alerts',()=>{
  const src=readFileSync('lib/scene-availability.mjs','utf8');
  for(const token of ['firebase/database','firebase-admin','fetch(','WebSocket(',
    'sendMessage(','servo.write','digitalWrite(','process.env','writeFileSync('])
    assert.equal(src.includes(token),false,token);
});
