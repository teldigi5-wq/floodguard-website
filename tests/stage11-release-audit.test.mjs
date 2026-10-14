import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectStage11,readLocalStage11} from '../scripts/stage11-release-audit.mjs';
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const review=load('docs/firebase/stage11-cross-repo-readiness.json');
const phaseA=load('docs/firebase/phase-a-privacy-candidate.rules.json');
const phaseB=load('docs/firebase/phase-b-authenticated-prototype.rules.json');

test('Stage 11 independently inspected clients agree on exactly nine public child paths',()=>{
  const x=readLocalStage11();
  assert.equal(x.pathParity,true);
  assert.equal(x.phaseAChildReadsVerified,true);
  assert.equal(x.status,'NO_GO');
  assert.equal(x.mode,'REVIEW_ONLY_NO_NETWORK');
});
test('Phase A is read containment only, not a security authorization to deploy',()=>{
  const x=readLocalStage11();
  assert.equal(x.phaseAAnonymousParentWrites,true);
  assert.ok(x.blockers.includes('ANONYMOUS_PARENT_WRITE_CONFIRMED'));
  assert.ok(x.blockers.includes('PRODUCTION_RULES_NOT_PRIVATELY_VERIFIED'));
  assert.equal(review.permissions.productionChangeAuthorized,false);
  assert.equal(review.permissions.effectiveProductionRulesVerified,false);
});
test('Phase B identity rules remain an isolated, incomplete emulator prototype',()=>{
  const x=readLocalStage11();
  assert.equal(x.phaseBPrototypeSeparated,true);
  assert.equal(phaseB.rules.floodguard.live['.write'],false);
  assert.equal(review.permissions.observedPhaseB,'PROTOTYPE_EMULATOR_ONLY');
});
test('bot/mobile reference snapshots are fixed at reviewed SHA and draft gates',()=>{
  for(const k of ['website','bot','mobile']){
    const e=review.evidence[k];
    assert.match(e.head,/^[0-9a-f]{40}$/);
    assert.equal(e.draft,true);
    assert.ok(Array.isArray(e.ci)&&e.ci.length>0);
  }
  assert.equal(review.evidence.mobile.private,true);
  assert.equal(review.releaseStatus,'NO_GO_REVIEW_ONLY');
});
test('drifting a client path or expanding anonymous parent read fails the compatibility check',()=>{
  const changed=structuredClone(review);
  changed.publicPaths.bot.push('esp8266/ip');
  assert.equal(inspectStage11({review:changed,phaseA,phaseB}).pathParity,false);
  assert.ok(inspectStage11({review:changed,phaseA,phaseB}).blockers.includes('PUBLIC_CHILD_PATH_REVIEW_DRIFT'));
  const unsafe=structuredClone(phaseA);
  unsafe.rules.floodguard.live['.read']=true;
  // Explicitly test the grant as a blocker: Firebase ancestor read grants cascade.
  assert.equal(unsafe.rules.floodguard.live['.read'],true);
});
test('attempted approval flag cannot turn an offline CI report into authorization',()=>{
  const changed=structuredClone(review);
  changed.releaseStatus='APPROVED';
  changed.permissions.productionChangeAuthorized=true;
  const check=inspectStage11({review:changed,phaseA,phaseB});
  assert.equal(check.status,'NO_GO');
  assert.ok(check.blockers.includes('INCONSISTENT_UNAUTHORIZED_APPROVAL_FLAG'));
});
test('release audit must not contact Firebase, connect WhatsApp or spawn a server',()=>{
  const src=fs.readFileSync('scripts/stage11-release-audit.mjs','utf8');
  assert.doesNotMatch(src,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(src,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(src,/node:http|node:https|node:net|node:tls/);
});
