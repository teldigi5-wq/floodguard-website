# FloodGuard R3 — Externally pinned synthetic incident journal (OFFLINE ONLY)

**2 November 2026. Follow-on to draft PR #94. No cloud publisher, production Rules, real witness service, hardware or field testing. NO-GO.**

## Recovered checkpoint and problem

The previously verified draft PR #94 uses a signed incident witness and requires caller-supplied trusted minimum epoch and revision, but it cannot independently prove those minimums came from a trusted source. A compromised database operator could replay an older, correctly signed witness if a downstream verifier never learns the newer incident minimum. PR #93's database-local epoch is also rollbackable by privileged Admin access.

This branch implements a **pure verification rehearsal**, not an operational ledger or a third-party witness service. Existing PR #94 signature verification, source authorization and freshness checks are **reused** rather than replaced.

## What this change adds

`experiments/r3-anchored-incident-journal.mjs` accepts caller-provided synthetic incident events, individually signed by a journal Ed25519 key, with:
- An exact canonical event schema, `deviceId`, consecutive revision number, `currentEpoch`, `quarantined`, event time and previous-link SHA-256 hash.
- An exact canonical **separately signed** checkpoint that commits to the journal head hash, revision, epoch and quarantine state. Journal signer and checkpoint signer cannot share an Ed25519 public key.
- A **mandatory externally pinned** `trustedPinnedRevision`, `trustedPinnedEpoch` and `trustedPinnedHash`. The verifier compares the pinned hash to the historical event at that revision, so a truncated or altered journal cannot simply present a valid but older signed checkpoint when the independent pin has advanced.
- Strictly consecutive history, monotonic event time, non-decreasing epochs, no epoch jumps, fail-closed quarantine, missing data denial, a maximum of 128 entries per lab witness, and a 15-second maximum checkpoint freshness window for this synthetic live-policy rehearsal.
- It returns explicit `operationallyApproved:false` and `releaseDecision:'NO_GO'` even on a valid integrity proof.

`experiments/r3-pinned-journal-publication.mjs` composes that signed-journal proof with the **existing** `verifyWitnessGatedSyntheticPublication` from PR #94. The four Ed25519 signer roles (journal, checkpoint, witness and attestor) must have distinct public keys. The witness device, epoch and revision must exactly match the anchored journal head. A quarantined journal **always denies** publication. An older signed attestation must be denied when quarantine/epoch has advanced, even if its cryptographic signature remains valid.

## Reproducible offline tests

- 13 unit/restart tests cover valid and quarantined histories, signatures, tampering, signed conflicting forks, truncation, missed checkpoint, non-sequential event, monotonicity, forged external pin, role confusion, stale/future checkpoint, missing test guard, simulation of two separate local files across a process-state restart, and torn JSON writes.
- 6 downstream composition tests check a synthetic normal attestation, an anchored quarantine, rollback with a higher externally pinned revision, signature-valid but mismatched witness revision, key-role confusion and mode fail-closed.
- The dedicated GitHub Actions workflow also reruns PR #94's 12 signed-witness tests and 8 existing private-schema regressions. All keys are disposable test-only and are generated in the runner; there are no source-controlled private keys, real Firebase projects, live sensor payloads, or network calls.
- Node 22 uses only the standard library; no paid services, elevated permissions or production secrets are required.

## Critical limitations and threat model

**This is not a real independent or durable ledger.** The journal, checkpoint and external pinned hash are supplied as parameters. For the restart test, the 'journal' and 'independently pinned' files are in separate paths on the *same disposable test machine*. Both are fully rollbackable by the same privileged owner. This test demonstrates **conditional detection** assuming the pinned revision/hash is genuinely outside the compromised authority. It does not establish secure key custody, independently operated signer/witness, append-only immutable hardware or WORM storage, cross-region replication, fsync guarantees, witness quorum, secure distribution or evidence of incident propagation. A counterparty compromising both keys or the external pin can still construct an apparently valid replacement history.

**Offline/disconnected verifiers must not use cached active witnesses for live flood safety decisions.** The 15-second check reduces replay lifetime but cannot guarantee a device learned of an incident. Clock authenticity, Byzantine issuer collusion, checkpoint consensus, reboot preservation under actual power loss and cross-device ordering remain untested.

The incident journal intentionally does not support clearing quarantine or activating epoch 2. Recovery requires separately designed re-provisioning, dual authorization, new signer trust and fresh physically sourced signed measurements.

**This file is not an upload, database schema or firmware command.** Do not paste JSON into Firebase Data/Rules or publish any of these synthetic records.

## Remaining field release gates

The owner's WSL checks previously showed nine public RTDB child GETs HTTP 200 and four private/parent GETs HTTP 401, and the Android Firebase QA dashboard reportedly worked. However the last observed system timestamp stayed `2026-08-25T14:30:41.226Z` over repeated reads. Historical ESP8266 firmware used `WiFiClientSecure.setInsecure()` and anonymous-style direct REST writes. Current flashed firmware, trusted TLS/authenticated ingestion, physical sensor freshness, local Arduino gate independence and alert delivery are **not verified**.

To advance beyond this checkpoint: independently owned monotonic incident-floor store; signed/rotatable operational key custody; interruption/crash/partition and anti-rollback integration; verified authenticated ESP8266 uploader using secure TLS; current signed sensor data; supervised emergency-alarm and actuator acceptance. Keep production NO-GO, do not broaden `.write` or change live Firebase Rules/data.

**NO MERGE, NO DEPLOY, NO LIVE FIREBASE WRITES, NO HARDWARE CONTROL.**
