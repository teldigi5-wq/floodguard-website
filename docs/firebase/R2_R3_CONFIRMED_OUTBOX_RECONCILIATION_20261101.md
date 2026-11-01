# FloodGuard R2/R3 — Read-only outbox/database confirmation reconciliation (2026-11-01)

**Synthetic-only isolated source and Firebase RTDB Emulator tests. No production DB connection, publication, deletion, acknowledgment, real device, alert, or gate interaction. NO-GO.**

## Why this checkpoint matters

In [PR #41](https://github.com/teldigi5-wq/floodguard-website/pull/41), the loopback HTTPS handler can place a full signed sensor frame and per-device replay high-water in a durable local journal. This gives a *local* 201 `LOCAL_DURABLE_ADMISSION_ONLY`, **not** a Firebase or human-warning delivery receipt. Earlier draft [PR #39](https://github.com/teldigi5-wq/floodguard-website/pull/39) demonstrated an atomic **emulator-only** update of public water telemetry and a private published checkpoint from a separately confirmed synthetic frame. The gap between these developments is independent **read-back comparison** before attempting to retire an outbox entry.

`experiments/confirmed-outbox-reconciliation-lab.mjs` is deliberately a **pure, read-only function**. It takes one retained signed outbox entry, an independently retrieved RTDB root snapshot, operator-provisioned device identity and trusted receipt key, plus a signed Stage 8 receipt, then refuses to assert a match unless all exact conditions hold:

1. The local signed payload is valid under the original Stage 7 frame contract; its digest, sequence, device, epoch and Ed25519 device signature match the operator-provisioned identity.
2. The private `projectionControl.waterAuthority` is enabled, scope-bound and pins the independent receipt signer's Ed25519 SPKI fingerprint. The per-device membership is still enabled under the approved ingest scope.
3. The recorded `confirmedIngest` tuple has `DATABASE_CONFIRMED` status and **exactly** the same device, epoch, sequence, SHA-256 payload digest and accepted timestamp as the signed Stage 8 receipt. The receipt must verify under the pinned issuer and its accepted time must not precede local admission or exceed the read-back clock.
4. The private atomic publication high-water checkpoint has the **exact same sequence and digest**. Older entries that have been superseded by later publication are *not* considered individually proven by the latest checkpoint alone.
5. The entire public tree obeys PR #34's exact scalar allowlist, has no unexpected public groups, nested objects or fields, and the five published water/system scalars exactly match the retained signed payload. Global risk remains `UNKNOWN`; a signed `SAFE` does not certify physical clearance.

It returns either a denial or `SYNTHETIC_DB_SNAPSHOT_MATCH_NO_ACK` with `canAcknowledge:false`. There is **no outbox delete, acknowledge, dequeue, persistent clear, notification or servo action**. This prevents a source of data loss: a single observed current checkpoint cannot establish that each older outbox event was durably processed or historically delivered.

## Emulator and test evidence

- Offline suite exercises the **actual PR #41 sealed outbox** (not a fabricated stand-in) and independently signed synthetic receipt. Negative cases cover forged signatures/keys, wrong issuer, confirmation absent or pending, identity revocation, superseded or conflicting high-water checkpoint, schema injection, projection mismatch, future receipt timestamp and missing DB.
- A separate loopback Firebase RTDB Emulator suite seeds only synthetic data, reads back a privileged server-side snapshot, tests exactly approved public scalar reads, denies anonymous access to private root and confirmation records, rejects superseded checkpoints, and demonstrates nested-object exposure if a privileged writer corrupts a public leaf. That exposure is **not a solution**; strict publisher isolation and corruption detection are still mandatory.
- Existing loopback HTTPS + journal regression tests, full website tests, lint, TypeScript check and Next.js build run in branch-specific CI. Results must be verified against the final head before acceptance.

## Security limits and next release gates

A plain JavaScript `root` argument, a public key supplied by an arbitrary caller or emulator-seeded `DATABASE_CONFIRMED` record is **not independently trustworthy**. This function must never be exposed as an HTTP API accepting caller-chosen trust roots or database snapshots. A production service must authenticate the transport and identity, enforce independently durable operator authority/revocation and receipt issuance, and fetch the protected DB snapshot using a restricted server identity. The privileged emulator context here is an artificial test capability, **not an endorsement of broad Admin SDK production access**.

There is no external anti-rollback anchor for local commissioning/replay history, no independently issued durable cloud receipt or crash-verified publication service, no guarantee against a privileged actor forging both DB and public state, and no authenticated end-user warning delivery evidence. Do not add ACK/compaction until the trusted publisher, per-message evidence retention and crash-safety/rollback tests are complete. Local receipt recovery can remain indefinitely buffered in this bounded test journal (test-only capacity); production must design operational retention, backpressure and outage escalation.

Original ESP8266 firmware still needs TLS certificate verification and device identity migration. The Arduino's sensor-error handling and gate safety require physical validation. The current owner-published Firebase lockdown remains in place.

**No merge, deploy, firmware flash, gate operation or public rules change. Production NO-GO.**
