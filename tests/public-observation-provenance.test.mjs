import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describePublicObservation} from '../lib/public-observation-trust.mjs';
import {reconcileDisplayedAlarmState} from '../lib/telemetry-safety.mjs';

const files = {
  badge:readFileSync('components/ui.tsx','utf8'),
  panel:readFileSync('components/page-kit.tsx','utf8'),
  dashboard:readFileSync('app/dashboard/page.tsx','utf8'),
  shell:readFileSync('components/site-chrome.tsx','utf8'),
  motion:readFileSync('components/advanced-motion.tsx','utf8'),
  css:readFileSync('app/globals.css','utf8'),
  provider:readFileSync('providers/flood-provider.tsx','utf8')
};

test('recent database timestamp never confers physical verification or safety authority',()=>{
  const x=describePublicObservation('live');
  assert.equal(x.observationRecentlyUpdated,true);
  assert.equal(x.authenticatedFieldSource,false);
  assert.equal(x.physicalConditionsVerified,false);
  assert.match(x.label,/unverified/i);
  assert.match(x.summary,/Sensor identity/);
  assert.equal(Object.isFrozen(x),true);
  for(const prop of ['canDeclareSafe','canOperateGate','canSendAlert'])
    assert.equal(x[prop],false,prop);
});
test('stale, unavailable, loading and invalid categories cannot imply sensor safety',()=>{
  for(const state of ['stale','unavailable','loading',null,undefined,'unexpected']) {
    const x=describePublicObservation(state);
    assert.equal(x.observationRecentlyUpdated,false);
    assert.equal(x.authenticatedFieldSource,false);
    assert.equal(x.physicalConditionsVerified,false);
    assert.equal(x.canDeclareSafe,false);
    assert.equal(x.canOperateGate,false);
    assert.equal(x.canSendAlert,false);
    assert.equal(Object.isFrozen(x),true);
  }
});
test('public live badge and shared status panel disclose source unverified',()=>{
  assert.match(files.badge,/describePublicObservation\(freshness\)\.label/);
  assert.doesNotMatch(files.badge,/freshness==="live"\?"Live"/);
  assert.match(files.panel,/if\(freshness==="live"\)\{const disclosure=describePublicObservation\(freshness\)/);
  assert.match(files.panel,/role="status"/);
  assert.match(files.panel,/sensor authenticity unverified/i);
});
test('command dashboard never calls timestamp-only RTDB connection synchronized hardware',()=>{
  assert.match(files.dashboard,/describePublicObservation\(freshness\)\.label/);
  assert.match(files.dashboard,/Reported risk only; field source unverified/);
  assert.doesNotMatch(files.dashboard,/Field network synchronized/);
  assert.match(files.shell,/Recent database record · unverified/);
  assert.doesNotMatch(files.shell,/Monitoring Live|Fresh field update|Emergency alarm/);
  assert.match(files.css,/\.live-badge\.live\{color:var\(--amber\)\}/);
});
test('animated network panel does not report CLEAR from missing alarm',()=>{
  assert.match(files.motion,/reconcileDisplayedAlarmState\(\{active:data\?\.alarm\?\.active,freshness\}\)/);
  assert.match(files.motion,/RECENT · UNVERIFIED/);
  assert.doesNotMatch(files.motion,/data\?\.alarm\?\.active\?"ACTIVE":"CLEAR"/);
  for(const state of ['live','stale','loading','unavailable']) {
    const result=reconcileDisplayedAlarmState({active:undefined,freshness:state});
    assert.equal(result,'UNAVAILABLE');
  }
  assert.equal(reconcileDisplayedAlarmState({active:false,freshness:'live'}),'CLEAR');
  assert.equal(reconcileDisplayedAlarmState({active:false,freshness:'stale'}),'UNAVAILABLE');
  assert.equal(reconcileDisplayedAlarmState({active:true,freshness:'stale'}),'LAST ACTIVE');
});
test('this UI preview does not modify authorization, publish to Firebase or run device controls',()=>{
  assert.match(files.provider,/onValue\(/);
  assert.match(files.provider,/reconcileDisplayedFloodRisk\(/);
  const policySource=readFileSync('lib/public-observation-trust.mjs','utf8');
  for(const unsafe of ['firebase/database','set(','update(','remove(','servo.write','digitalWrite','createExclusiveLocal','fetch('])
    assert.equal(policySource.includes(unsafe),false,unsafe);
  assert.equal(policySource.includes('authenticatedFieldSource: true'),false);
});
