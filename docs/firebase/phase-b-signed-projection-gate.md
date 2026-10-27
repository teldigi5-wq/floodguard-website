# Signed telemetry-to-public projection gate — offline prototype

**No production or Firebase write capability. The release remains NO-GO.**

This revision adds `experiments/strict-signed-projection-gate.mjs` as a pure projection *planner* to sit between private, enrolled-device observations and a future **separately authorized** public telemetry publisher. Its purpose is to reject unsafe source data before any client-visible write is even proposed.

## Preconditions checked

- Exact Stage 7 canonical envelope: device ID, epoch, observation time, four bounded fields, no extra keys, and no gate or network metadata.
- Enabled operator-controlled device registry binding for the exact device and epoch, scoped to `prototype-ingest-v1`.
- Valid Stage 8 Ed25519 server receipt signature and a cryptographic SHA-256 digest matching the exact canonical envelope.
- Independently recorded Stage 9 `DATABASE_CONFIRMED` for the same device/epoch/sequence/digest/accepted-time receipt. A signed **ACCEPTED_ONLY** record is not enough.
- Source observation timestamp and receipt-acceptance time lie within a tightly bounded 30-second window of the *injected test clock* and no more than 2 seconds in the future. This does **not** establish that a physical clock is authentic.
- An explicit previous-publication checkpoint is present. Same-epoch sequence must strictly advance; epoch replacement requires operator review. An omitted checkpoint after restart must never be treated as a first installation.

## Output if—and only if—all tests pass

One immutable value marked `OFFLINE_PROJECTION_PLAN_NOT_APPLIED`, with exactly five whitelisted child paths:

```text
/floodguard/live/water/distanceCm
/floodguard/live/water/levelCm
/floodguard/live/water/status
/floodguard/live/system/lastUpdate
/floodguard/live/system/overallRisk  (always UNKNOWN)
```

The proposed overall flood risk is **UNKNOWN**, because a water-only observation cannot establish rainfall, real sensor calibration, gate position or physical field safety. The plan intentionally excludes private ESP8266 networking identifiers, commands, actuator paths, identity records, broad parent updates and WhatsApp. Source authenticity, device trust, persistent projection checkpoint and receipt/delivery confirmation are **not** established by a pure function with caller-supplied inputs.

## Critical missing production components

- Verified actual ESP8266 firmware protocol; authenticated credential provisioning/refresh, certificate validation and device-clock bootstrap.
- Trusted ingestion implementation that obtains raw identity/authorization, server-signed acceptance proof and confirmed database persistence from secure sources (rather than trusting arbitrary caller objects).
- A durable, concurrent, revocation-aware **projector service** with a transactionally recorded per-device checkpoint and exact-path output allowlisting, strict least-privilege server credentials and verified source-to-public round trip. Privileged server writes bypass ordinary Firebase client Security Rules.
- A production freshness policy for multi-sensor fusion; no publishing of stale-but-plausible SAFE risk or inferred gate actuation.
- A non-production isolated authenticated integration run, supervised physical acceptance, documented rollback and explicit owner approval.

This planner **does not** implement any publisher. It performs no network calls, Firebase reads/writes, process-environment lookups, WhatsApp, device action or persistence. It must never be deployed as a ready-made service.

## Verification evidence

Run the existing Node test suite and both Phase B emulator jobs on the exact PR commit. `tests/strict-signed-projection-gate.test.mjs` checks signed acceptance, digest forgery, authorizer scope/UID, database confirmation, timestamp integrity, restart checkpoint, replay, epoch replacement and fixed-path/secret-free output. Review the live workflow result before declaring verification.
