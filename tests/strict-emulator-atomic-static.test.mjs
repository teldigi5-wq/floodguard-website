import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('trusted projector is gated to local Firebase Emulator and never auto-starts',()=>{
  const s=readFileSync('experiments/strict-emulator-atomic-projector.mjs','utf8');
  assert.match(s,/FG_STRICT_EMULATOR_PROJECTOR_TEST/);
  assert.match(s,/FIREBASE_DATABASE_EMULATOR_HOST/);
  assert.match(s,/const EMULATOR='127\.0\.0\.1:9000'/);
  assert.match(s,/database\.ref\('\/floodguard'\)/);
  assert.match(s,/target\.on\('value',onValue,reject\)/);
  assert.match(s,/target\.off\('value',onValue\)/);
  assert.match(s,/target\.transaction\(/);
  assert.doesNotMatch(s,/firebase-admin|serviceAccount|https:\/\/|http:\/\/|fetch\s*\(|\.listen\s*\(/);
  // Crypto's SHA-256 hash.update() is necessary for the trusted signer pin.
  // Forbid mutation through Firebase refs without rejecting that operation.
  assert.doesNotMatch(s,/\b(?:database|target|db)\.(?:set|update)\s*\(/);
  assert.doesNotMatch(s,/\.ref\([^)]*\)\.(?:set|update)\s*\(/);
  assert.doesNotMatch(s,/\b(?:writeFileSync|execSync|spawnSync)\s*\(/);
});

test('fixed allowlisted five public outputs and private transaction checkpoint',()=>{
  const s=readFileSync('experiments/strict-emulator-atomic-projector.mjs','utf8');
  for(const target of [
    'water/distanceCm','water/levelCm','water/status',
    'system/lastUpdate','system/overallRisk'
  ])assert.ok(s.includes(target),'missing strict path '+target);
  assert.match(s,/confirmedIngest/);
  assert.match(s,/projectionControl/);
  assert.match(s,/staging/);
  assert.match(s,/deviceAuthorization/);
  assert.match(s,/databaseRecord:confirmed/);
  assert.match(s,/publication-state-unavailable/);
  assert.match(s,/staging-frame-mismatch/);
  assert.match(s,/projectionControl\?\.waterAuthority/);
  assert.match(s,/receiptSignerFingerprint/);
  assert.match(s,/water-source-not-authorized/);
  assert.match(s,/receipt-signer-not-authorized/);
});

test('emulator smoke suite is wired to a distinct local project, not deployed rules',()=>{
  const workflow=readFileSync('.github/workflows/firebase-phase-b-prototype.yml','utf8');
  assert.match(workflow,/FG_STRICT_EMULATOR_PROJECTOR_TEST=1/);
  assert.match(workflow,/tests\/strict-emulator-atomic-projector\.mjs/);
  assert.match(workflow,/firebase\.phase-b-strict\.json/);
  assert.match(workflow,/--project demo-strict-projector/);
  assert.match(workflow,/branches: \[main\]/);
  assert.doesNotMatch(workflow,/firebase deploy|npm run deploy|--project floodguard-e3215/);
  const cfg=JSON.parse(readFileSync('firebase.phase-b-strict.json','utf8'));
  assert.equal(cfg.database.rules,'docs/firebase/phase-b-strict-readonly-live.rules.json');
});
