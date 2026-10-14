import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessStage16ProposedUi} from '../experiments/stage16-uncertainty-policy.mjs';
import {compareStage14SyntheticClients} from '../experiments/stage14-cross-client-models.mjs';

const fixture=JSON.parse(fs.readFileSync('docs/firebase/stage14-cross-client-fixtures.json','utf8'));
const decision=JSON.parse(fs.readFileSync('docs/firebase/STAGE16_UNCERTAINTY_GATES.json','utf8'));
const now=fixture.timeReferenceMs;
const scenario=id=>{
  const found=fixture.scenarios.find(s=>s.id===id);
  assert.ok(found,'Missing fixture '+id);return found;
};
const outcome=id=>{
  const item=scenario(id);
  return assessStage16ProposedUi({snapshot:item.snapshot,nowMs:now,connected:item.connected!==false});
};
const sample=(patch={})=>{
  const template=structuredClone(scenario('concordant-safe').snapshot);
  return {...template,...patch};
};
test('Stage 16 is review-only and does not modify the 12 Stage 14 fixtures',()=>{
  assert.equal(fixture.scenarios.length,12);
  assert.equal(decision.releaseDecision,'NO_GO_REVIEW_ONLY');
  assert.equal(decision.runtimeChangesAuthorized,false);
  assert.equal(decision.liveProductionAccessVerified,false);
  assert.equal(decision.physicalFieldEvidenceVerified,false);
  assert.equal(decision.mobileRepositoryVisibility,'PRIVATE');
});
test('consistent SAFE, WARNING and DANGER show only reported/unverified labels',()=>{
  for(const [id,label] of [
    ['concordant-safe','SAFE_REPORTED_ONLY'],
    ['concordant-warning-edge','WARNING_REPORTED_ONLY'],
    ['concordant-danger-edge','DANGER_REPORTED_ONLY']
  ]){
    const result=outcome(id);
    assert.equal(result.waterDisplay,label,id);
    assert.equal(result.freshnessDisplay,'RECENT_FIELD_TIMESTAMP_ONLY');
    assert.equal(result.deviceIdentityVerified,false);
    assert.equal(result.decision,'NO_GO');
  }
});
test('zero air gap never becomes SAFE or confirmed DANGER without a device contract',()=>{
  const result=outcome('zero-distance-diverges');
  assert.equal(result.waterDisplay,'UNVERIFIED_WATER');
  assert.equal(result.riskDisplay,'REVIEW_REQUIRED');
  assert.ok(result.reviewReasons.includes('ZERO_GAP_PHYSICAL_MEANING_UNVERIFIED'));
  assert.equal(result.canActuate,false);
});
test('conflicting gate angle and reported status cannot claim OPEN or CLOSED',()=>{
  for(const id of ['gate-raw-open-but-zero-angle','gate-middle-angle-raw-closed']){
    const x=outcome(id);
    assert.equal(x.gateDisplay,'POSITION_CONFLICT');
    assert.ok(x.reviewReasons.includes('GATE_STATUS_ANGLE_COUNTDOWN_CONFLICT'));
    assert.equal(x.physicalGatePositionVerified,false);
  }
});
test('an agreed positive gate observation is still only a reported state',()=>{
  const x=assessStage16ProposedUi({snapshot:sample({
    gate:{status:'OPEN',angle:90,countdownSeconds:0}
  }),nowMs:now});
  assert.equal(x.gateDisplay,'OPEN_REPORTED_ONLY');
  assert.equal(x.canActuate,false);
});
test('countdown reported while an almost closed gate remains an unverified observation',()=>{
  const x=assessStage16ProposedUi({snapshot:sample({
    gate:{status:'COUNTDOWN',angle:0,countdownSeconds:5}
  }),nowMs:now});
  assert.equal(x.gateDisplay,'COUNTDOWN_REPORTED_ONLY');
  assert.equal(x.realAlertDeliveryVerified,false);
  assert.equal(x.canSendAlerts,false);
});
test('CRITICAL rain with backend LOW becomes a review-required conflict',()=>{
  const x=outcome('reported-risk-conflicts-derived-rain-critical');
  assert.equal(x.riskDisplay,'REVIEW_REQUIRED');
  assert.ok(x.reviewReasons.includes('BACKEND_RISK_CONFLICT_OR_UNKNOWN'));
});
test('unknown water and rain cannot silently downgrade overall risk to LOW',()=>{
  const x=outcome('sensor-unavailable-fallback-low-risk');
  assert.equal(x.waterDisplay,'UNAVAILABLE');
  assert.equal(x.riskDisplay,'REVIEW_REQUIRED');
  assert.ok(x.reviewReasons.includes('WATER_MEASUREMENT_MISSING_OR_INVALID'));
});
test('legacy ONLINE rain category is held pending evidence of actual firmware variant',()=>{
  const x=outcome('legacy-online-rain-category');
  assert.equal(x.riskDisplay,'REVIEW_REQUIRED');
  assert.ok(x.reviewReasons.includes('LEGACY_ONLINE_RAIN_CATEGORY_UNVERIFIED'));
});
test('old field timestamp and offline Firebase link never claim live sensor connectivity',()=>{
  const twenty=outcome('stale-20s-on-connected-database');
  assert.equal(twenty.freshnessDisplay,'STALE_UNDER_AT_LEAST_ONE_EXISTING_CLIENT_WINDOW');
  assert.deepEqual(twenty.comparativeCurrentWindows,
    {website:'stale',bot:'stale',mobile:'within-window'});
  const offline=outcome('fresh-field-clock-but-disconnected');
  assert.equal(offline.freshnessDisplay,'DISCONNECTED_LAST_REPORTED_ONLY');
  assert.equal(offline.deviceIdentityVerified,false);
});
test('future source clock is flagged and never replaced by local reconnect time',()=>{
  const x=outcome('future-field-clock');
  assert.equal(x.freshnessDisplay,'INVALID_OR_MISSING_FIELD_TIMESTAMP');
  assert.equal(x.timestampAgeSeconds,null);
});
test('numeric strings, missing readings and out-of-range measurements cannot generate SAFE',()=>{
  for(const water of [
    {distanceCm:'20',levelCm:5,status:'SAFE'},
    {distanceCm:-1,levelCm:5,status:'SAFE'},
    {distanceCm:401,levelCm:5,status:'SAFE'},
    {distanceCm:20,status:'SENSOR_ERROR'},
    {distanceCm:20,levelCm:14,status:'SAFE'},
    {distanceCm:20,levelCm:5,status:'DANGER'},
    {distanceCm:20,levelCm:NaN,status:'SAFE'}
  ]){
    const x=assessStage16ProposedUi({snapshot:sample({water}),nowMs:now});
    // An invalid optional numeric field must not be taken as valid; if
    // the trusted distance/status agree, the optional field can be absent.
    if(water.distanceCm===20&&Number.isNaN(water.levelCm)){
      assert.equal(x.waterDisplay,'SAFE_REPORTED_ONLY');
    }else{
      assert.notEqual(x.waterDisplay,'SAFE_REPORTED_ONLY',JSON.stringify(water));
    }
  }
});
test('a valid 20 cm distance with missing level remains reported only, not field verified',()=>{
  const x=assessStage16ProposedUi({snapshot:sample({
    water:{distanceCm:20,status:'SAFE'}
  }),nowMs:now});
  assert.equal(x.waterDisplay,'SAFE_REPORTED_ONLY');
  assert.equal(x.deviceIdentityVerified,false);
});
test('one conflicting measurement never silently overrides another partial PATCH',()=>{
  const x=assessStage16ProposedUi({snapshot:sample({
    water:{distanceCm:20,levelCm:11,status:'SAFE'}
  }),nowMs:now});
  assert.equal(x.waterDisplay,'UNVERIFIED_WATER');
  assert.ok(x.reviewReasons.includes('WATER_DISTANCE_AND_LEVEL_CONFLICT'));
});
test('zero-distance ambiguity is detected across different reported statuses',()=>{
  for(const status of ['SAFE','WARNING','DANGER','UNKNOWN']){
    for(const level of [0,5,11,25]){
      const x=assessStage16ProposedUi({snapshot:sample({
        water:{distanceCm:0,levelCm:level,status}
      }),nowMs:now});
      assert.equal(x.waterDisplay,'UNVERIFIED_WATER');
      assert.equal(x.riskDisplay,'REVIEW_REQUIRED');
    }
  }
});
test('all Stage 14 review scenarios remain blocked from deployment or alerting',()=>{
  for(const item of fixture.scenarios){
    const x=assessStage16ProposedUi({
      snapshot:item.snapshot,connected:item.connected!==false,nowMs:now
    });
    assert.equal(x.decision,'NO_GO',item.id);
    assert.equal(x.canActuate,false,item.id);
    assert.equal(x.canSendAlerts,false,item.id);
    assert.equal(x.canDeploy,false,item.id);
    assert.equal(x.realAlertDeliveryVerified,false,item.id);
    assert.ok(x.reviewReasons.includes('AUTHENTICATED_FIELD_SOURCE_UNVERIFIED'),item.id);
    assert.doesNotMatch(x.freshnessDisplay,/^LIVE$|^CONNECTED_AND_SAFE$/);
  }
});
test('proposed reviewer detects existing cross-client disagreements without altering source',()=>{
  for(const id of ['zero-distance-diverges','gate-raw-open-but-zero-angle',
    'reported-risk-conflicts-derived-rain-critical']){
    const item=scenario(id);
    const old=compareStage14SyntheticClients({state:item.snapshot,nowMs:now,connected:true});
    const proposed=outcome(id);
    assert.ok(old.differentFields.length>0);
    assert.ok(proposed.reviewReasons.length>1);
  }
});
test('public projection never emits SSID, private IP, credential or unknown raw fields',()=>{
  const s=sample({
    esp8266:{ip:'192.0.2.9',wifi:'FAKE_PRIVATE_TEST_SSID',password:'FAKE_SECRET'},
    water:{distanceCm:0,status:'SAFE',hidden:'FAKE_PRIVATE_WATER_METADATA'}
  });
  const before=structuredClone(s);
  const x=assessStage16ProposedUi({snapshot:s,nowMs:now});
  const display=JSON.stringify(x);
  assert.deepEqual(s,before,'pure reviewer may not mutate snapshot');
  assert.doesNotMatch(display,/192\.0\.2|FAKE_PRIVATE|password|hidden/);
});
test('no proposed review result ever proves real-world safety even for all-good inputs',()=>{
  const x=outcome('concordant-safe');
  assert.equal(x.kind,'STAGE16_PROPOSED_DISPLAY_ONLY_NOT_A_RUNTIME_PATCH');
  assert.equal(x.nextAction,'SEEK_SUPERVISED_FIELD_EVIDENCE_AND_SECURITY_APPROVAL');
  assert.equal(x.realAlertDeliveryVerified,false);
  assert.equal(x.physicalGatePositionVerified,false);
});
test('invalid input is rejected rather than inventing a healthy system',()=>{
  assert.throws(()=>assessStage16ProposedUi({snapshot:null,nowMs:now}),TypeError);
  assert.throws(()=>assessStage16ProposedUi({snapshot:{},nowMs:undefined}),TypeError);
  assert.throws(()=>assessStage16ProposedUi({snapshot:[],nowMs:now}),TypeError);
});
test('experiment cannot import live Firebase, WhatsApp or hardware interfaces',()=>{
  const source=fs.readFileSync('experiments/stage16-uncertainty-policy.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:http|node:https|node:net|node:tls/);
  assert.doesNotMatch(source,/setInsecure\s*\(|servo\.write\s*\(/);
});
