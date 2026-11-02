# FloodGuard R3 — Durable monotonic local issuer checkpoint (offline lab)

**2 November 2026 | stacked on verified draft PR #74, `8505a0c9ba5f2b3112102558ebd263ebd98afe3e` | DRAFT / UNMERGED / PRODUCTION NO-GO.**

## Motivation

PR #74 implemented an offline-only Ed25519 attestation issuer that verifies a Stage 8 signed acceptance receipt, independently reads the **synthetic HMAC-sealed Stage 9 database**, and compares an independently commissioned operator registry before/after the read. However, that issuer had no **durable history of attestations already returned**. The same local Stage 8 receipt could be presented again after process restart or an uncertain response, with no independent issuance record.

## Scope implemented

`experiments/durable-offline-issuer-checkpoint-lab.mjs` is a **local-only** wrapper around the pre-existing PR #74 issuer. It does not modify or replace the old review code. Its constructor requires an explicitly provisioned, frozen offline issuer capability, pinned *synthetic* Ed25519 issuer public key, a separate test-only HMAC key, clock, and absolute existing test directory.

An operator must explicitly call `commission(seed)` with an already known **synthetic previous checkpoint**: device ID, epoch, sequence, SHA-256 digest and acceptance timestamp. It does **not** invent initial issuance history, auto-recover a missing file, admit an uninitialized first publication, or implicitly rotate a device epoch. The seed is an injected operator claim in the **test harness**, not a remotely verified or production authorization attestation.

The wrapper uses:
- A commissioning sidecar written **before** the ledger. A simulated interrupted initial write leaves a marker that prevents silent recommissioning.
- Exclusive `wx` lock acquisition with no auto-removal of abandoned locks, protecting cooperating local readers/writers and refusing ambiguous simultaneous issuance. This is **not** a distributed lock or an atomic cross-service revocation fence.
- A small HMAC-SHA-256-sealed single-device ledger (up to **16 entries including its initial seed**), strict contiguous increasing sequence numbers, constant device/epoch/signer binding and nondecreasing acceptance/confirmation times. No automatic pruning; capacity exhaustion denies issuance.
- Same-filesystem temporary file written in exclusive mode, `fsync()`, atomic rename and parent directory `fsync()`, before **any** locally generated signature can be returned. Host POSIX semantics are tested in disposable CI, not actual flash electrical durability.
- A fresh invocation of PR #74's verifier and independently read confirmed record *inside the local issuance lock*. The wrapper verifies the result's Ed25519 signature against its pinned issuer public key and the expected receipt, re-checks clock and sequence, then commits the sealed checkpoint.
- Permanent refusal when the ledger/marker is missing, malformed, symlinked at the final path, signed by another issuer, HMAC-tampered, contended by a stale lock, or older/replayed than the existing checkpoint.

A test-only `failPoint` constructor option simulates **before commit** and **after durable commit but before delivering the response**. The first cannot return a signature and does not advance history; the second advances the sealed history, refuses returning the signature, and rejects an attempted retry after reconstructing the wrapper.

The wrapper's successful response remains `LOCAL_SYNTHETIC_DURABLY_RECORDED_ATTESTATION`; it and all denials leave **publishing, cloud ACK, alerts, physical gate control and production approval false**. This code has no HTTP handler, Firebase Admin SDK, network listener, real device keys, production secrets, telemetry writer or actuator APIs.

## Verification scope

`tests/durable-offline-issuer-checkpoint-lab.test.mjs` uses ephemeral key pairs, HMAC keys and actual temporary **local** POSIX files to exercise explicit commissioning, persisted restart state, duplicate and gap refusal, wrong identity/epoch, issuer key rotation mismatch, forged receipt, revoked registry, missing/tampered synthetic database, lost/corrupted ledger/commission marker, symlinks, stale locks, crash boundaries and capacity exhaustion. All original R2/R3 tests and the NodeMCU/website security CI remain required on the **exact new head**.

**These checks do not prove rollback protection:** an attacker with the HMAC key or a complete copied older sealed file can replay an old valid snapshot. The commissioning marker can itself be deleted by a privileged actor. True anti-rollback requires a separately trusted and durably monotonic external anchor, key custody, authenticated operator change control and a verified recovery protocol. `Object.freeze()` does not authenticate the injected issuer. The wrapper does not hold the operator registry's own lock across the database read and signature commit, so remote revocation can still race with issuance.

The future operational issuer requires a real least-privilege database read identity, durable commit evidence, **atomic revocation/issuance fencing**, independently anchored monotonic issuance history and key rotation, protected TLS, recorded audit events and verified failure/recovery behavior. None of these have been deployed. Physical ESP8266 storage reliability, the authenticated signed publisher and Arduino UNO physical gate/alarm commissioning remain unresolved.

**No merge, physical flashing, Firebase changes, publication, ACK, warning dispatch or gate actuation. PRODUCTION NO-GO.**
