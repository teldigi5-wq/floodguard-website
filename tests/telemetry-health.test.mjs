import test from "node:test";
import assert from "node:assert/strict";
import { ageSeconds, classifyTelemetryFreshness, parseFieldTimestamp, createCriticalStreamHealthTracker, createEspChildObservationTracker } from "../lib/telemetry-health.mjs";
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


test("ESP observations require all independently subscribed public children",()=>{
  const esp=createEspChildObservationTracker();
  assert.equal(esp.complete,false);
  assert.equal(esp.record("status","ONLINE",true),null);
  assert.equal(esp.record("connection","ONLINE",true),null);
  const ready=esp.record("rssi",-72,true);
  assert.deepEqual(ready,{connection:"ONLINE",status:"ONLINE",rssi:-72});
  assert.equal(esp.complete,true);
  assert.equal(Object.isFrozen(ready),true);
});

test("ESP child rejection clears cached ONLINE and siblings cannot resurrect it",()=>{
  const esp=createEspChildObservationTracker();
  esp.record("status","ONLINE",true);
  esp.record("connection","ONLINE",true);
  assert.equal(esp.record("rssi",-70,true).status,"ONLINE");
  // Rejected rssi on the current live stream invalidates the entire report.
  assert.equal(esp.record("rssi",500,false),null);
  assert.equal(esp.complete,false);
  assert.equal(esp.record("connection","ONLINE",true),null);
  assert.equal(esp.record("rssi",-62,true),null);
  // A conflicting OFFLINE/ONLINE pair must NOT restore a positive report.
  assert.equal(esp.record("status","OFFLINE",true),null);
  assert.equal(esp.complete,false);
  const recovered=esp.record("connection","OFFLINE",true);
  assert.equal(recovered.status,"OFFLINE");
  assert.equal(recovered.connection,"OFFLINE");
  assert.equal(esp.complete,true);
});

test("ESP permission/cancellation failure clears and requires fresh independent callbacks",()=>{
  const esp=createEspChildObservationTracker();
  esp.record("status","ONLINE",true);
  esp.record("connection","ONLINE",true);
  assert.ok(esp.record("rssi",-80,true));
  assert.equal(esp.fail(),null);
  assert.equal(esp.record("rssi",-85,true),null);
  assert.equal(esp.record("status","UNKNOWN",true),null);
  assert.deepEqual(esp.record("connection","OFFLINE",true),
    {connection:"OFFLINE",status:"UNKNOWN",rssi:-85});
});

test("contradictory ONLINE/OFFLINE/UNKNOWN children cannot appear as an online field connection",()=>{
  for(const [status,connection] of [
    ["ONLINE","OFFLINE"],["OFFLINE","ONLINE"],
    ["ONLINE","UNKNOWN"],["UNKNOWN","ONLINE"],
    ["ONLINE","ERROR"],["NOT_INSTALLED","ONLINE"]
  ]){
    const esp=createEspChildObservationTracker();
    esp.record("status",status,true);
    esp.record("connection",connection,true);
    assert.equal(esp.record("rssi",-67,true),null,
      "contradiction "+status+"/"+connection);
    assert.equal(esp.complete,false,
      "conflict must not become an apparently complete report");
    // RSSI updates may still arrive while the two statuses disagree.
    assert.equal(esp.record("rssi",-60,true),null);
    const repaired = status==="ONLINE"
      ? esp.record("connection","ONLINE",true)
      : esp.record("status","ONLINE",true);
    assert.deepEqual(repaired,{
      connection:"ONLINE",status:"ONLINE",rssi:-60
    });
    assert.equal(esp.complete,true);
  }
});

test("consistently negative and unknown connection states remain reportable, never marked ONLINE",()=>{
  for(const [status,connection] of [
    ["OFFLINE","OFFLINE"],["ERROR","OFFLINE"],
    ["UNKNOWN","OFFLINE"],["NOT_INSTALLED","UNKNOWN"]
  ]){
    const esp=createEspChildObservationTracker();
    esp.record("connection",connection,true);
    esp.record("rssi",null,true);
    assert.deepEqual(esp.record("status",status,true),
      {connection,status,rssi:null});
    assert.equal(esp.complete,true);
  }
});

test("ESP invalid fields and injected child keys cannot report ONLINE",()=>{
  for(const [key,value,valid] of [
    ["ip","192.0.2.1",true],["status","ONLINE",false],
    ["status","connected",true],["connection","ONLINE ".repeat(12),true],
    ["rssi",Number.NaN,true],["rssi",Infinity,true],
    ["rssi",-300,true],["rssi","-75",true]
  ]){
    const esp=createEspChildObservationTracker();
    esp.record("status","ONLINE",true);
    esp.record("connection","ONLINE",true);
    esp.record("rssi",-75,true);
    assert.equal(esp.record(key,value,valid),null,key);
    assert.equal(esp.complete,false,key);
  }
  const esp=createEspChildObservationTracker();
  esp.record("status","UNKNOWN",true);
  esp.record("connection","OFFLINE",true);
  assert.deepEqual(esp.record("rssi",null,true),
    {connection:"OFFLINE",status:"UNKNOWN",rssi:null});
});

test("actual website provider clears the ESP report on invalid or cancelled child",()=>{
  const provider=readFileSync("providers/flood-provider.tsx","utf8");
  assert.match(provider,/createEspChildObservationTracker\(\)/);
  assert.match(provider,/espTracker\.record\(key, parsed\.data, true\)/);
  assert.match(provider,/espTracker\.fail\(\)/);
  assert.match(provider,/setEspObservation\(null\)/);
  assert.match(provider,/delete next\.esp8266/);
  assert.doesNotMatch(provider,/esp8266: \{ \.\.\.previous\?\.esp8266, \[key\]: parsed\.data \}/);
});
