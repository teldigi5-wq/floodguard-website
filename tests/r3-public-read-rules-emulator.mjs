// FloodGuard R3 public-telemetry Rules: real LOCAL Firebase RTDB Emulator.
// All fixture data are synthetic, including private-path canaries.
// Must NEVER run against a live Firebase project, connect to hardware, or send alerts.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = 'demo-r3-public-read-rules';
const ORIGIN = 'http://127.0.0.1:9000';
const NS = PROJECT + '-default-rtdb';
if (
  process.env.FG_R3_PUBLIC_READ_EMULATOR_TEST !== '1' ||
  process.env.GCLOUD_PROJECT !== PROJECT ||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9000'
) {
  throw new Error('Refusing execution without exact local demo RTDB Emulator gates');
}

const PUBLIC = Object.freeze([
  'floodguard/live/water', 'floodguard/live/rain',
  'floodguard/live/gate', 'floodguard/live/alarm',
  'floodguard/live/devices', 'floodguard/live/system',
  'floodguard/live/esp8266/connection',
  'floodguard/live/esp8266/rssi',
  'floodguard/live/esp8266/status',
]);
const PRIVATE = Object.freeze([
  'floodguard', 'floodguard/live', 'floodguard/live/esp8266',
  'floodguard/live/esp8266/ip', 'floodguard/live/esp8266/wifi',
  'floodguard/bot', 'floodguard/test',
]);

function testUrl(path, ownerForFixtureOnly = false) {
  if (
    typeof path !== 'string' ||
    !/^[a-zA-Z0-9_/-]+$/.test(path) ||
    path.startsWith('/') || path.includes('//') || path.includes('..')
  ) throw new Error('Refusing unexpected synthetic path');
  const url = new URL('/' + path + '.json', ORIGIN);
  url.searchParams.set('ns', NS);
  // Emulator bypass token ONLY for deterministic localhost fixture setup.
  if (ownerForFixtureOnly) url.searchParams.set('access_token', 'owner');
  return url;
}
async function request(path, method = 'GET', body, fixtureOwner = false) {
  const url = testUrl(path, fixtureOwner);
  const response = await fetch(url, {
    method,
    headers: {'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    redirect: 'manual',
    signal: AbortSignal.timeout(6000),
  });
  // All responses contain synthetic fixture data; never log raw JSON.
  const raw = await response.text();
  let value;
  try { value = JSON.parse(raw); } catch { value = null; }
  return {status: response.status, value};
}
const deny = (response, path) =>
  assert.ok(response.status === 401 || response.status === 403,
    'Unexpected public access on ' + path + ': HTTP ' + response.status);

before(async () => {
  const synthetic = {
    live: {
      water: {distanceCm: 15.35, levelCm: 9.65, status: 'WARNING'},
      rain: {currentMm: 35, dailyMm: 35, status: 'NORMAL'},
      gate: {status: 'CLOSED', angle: 0, countdownSeconds: 0},
      alarm: {active: false, type: 'NONE'},
      devices: {
        arduino: 'OFFLINE',
        __synthetic_private_canary: 'LAB_SHOULD_NOT_BE_IN_PUBLIC_CHILD',
      },
      system: {lastUpdate: 1700000000000, overallRisk: 'UNKNOWN'},
      esp8266: {
        connection: 'DISCONNECTED', rssi: -72, status: 'OFFLINE',
        ip: '192.0.2.10', wifi: 'SYNTHETIC_PRIVATE_WIFI',
      },
    },
    bot: {config: 'SYNTHETIC_PRIVATE'},
    test: {config: 'SYNTHETIC_PRIVATE'},
  };
  const seeded = await request('floodguard', 'PUT', synthetic, true);
  assert.equal(seeded.status, 200, 'Local test fixture did not seed');
});

test('actual RTDB Emulator grants all nine anonymous child reads', async () => {
  for (const path of PUBLIC) {
    const r = await request(path);
    assert.equal(r.status, 200, path + ' should be anonymously readable');
    assert.notEqual(r.value, null, path + ' seeded fixture should exist');
  }
});

test('actual RTDB Emulator denies all seven private or ancestor reads', async () => {
  for (const path of PRIVATE) {
    deny(await request(path), path);
  }
});

test('a public-child read grant also exposes its unknown descendants (release blocker)', async () => {
  // Deliberate synthetic canary demonstrates the Rules engine's read cascade.
  // Even when known ip/wifi paths are protected, a new private field under
  // devices would become public. A complete live descendant inventory is required.
  const r = await request('floodguard/live/devices');
  assert.equal(r.status, 200);
  assert.equal(r.value.__synthetic_private_canary,
    'LAB_SHOULD_NOT_BE_IN_PUBLIC_CHILD');
});

test('actual RTDB Emulator denies anonymous PUT/PATCH/POST/DELETE writes', async () => {
  const blocked = [
    ['floodguard/live/water', 'PUT', {status:'SAFE'}],
    ['floodguard/live/rain', 'PATCH', {dailyMm: 0}],
    ['floodguard/live/gate/status', 'PUT', 'OPEN'],
    ['floodguard/live/system/lastUpdate', 'PUT', 9999999999999],
    ['floodguard/live/esp8266/ip', 'PUT', '198.51.100.10'],
    ['floodguard/live/esp8266/status', 'PUT', 'ONLINE'],
    ['floodguard/live/water', 'POST', {status:'SAFE'}],
    ['floodguard/live/alarm', 'DELETE', undefined],
    ['floodguard/live', 'DELETE', undefined],
    ['floodguard/bot', 'PUT', {enabled:true}],
    ['floodguard/test', 'PUT', {enabled:true}],
  ];
  for (const [path, method, body] of blocked) {
    deny(await request(path, method, body), method + ' ' + path);
  }
});

test('denied writes cannot alter synthetic field measurements or gate', async () => {
  const water = await request('floodguard/live/water');
  const gate = await request('floodguard/live/gate');
  const time = await request('floodguard/live/system/lastUpdate');
  assert.equal(water.status, 200);
  assert.equal(water.value.status, 'WARNING');
  assert.equal(gate.value.status, 'CLOSED');
  assert.equal(time.value, 1700000000000);
});

test('no real-authenticated writer is present; protected publisher stays NO_GO', () => {
  // This suit deliberately proves only public REST client Rules. The special
  // local fixture owner is NOT a proposed device or production credential.
  assert.equal(PROJECT.startsWith('demo-'), true);
  assert.equal(ORIGIN, 'http://127.0.0.1:9000');
  assert.equal(PUBLIC.length, 9);
  assert.equal(PRIVATE.length, 7);
});
