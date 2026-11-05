import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=readFileSync('next.config.ts','utf8');
const firebase=readFileSync('lib/firebase.ts','utf8');
const scan=readFileSync('scripts/r3-h36-assert-preview-bundle.mjs','utf8');
const workflow=readFileSync('.github/workflows/r3-h36-preview-bundle-scrub.yml','utf8');

test('H36 preview compile strips URL rather than only blocking database initialization',()=>{
  assert.match(config,/FLOODGUARD_COMPILED_DATABASE_URL: process\.env\.VERCEL_ENV === "preview"/);
  assert.match(config,/\? ""\s*: \(process\.env\.NEXT_PUBLIC_FIREBASE_DATABASE_URL \?\? ""\)/);
  assert.match(config,/FLOODGUARD_VERCEL_PREVIEW_BLOCK: process\.env\.VERCEL_ENV === "preview" \? "1" : "0"/);
  assert.match(firebase,/const databaseURL = process\.env\.FLOODGUARD_COMPILED_DATABASE_URL;/);
  assert.doesNotMatch(firebase,/const databaseURL = process\.env\.NEXT_PUBLIC_FIREBASE_DATABASE_URL;/);
  assert.match(firebase,/if \(VERCEL_PREVIEW_BLOCKED\)/);
});
test('H36 original production and fixed demo-emulator paths remain guarded and functional',()=>{
  assert.match(config,/: \(process\.env\.NEXT_PUBLIC_FIREBASE_DATABASE_URL \?\? ""\)/);
  assert.match(firebase,/NEXT_PUBLIC_FG_R3_EMULATOR_LAB === "1"/);
  assert.match(firebase,/databaseURL !== DEMO_R3_URL/);
  assert.match(firebase,/connectDatabaseEmulator\(db, "127\.0\.0\.1", 19001\)/);
  assert.match(firebase,/return getDatabase\(getApps\(\)\[0\] \?\? initializeApp\(\{databaseURL\}\)\)/);
});
test('H36 scan examines actually exported client JS, HTML, CSS without logging secrets',()=>{
  assert.match(scan,/path\.resolve\('out'\)/);
  assert.match(scan,/syntheticHost='demo-preview-forbidden-default-rtdb\.firebasedatabase\.app'/);
  assert.match(scan,/\.js/);
  assert.match(scan,/\.html/);
  assert.match(scan,/data\.includes\(syntheticHost\)/);
  assert.doesNotMatch(scan,/fetch\s*\(|http\.request|https\.request|firebase deploy|process\.env\.NEXT_PUBLIC_FIREBASE_DATABASE_URL/);
});
test('H36 CI builds actual preview with synthetic DB URL and requires scrub before Chromium',()=>{
  assert.match(workflow,/VERCEL_ENV: preview/);
  assert.match(workflow,/FG_H36_BUNDLE_SCAN: '1'/);
  assert.match(workflow,/NEXT_PUBLIC_FIREBASE_DATABASE_URL: https:\/\/demo-preview-forbidden-default-rtdb\.firebasedatabase\.app/);
  assert.match(workflow,/node scripts\/r3-h36-assert-preview-bundle\.mjs/);
  assert.match(workflow,/node --test tests\/browser\/h35-preview-firebase-chromium\.test\.mjs/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
