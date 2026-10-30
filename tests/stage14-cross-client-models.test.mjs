import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compareStage14SyntheticClients} from '../experiments/stage14-cross-client-models.mjs';
import {readLocalStage11} from '../scripts/stage11-release-audit.mjs';
const report=JSON.parse(fs.readFileSync('docs/firebase/stage14-cross-client-fixtures.json','utf8'));
const run=s=>compareStage14SyntheticClients({state:s.snapshot,
  connected:s.connected===false?false:true,nowMs:report.timeReferenceMs});
test('fixed source SHAs and synthetic-only scope are preserved',()=>{
  assert.equal(report.schema,'floodguard-stage14-inspected-client-models-v1');
  assert.equal(report.scenarios.length,12);
  assert.ok(Object.values(report.inspectedCommits).every(x=>/^[a-f0-9]{40}$/.test(x)));
  assert.equal(report.severity,'NO_GO_MANUAL_REVIEW');
});
test('all documented model outcomes match the inspected-source scenario predictions',()=>{
  for(const scenario of report.scenarios){
    const outcome=run(scenario),expected=scenario.expect;
    assert.equal(outcome.kind,'OFFLINE_REVIEW_MODELS_NOT_ACTUAL_CLIENT_EXECUTION');
    assert.deepEqual(outcome.differentFields,expected.differing,scenario.id);
    for(const client of ['web','bot','mobile']){
      const model=outcome.modelResults[client==='web'?'website':client];
      for(const field of ['Water','Rain','Risk','Gate']){
        if(expected[client+field]!==undefined)
          assert.equal(model[field.toLowerCase()],expected[client+field],scenario.id+' '+client+field);
      }
    }
    if(expected.freshness)assert.deepEqual(outcome.freshnessWindows,expected.freshness,scenario.id);
    assert.equal(outcome.deploymentApproved,false);
    assert.equal(outcome.hardwareTested,false);
    assert.equal(outcome.alertsSent,false);
  }
});
test('known consistent safe/warning/danger boundaries align in the review models',()=>{
  for(const id of ['concordant-safe','concordant-warning-edge','concordant-danger-edge']){
    const r=run(report.scenarios.find(x=>x.id===id));
    assert.deepEqual(r.differentFields,[],id);
  }
});
test('zero air gap is NOT silently harmonized with legacy bot distance > 0 check',()=>{
  const r=run(report.scenarios.find(x=>x.id==='zero-distance-diverges'));
  assert.equal(r.modelResults.website.water,'DANGER');
  assert.equal(r.modelResults.mobile.water,'DANGER');
  assert.equal(r.modelResults.bot.water,'SAFE');
  assert.ok(r.differentFields.includes('water'));
});
test('raw OPEN state with zero-degree servo remains an unresolved gate status disagreement',()=>{
  const r=run(report.scenarios.find(x=>x.id==='gate-raw-open-but-zero-angle'));
  assert.equal(r.modelResults.mobile.gate,'OPEN');
  assert.equal(r.modelResults.website.gate,'CLOSED');
  assert.equal(r.modelResults.bot.gate,'CLOSED');
});
test('derived mobile flood risk can disagree with stale firmware risk and can fall back to LOW with unknown sensors',()=>{
  const a=run(report.scenarios.find(x=>x.id==='reported-risk-conflicts-derived-rain-critical'));
  assert.equal(a.modelResults.mobile.risk,'CRITICAL');
  assert.equal(a.modelResults.bot.risk,'LOW');
  const b=run(report.scenarios.find(x=>x.id==='sensor-unavailable-fallback-low-risk'));
  assert.equal(b.modelResults.mobile.risk,'LOW');
  assert.equal(b.modelResults.website.risk,'UNAVAILABLE');
});
test('legacy ONLINE rain status normalizes in website and mobile models, but bot reads original value',()=>{
  const r=run(report.scenarios.find(x=>x.id==='legacy-online-rain-category'));
  assert.equal(r.modelResults.website.rain,'HEAVY_RAIN');
  assert.equal(r.modelResults.mobile.rain,'HEAVY_RAIN');
  assert.equal(r.modelResults.bot.rain,'ONLINE');
});
test('source freshness windows disagree at 20s while future clocks and disconnections do not prove LIVE',()=>{
  const a=run(report.scenarios.find(x=>x.id==='stale-20s-on-connected-database'));
  assert.equal(a.clientsDisagreeAboutFreshness,true);
  for(const id of ['future-field-clock','fresh-field-clock-but-disconnected']){
    const r=run(report.scenarios.find(x=>x.id===id));
    assert.equal(r.clientsDisagreeAboutFreshness,false);
    assert.deepEqual(Object.values(r.freshnessWindows),['stale','stale','stale']);
  }
});
test('website normalization keeps calibrated thresholds while Stage 14 fixtures remain historical',()=>{
  // Stage 14 is an intentionally historical synthetic comparison, not a
  // certification of the current native providers or live firmware.
  const web=fs.readFileSync('providers/flood-provider.tsx','utf8');
  const safety=fs.readFileSync('lib/telemetry-safety.mjs','utf8');
  const lib=fs.readFileSync('lib/telemetry-health.mjs','utf8');
  for(const snippet of ['normalizeWaterGroup(source)', 'normalizeGateGroup(source)',
    'normalizeRisk(source.overallRisk)', 'reconcileCalibratedWaterMeasurement(source)']){
    assert.ok(web.includes(snippet),snippet);
  }
  for(const snippet of ['const heightCm = 25;', 'levelCm >= 11', 'levelCm >= 8.5']){
    assert.ok(safety.includes(snippet),snippet);
  }
  assert.match(lib,/FRESH_WINDOW_SECONDS = 10/);
  assert.equal(readLocalStage11().status,'NO_GO');
});
test('test-only model has no networking, Firebase SDK, WhatsApp, or hardware commands',()=>{
  const source=fs.readFileSync('experiments/stage14-cross-client-models.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:http|node:https|node:tls|node:net/);
});
