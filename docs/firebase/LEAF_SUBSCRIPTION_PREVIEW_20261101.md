# R3 — Primitive leaf subscription preview lab (1 November 2026)

**DRAFT, TEST-ONLY.** This is a stacked follow-up to [PR #35](https://github.com/teldigi5-wq/floodguard-website/pull/35), itself based on [PR #34](https://github.com/teldigi5-wq/floodguard-website/pull/34). No production Firebase reads, writes, rules changes, credentials, hardware changes, actuator control, WhatsApp messages, website deployment or Android release. **NO-GO**.

## Purpose

An operator has already applied a temporary Firebase lockdown after finding deployed anonymous read/write permissions under `/floodguard/live`. Four operator-run anonymous read probes returned HTTP 401 after the lockdown, but other rules and write permissions have not been verified by independent production testing. Current legacy website/mobile/WhatsApp monitoring is intentionally interrupted. **Never restore unrestricted public writes to regain telemetry.**

`experiments/public-leaf-subscription-adapter-lab.mjs` builds strictly on PR #35's pure reducer and PR #34's reviewed primitive allowlist. A trusted test caller supplies `subscribe(path,onValue,onError)` returning an unsubscribe function. This module is **not** wired to the real Firebase SDK or the running Next.js provider. It creates no browser listeners or requests unless an external caller explicitly supplies an adapter.

- It subscribes only to the 24 allowlisted primitive telemetry leaves. No `/floodguard/live` legacy parent, group root, ESP IP/Wi-Fi metadata, or command path is visited.
- It rejects any extra or reentrant concurrent start, retains unique per-session generations, and unregisters all acquired leaf observers on stop/reconnect/setup failure. Delayed callbacks from retired subscriptions are ignored.
- Errors are classified into denied and generic transport faults without forwarding error bodies, URLs, secrets or exception messages; affected cached records are evicted.
- It invokes PR #35's strict scalar validator and neutral summary, which never upgrades unsigned `SAFE`, `LOW` or `CLOSED` into a safety clearance or verified gate position. Browser receipt time does not establish true source freshness.
- Subscribers receive a defensive copy of state to avoid a UI callback corrupting internal records.

## Evidence and limits

The isolated local Node 22 test suite covers subscription scope, permission denial, object-shaped injection at an approved field, cancellation, reconnect, stale callback, partial-setup failure, defensive copies, receipt staleness and prohibition of network/writes/actuation. A full app/Flutter/bot integration, real emulator read listener, Firebase Authentication and physical acceptance are **not** demonstrated by these tests.

**Critical remaining bridge:** Existing signed ingestion research in website [PR #14](https://github.com/teldigi5-wq/floodguard-website/pull/14) must be assessed and safely reconciled, not reimplemented in a competing gateway. That stack remains a synthetic/loopback laboratory, not an authenticated live service or trusted publish path. The archived v6 ESP8266 code uses anonymous parent PATCH and `setInsecure()`; it is incompatible with the lockdown and must not be operated unchanged as a trusted uploader.

## Required safe rollout sequence

1. Confirm separate verified hardware baseline, physical safe-state policy, mechanical limit/feedback, independent manual override, and actual installed Arduino/ESP8266 versions; do not flash or actuate remotely.
2. Review PR #14 durable signed ingestion work, cryptographic device identity, safe TLS/bootstrap, revocation, replay, publication evidence, clock and crash recovery.
3. Build a server-controlled, least-privilege signed source publication route with persisted checkpoints; deny unknown fields, metadata and commands. Never treat administrative RTDB writes as protected by client rules.
4. Run Firebase Emulator and explicit preview browser/Flutter/bot integration using the immutable 24-field projection and local read adapter; fault-inject denied parent/group reads and stale data.
5. Only under owner-reviewed maintenance and device-safe supervision, deploy the identity and publisher migration, verify writes/reads, inspect real sensor and alert outputs, then cut over consumers; keep a rollback plan that **does not** reopen anonymous writes.

**Status:** Offline read-side subscription adapter lab completed. No trustworthy real-time monitoring restored. Production NO-GO.
