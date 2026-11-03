# FloodGuard R3 H7 — externally anchored incident and publication witness (offline lab)

**3 November 2026 · draft successor to H6 PR #100 at f750cf449f2186af8e9a5cbbf4cb34f5b23fcaba. NO LIVE FIREBASE, NO DEPLOY, NO MERGE, NO FIRMWARE/ALERT/GATE OPERATIONS. PRODUCTION NO-GO.**

## Continuation and purpose

H6 denied direct database-client ticket and publication writes, and required a three-signer verified worker for a synthetic conditional water-record PUT. H6 explicitly did **not** provide an atomic revocation/incident fence covering separate Firebase nodes; a compromised privileged operator could still bypass rules, and an ETag on the publication node does not prevent an incident flag changing concurrently elsewhere.

Earlier Stage 7 and Stage 8 already implemented crash-aware sealed acceptance/reconciliation ledgers. H7 does not duplicate their sensor protocol, use real cloud endpoints, replace the H6 worker, or claim physical flood safety. Instead, H7 rehearses a small **operator-controlled incident epoch and separately attested publication witness** in test-only local storage.

## New modules

- `experiments/r3-h7-external-witness-lab.mjs`: witness with an exact pinned synthetic device ID, explicit absolute test directory, 32-byte-or-longer ephemeral HMAC integrity key, distinct operator and publication-acknowledger Ed25519 public keys, injected clock, and injected **external monotonic anchor interface**.
- `experiments/r3-h7-offline-coordinator.mjs`: invokes the **unchanged H4 three-signer admission issuer** before holding a witness reservation. A caller cannot cause a coordinator reservation by merely claiming `DATABASE_CONFIRMED`; the existing signatures must validate. The witness capability itself must remain trusted; direct calls to its lower-level reserve API are a test-only capability, not an exposed endpoint.
- `tests/r3-h7-external-witness.test.mjs`: synthetic operator, confirmation and three source/receipt/attestation signing keys, corruption, rollback, incident, stale-lock and concurrent-reservation tests. No user secrets, network calls, real Firebase project, Arduino/servo, or alert delivery.

## Witness semantics and durability

Every operation opens an exclusive local `wx` lock. **Crash-leftover locks are never silently removed.** A journal state is HMAC-sealed, written through an exclusive random temporary file, file-fsynced, atomically renamed and directory-fsynced. Each transition is hash-chained to the prior external anchor. Only after local durability does the witness ask the injected external authority to compare-and-advance its monotonic revision/head. If this second step is refused or loses its result, future reads observe a mismatch and block until explicitly investigated; no speculative retry or re-enrollment is permitted.

A signed, exact `BOOTSTRAP` operator event is required to initialize. No absent/corrupted state is interpreted as an empty safe ledger. An explicit bootstrap authorizes the first test epoch; it cannot be replayed. A separately operator-signed `QUARANTINE` increments incident epoch and immediately rejects further reservations and acknowledgements. A separately operator-signed `RECOVER` can clear quarantine **only when no unresolved publication remains**. Recovery advances the epoch, so old epoch-1 signed device evidence remains invalid until a separately governed key/epoch rotation is designed.

The witness accepts one outstanding publication reservation for exactly the next sequence/digest from an H4-verified candidate. It does **not** advance the last published sequence merely because an application sent a write. A separate **signed publication acknowledgement** with its own distinct public key must bind the reservation ID, sequence, digest, incident epoch and next witness revision. Only then is the checkpoint advanced and reservation cleared. Missing, forged, outdated or wrong-epoch acknowledgements leave the operation unresolved and fail closed.

The test demonstrates a local journal rollback with a mathematically valid HMAC is detected if the external anchor retains the higher revision. A compromised operator that also rolls back the external anchor or steals its integrity key/key custody could defeat this local test. This is **conditional rollback detection**, not proof of a real independent trusted service, immutable hardware log or anti-rollback hardware.

## Crucial limits

**The injected external anchor is an in-memory TEST DOUBLE, NOT a separate host, Cloud KMS, secure enclave or separately administered durable storage.** The operator and acknowledgement private keys are synthetic and live in the same CI test process. Neither key custody nor independent failure domains have been demonstrated. H7 never controls a real Firebase admission, ticket, device, alert or gate, and is not an authorized production publication path.

H7 is **not yet connected to H6's privileged Emulator worker or its Firebase ETag CAS**. The H7 acknowledgement tests use independently generated synthetic signatures, not a production-witnessed RTDB commit. This means H7 is a conservative new witness primitive and signed-chain coordinator, not an end-to-end atomic transaction or proof that H6 is safe against revocation during PUT. H6's existing Emulator regression runs independently without a new witness.

A real publisher must atomically fence the independent incident epoch at the final write boundary or reject/compensate after an external change. A separately signed acknowledgement must come from a verified commit witness that cannot be forged by the publisher; a signed assertion alone without independent evidence is not sufficient. An incident during an unresolved publication deliberately leaves a pending reservation; H7 currently has **no automatic clear/reconcile or proof-of-absence procedure**. Restoration is blocked rather than guessed.

A still-valid privileged Firebase Admin/worker credential can directly bypass Rules and write synthetic false SAFE records; H7 does not prevent or retroactively revoke that. The old H6 negative test remains relevant. A real safety-critical solution also needs supervised physical calibration, secure ESP8266 trust-anchor provisioning, independently operational on-device alarms and mechanical gate interlocks, real incident telemetry freshness and tested fail-safe modes.

## Review gates

The H7 offline tests must pass on the exact draft head. The inherited H6 Auth+Realtime Database Emulator suite is run again but it does **not** prove an H7-to-RTDB integration. No production secrets or real project IDs are used, no real Rules are published, and no live data is changed.

**Next conditional gate:** bind the H7 witness to a nonproduction H6 publisher with externally authenticated acknowledgement and incident-epoch checks, verify crash-after-commit and revocation-before-PUT races, and arrange independent operator-controlled storage/key custody. Explicit operator approval is required before deploying or powering physical hardware.

**Disposition: DRAFT / UNMERGED / PRODUCTION NO-GO.**
