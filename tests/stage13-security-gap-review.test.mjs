import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewStage13SyntheticAuthMigration,compareStage13SyntheticFreshness,
  reviewStage13SyntheticRollout,STAGE13_WINDOWS}
  from '../experiments/stage13-security-gap-review.mjs';
import {readLocalStage11} from '../scripts/stage11-release-audit.mjs';
const gates=JSON.parse(fs.readFileSync('docs/firebase/STAGE13_DECISION_GATES.json','utf8'));
const phaseA=JSON.parse(fs.readFileSync('docs/firebase/phase-a-privacy-candidate.rules.json','utf8'));
const phaseB=JSON.parse(fs.readFileSync('docs/firebase/phase-b-authenticated-prototype.rules.json','utf8'));
const now=Date.UTC(2026,9,14,10,0,0);
const fullSynthetic={
  route:'direct-firebase-device-identity',
  deviceIdentityBound:true,peerCertificateVerified:true,
  credentialRenewalReviewed:true,revocationReviewed:true,
  replayAfterRebootReviewed:true,offlineRetryReviewed:true,
  privateFieldIsolationReviewed:true,
  currentFlashedDeviceCompatibilityVerified:true,
  fieldTestsWithExplicitOwnerConsent:true
};
test('legacy anonymous whole-tree PUT and slash-key PATCH cannot be called authenticated',()=>{
  for(const legacyTransport of ['legacy-anonymous-parent-put','legacy-anonymous-root-patch']){
    const result=reviewStage13SyntheticAuthMigration({...fullSynthetic,legacyTransport});
    assert.equal(result.releaseDecision,'NO_GO');
    assert.equal(result.canWriteProduction,false);
    assert.ok(result.blockers.includes('LEGACY_ANONYMOUS_PARENT_WRITE_CANNOT_BE_TRUSTED'));
  }
  assert.equal(reviewStage13SyntheticAuthMigration({
    ...fullSynthetic,legacyParentWritesRetained:true
  }).canReflashHardware,false);
});
test('missing TLS, identity, renewal, revocation and reboot-proof fields are explicit blockers',()=>{
  const r=reviewStage13SyntheticAuthMigration({route:'direct-firebase-device-identity'});
  for(const item of ['UNPROVEN_deviceIdentityBound','UNPROVEN_peerCertificateVerified',
    'UNPROVEN_credentialRenewalReviewed','UNPROVEN_revocationReviewed',
    'UNPROVEN_replayAfterRebootReviewed','UNPROVEN_offlineRetryReviewed']){
    assert.ok(r.blockers.includes(item),item);
  }
  assert.equal(r.fieldHardwareTested,false);
  assert.equal(r.realProductionAuthVerified,false);
});
test('gateway has separate Admin SDK bypass, identity, hosting and durability reviews',()=>{
  const r=reviewStage13SyntheticAuthMigration({
    route:'trusted-local-ingestion-gateway',
    ...Object.fromEntries(Object.keys(fullSynthetic).filter(k=>k!=='route')
      .map(k=>[k,fullSynthetic[k]]))
  });
  for(const item of ['UNPROVEN_GATEWAY_independentGatewayAuthorizationReviewed',
    'UNPROVEN_GATEWAY_adminSdkBypassRiskReviewed',
    'UNPROVEN_GATEWAY_rateAndPayloadLimitsReviewed',
    'UNPROVEN_GATEWAY_idempotentDownstreamReviewed',
    'UNPROVEN_GATEWAY_auditedGatewayHostingReviewed']){
    assert.ok(r.blockers.includes(item),item);
  }
});
test('even all synthetic PASS flags cannot grant production rule change or hardware control',()=>{
  const gateway=reviewStage13SyntheticAuthMigration({...fullSynthetic,
    route:'trusted-local-ingestion-gateway',
    independentGatewayAuthorizationReviewed:true,adminSdkBypassRiskReviewed:true,
    rateAndPayloadLimitsReviewed:true,idempotentDownstreamReviewed:true,
    auditedGatewayHostingReviewed:true});
  assert.equal(gateway.releaseDecision,'NO_GO');
  assert.equal(gateway.canWriteProduction,false);
  assert.equal(gateway.canStartWhatsApp,false);
  assert.equal(gateway.fieldHardwareTested,false);
  assert.ok(gateway.blockers.includes('SEPARATE_OWNER_DEPLOYMENT_APPROVAL_REQUIRED'));
});
test('unsupported migration route is rejected',()=>{
  assert.ok(reviewStage13SyntheticAuthMigration({
    route:'unsigned-forward-all',legacyParentWritesRetained:true
  }).blockers.includes('UNSUPPORTED_OR_UNKNOWN_MIGRATION_ROUTE'));
  assert.throws(()=>reviewStage13SyntheticAuthMigration(null),TypeError);
});
test('fresh observations are within all windows but do not prove real hardware live',()=>{
  const result=compareStage13SyntheticFreshness({timestamp:now-5000,nowMs:now,connected:true});
  assert.equal(result.ageSeconds,5);
  assert.deepEqual(result.windowClassification,{website:'within-window',
    bot:'within-window',mobile:'within-window'});
  assert.equal(result.showsRealHardwareLive,false);
});
test('10, 15 and 30 second boundaries are documented, never silently updated',()=>{
  assert.deepEqual(STAGE13_WINDOWS,{website:10,bot:15,mobile:30});
  for(const sec of [10,11,15,16,20,30,31]){
    const r=compareStage13SyntheticFreshness({
      timestamp:now-sec*1000,nowMs:now,connected:true});
    assert.equal(r.windowClassification.website,sec<=10?'within-window':'stale');
    assert.equal(r.windowClassification.bot,sec<=15?'within-window':'stale');
    assert.equal(r.windowClassification.mobile,sec<=30?'within-window':'stale');
    assert.equal(r.clientsDisagree,(sec>=11&&sec<=30));
  }
  assert.equal(gates.freshness.windowsSeconds.mobile,30);
  assert.equal(gates.freshness.policyChangeAuthorized,false);
});
test('invalid/future/missing field clocks and network drop never become live proof',()=>{
  for(const timestamp of [null,0,'invalid',now+60000]){
    const r=compareStage13SyntheticFreshness({timestamp,nowMs:now,connected:true});
    assert.deepEqual(Object.values(r.windowClassification),['stale','stale','stale']);
  }
  const offline=compareStage13SyntheticFreshness({timestamp:now-1000,nowMs:now,connected:false});
  assert.deepEqual(Object.values(offline.windowClassification),['stale','stale','stale']);
  assert.equal(offline.showsRealHardwareLive,false);
  const absent=compareStage13SyntheticFreshness({timestamp:null,nowMs:now,connected:false,hasData:false});
  assert.deepEqual(Object.values(absent.windowClassification),['unavailable','unavailable','unavailable']);
  assert.throws(()=>compareStage13SyntheticFreshness({timestamp:now}),TypeError);
});
test('a field clock in seconds and ISO produces same age; reconnect does not overwrite it',()=>{
  for(const timestamp of [(now-20000)/1000,new Date(now-20000).toISOString(),now-20000]){
    const x=compareStage13SyntheticFreshness({timestamp,nowMs:now,connected:true});
    assert.equal(x.ageSeconds,20);
    assert.equal(x.windowClassification.website,'stale');
    assert.equal(x.windowClassification.mobile,'within-window');
  }
});
test('an asserted completed rollout checklist is never a deployment permit',()=>{
  const keys=gates.rolloutRequiredEvidenceIds;
  const check=reviewStage13SyntheticRollout(Object.fromEntries(keys.map(x=>[x,true])));
  assert.equal(check.syntheticChecklistFullyClaimed,true);
  assert.equal(check.canDeploy,false);
  assert.equal(check.result,'NO_GO');
  assert.equal(check.effectiveRulesRetrieved,false);
  assert.equal(check.productionRulePublicationApproved,false);
  const missing=reviewStage13SyntheticRollout({});
  assert.deepEqual(missing.remainingSyntheticChecklistFields,keys);
  assert.equal(missing.syntheticChecklistFullyClaimed,false);
});
test('Phase A retains anonymous writer; Stage 13 makes no Firebase deployment changes',()=>{
  assert.equal(phaseA.rules.floodguard.live['.write'],true);
  assert.equal(phaseB.rules.floodguard.live['.write'],false);
  assert.equal(readLocalStage11().status,'NO_GO');
  assert.equal(gates.releaseDecision,'NO_GO_REVIEW_ONLY');
  assert.equal(gates.verifiedProductionAuth,false);
  assert.equal(gates.hardwareFlashedOrOperated,false);
  assert.equal(gates.productionRulesChanged,false);
});
test('Stage 13 model has no SDK, sockets, token issuance, hardware or hosted service',()=>{
  const source=fs.readFileSync('experiments/stage13-security-gap-review.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:http|node:https|node:tls|node:net/);
});
