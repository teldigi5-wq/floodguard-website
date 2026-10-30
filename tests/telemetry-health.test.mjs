import test from "node:test";
import assert from "node:assert/strict";
import { ageSeconds, classifyTelemetryFreshness, parseFieldTimestamp, createCriticalStreamHealthTracker, classifySourceBoundFreshness } from "../lib/telemetry-health.mjs";
import { readFileSync } from "node:fs";

const now = Date.UTC(2026, 9, 13, 4, 50, 0);
const healthy = { loading: false, hasData: true, connected: true, error: false, ageSeconds: 4 };

test("field timestamps support milliseconds, seconds and ISO strings", () => {
  assert.equal(parseFieldTimestamp(now - 4_000, now), now - 4_000);
  assert.equal(parseFieldTimestamp((now - 4_000) / 1000, now), now - 4_000);
  assert.equal(parseFieldTimestamp(new Date(now - 4_000).toISOString(), now), now - 4_000);
  assert.equal(ageSeconds(now - 4_000, now), 4);
});
test("invalid and future timestamps never qualify as fresh", () => {
  for (const raw of [null, "", "invalid", 0, -2, Infinity, now + 60_000]) {
    assert.equal(parseFieldTimestamp(raw, now), null);
  }
  assert.equal(ageSeconds(null, now), null);
});
test("current observations qualify as live only with connection and timestamp", () => {
  assert.equal(classifyTelemetryFreshness(healthy), "live");
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: 10 }), "live");
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: 11 }), "stale");
});
test("old readings remain last recorded, not unavailable", () => {
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: 86400 * 80 }), "stale");
});
test("Firebase disconnection and missing clocks never imply live hardware", () => {
  assert.equal(classifyTelemetryFreshness({ ...healthy, connected: false }), "stale");
  assert.equal(classifyTelemetryFreshness({ ...healthy, connected: null }), "stale");
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: null }), "stale");
  assert.equal(classifyTelemetryFreshness({ ...healthy, error: true }), "stale");
});
test("loading and missing data do not become false SAFE readings", () => {
  assert.equal(classifyTelemetryFreshness({ ...healthy, loading: true }), "loading");
  assert.equal(classifyTelemetryFreshness({ ...healthy, hasData: false }), "unavailable");
});


test("offline working hardware keeps recorded measurements historical, not live", () => {
  // Offline is a connectivity state, not evidence of failed Arduino firmware.
  const offline = { ...healthy, hasData: true, connected: false, ageSeconds: 3600 };
  assert.equal(classifyTelemetryFreshness(offline), "stale");
  assert.equal(classifyTelemetryFreshness({ ...offline, connected: null }), "stale");
  assert.equal(classifyTelemetryFreshness({ ...offline, hasData: false }), "unavailable");
});

test("reconnecting to Firebase without a fresh field timestamp never makes offline hardware live", () => {
  const oldFieldTime = now - 4 * 3600 * 1000;
  const originalAge = ageSeconds(parseFieldTimestamp(oldFieldTime, now), now);
  assert.equal(originalAge, 4 * 3600);
  const afterReconnecting = { ...healthy, connected: true, ageSeconds: originalAge };
  assert.equal(classifyTelemetryFreshness(afterReconnecting), "stale");
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: null }), "stale");
});

test("historical field timestamps are never silently refreshed to browser time", () => {
  const oldReading = new Date(now - 86400 * 1000).toISOString();
  const parsed = parseFieldTimestamp(oldReading, now);
  assert.equal(parsed, now - 86400 * 1000);
  assert.equal(ageSeconds(parsed, now), 86400);
  assert.equal(classifyTelemetryFreshness({ ...healthy, ageSeconds: 86400 }), "stale");
});

test("water failure persists despite successful unrelated child snapshots", () => {
  const streams = createCriticalStreamHealthTracker();
  assert.equal(streams.healthy, true);
  assert.equal(streams.update("water", false), false);
  for (const sibling of ["rain","gate","alarm","devices","esp8266","rssi"]) {
    assert.equal(streams.update(sibling, true), false, sibling);
    assert.deepEqual(streams.failures, ["water"]);
  }
  assert.equal(streams.update("water", true), true);
  assert.deepEqual(streams.failures, []);
});

test("system and water failures clear only after each critical stream recovers", () => {
  const streams = createCriticalStreamHealthTracker();
  assert.equal(streams.update("water", false), false);
  assert.equal(streams.update("system", false), false);
  assert.deepEqual(streams.failures, ["system","water"]);
  assert.equal(streams.update("water", true), false);
  assert.equal(streams.update("rain", true), false);
  assert.deepEqual(streams.failures, ["system"]);
  assert.equal(streams.update("system", true), true);
  assert.equal(streams.update("system", false), false, "later failure must be noticed");
  assert.equal(streams.update("system", undefined), false, "missing child is not healthy");
  assert.equal(streams.update("system", true), true);
});

test("live provider uses independent critical child failure tracking", () => {
  const provider = readFileSync("providers/flood-provider.tsx", "utf8");
  assert.match(provider, /createCriticalStreamHealthTracker\(\)/);
  assert.match(provider, /criticalStreams\.update\(key, healthy\)/);
  assert.match(provider, /updateCriticalStatus\(key, false\)/);
  assert.match(provider, /updateCriticalStatus\(key, parsed\.success && raw !== null\)/);
  assert.doesNotMatch(provider, /if \(parsed\.success && raw !== null\) setError\(null\)/);
});

test('source-bound water freshness accepts a coherent recent attested sample shape', () => {
  const frame = {
    stream: 'water', sourceId: 'ultrasonic-1', epoch: 4,
    sequence: 41, observedAt: now - 4_000, receivedAt: now - 3_000
  };
  const evaluate = (observation, extra = {}) => classifySourceBoundFreshness({
    loading: false, hasData: true, connected: true, error: false,
    stream: 'water', observation, nowMs: now, ...extra
  });
  assert.equal(evaluate(frame), 'live');
  assert.equal(evaluate(frame, {prior: {
    sourceId: 'ultrasonic-1', epoch: 4, sequence: 40,
    observedAt: now - 6_000, receivedAt: now - 5_000
  }}), 'live');
  assert.equal(evaluate(frame, {connected: false}), 'stale');
  assert.equal(evaluate(frame, {loading: true}), 'loading');
  assert.equal(evaluate(frame, {hasData: false}), 'unavailable');
});
test('new system heartbeat cannot freshen an old water or rain observation', () => {
  for (const stream of ['water', 'rain']) {
    const reading = {
      stream, sourceId: stream + '-sensor', epoch: 1, sequence: 7,
      observedAt: now - 60_000, receivedAt: now - 1_000
    };
    const newerUnrelatedSystemLastUpdate = now - 500;
    assert.ok(newerUnrelatedSystemLastUpdate > reading.observedAt);
    assert.equal(classifySourceBoundFreshness({
      stream, observation: reading, hasData: true,
      connected: true, nowMs: now
    }), 'stale');
  }
});
test('unknown, mismatched, malformed, future or replayed source metadata fails closed', () => {
  const good = {
    stream: 'water', sourceId: 'water-1', epoch: 3,
    sequence: 102, observedAt: now - 3_000, receivedAt: now - 2_000
  };
  const evaluate = (observation, extra = {}) => classifySourceBoundFreshness({
    stream: 'water', observation, hasData: true,
    connected: true, nowMs: now, ...extra
  });
  for (const observation of [
    null,
    {...good, stream: 'rain'}, {...good, sourceId: ''},
    {...good, epoch: -1}, {...good, sequence: 0},
    {...good, observedAt: undefined},
    {...good, receivedAt: undefined},
    {...good, observedAt: now + 60_000},
    {...good, receivedAt: now + 60_000},
    {...good, observedAt: now - 12_000, receivedAt: now - 1000},
    {...good, observedAt: now - 2000, receivedAt: now - 9000}
  ]) assert.equal(evaluate(observation), 'stale', JSON.stringify(observation));
  assert.equal(evaluate(good, {prior: {
    sourceId: 'water-1', epoch: 3, sequence: 102,
    observedAt: now - 4_000, receivedAt: now - 3_000
  }}), 'stale');
  assert.equal(evaluate(good, {prior: {
    sourceId: 'water-1', epoch: 4, sequence: 101,
    observedAt: now - 4_000, receivedAt: now - 3_000
  }}), 'stale');
  assert.equal(evaluate(good, {prior: {
    sourceId: 'other-sensor', epoch: 3, sequence: 101,
    observedAt: now - 4_000, receivedAt: now - 3_000
  }}), 'stale');
});
test('source freshness prototype is not wired to unauthenticated live provider', () => {
  const provider = readFileSync('providers/flood-provider.tsx', 'utf8');
  const helper = readFileSync('lib/telemetry-health.mjs', 'utf8');
  assert.match(helper, /classifySourceBoundFreshness/);
  assert.doesNotMatch(provider, /classifySourceBoundFreshness/);
});

test('higher sequence cannot disguise observation-time or receipt-clock rollback', () => {
  const frame = {
    stream: 'water', sourceId: 'ultrasonic-A', epoch: 9, sequence: 103,
    observedAt: now - 3_000, receivedAt: now - 2_000
  };
  const previous = {
    sourceId: frame.sourceId, epoch: frame.epoch, sequence: 102,
    observedAt: now - 4_000, receivedAt: now - 3_000
  };
  const evaluate = (prior) => classifySourceBoundFreshness({
    stream: 'water', observation: frame,
    hasData: true, connected: true, nowMs: now, prior
  });
  assert.equal(evaluate(previous), 'live');
  assert.equal(evaluate({...previous, observedAt: now - 2_000}), 'stale',
    'new sequence must not excuse rolled-back sensor observation time');
  assert.equal(evaluate({...previous, receivedAt: now - 1_000}), 'stale',
    'new sequence must not excuse rolled-back trusted receipt clock');
  assert.equal(evaluate({...previous, observedAt: undefined}), 'stale');
  assert.equal(evaluate({...previous, receivedAt: undefined}), 'stale');
  assert.equal(evaluate({...previous, observedAt: now + 60_000}), 'stale');
  assert.equal(evaluate({...previous, receivedAt: now + 60_000}), 'stale');
  assert.equal(evaluate({...previous, sequence: 103}), 'stale');
});
