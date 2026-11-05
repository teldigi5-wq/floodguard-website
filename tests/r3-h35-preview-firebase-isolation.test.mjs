import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=readFileSync('next.config.ts','utf8');
const firebase=readFileSync('lib/firebase.ts','utf8');
const provider=readFileSync('providers/flood-provider.tsx','utf8');

test('H35 Vercel preview signal is a server-side build-derived constant',()=>{
  assert.match(config,/FLOODGUARD_VERCEL_PREVIEW_BLOCK: process\.env\.VERCEL_ENV === "preview" \? "1" : "0"/);
  assert.match(firebase,/export const VERCEL_PREVIEW_BLOCKED = process\.env\.FLOODGUARD_VERCEL_PREVIEW_BLOCK === "1"/);
  assert.doesNotMatch(firebase,/process\.env\.NEXT_PUBLIC_FG_PREVIEW_ALLOWED/);
});
test('H35 preview denial runs before any test/emulator or normal Firebase initialization',()=>{
  const guard=firebase.indexOf('if (VERCEL_PREVIEW_BLOCKED)');
  const lab=firebase.indexOf('if (testLab)');
  const cloud=firebase.indexOf('getDatabase(getApps()[0]');
  const url=firebase.indexOf('const databaseURL = process.env.FLOODGUARD_COMPILED_DATABASE_URL;');
  assert.ok(guard>0 && guard<url && guard<lab && guard<cloud);
  assert.match(firebase,/throw new Error\("FloodGuard Firebase subscriptions disabled in review preview\."\)/);
});
test('H35 both public-source and local emulator connection paths remain intact outside preview',()=>{
  assert.match(firebase,/NEXT_PUBLIC_FG_R3_EMULATOR_LAB === "1"/);
  assert.match(firebase,/connectDatabaseEmulator\(db, "127\.0\.0\.1", 19001\)/);
  assert.match(firebase,/window\.location\.hostname === "127\.0\.0\.1"/);
  assert.match(firebase,/return getDatabase\(getApps\(\)\[0\] \?\? initializeApp\(\{databaseURL\}\)\)/);
  assert.match(firebase,/LIVE_PATH = process\.env\.NEXT_PUBLIC_FIREBASE_LIVE_PATH \?\? "floodguard\/live"/);
});
test('H35 preview page reports unavailable rather than claiming live flood safety',()=>{
  assert.match(provider,/import \{ database, LIVE_PATH, VERCEL_PREVIEW_BLOCKED \} from "@\/lib\/firebase"/);
  assert.match(provider,/Review preview only: Firebase subscriptions are disabled; no live flood status is available/);
  assert.match(provider,/const db = database\(\)/);
  assert.match(provider,/setError\(VERCEL_PREVIEW_BLOCKED/);
});
test('H35 production/preview policy test is part of dedicated non-deploy CI',()=>{
  const workflow=readFileSync('.github/workflows/r3-h35-preview-firebase-isolation.yml','utf8');
  const browser=readFileSync('tests/browser/h35-preview-firebase-chromium.test.mjs','utf8');
  assert.match(workflow,/safety\/r3-h35-vercel-preview-firebase-isolation-20261105/);
  assert.match(workflow,/security\/r3-h34-unambiguous-reviewed-baselines-20261104/);
  assert.match(workflow,/VERCEL_ENV: preview/);
  assert.match(workflow,/NEXT_PUBLIC_FIREBASE_DATABASE_URL: https:\/\/demo-preview-forbidden-default-rtdb\.firebasedatabase\.app/);
  assert.match(workflow,/node --test tests\/browser\/h35-preview-firebase-chromium\.test\.mjs/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(browser,/serviceWorkers:'block'/);
  assert.match(browser,/page\.on\('websocket'/);
  assert.match(browser,/externalRequests/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
