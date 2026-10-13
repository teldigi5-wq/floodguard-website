import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ALLOWED_PUBLIC_PATHS = Object.freeze([
  "floodguard/live/water",
  "floodguard/live/rain",
  "floodguard/live/gate",
  "floodguard/live/alarm",
  "floodguard/live/devices",
  "floodguard/live/system",
  "floodguard/live/esp8266/connection",
  "floodguard/live/esp8266/rssi",
  "floodguard/live/esp8266/status",
]);
export const MUST_DENY_PATHS = Object.freeze([
  "floodguard",
  "floodguard/live",
  "floodguard/live/esp8266",
  "floodguard/live/esp8266/ip",
  "floodguard/live/esp8266/wifi",
  "floodguard/bot",
  "floodguard/test",
]);

export function validateFirebaseUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !/(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app)$/.test(host) ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Expected an HTTPS Firebase RTDB origin with no path, tokens, query, or fragment");
  }
  return url.origin;
}

/**
 * Safe non-mutating health probe. Checks only HTTP statuses and never
 * processes, prints, stores, or forwards response bodies (including
 * sensitive ESP8266 fields while production rules are still exposed).
 */
export async function checkReadBoundaries({
  databaseUrl,
  fetcher = fetch,
  timeoutMs = 12000,
} = {}) {
  const origin = validateFirebaseUrl(databaseUrl);
  const results = [];
  for (const [path, expected] of [
    ...ALLOWED_PUBLIC_PATHS.map((p) => [p, "allow"]),
    ...MUST_DENY_PATHS.map((p) => [p, "deny"]),
  ]) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetcher(
        origin + "/" + path + ".json",
        { method: "GET", redirect: "manual", cache: "no-store", signal: abort.signal },
      );
      // Cancel rather than read response: do NOT emit actual database content.
      try { await response.body?.cancel?.(); } catch { /* response may already be closed */ }
      const allowed = expected === "allow";
      const success = allowed ? response.status === 200
        : response.status === 401 || response.status === 403;
      results.push({ path, expected, status: response.status, success });
    } catch {
      // Network failures are NOT evidence that Firebase denied access.
      results.push({ path, expected, status: "NETWORK_ERROR", success: false });
    } finally {
      clearTimeout(timer);
    }
  }
  return { passed: results.every((r) => r.success), results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.FG_RTDB_URL || process.argv[2];
  if (!databaseUrl) {
    console.error("Set FG_RTDB_URL to your Firebase Realtime Database HTTPS root URL.");
    process.exitCode = 2;
  } else {
    try {
      const audit = await checkReadBoundaries({ databaseUrl });
      for (const row of audit.results) {
        console.log(
          (row.success ? "PASS" : "FAIL") + " " + row.path
          + " expected=" + row.expected + " HTTP=" + row.status,
        );
      }
      console.log(audit.passed
        ? "All public/privacy READ boundaries passed; write permissions are NOT assessed."
        : "Read boundaries failed. No database data or rules were modified.");
      process.exitCode = audit.passed ? 0 : 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
