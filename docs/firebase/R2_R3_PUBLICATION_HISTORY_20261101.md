# FloodGuard — R2/R3 per-reading publication history rehearsal (2026-11-01)

**Research-only, disposable Firebase RTDB Emulator. No live Firebase SDK publisher, service keys, changed production rules, firmware update, external alert, or gate action. RELEASE NO-GO.**

## Previous checkpoint

- Stacked on [PR #42](https://github.com/teldigi5-wq/floodguard-website/pull/42), exact passed head `df9e0550fea3d16e183f59f6f40497416ce46372`, with a pure **read-only** signed outbox read-back comparison. No ACK or deletion.
- PR #39 introduced an **emulator-only** transaction that updates five authorized water/system scalar fields and `projectionControl.devices[deviceId]` high-water. A newer sequence overwrites the checkpoint. The current checkpoint alone cannot establish evidence for a superseded outbox entry.
- This lab is **not** a production trust authority. Signed Stage 8 receipt keys are provided by the test harness and the root is synthetically seeded by an emulator-only privileged operator; real authenticated sensor identity and an independent durable issuer remain missing.

## New evidence-preserving transaction candidate

`experiments/immutable-publication-history-lab.mjs` wraps PR #39's exact signed/revocable source validation, confirmed-database record match, replay check, timestamp monotonicity and scalar projector. If that base candidate succeeds, a proposed atomic private `/floodguard/publicationHistoryV1` update accompanies the same public 5-field update and checkpoint:

```text
/floodguard/
  publicTelemetryLabV1/              publicly readable scalar leaves ONLY
  projectionControl/devices/...      PRIVATE high-water checkpoint
  publicationHistoryV1/              PRIVATE signed receipt history
    schema, deviceId, epoch, issuerFingerprint
    entries/
      <sequence>/
        sequence, digest, observedAtMs
        distanceCm, levelCm, status, overallRisk
        receipt, receiptSignature
```

- The full existing history must be present and internally valid when the previous checkpoint is initialized. A missing or corrupt record, changed signer, mismatched latest digest, diverged latest public value, replay, bad source-clock order or unexpected field prevents the next proposal.
- Every historical Stage 8 receipt must verify against the **pinned current Ed25519 issuer** and match its exact device/epoch/sequence/digest. A digest binds the admission's original canonical frame, while the separately recorded public scalar values are *local claimed history*, not an independently signed audit of what all clients observed.
- The newest signed evidence entry must match the current private high-water and the last projected public water/system scalar values. A candidate adds a new immutable-by-convention sequence key without deleting earlier records. A malicious privileged writer with root access **can rewrite history despite these checks**; external tamper-evidence/append-only storage is still necessary.
- Deliberate **8-record cap**: exhaustion rejects a new publication instead of pruning earlier receipts. This is a laboratory backpressure limit, not an operational retention or throughput design.
- The test code is single-authority/single-water-source, not a multi-tenant or generalized device journal. Operator changes and key rotations require separate reviewed migration. It has no local outbox ACK, deletion, reconciliation approval, notification delivery, physical safety proof or gate control.

## Evidence gates

The new offline tests cover first/second publication, immutable prior record, missing/altered history, issuer revocation, forged receipt, replay, timestamp rollback, public checkpoint mismatch, private state preservation, full-history backpressure and absence of network/gate APIs. The loopback RTDB Emulator suite uses the **actual PR #34 pinned leaf rules** and root transaction, verifying two accepted signed frames with retained private receipts, denied unauthorized history reads/writes, forged/revoked receipt refusal, corrupt history refusal and fail-closed nested public value injection.

CI runs Node 22, Java 17, exact pin `firebase-tools@14.18.0`, both test suites, older signed-reconciliation checks and complete website tests/lint/typecheck/Next.js build. **Only exact-head successful GitHub CI qualifies as an accepted test checkpoint.**

## Before any actual service is reactivated

1. Establish genuinely independent device identity, certificate-verified ESP8266 TLS, operator-owned key lifecycle, revocation and crash-safe source enrollment with an external anti-rollback anchor.
2. Build a least-privilege authenticated cloud publisher that owns the only allowed scalar publication contract. Firebase Admin SDK bypasses client RTDB rules; a privileged actor can expose nested data at a public leaf without the projector's consent.
3. Persist per-record, independently verifiable publication evidence with bounded retention, backup and disaster recovery, ensuring progress under outages rather than an eight-message permanent queue.
4. Verify idempotent, crash-consistent **per-message outbox ACK and compaction** against independent confirmed database records and signed historical evidence; handle lost acknowledgments, concurrency, key rotation and failures without false success. PR #42's `canAcknowledge:false` remains mandatory until then.
5. Restore read-only preview website/Flutter/bot clients; implement stale/offline warning states and audit notification delivery; conduct supervised physical sensor/buzzer/gate/manual override and local automation acceptance.

**The owner's published anonymous `/floodguard/live` lockdown stays active. All historical drafts remain unmerged; do not deploy, reconnect insecure firmware or operate real gate hardware.**
