import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const client=readFileSync('lib/firebase.ts','utf8');
const policy=readFileSync('lib/firebase-app-policy.mjs','utf8');

test('H37 live client selects a distinct named app after all URL and preview checks',()=>{
  const preview=client.indexOf('if (VERCEL_PREVIEW_BLOCKED)');
  const url=client.indexOf('if (!databaseURL ||');
  const selection=client.indexOf('getScopedPublicMonitorApp({databaseURL,getApps,initializeApp})');
  assert.ok(preview>0&&url>preview&&selection>url);
  assert.match(client,/import \{ getScopedPublicMonitorApp \} from "\.\/firebase-app-policy\.mjs"/);
  assert.match(client,/return getDatabase\(app\)/);
  assert.doesNotMatch(client,/getApps\(\)\[0\]/);
});

test('H37 policy rejects colliding named app with different tenant or extra credentials',()=>{
  assert.match(policy,/PUBLIC_MONITOR_APP_NAME = "floodguard-public-monitor"/);
  assert.match(policy,/app\.name===PUBLIC_MONITOR_APP_NAME/);
  assert.match(policy,/options\.databaseURL!==databaseURL/);
  assert.match(policy,/Object\.keys\(options\)\.some\(key=>key!=="databaseURL"\)/);
  assert.match(policy,/initializeApp\(\{databaseURL\},PUBLIC_MONITOR_APP_NAME\)/);
  assert.doesNotMatch(policy,/getApps\(\)\[0\]/);
});

test('H37 original fixed loopback emulator, preview URL scrub and source guard remain',()=>{
  assert.match(client,/const LAB_APP_NAME = "floodguard-r3-h25-browser-lab"/);
  assert.match(client,/connectDatabaseEmulator\(db, "127\.0\.0\.1", 19001\)/);
  assert.match(client,/const databaseURL = process\.env\.FLOODGUARD_COMPILED_DATABASE_URL/);
  assert.match(client,/if \(VERCEL_PREVIEW_BLOCKED\)/);
});

test('H37 CI includes real Firebase SDK app-registry tests and inherited browser gates',()=>{
  const workflow=readFileSync('.github/workflows/r3-h37-firebase-app-isolation.yml','utf8');
  assert.match(workflow,/security\/r3-h37-firebase-named-app-isolation-20261105/);
  assert.match(workflow,/security\/r3-h36-preview-bundle-firebase-url-redaction-20261105/);
  assert.match(workflow,/node --test tests\/r3-h37-firebase-named-app-sdk\.test\.mjs/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/node --test tests\/browser\/h35-preview-firebase-chromium\.test\.mjs/);
  assert.match(workflow,/node scripts\/r3-h36-assert-preview-bundle\.mjs/);
  assert.doesNotMatch(workflow,/firebase deploy|--project floodguard-e3215|secrets\./);
});
