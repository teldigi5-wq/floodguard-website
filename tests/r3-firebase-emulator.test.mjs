/**
 * Realtime Database Emulator-only contract tests.
 * Never run against the live project; do not accept custom hosts or namespace.
 * Synthetic data only, no physical gate control or device command support.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const HOST = '127.0.0.1';
const PORT = 19001;
const PROJECT = 'demo-floodguard-r3';
const NAMESPACE = 'demo-floodguard-r3-default-rtdb';
const BASE = 'http://127.0.0.1:19001';
const approved = [
  'water', 'rain', 'gate', 'alarm', 'devices', 'system',
  'esp8266/connection', 'esp8266/rssi', 'esp8266/status',
];
const denied = [
  '', 'floodguard', 'floodguard/live', 'floodguard/live/esp8266',
  'floodguard/live/esp8266/ip', 'floodguard/live/esp8266/wifi',
  'floodguard/bot', 'floodguard/test',
];
function requireLocalEmulator() {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, HOST + ':' + PORT,
    'Only the fixed local RTDB emulator is permitted');
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT,
    'Only the disposable demo project is permitted');
  assert.equal(new URL(BASE).origin, BASE);
}
function emulatorURL(path, privileged = false) {
  requireLocalEmulator();
  assert.ok(typeof path === 'string' && !path.includes('?') && !path.includes('#'));
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const url = new URL(BASE + '/' + (normalized ? normalized + '.json' : '.json'));
  url.searchParams.set('ns', NAMESPACE);
  if (privileged) url.searchParams.set('auth', 'owner'); // Emulator-only bypass.
  return url;
}
async function status(method, path, payload, privileged = false) {
  const response = await fetch(emulatorURL(path, privileged), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    ...(payload === undefined ? {} : {
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    }),
  });
  await response.arrayBuffer(); // Never print response bodies in CI logs.
  return response.status;
}
const refused = code => code === 401 || code === 403;

test('no production host or project can be supplied', () => {
  requireLocalEmulator();
  assert.equal(emulatorURL('floodguard/live/system').origin, BASE);
});
test('privileged emulator-only seed uses deliberately stale synthetic values', async () => {
  const sample = {
    water: {distanceCm: 15.35, levelCm: 9.65, status: 'WARNING'},
    rain: {currentMm: 35, dailyMm: 35},
    gate: {status: 'CLOSED', angle: 0, countdownSeconds: 0},
    alarm: {active: false},
    devices: {arduino: {status: 'OFFLINE'}},
    system: {lastUpdate: 0},
    esp8266: {connection: 'DISCONNECTED', rssi: -90, status: 'OFFLINE',
      ip: '192.0.2.1', wifi: 'SYNTHETIC_PRIVATE'},
  };
  assert.equal(await status('PUT', 'floodguard/live', sample, true), 200);
});
test('nine public telemetry reads allowed by the real emulator Rules engine', async () => {
  for (const p of approved) {
    const code = await status('GET', 'floodguard/live/' + p);
    assert.equal(code, 200, p);
  }
});
test('private ESP data and parent/test/bot nodes remain unreadable', async () => {
  for (const p of denied) {
    const code = await status('GET', p);
    assert.ok(refused(code), (p || '/') + ' unexpectedly returned ' + code);
  }
});
test('anonymous client cannot PUT any public branch or private control path', async () => {
  for (const p of [
    ...approved.map(x => 'floodguard/live/' + x),
    'floodguard/live', 'floodguard/live/esp8266/ip', 'floodguard/bot',
  ]) {
    const code = await status('PUT', p, 'UNAUTHORIZED_SYNTHETIC');
    assert.ok(refused(code), p + ' returned ' + code);
  }
});
test('anonymous PATCH and DELETE remain denied', async () => {
  const patch = await status('PATCH', 'floodguard/live', {system: {lastUpdate: 1}});
  const deletion = await status('DELETE', 'floodguard/live/system');
  assert.ok(refused(patch), 'PATCH returned ' + patch);
  assert.ok(refused(deletion), 'DELETE returned ' + deletion);
});
test('privileged synthetic seed persists after unauthorized modifications', async () => {
  assert.equal(await status('GET', 'floodguard/live/system/lastUpdate', undefined, true), 200);
  assert.equal(await status('GET', 'floodguard/live/esp8266/ip', undefined, true), 200);
});
