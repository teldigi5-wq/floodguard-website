import test from "node:test";
import assert from "node:assert/strict";
import { ageSeconds, classifyTelemetryFreshness, parseFieldTimestamp, createCriticalStreamHealthTracker } from "../lib/telemetry-health.mjs";

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

test("one critical child failure is not erased by successful unrelated callbacks",()=>{
  const tracker=createCriticalStreamHealthTracker();
  assert.equal(tracker.update("water",false),false);
  for(const s of ["rain","gate","alarm","devices","esp8266"])
    assert.equal(tracker.update(s,true),false);
  assert.deepEqual(tracker.failures,["water"]);
  assert.equal(tracker.update("water",true),true);
});

test("system and water failures need independent valid source recovery",()=>{
  const tracker=createCriticalStreamHealthTracker();
  assert.equal(tracker.update("system",false),false);
  assert.equal(tracker.update("water",false),false);
  assert.equal(tracker.update("water",true),false);
  assert.deepEqual(tracker.failures,["system"]);
  assert.equal(tracker.update("system",true),true);
  assert.equal(tracker.update("system",false),false);
  assert.equal(tracker.update("system",null),false);
});
