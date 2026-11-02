# FloodGuard R3 — local cooperative issuer/revocation serialization

**2 November 2026 · successor to verified draft PR #75 `54e2cd3d584ca17a810c2b85403848b28bb24da7`. OPEN DRAFT / UNMERGED. PRODUCTION NO-GO.**

## Problem actually observed in source

PR #74's independently re-reading local test database issuer calls operator `status()` and `get()` before and after the database read; PR #75's durable HMAC-sealed issuance history holds a **different** local exclusive lock while committing the signature record. The operator registry's existing `revoke()` uses its own `operator-device-registry-lab.lock`. There is **no shared atomic owner** across an issuance transaction and the operator's revocation API. A revocation between the final registry check and the return of a signed attestation could invalidate its authorization provenance.

## Preview-only improvement

`experiments/serialized-offline-authority-lab.mjs` composes the prior **real local-file test implementations** behind a single additional exclusive `r3-local-authority-coordinator.lock`. The explicit factory requires a precommissioned, frozen operator registry with `get/status/revoke`, a frozen PR #75 issuance ledger with `attest/checkpoint`, and an existing absolute POSIX directory. It offers exactly two operations:

- `attest({receipt,receiptSignature})`: locks the shared file before inspecting the request, confirms currently enabled operator identity, epoch and scope; verifies an existing issuance checkpoint; calls the sealed ledger's full PR #74 independent-database signer and durable commit while holding the same lock; and checks the operator's revision, identity, epoch and key fingerprint **again after the commit and before returning the attestation**. If an unauthorized direct registry mutation occurs between those checks, this local wrapper suppresses the signature response. The issued checkpoint is intentionally **not rewound** after an uncertain response, so retries remain replay-denied.
- `revoke(deviceId)`: acquires **the same lock**, asks the separately HMAC-sealed registry to revoke the device, verifies the post-state is disabled, then returns a revocation result. If an attestation holds the lock, a cooperating revocation returns **refused / authority unavailable**, not silently queued or falsely reported as completed. A caller must explicitly retry through a supervised workflow.

Both operations deny missing/untrusted inputs, contention, corrupt registry/issuance ledger and any replay. The lock is acquired with `wx` and is **not auto-stolen or auto-cleared** after an interrupted process. All responses have no Firebase publish, cloud receipt/ACK, SMS/WhatsApp notification, physical gate, or production approval capability.

`tests/serialized-offline-authority-lab.test.mjs` generates ephemeral local signing/HMAC keys and writes only synthetic Stage9 database, operator registry and issuance files in OS temporary directories. It checks successful serialized issuance and restart replay, revocation before issuance, cooperating revocation attempted during the DB read, **out-of-band** registry revocation during the read (caught by PR #74's revision check), out-of-band revocation **after the durable issuance commit** (caught by the new final fence, suppressing signature return), stale lock behavior, malformed/smuggled requests, forged receipts, lost response and missing ledger, and static no-network/no-gate restrictions. All existing full pinned ESP8266 tests, website tests/lint/typecheck/build, ingress/crypto/POSIX suites must pass on the exact new head.

## Non-negotiable limitations

**This is NOT atomic revocation across services or a production authorization boundary.** Only cooperating callers that **all** use this coordinator and exact same local filesystem lock are ordered. Existing raw `registry.revoke()`, another process ignoring the lock, malicious injected dependencies, a distributed database, Firebase Rules changes, alternate deployment, or a signer holding its private key outside the coordinator can bypass it. A host `Object.freeze` check is not authentication. The final post-commit status and `get()` remain two separate registry reads, and external direct revocation can race after the last check. There is no shared transaction or distributed compare-and-swap fence across a real RTDB commit, registry revision and signer issuance.

The PR #75 local HMAC journal still **cannot prevent privileged rollback of previously valid sealed files**. Real monotonic anti-rollback would require independently anchored state and audited recovery protocols. No field ESP8266 signed publisher, hardware filesystem/brownout test, production Firebase read-after-commit, real issuer key custody/rotation, cloud receipt, accepted public SAFE signal, or commissioned UNO alarm/gate is present.

A future reliable design should place issuer permission, revocation epoch, monotonic issuance counter and confirmation commitment under a **single transactional authority** (or use a rigorously specified remote compare-and-swap fencing protocol), then validate crashes, host/network partitions, concurrent revoke/confirm and key loss. No production migration is authorized here.

**No merge, deployment, live Firebase rules/data, device flash, alerts, ACKs or physical gate operation. PRODUCTION NO-GO.**
