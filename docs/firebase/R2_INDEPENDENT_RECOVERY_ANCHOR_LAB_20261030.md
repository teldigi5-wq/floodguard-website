# FloodGuard R2 — independently signed recovery-anchor rehearsal

**Status: OFFLINE / LOCAL FIREBASE EMULATOR ONLY. Not a durable production ledger, source authentication service or deployed recovery procedure.** This branch is stacked on draft PR #22 → #21 → #20 → #18 → #14.

## Purpose: a restored RTDB record can still have a valid signature

Earlier Stage 7/8 offline HMAC ledgers and R2 server receipts reject ordinary duplicate telemetry. A privileged database restore or backup rollback could nevertheless replace the current RTDB leaf with an **older, internally valid signed report**. Firebase Rules compare against the restored state; by themselves, they cannot discover that the database used to contain a newer sequence.

The R2 recovery-anchor experiment provides a distinct **operator-signed high-water record**. It binds exactly: protocol version, `water` or `rain` stream, approved source alias, epoch, sequence, and SHA-256 of canonical signed-report payload. The anchor has its own independently pinned Ed25519 verification key. The operator key never appears in RTDB, the publisher, or production configuration.

The read-only `reviewR2RecoveryAnchor` verifies the separate anchor signature and the previously published report signature. It permits a **matching** prior checkpoint only. It rejects an older restored database record, a database ahead of its anchor, same-sequence different digest, unauthorized stream/epoch changes, forged keys or missing proof. No mismatch triggers a replay-counter reset, public overwrite, re-enrollment, or silent recovery.

The `publishR2WithRecoveryAnchorLab` wrapper obtains a fresh scoped-emulator snapshot, validates its external anchor, and then delegates to the R2 dual-signed publisher and RTDB monotonic rules. It writes only the approved evidence leaf. On success it returns `requiresIndependentAnchorAdvance:true`; **it cannot issue or persist a new operator anchor**. A second publication with the previous anchor is rejected until an operator independently inspects and signs the updated record. This separates checkpoint authority from publisher identity.

## Tested failure scenarios

- Water and rain maintain distinct signed source histories and operator anchors.
- Signed new reports are blocked if the independently signed operator anchor is missing, forged, signed by an unrelated key, for another stream or epoch, or has a conflicting digest.
- A synthetic database restore rolls the public leaf from sequence 2 to an older signed sequence 1. Retaining the independently signed sequence-2 anchor causes the next publication to reject `database-behind-independent-anchor`.
- An ambiguous commit that advances the database but not the separately signed anchor is explicitly unconfirmed pending operator reconciliation; the system must never assume that the old anchor can safely be reused.
- Existing Stage R2 Firebase publisher tests continue to check concurrent replay and private-data boundaries.

## Critical unresolved trust and atomicity limits

This **does not prove durability**. The lab deliberately supplies the independently signed anchor as an in-memory test fixture. It is not stored on independently durable hardware/cloud storage, and an attacker who restores **both** the database **and** the operator anchor to a mutually matching older snapshot defeats this check. A signature detects modification but does **not** prove freshness or prevent rollback of the signed anchor itself.

The preflight read and the subsequent Firebase write are **not one atomic transaction with the external anchor authority**. A privileged concurrent restore between those operations remains a race. Production needs durable, nonrollback monotonic checkpoints with explicit consistency and reconciliation guarantees, as well as an authenticated service-to-service protocol that fences publication by an independently controlled high-water authority. The lab's test operator signing is not a substitute for a deployed key management system or safe disaster-recovery runbook.

No production RTDB rules, app provider, bot, mobile app, Vercel release, real firmware, real credentials or floodgate hardware are accessed. Real device clocks, cryptographically verified ingestion, rain-gauge calibration, source key rotation, physical safety and alert delivery remain open gates.

## Isolated reproduction

```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r2-recovery-anchor-lab.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r2-attested --config firebase.r2-dual-stream-lab.json \
  "FG_R2_ATTESTED_PUBLISHER_LAB_TEST=1 FG_R2_RECOVERY_ANCHOR_LAB_TEST=1 node --test tests/r2-attested-dual-stream-publisher-emulator.mjs"
```

**R2 PARTIAL — release NO-GO.** No protected-main merge or production cutover.
