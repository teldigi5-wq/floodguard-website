# FloodGuard Stage R2 — source-bound freshness contract (research branch)

**Status: offline helper and deterministic tests only. NOT wired to production, firmware, or the live website provider.**

## Confirmed gap
The existing website provider derives its `live` freshness state from `system.lastUpdate`. A new system heartbeat can make an old water/rain reading look recent. The field schema currently has no independently authenticated observation clock per sensor; Firebase connection time is not observation time.

## Proposed per-source envelope
A trusted ingestion service must bind each sensor observation to `stream` (`water` or `rain`), `sourceId`, authorization-controlled `epoch`, monotonic `sequence`, `observedAt`, and trustworthy `receivedAt`. Timestamp fields in the new offline helper are accepted for shape and relative-age checking; this does not prove they are genuine. The server must authenticate the publisher and tie the recorded timestamp/sequence to verified source data.

`classifySourceBoundFreshness` fails closed when metadata is missing, from a different stream, expired, future-dated, malformed, nonmonotonic relative to a caller-provided prior value, or disconnected. The 10-second window is inherited from existing website prototypes. A separate `system.lastUpdate` value is deliberately not accepted as an argument.

## Migration preconditions
1. Verify firmware payloads, local clocks, server receipt clocks, sensor calibration, and network-delivery jitter with physical evidence. Unsynchronised ESP8266 clocks must not be treated as trusted wall clocks.
2. Define and test a server-side attestation and durable anti-replay/rollback policy; the helper's optional `prior` is **not** durable replay protection.
3. Write read-only compatibility and negative tests covering stale water + fresh heartbeat, delayed readings, restarts, clock changes, epoch rotation, per-sensor outage, and split child updates for website, bot and Android.
4. Agree on signed or otherwise authenticated source attribution and a safe staged RTDB schema; do not grant anonymous writes.
5. Only then wire this into all clients, review visible STALE/UNKNOWN displays, test on a staging emulator and plan a reversible deployment.

No production Firebase rules, hardware, WhatsApp, bot host, protected main, or live website were changed. The release remains **NO-GO**.
