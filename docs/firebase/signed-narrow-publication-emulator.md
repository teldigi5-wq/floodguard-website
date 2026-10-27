# Signed confirmation to scoped RTDB publication — emulator-only integration

**Status: draft research, NOT a deployable Firebase/ESP8266 authentication fix.**

The prior proof demonstrated (a) offline Ed25519 signing and receipt verification and (b) a separate Firebase client role able to modify only `/floodguard/publicationLab/water`. This stage uses **both together in one local Firebase Emulator transaction**. No service accounts, actual Firebase instances, physical devices, external HTTPS listener or WhatsApp messages are used.

## Tested path

The `createSignedNarrowEmulatorPublisher` factory in `experiments/signed-narrow-publisher-emulator.mjs` takes a **rules-constrained emulator client identity**, two separately trusted Ed25519 *public keys* and an operator-controlled clock during **initialization**. Individual messages contain only a synthetic canonical envelope, signed server receipt, and independently signed persistence/authorization attestation. Neither the "trusted" keys nor caller-asserted registry or `DATABASE_CONFIRMED` records are accepted from the publication message.

1. Fail closed unless the environment is explicitly the `127.0.0.1:9000` database emulator and signed-bridge test flag is present.
2. Reject invalid issuer key material at bootstrap, and cryptographically verify an independent Ed25519 attestation under the second pre-approved key. The exact canonical attestation binds UID, epoch, sequence, envelope digest, receipt accepted time, confirmation time, enabled scope and `DATABASE_CONFIRMED` status. Reject extra fields, tampering, omitted evidence, expired confirmation (5 seconds) and future skew. The publisher cannot substitute a per-message verifier key or per-message expected fingerprint.
3. Read the existing publication snapshot with a temporary value listener; never implicitly provision or recover a missing checkpoint.
4. Within one transaction at **exactly** `/floodguard/publicationLab/water`, independently recheck that the attestation remains fresh on transaction retries, then derive the registry binding and confirmed-ingest record **solely from its signature-verified contents**. The Phase B planner separately verifies the receipt issuer signature, envelope digest and source timestamp. The private publication checkpoint and public observation time must strictly advance.
5. Write only the five safe observation fields plus the same transaction's private checkpoint. The overall water-only flood risk remains `UNKNOWN`. No gate/alarm/ESP networking data is read or changed.
6. The **Firebase Emulator Security Rules** independently constrain the writer's UID/claim, operator-configured device/epoch, subtree, all field values, checkpoint sequence and public time. A rejected transaction leaves the last safe-to-display reading and checkpoint unchanged. The publisher cannot alter its own authorization or any original `/floodguard/live` subtree.

### Verification

```bash
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-narrow-signed-bridge --config firebase.phase-b-narrow-lab.json \
  "FG_NARROW_SIGNED_BRIDGE_TEST=1 node --test tests/narrow-signed-publisher-emulator.mjs"
```

The tests exercise the local database under real RTDB rules, simulated signed and confirmed ingestion, replay, forged receipts/frames and alternate signer keys, revoked or wrong identities, stale/old timestamps, publisher wrong-claim/revocation, missing checkpoint, concurrent duplicate deliveries, fresh signed advancement, public/private reads, and preservation of unrelated branches.

## Production stop conditions

**The proof issuer and bootstrap keys remain synthetic.** The publisher now cryptographically checks two pinned issuer keys and obtains registry/confirmed evidence only from a signed short-lived attestation, but the offline test attestation signer is **not** a production verified database service. A compromised/malicious issuer can still sign false claims. Real production requires a separately secured verifier that checks device identity/TLS, durable receipt persistence, operator authorization and revocation against a trustworthy datastore *before* signing; narrowly scoped publisher role credentials; secure immutable operator bootstrapping of the two public keys; rotation/expiry; audit, crash recovery and attestation renewal. A receipt alone never proves a physical sensor measurement. Firebase RTDB Rules cannot verify Ed25519 signatures. No real firmware or cloud data are verified. New standalone tests in `tests/synthetic-publication-attestation.test.mjs` exercise strict canonical signing, expiry and tampering, alongside `tests/narrow-signed-publisher-emulator.mjs` real local RTDB tests.

This publication path is intentionally different from existing website/mobile subscriptions to `/floodguard/live`; no client has been migrated. **Do not deploy or merge** the experimental rules or publisher, change the old live data, alter hardware/firmware, disclose credentials, or assert that anonymous production writes are repaired. Before cutover, verify the flashed ESP8266 sender, its clock/TLS and credential provisioning, design a durable end-to-end trusted ingest pipeline, plan explicit read-subscription migration and rollbacks, then conduct supervised field testing with owner approval.
