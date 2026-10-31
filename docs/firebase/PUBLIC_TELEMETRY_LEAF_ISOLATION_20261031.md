# FloodGuard — Public telemetry primitive-leaf isolation

**31 October 2026. Separate main-based laboratory contract. No deployed Firebase rules, real device integration, public-site cutover, credentials, or physical gate changes. Production NO-GO.**

## Finding

The current checked-in `firebase.rules.json` grants anonymous `.read: true` on six legacy telemetry **group objects**. Firebase RTDB read grants inherit downward: all descendants become readable, even a subsequently added `.read: false` on a private child. Earlier standalone [PR #33](https://github.com/teldigi5-wq/floodguard-website/pull/33) tested that exposure. The deployed rule tree and real public data still need independent verification.

## Isolated design, not a production migration

- `experiments/public-telemetry-leaf-projection-lab.mjs` exports a whitelist-only projector. Input is intended to come **after independently authenticated, schema-validated device ingestion**; this lab does not implement that prerequisite. It copies only known water, rain, gate, alarm, system, device and ESP8266 scalar fields, applies value limits, and excludes unknown fields and whole nested objects by construction. Invalid allowlisted values throw rather than emitting partial or falsely reassuring status.
- `docs/firebase/public-telemetry-leaf-lab.rules.json` defines a **separate path**, `/floodguard/publicTelemetryLabV1`, with anonymous `.read: true` only on 24 named primitive children. **No parent `.read: true` anywhere. All client writes denied.** The existing `/floodguard/live` production-facing tree is neither read nor changed.
- `tests/public-telemetry-leaf-projection-lab.test.mjs` covers whitelist drift, input validation, private metadata stripping, no unsafe SAFE defaults, and absence of network/Firebase code in the pure projector.
- `tests/public-telemetry-leaf-emulator.mjs` verifies individual public primitive grants, denied parent/group reads, nonallowlisted secret siblings denied even when a privileged synthetic fixture inserts them, and all anonymous/ordinary-authenticated writes denied. The runner uses `127.0.0.1:9000`, a `demo-` project, synthetic data and no credentials.
- `.github/workflows/firebase-public-leaf-isolation.yml` runs exact contract tests, actual emulator tests, existing website tests, TypeScript, lint and Next.js build on the isolated branch and main-targeted PR.

**Important limitations:**
1. A public scalar leaf `.read: true` still grants read access to **any descendants stored at that exact leaf**. A privileged Firebase Admin writer can bypass RTDB write validation and accidentally write an object instead of a scalar. Only a verified projector plus least-privilege write path, robust post-write auditing and external source identity can reduce that risk. The lab denies client writes entirely and therefore is not a functioning production publisher.
2. A whitelist can strip private unknown fields, but it **cannot prove that allowed strings or numbers themselves are non-sensitive**. Dataset/domain review remains necessary. The projector copies `status:'SAFE'` and `overallRisk:'LOW'` as *unverified reported values*; it is NOT a trusted physical clearance signal.
3. No secure issuer, authenticated source identity, calibration proof, independently verified per-stream freshness, revocation, anti-replay protection, private publisher IAM, independent rollback witness, cross-system atomicity or operator-approved recovery is supplied by this lab.
4. No production RTDB rules revision is verified or changed. Never deploy this rules file over a live database; it deliberately denies all client writes and is incompatible with the current legacy provider path/ingestion. Do not treat a preview build or green CI as an authorization to switch the public dashboard.
5. We do not know whether the current deployed telemetry groups contain sensitive nested data. Check access statuses using PR #33's **anonymous, GET-only** auditor from a confirmed network, and privately inspect public schema in Firebase Console without exposing the data in CI/logs.

## Required operational migration later

A future *separate approved migration* must implement a scoped server gateway with verified per-device identity, strict source-bound replay/freshness checks and revocation, signing key custody, and an allowlisted primitive publisher with audit/fencing. A controlled preview reader must subscribe to each permitted **field leaf** separately, tolerate missing/unavailable values, and label all states as unverified unless authenticated signed evidence confirms them. Compare outputs against real devices with an independent hardware acceptance protocol. Never cut over the production dashboard or physically actuate a gate from unverified values.

**Stage: public-projection and RTDB leaf isolation laboratory only. Release: NO-GO.**
