import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describePublicRainObservation } from "../lib/public-health-observation.mjs";

const root = resolve(import.meta.dirname, "..");
const read = async (f) => readFile(resolve(root, f), "utf8");

test("Vercel build uses Next.js, not the old Cloudflare preview runtime", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.name, "floodguard-website");
});

test("Firebase sample rules never allow anonymous live-data overwrites", async () => {
  const rules = JSON.parse(await read("firebase.rules.json")).rules;
  assert.equal(rules[".write"], false);
  assert.equal(rules.floodguard.live.esp8266.ip[".read"], false);
  assert.equal(rules.floodguard.live.esp8266.wifi[".read"], false);
  assert.equal(rules.floodguard.live.water[".read"], true);
  const raw = JSON.stringify(rules);
  assert.ok(!raw.includes('".write":true'));
});

test("all website routes exist", async () => {
  for (const url of ["", "about", "dashboard", "devices", "diagnostics", "gate", "impact", "rainfall", "safety", "system", "water"]) {
    await stat(resolve(root, "app", url, "page.tsx"));
  }
});

test("unconfigured Firebase does not silently point to old project", async () => {
  const firebase = await read("lib/firebase.ts");
  assert.ok(firebase.includes("NEXT_PUBLIC_FIREBASE_DATABASE_URL"));
  assert.ok(!firebase.includes("floodguard-e3215-default-rtdb"));
});

test("public subscriptions comply with restrictive Firebase rules", async () => {
  const rules = JSON.parse(await read("firebase.rules.json")).rules.floodguard.live;
  const provider = await read("providers/flood-provider.tsx");
  assert.ok(!provider.includes('ref(db, LIVE_PATH),'), "Must not subscribe to a restricted RTDB parent");
  assert.ok(provider.includes('`${LIVE_PATH}/${key}`'), "Must subscribe to public telemetry branches");
  assert.ok(provider.includes('`${LIVE_PATH}/esp8266/${key}`'), "Must restrict ESP listeners to safe children");
  for (const key of ["water", "rain", "gate", "alarm", "devices", "system"]) {
    assert.equal(rules[key][".read"], true, `${key} must be publicly readable`);
  }
  for (const key of ["connection", "rssi", "status"]) {
    assert.equal(rules.esp8266[key][".read"], true, `esp8266/${key} must be publicly readable`);
  }
  for (const key of ["ip", "wifi"]) {
    assert.equal(rules.esp8266[key][".read"], false, `esp8266/${key} must remain private`);
  }
});

test("retained Firebase measurements remain clearly marked as historical", async () => {
  const provider = await read("providers/flood-provider.tsx");
  const panel = await read("components/page-kit.tsx");
  assert.ok(provider.includes('lastUpdateMs: stamp'));
  assert.ok(provider.includes("classifyTelemetryFreshness"),
    "Field freshness must be derived from the independently tested state model");
  assert.ok(!provider.includes('age > 60) freshness = "unavailable"'));
  assert.ok(panel.includes("Last recorded readings — not live"));
  assert.ok(panel.includes("lastSeenLabel(lastUpdateMs)"));
});

test("historical hardware states must not appear live", async () => {
  const devices = await read("app/devices/page.tsx");
  const rain = await read("app/rainfall/page.tsx");
  const gate = await read("app/gate/page.tsx");
  assert.ok(devices.includes("LAST REPORTED:"), "Historic device state label is required");
  assert.ok(rain.includes("describePublicRainObservation"), "Rain surface must use qualified shared reporting");
  assert.ok(rain.includes("view.gaugeLabel"), "Rain gauge status must not be derived directly from a single raw child");
  // Retain and strengthen this inherited freshness contract: absent/stale
  // and contradictory sensor health cannot declare physical sensor ONLINE.
  for (const input of [
    {rain:{status:"NORMAL",currentMm:0,dailyMm:0,sensorStatus:"ONLINE"},device:"OFFLINE",freshness:"live"},
    {rain:{status:"NORMAL",currentMm:0,dailyMm:0,sensorStatus:"ONLINE"},device:"ONLINE",freshness:"stale"},
    {rain:null,device:"ONLINE",freshness:"live"}
  ]) {
    const view=describePublicRainObservation(input);
    assert.notEqual(view.gaugeLabel,"REPORTED ONLINE · UNVERIFIED");
    assert.equal(view.currentMm,null);
    assert.equal(view.dailyMm,null);
    assert.equal(view.canDeclareNormal,false);
  }
  assert.ok(gate.includes("activeCountdown"), "Historical countdowns must never animate as active timers");
  // H15 disabled operational-style release animations entirely; recency
  // alone must NOT authorize a visual that resembles physical discharge.
  assert.ok(gate.includes("const releaseActive = false;"),
    "Unsigned gate telemetry must not imply active physical discharge");
  assert.ok(gate.includes("describeGateObservation({ gate, freshness })"),
    "Gate state must pass the fail-closed reported-position contract");
  assert.ok(gate.includes("Physical gate closure and countdown are not independently verified."),
    "A reported countdown cannot prove an actual closed gate");
});

test("template RTDB rules cannot grant private ESP access through readable ancestors", async () => {
  const rules = JSON.parse(await read("firebase.rules.json")).rules;
  const ancestors = [rules, rules.floodguard, rules.floodguard.live, rules.floodguard.live.esp8266];
  for (const group of ancestors) {
    assert.notEqual(group[".read"], true,
      "Read grants on parent RTDB paths expose even explicitly denied descendants");
  }
});
