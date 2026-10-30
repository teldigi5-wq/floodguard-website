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

/**
 * R2 LAB CONTRACT ONLY: never infer one sensor's freshness from
 * system.lastUpdate, a sibling sensor, or the time a Firebase listener fires.
 *
 * The receipt is assumed to be bound to this sensor observation by a trusted
 * publisher; this pure function does NOT authenticate identities/signatures,
 * establish durable anti-replay, or validate an unsynchronised hardware clock.
 * Do not use it for production live claims until ingestion attestation exists.
 */
export function classifySourceBoundFreshness({
  loading = false, hasData = false, connected = null, error = false,
  stream, observation, prior = null, nowMs = Date.now()
} = {}) {
  if (loading) return 'loading';
  if (!hasData) return 'unavailable';
  if (connected !== true || error || !Number.isFinite(nowMs)) return 'stale';
  if (stream !== 'water' && stream !== 'rain') return 'stale';
  if (!observation || typeof observation !== 'object' || Array.isArray(observation))
    return 'stale';
  if (observation.stream !== stream) return 'stale';
  if (typeof observation.sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(observation.sourceId))
    return 'stale';
  if (!Number.isSafeInteger(observation.epoch) || observation.epoch < 0 ||
      !Number.isSafeInteger(observation.sequence) || observation.sequence <= 0)
    return 'stale';

  // Changing a source, epoch, or replaying a sequence needs explicit
  // authorised re-baselining by an ingestion authority, not an auto-accept.
  const observed = parseFieldTimestamp(observation.observedAt, nowMs);
  const received = parseFieldTimestamp(observation.receivedAt, nowMs);
  if (observed === null || received === null ||
      received < observed - MAX_CLOCK_LEAD_MS) return 'stale';

  if (prior !== null) {
    if (!prior || observation.sourceId !== prior.sourceId ||
        observation.epoch !== prior.epoch ||
        !Number.isSafeInteger(prior.sequence) ||
        observation.sequence <= prior.sequence) return 'stale';

    // A higher sequence alone cannot disguise a rolled-back sensor or
    // receipt clock. Require explicit previous timestamps for comparison;
    // this remains an in-memory proof shape, not durable anti-replay.
    const previousObserved = parseFieldTimestamp(prior.observedAt, nowMs);
    const previousReceived = parseFieldTimestamp(prior.receivedAt, nowMs);
    if (previousObserved === null || previousReceived === null ||
        previousReceived < previousObserved - MAX_CLOCK_LEAD_MS ||
        observed < previousObserved || received < previousReceived)
      return 'stale';
  }
  const observedAge = ageSeconds(observed, nowMs);
  const receivedAge = ageSeconds(received, nowMs);
  if (observedAge === null || receivedAge === null) return 'stale';
  return classifyTelemetryFreshness({
    loading: false, hasData: true, connected, error,
    ageSeconds: Math.max(observedAge, receivedAge)
  });
}
