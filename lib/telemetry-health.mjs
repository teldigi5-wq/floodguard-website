/**
 * Pure, browser-independent field timestamp and freshness logic.
 *
 * Firebase connection status alone cannot prove hardware connectivity.
 * Historical telemetry must remain accessible, but not be labelled live.
 */
const MAX_CLOCK_LEAD_MS = 2_000;
const EARLIEST_VALID_MS = Date.UTC(2000, 0, 1);
const FRESH_WINDOW_SECONDS = 10;

/** @param {unknown} value @param {number} [nowMs] */
export function parseFieldTimestamp(value, nowMs = Date.now()) {
  let raw = null;
  if (typeof value === "number" && Number.isFinite(value)) raw = value;
  else if (typeof value === "string" && value.trim() !== "") {
    const normalized = value.trim();
    const candidate = Number(normalized);
    raw = Number.isFinite(candidate) ? candidate : Date.parse(normalized);
  }
  if (raw === null || !Number.isFinite(raw)) return null;
  const timestamp = raw < 1e12 ? raw * 1000 : raw;
  if (timestamp < EARLIEST_VALID_MS || timestamp > nowMs + MAX_CLOCK_LEAD_MS) return null;
  return Math.floor(timestamp);
}

/** @param {number | null} timestampMs @param {number} [nowMs] */
export function ageSeconds(timestampMs, nowMs = Date.now()) {
  if (timestampMs === null || !Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - timestampMs) / 1_000));
}

/**
 * @param {{loading:boolean,hasData:boolean,connected:boolean|null,error:boolean,ageSeconds:number|null}} state
 * @returns {"loading"|"live"|"stale"|"unavailable"}
 */
export function classifyTelemetryFreshness(state) {
  if (state.loading) return "loading";
  if (!state.hasData) return "unavailable";
  if (state.connected === true && !state.error
      && state.ageSeconds !== null && state.ageSeconds >= 0
      && state.ageSeconds <= FRESH_WINDOW_SECONDS) return "live";
  return "stale";
}

/**
 * Track failures on independently subscribed safety-critical RTDB children.
 * A successful rain, gate, device, or ESP callback must NEVER clear a
 * previously observed water/system authorization or validation failure.
 * In-memory only, scoped to one mounted provider subscription lifecycle.
 */
export function createCriticalStreamHealthTracker() {
  const failed = new Set();
  return Object.freeze({
    update(key,healthy) {
      if(key==='water'||key==='system') {
        if(healthy===true) failed.delete(key);
        else failed.add(key);
      }
      return failed.size === 0;
    },
    get healthy() { return failed.size === 0; },
    get failures() { return Object.freeze([...failed].sort()); }
  });
}
