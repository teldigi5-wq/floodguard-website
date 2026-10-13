# ADR-0001 · Field control authority and telemetry truthfulness

**Status:** Accepted for the web client  
**Scope:** Public FloodGuard educational monitoring prototype

## Context

A monitoring dashboard may remain connected to Firebase even when Arduino/ESP hardware has been switched off. Firebase Realtime Database retains the last published records by design. The webpage must not convert an old `ONLINE` string, an old gate angle, or a retained countdown into a claim about current operation.

## Decision

1. **Physical authority stays local.** Arduino/firmware alone determines gate and alarm behavior; the browser is a read-only presentation layer.
2. **Telemetry uses explicit field timestamps.** `system.lastUpdate` is parsed as epoch seconds, milliseconds or ISO strings. Implausible timestamps are rejected for freshness purposes.
3. **Client connectivity is not hardware connectivity.** A recent field timestamp plus connected Firebase client may qualify a report as `live`; otherwise valid retained readings are `stale`. No usable data is `unavailable`.
4. **Historical observations stay visible.** The UI shows last-known values with age and an explicit warning. A stale countdown never runs, stale device ONLINE is never treated as proof of present health, and stale gate data does not animate an active discharge.
5. **Public data is allowlisted.** Subscribe to specific RTDB child paths, never to a parent that contains private ESP network data.
6. **No invented readings.** No zero-filling absent measurements, fake sensor history or unverified alarm clearance.

## Consequences and constraints

- The website remains useful after the field device stops updating, without pretending to be a life-safety system.
- Client clock errors can make a fresh observation appear stale; this is safer than false certainty.
- `system.lastUpdate` is a source timestamp, not cryptographic proof of sensor provenance.
- The current single RTDB live snapshot cannot support durable chart history by itself.
- The system has no server-side authenticated ingestion layer yet. Firebase writer identity and deployed RTDB rules need a separate engineering review.

## Testing

`tests/telemetry-health.test.mjs` covers timestamps in multiple units, future timestamps, aged observations, disconnected cloud transport, and missing data. `tests/source-preflight.test.mjs` guards source-level contract and UI safety labels.

## Future evolution

Add scoped device authentication, append-only timestamped history with retention, Firebase Emulator security-rule tests, an offline hardware integration harness, and Playwright responsive/accessibility checks—without violating physical gate authority.
