import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
test('opt-in emulator path is locked to exact demo URL and loopback browser origin',()=>{
  const source=read('lib/firebase.ts');
  assert.match(source,/NEXT_PUBLIC_FG_R3_EMULATOR_LAB === "1"/);
  assert.match(source,/DEMO_R3_URL = "https:\/\/demo-floodguard-r3-default-rtdb\.firebasedatabase\.app"/);
  assert.match(source,/window\.location\.hostname === "127\.0\.0\.1"/);
  assert.match(source,/window\.location\.port === "4173"/);
  assert.match(source,/window\.location\.protocol === "http:"/);
  assert.match(source,/databaseURL !== DEMO_R3_URL/);
  assert.match(source,/LIVE_PATH !== "floodguard\/live"/);
  assert.match(source,/connectDatabaseEmulator\(db, "127\.0\.0\.1", 19001\)/);
  assert.match(source,/throw new Error\("Blocked: R3 emulator lab requires/);
  assert.match(source,/return getDatabase\(getApps\(\)\[0\] \?\? initializeApp\(\{databaseURL\}\)\)/);
});
test('emulator does not require production Firebase service account or credentials',()=>{
  const runner=read('scripts/r3-h25-browser-emulator-lab.sh');
  const workflow=read('.github/workflows/r3-h25-sdk-emulator-browser.yml');
  for(const script of [runner,workflow]){
    assert.match(script,/demo-floodguard-r3/);
    assert.match(script,/127\.0\.0\.1/);
    assert.doesNotMatch(script,/firebase deploy|gcloud auth|--project floodguard-e3215/);
    assert.doesNotMatch(script,/secrets\.[A-Z_]+/);
  }
  assert.match(workflow,/FIREBASE_TOKEN: ''/);
  assert.match(workflow,/GOOGLE_APPLICATION_CREDENTIALS: ''/);
  assert.match(workflow,/NEXT_PUBLIC_FG_R3_EMULATOR_LAB: '1'/);
  assert.match(workflow,/firebase-tools@15\.34\.2 emulators:exec/);
  assert.match(workflow,/--config r3-firebase-emulator\.json/);
  assert.match(workflow,/--only database/);
});
test('synthetic browser explicitly blocks all external HTTP and observes only local websockets',()=>{
  const testFile=read('tests/browser/h25-sdk-emulator-chromium.test.mjs');
  assert.match(testFile,/serviceWorkers:'block'/);
  assert.match(testFile,/await context\.route\('\*\*\/\*'/);
  assert.match(testFile,/u\.hostname==='127\.0\.0\.1'/);
  assert.match(testFile,/u\.port==='19001'/);
  assert.match(testFile,/assert\.deepEqual\(blocked,\[\]/);
  assert.match(testFile,/assert\.deepEqual\(errors,\[\]/);
  assert.match(testFile,/adminPut\('floodguard\/live\/esp8266\/connection','DISCONNECTED'\)/);
  assert.match(testFile,/adminPut\('floodguard\/live\/rain\/sensorStatus','OFFLINE'\)/);
  assert.match(testFile,/adminPut\('floodguard\/live\/gate\/status','OPEN'\)/);
  assert.match(testFile,/adminPut\('floodguard\/live\/system\/lastUpdate',0\)/);
  assert.doesNotMatch(testFile,/fetch\(['"]https:\/\/(?!demo-floodguard-r3)/);
});
test('emulator run script refuses wrong project, host, credentials and path',()=>{
  const runner=read('scripts/r3-h25-browser-emulator-lab.sh');
  assert.match(runner,/test "\$\{FG_H25_BROWSER_LAB:-\}" = "1"/);
  assert.match(runner,/test "\$\{FIREBASE_DATABASE_EMULATOR_HOST:-\}" = "127\.0\.0\.1:19001"/);
  assert.match(runner,/test -z "\$\{FIREBASE_TOKEN:-\}"/);
  assert.match(runner,/test -z "\$\{GOOGLE_APPLICATION_CREDENTIALS:-\}"/);
  assert.match(runner,/test ! -e \.floodguard-private-evidence/);
  assert.match(runner,/node --test tests\/r3-firebase-emulator\.test\.mjs/);
  assert.match(runner,/node --test tests\/browser\/h25-sdk-emulator-chromium\.test\.mjs/);
});
test('H25 does not add public credentials, source authorization, real alert or gate mutation',()=>{
  const firebase=read('lib/firebase.ts');
  const testFile=read('tests/browser/h25-sdk-emulator-chromium.test.mjs');
  assert.doesNotMatch(firebase,/apiKey|serviceAccount|privateKey|sendMessage\(|set\(ref|update\(ref/);
  assert.doesNotMatch(testFile,/realRecipient|sendMessage\(|physicalGateCommand\(/);
  assert.match(testFile,/SYNTHETIC_PRIVATE_WIFI_NEVER_PUBLIC/);
});
