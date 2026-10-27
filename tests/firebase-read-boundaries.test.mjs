import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReadBoundaries, validateFirebaseUrl,
  ALLOWED_PUBLIC_PATHS, MUST_DENY_PATHS,
} from "../scripts/verify-firebase-read-boundaries.mjs";

const base = "https://floodguard-e3215-default-rtdb.asia-southeast1.firebasedatabase.app";
test("read-only auditor accepts only HTTPS Firebase RTDB origins", () => {
  assert.equal(validateFirebaseUrl(base), base);
  for (const url of [
    "http://floodguard-e3215-default-rtdb.asia-southeast1.firebasedatabase.app",
    "https://evil.test",
    "https://firebaseio.com.evil.test",
    base + "/floodguard/live",
    base + "/?auth=secret",
  ]) assert.throws(() => validateFirebaseUrl(url));
});

test("read-only auditor verifies leaf grants and parent/private denies", async () => {
  const visited = [];
  const mockedFetch = async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    visited.push(url);
    const denied = MUST_DENY_PATHS.some((p) => url.endsWith("/" + p + ".json"));
    return { status: denied ? 401 : 200, body: { cancel: async () => {} } };
  };
  const result = await checkReadBoundaries({ databaseUrl: base, fetcher: mockedFetch });
  assert.equal(result.passed, true);
  assert.equal(visited.length, ALLOWED_PUBLIC_PATHS.length + MUST_DENY_PATHS.length);
  assert.ok(!visited.some((url) => url.endsWith("/floodguard/live.json?auth=secret")));
});

test("still-public ESP network fields cause failure without disclosing response data", async () => {
  const fetcher = async () => ({ status: 200, body: { cancel: async () => {} } });
  const result = await checkReadBoundaries({ databaseUrl: base, fetcher });
  assert.equal(result.passed, false);
  const privateIp = result.results.find((r) => r.path.endsWith("esp8266/ip"));
  assert.deepEqual({ status: privateIp.status, success: privateIp.success },
    { status: 200, success: false });
  assert.ok(!JSON.stringify(result).includes("192.168."));
});

test("network failure is not mistaken for a secure deny", async () => {
  const result = await checkReadBoundaries({
    databaseUrl: base,
    fetcher: async () => { throw new Error("connection failed"); },
  });
  assert.equal(result.passed, false);
  assert.ok(result.results.every((row) => row.status === "NETWORK_ERROR"));
});
