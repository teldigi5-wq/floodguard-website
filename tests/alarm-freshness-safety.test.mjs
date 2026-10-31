import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileDisplayedAlarmState} from '../lib/telemetry-safety.mjs';

const state=(active,freshness)=>
  reconcileDisplayedAlarmState({active,freshness});

test('a live system heartbeat cannot verify individual alarm clearance',()=>{
  assert.equal(state(false,'live'),'INACTIVE REPORTED');
  assert.equal(state(true,'live'),'ACTIVE');
  assert.equal(reconcileDisplayedAlarmState({
    active:false,freshness:'live',verifiedClearance:true
  }),'CLEAR');
});

test('null, absent and malformed alarm values cannot be interpreted as CLEAR',()=>{
  for(const active of [null,undefined,0,1,'false','true','CLEAR',{},[],NaN]){
    assert.equal(state(active,'live'),'UNAVAILABLE');
  }
  assert.equal(reconcileDisplayedAlarmState({freshness:'live'}),'UNAVAILABLE');
  assert.equal(reconcileDisplayedAlarmState({}),'UNAVAILABLE');
});

test('stale or disconnected false never displays a current clearance',()=>{
  for(const freshness of ['stale','loading','unavailable',null,undefined,'unknown']){
    assert.equal(state(false,freshness),'UNAVAILABLE');
    assert.notEqual(state(false,freshness),'CLEAR');
  }
});

test('stale ACTIVE remains a historical warning, not a live assertion',()=>{
  assert.equal(state(true,'stale'),'LAST ACTIVE');
  for(const freshness of ['loading','unavailable',null,undefined]){
    assert.equal(state(true,freshness),'UNAVAILABLE');
  }
  assert.equal(state(null,'stale'),'UNAVAILABLE');
});

test('dashboard and shared quick metrics use same freshness-aware alarm policy',()=>{
  const quick=readFileSync('components/page-kit.tsx','utf8');
  const dashboard=readFileSync('app/dashboard/page.tsx','utf8');
  for(const source of [quick,dashboard]){
    assert.match(source,/reconcileDisplayedAlarmState\(\{active:data\?\.alarm\?\.active,freshness\}\)/);
    assert.doesNotMatch(source,/data\?\.alarm\?\.active\?"ACTIVE":"CLEAR"/);
    assert.doesNotMatch(source,/data\?\.alarm\?\.active===false\?"CLEAR"/);
  }
  assert.match(dashboard,/alarmGauge=alarmState==="ACTIVE"\?1:alarmState==="CLEAR"\?0:null/);
  assert.match(dashboard,/value=\{alarmGauge\}/);
  assert.match(dashboard,/display=\{alarmState\}/);
  assert.match(quick,/title="Alarm" value=\{alarmState\}/);
  assert.match(dashboard,/title="Alarm" value=\{alarmState\}/);
});

test('copied and downloaded observation preserve raw alarm flag and explicit freshness interpretation',()=>{
  const source=readFileSync('components/status-snapshot.tsx','utf8');
  assert.match(source,/displayState:reconcileDisplayedAlarmState\(\{active:data\?\.alarm\?\.active,freshness\}\)/);
  assert.match(source,/active:data\?\.alarm\?\.active\?\?null/);
  assert.match(source,/Alarm: \$\{s\.alarm\.displayState\}/);
  assert.match(source,/JSON\.stringify\(snapshot\(\),null,2\)/);
  assert.doesNotMatch(source,/s\.alarm\.active===false\?"CLEAR"/);
});

test('invalid or unreadable Firebase group updates remove cached group evidence',()=>{
  const provider=readFileSync('providers/flood-provider.tsx','utf8');
  const start=provider.indexOf('const publicSchemas = {');
  const end=provider.indexOf('// The ESP node contains potentially private network details.');
  const source=provider.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(source,/alarm: alarmSchema/);
  assert.match(provider,/active: z\.boolean\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(source,/if \(!parsed\.success && raw !== null\)/);
  assert.match(source,/setData\(\(previous\) => \{/);
  assert.match(source,/delete \(next as Record<string, unknown>\)\[key\]/);
  assert.equal(source.match(/delete \(next as Record<string, unknown>\)\[key\]/g)?.length,3,
    'malformed payload, absent group and permission error must all clear old evidence');
  assert.match(source,/updateCriticalStatus\(key, false\)/);
  assert.match(provider,/if \(key === "water" \|\| key === "system"\)/);
});

test('alarm interpretation remains a pure read-only transformation',()=>{
  const source=readFileSync('lib/telemetry-safety.mjs','utf8');
  assert.match(source,/export function reconcileDisplayedAlarmState/);
  assert.doesNotMatch(source,/firebase-admin|sendMessage\s*\(|gateCommand|node:https|node:http/);
});

test('CLEAR is impossible without explicitly verified alarm-source clearance',()=>{
  for(const active of [false,null,undefined,'false']){
    const result=reconcileDisplayedAlarmState({active,freshness:'live'});
    assert.notEqual(result,'CLEAR');
  }
  for(const freshness of ['stale','loading','unavailable',null]){
    assert.notEqual(reconcileDisplayedAlarmState({
      active:false,freshness,verifiedClearance:true
    }),'CLEAR','freshness must also be live');
  }
  const provider=readFileSync('providers/flood-provider.tsx','utf8');
  assert.doesNotMatch(provider,/verifiedClearance:\s*true/,
    'Unattested legacy Firebase listeners cannot create source proof');
  const dashboard=readFileSync('app/dashboard/page.tsx','utf8');
  assert.match(dashboard,/alarmState==="CLEAR"\?0:null/,
    'An unverified inactive report must not drive a zero alarm gauge');
});
