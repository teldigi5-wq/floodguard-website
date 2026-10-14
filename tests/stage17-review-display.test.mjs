import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildStage17ReviewCards} from '../experiments/stage17-review-display.mjs';
const scenarios=JSON.parse(fs.readFileSync('docs/firebase/stage14-cross-client-fixtures.json','utf8'));
const sample=id=>scenarios.scenarios.find(x=>x.id===id);
function report(id){const x=sample(id);return buildStage17ReviewCards({
  snapshot:x.snapshot,nowMs:scenarios.timeReferenceMs,connected:x.connected!==false
});}
const by=(r,id)=>r.cards.find(x=>x.id===id);
test('review card output is four structured, non-operational notices with non-color labels',()=>{
  for(const s of scenarios.scenarios){
    const x=report(s.id);
    assert.equal(x.kind,'STAGE17_OFFLINE_DISPLAY_REVIEW_ONLY');
    assert.equal(x.approval,'NO_GO');
    assert.deepEqual(x.cards.map(c=>c.id),['water','gate','risk','freshness']);
    assert.equal(x.canSendAlerts,false);
    assert.equal(x.canControlGate,false);
    for(const c of x.cards){
      assert.ok(c.heading&&c.detail&&c.evidence);
      assert.match(c.evidence,/not live, not a safety decision/i);
      assert.ok(['warning','neutral'].includes(c.tone));
      assert.ok(Object.isFrozen(c));
    }
  }
});
test('zero air gap shows unverified rather than calling sensor healthy',()=>{
  const x=report('zero-distance-diverges');
  assert.match(by(x,'water').heading,/unverified/i);
  assert.match(by(x,'risk').heading,/review/i);
  assert.ok(x.rawReasons.includes('ZERO_GAP_PHYSICAL_MEANING_UNVERIFIED'));
});
test('gate raw status versus angle disagreement is not claimed open or closed',()=>{
  for(const id of ['gate-raw-open-but-zero-angle','gate-middle-angle-raw-closed']){
    const x=report(id);
    assert.equal(by(x,'gate').heading,'Gate position conflict');
  }
});
test('backend LOW and sensor CRITICAL triggers risk review, not a safe label',()=>{
  const x=report('reported-risk-conflicts-derived-rain-critical');
  assert.equal(by(x,'risk').heading,'Overall risk requires review');
});
test('missing sources never imply a validated LOW or SAFE level',()=>{
  const x=report('sensor-unavailable-fallback-low-risk');
  assert.equal(by(x,'water').heading,'Water observation unavailable');
  assert.equal(by(x,'risk').heading,'Overall risk requires review');
});
test('concordant SAFE is qualified as reported and unverified',()=>{
  const x=report('concordant-safe');
  assert.match(by(x,'water').heading,/SAFE reported — not verified/);
  assert.match(by(x,'risk').heading,/LOW reported — not verified/);
  assert.match(by(x,'freshness').heading,/timestamp only/i);
});
test('stale or disconnected data never appears as verified recent',()=>{
  for(const id of ['stale-20s-on-connected-database','future-field-clock','fresh-field-clock-but-disconnected']){
    const x=report(id);
    assert.equal(by(x,'freshness').heading,'Reading freshness unverified');
  }
});
test('accessibility markup identifies note, heading and description without color-only meaning',()=>{
  const src=fs.readFileSync('components/stage17-review-notice.tsx','utf8');
  assert.match(src,/role="note"/);
  assert.match(src,/aria-labelledby=\{titleId\}/);
  assert.match(src,/aria-describedby=\{descriptionId\}/);
  assert.match(src,/aria-hidden="true"/);
  assert.match(src,/\{notice.heading\}/);
  assert.match(src,/\{notice.detail\}/);
  assert.match(src,/data-review-only="true"/);
  const text=fs.readFileSync('app/dashboard/page.tsx','utf8');
  assert.doesNotMatch(text,/Stage17ReviewNotice/);
  assert.doesNotMatch(text,/stage17-review-display/);
});
test('review formatter does not access runtime secrets, network, live devices or Firebase SDK',()=>{
  const src=fs.readFileSync('experiments/stage17-review-display.mjs','utf8');
  assert.doesNotMatch(src,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(src,/firebase-admin|FIREBASE_DATABASE_URL|process\.env|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(src,/node:http|node:https|node:net|node:tls/);
});
