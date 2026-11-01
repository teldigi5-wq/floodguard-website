# FloodGuard R2 — Durable signed admission/outbox research (2026-11-01)

**OFFLINE REPLACEMENT CANDIDATE ONLY. NOT CONNECTED TO LIVE HTTPS, FIREBASE, APPS, HARDWARE OR THE GATE. Release NO-GO.**

## Motivation: accepted telemetry could otherwise be lost before publication

The existing [PR #14](https://github.com/teldigi5-wq/floodguard-website/pull/14) loopback HTTPS handler verifies a synthetic device signature and commits `{epoch, sequence, keyFingerprint}` to the HMAC-sealed Stage 7 ledger, then returns HTTP 201 `LOCAL_LEDGER_ACCEPTED_ONLY`. **The Stage 7 ledger does not persist the full signed envelope.** A crash after that acknowledgment but before a downstream confirmation/publication can leave no recoverable sensor payload even though its sequence has already been consumed. This is not a claim that real FloodGuard production messages have actually been lost; existing production authenticated ingestion is not commissioned.

This PR adds `experiments/durable-admission-outbox-lab.mjs` as a **candidate alternative** for a future integrated admission path. It deliberately does NOT modify, replace, or run the existing loopback handler, Stage 7 ledger, real Firebase service, or physical controller.

## Candidate safety properties

- Requires explicit operator commissioning, absolute non-shared local directory, an externally provided 256-bit-or-higher HMAC integrity key, injected identity provider and clock. No default users/keys, enrollment or network listeners. Missing/tampered/seal-invalid/symlinked files, stale locks and lost keys deny rather than implicitly commission a new ledger.
- Within a lock, re-reads local state and current operator identity. Only enabled `prototype-ingest-v1` Ed25519 public-key/epoch bindings and canonical Stage 7 frames can be admitted. Rejects unknown/private fields, contradictory risk, invalid source clock, signature forgery and replayed/out-of-order sequence.
- One sealed state mutation advances the per-device replay high-water and persists the **complete canonical signed envelope and signature** in a bounded pending outbox. Uses exclusive file, owner-only mode, fresh temp-file write, fsync, atomic rename and directory fsync; a positive local acceptance result is returned only after this path completes. If a crash occurs after rename but before its acknowledgment, caller must inspect/reconcile, not infer failure from missing response.
- At most **8 pending messages per device**, **8 devices**, and 64 KiB on-disk record. Full state rejects new admissions rather than discard old data. These limits are **test safeguards, not operational capacity planning**.
- Restarted operator instances can inspect the retained envelopes for replay/reconciliation testing. There is intentionally **no acknowledged/dequeue/publication method** until verified database confirmation and independent, atomic source-authority proof exist. Without this, a test environment reaches capacity rather than emit misleading success.
- The HMAC seal only protects against accidental/unauthorized edits when the key is not compromised. It does NOT prevent a fully privileged operator who can roll back a valid sealed copy; it is not a remote durable receipt, multi-host consensus, real ESP8266 authentication, certificate verification, or a disaster-recovery authority.
- The operator registry is a **separate state domain**. Re-reading it under a local outbox lock does not make revocation and admission a distributed atomic operation; the production design must resolve this gap.

## Evidence and limits

11 negative/positive Node tests cover explicit commission, exact signed payload preservation across independent restart, tamper and missing-file failure, bad fields/private metadata, forged signature, revocation/scope/epoch, wrong key, clock age, monotonic sequences, bounded queue overflow, unsafe directory, stale lock and symlink. Code is verified against the actual upstream Stage 7 canonical validator in GitHub CI; local tests alone are not production acceptance.

This branch is stacked on [PR #39](https://github.com/teldigi5-wq/floodguard-website/pull/39), which has **10/10** local RTDB Emulator transactional tests passing. The new outbox candidate is NOT wired to those atomic transactions; they remain separate until a reviewed, durable acknowledgment/reconciliation protocol exists.

## Next engineering gates

1. Design a single-authority, truly durable admission→confirmation→publication protocol with authenticated device identity and verified TLS. Resolve commit ambiguity, persisted high-water restore, retained events, source revocation racing with admission, and authenticated checkpoint handoff. **Never treat local 201 as cloud or alert delivery.**
2. Require read-only reconciliation of signed durable outbox entries with independently confirmed database records, then add an explicitly proof-gated acknowledgment/compaction method. Model file-system rollback/crash and multi-process/multi-node scenarios.
3. Reconcile the stacked PR #14 / #34–39 contracts and client-side preview readers in a disposable workspace without merging drafts prematurely.
4. Review private actual flashed ESP8266 firmware and Arduino local sensor-error/gate safety policies, keep old anonymous `/floodguard/live` writes locked, and require supervised hardware and alert acceptance before restoring service.

**Existing production RTDB lockdown and all firmware, deployments, alarm and gate controls remain unchanged.**
