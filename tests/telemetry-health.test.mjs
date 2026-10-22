import test from "node:test";
import assert from "node:assert/strict";
import { ageSeconds, classifyTelemetryFreshness, parseFieldTimestamp } from "../lib/telemetry-health.mjs";

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
