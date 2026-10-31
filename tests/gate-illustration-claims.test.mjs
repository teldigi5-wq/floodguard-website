import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileReportedGateStatus} from '../lib/telemetry-safety.mjs';

const read=path=>readFileSync(path,'utf8');

test('contradictory or missing gate observations are UNKNOWN before any scene',()=>{
  for(const v of [
    {status:'OPEN',angle:0,countdownSeconds:0},
    {status:'CLOSED',angle:90,countdownSeconds:0},
    {status:'COUNTDOWN',angle:0,countdownSeconds:0},
    {status:'OPEN',angle:null,countdownSeconds:0},
    {status:'UNKNOWN',angle:90,countdownSeconds:0}
  ])assert.equal(reconcileReportedGateStatus(v),'UNKNOWN');
});

test('gate page cannot override reconciled gate status with servo angle',()=>{
  const gate=read('app/gate/page.tsx');
  assert.match(gate,/const gateState = \(gate\?\.status \?\? "UNKNOWN"\)\.toUpperCase\(\)/);
  assert.match(gate,/const angle = gateState !== "UNKNOWN"/);
  assert.doesNotMatch(gate,/\bgateState\s*=\s*"CLOSED"/);
  assert.doesNotMatch(gate,/\bgateState\s*=\s*"OPEN"/);
  assert.doesNotMatch(gate,/\breleaseActive\b|\bactiveCountdown\b/);
  assert.doesNotMatch(gate,/Gate warning" value=\{[^}]*"CLEAR"/);
  assert.match(gate,/REPORTED COUNTDOWN/);
  assert.match(gate,/physical position unverified/);
  assert.match(gate,/ILLUSTRATIVE/);
});

test('hydraulic model explains simulated flow and cannot claim physical discharge',()=>{
  const scene=read('components/dam-scene.tsx');
  assert.match(scene,/Illustrative dam model, not a physical flow measurement/);
  assert.match(scene,/Simulated discharge only/);
  assert.match(scene,/No simulated flow/);
  assert.match(scene,/Illustrative hydraulic response/);
  assert.match(scene,/physical discharge/);
  assert.doesNotMatch(scene,/>Gates sealed</);
  assert.doesNotMatch(scene,/>Controlled release</);
  assert.doesNotMatch(scene,/>Live water digital twin</);
  assert.match(scene,/angle===null\?"UNKNOWN"/);
});

test('shared timestamp never renders as a source-verified live alarm clearance',()=>{
  const badge=read('components/ui.tsx');
  const dashboard=read('app/dashboard/page.tsx');
  const chrome=read('components/site-chrome.tsx');
  const diagnostics=read('app/diagnostics/page.tsx');
  assert.match(badge,/freshness==="live"\?"Recent system update"/);
  assert.doesNotMatch(badge,/freshness==="live"\?"Live"/);
  assert.match(dashboard,/Recent system timestamp · sources unverified/);
  assert.match(dashboard,/RECENT SYSTEM UPDATE/);
  assert.match(chrome,/Reported alarm active · unverified/);
  assert.doesNotMatch(chrome,/"Emergency alarm"/);
  assert.match(diagnostics,/Reported inactive \(unverified\)/);
});

test('original safety purpose and production trust boundary remain explicit',()=>{
  const risk=read('lib/telemetry-safety.mjs');
  const provider=read('providers/flood-provider.tsx');
  assert.match(risk,/verifiedClearance=false/);
  assert.match(provider,/reconcileDisplayedFloodRisk\(\{/);
  assert.doesNotMatch(provider,/verifiedClearance:\s*true/);
  const page=read('app/gate/page.tsx');
  assert.doesNotMatch(page,/firebase\/database|set\s*\(|update\s*\(|remove\s*\(/);
});
