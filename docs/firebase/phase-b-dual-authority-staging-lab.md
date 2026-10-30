# Independent verifier approval plus scoped staging authority (test-only)

**Review-only candidate, 28 October 2026. Production NO-GO.**

The preceding authority-only rules candidate removes direct staging write access
from device Firebase mock identities but leaves a meaningful weakness: an actor
with the staging authority's credential can inject a syntactically valid,
unsigned reading. RTDB Rules cannot cryptographically verify Ed25519 device
signatures or independent receipt signatures.

This separate candidate adds a **two-credential approval boundary** in an
isolated localhost Firebase Emulator. It does not replace the previous ruleset,
and no live Firebase project, firmware, WhatsApp integration, or hardware
is accessed.

## Lab permissions and complete execution

The two independently scoped, separately test-authenticated identities are:

1. `ingest-verifier-stage-a` with claim `fg_ingest_verifier_v1`. It can only
   set a complete approval record at
   `/floodguard/ingestApprovalLab/device-stage-a`, with its own enabled
   verifier assignment and matching device authorization. That record binds
   sequence, epoch, exact distance/level/risk values, canonical-envelope
   SHA-256 digest, an issued timestamp, and a short expiry. Each replacement
   must increase sequence and satisfy age/expiry and field bounds.
2. `ingest-authority-stage-a` with claim `fg_ingest_authority_v1`. It can
   only write `/floodguard/staging/ingestV1/device-stage-a` after an unexpired
   verifier approval already exists **for the exact same four fields** and
   current device epoch, the verifier assignment is still enabled, the
   authority's own assignment is still enabled, device authorization remains
   valid, and the new sequence is strictly higher than its prior staged value.

The verifier's `createSignedStagingApprovalEmulator` reuses the Stage 7
canonical-envelope format and Stage 8 signed acceptance-receipt verifier,
validating pinned public keys, a fresh source observation, sealed operator
identity and sealed accepted-sequence checkpoint before attempting its single
ordinary Firebase emulator client write. The staged writer remains
`createSignedStagingEmulatorWriter` and re-verifies this same evidence using
its own scoped client before sending the four-field staging record.
Successful SDK callbacks are local emulator ACKs only, not independently
confirmed cloud durability. Lost-ACK paths never auto-retry.

The independent rules also deny direct writes from ordinary devices,
unauthenticated accounts, parent paths, bot/live/physical-gate paths, private
Wi-Fi or networking metadata, and any missing or expired approval. The
approval itself cannot be read or overwritten by the staging principal.
An approval survives only 10 seconds in this prototype; the rule rejects a
later staging attempt based on an expired record. A revoked verifier or device
authorization blocks staging even when an approval was already saved.

## Test command

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-dual-authority-ingest \
  --config firebase.phase-b-dual-authority.json \
  "FG_SIGNED_STAGING_BRIDGE_TEST=1 FG_DUAL_AUTHORITY_TEST=1 node --test tests/dual-authority-staging-emulator.mjs"
```

The dedicated 12-case suite uses only synthetic Ed25519 keys,
ephemeral HMAC-sealed offline identity/ledger state, and
`@firebase/rules-unit-testing`. Privileged test fixture setup and
independent readback are NOT part of the production authority or writer.

## What this improves—and what it does not

Compromise of the staging credential **alone** can no longer create arbitrary
unsanctioned sensor data. Compromise of the verifier credential **alone**
cannot directly stage or modify public telemetry. However, a stolen verifier
credential can create a false syntactically valid approval (because RTDB
Rules do not validate signatures), and a stolen staging credential can publish
an already approved reading. **Compromise or collusion of both credentials
can still fabricate readings.** Separate mock Firebase UIDs are NOT proof
of deployment-level isolation, separate servers, secure token issuance,
independent key custody, durable operator audit or threat containment.

The grant is a short-lived *capability by database state*, not a signed
unforgeable bearer token, an immutable event log or a Firebase persistence
confirmation. Database Rules and mock claims do not prove actual firmware
identity or the current deployed Firebase Rules. The emulator uses the host
wall clock for expiry. Long-running/disconnected mobile or ESP clients need
supervised clock and receipt-lifecycle tests before a real cutover.

An operator-approved production architecture still needs real-time signed
verification forced through a backend trusted boundary, hard separation of
Firebase credentials/processes, least-privilege issuance/rotation/revocation,
rate limits and denial-of-service budgets, independently durable audit and
checkpointing, safe lost-ACK reconciliation, and a rollback-tested transition
away from the reported live anonymous writes. Flutter native CI, real
ESP8266 firmware/TLS/key custody, cloud IAM and real messaging remain
independent NO-GO gates.

**Do not merge or deploy this research ruleset.**
