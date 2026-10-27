# Signed confirmation to scoped RTDB publication — emulator-only integration

**Status: draft research, NOT a deployable Firebase/ESP8266 authentication fix.**

The prior proof demonstrated (a) offline Ed25519 signing and receipt verification and (b) a separate Firebase client role able to modify only `/floodguard/publicationLab/water`. This stage uses **both together in one local Firebase Emulator transaction**. No service accounts, actual Firebase instances, physical devices, external HTTPS listener or WhatsApp messages are used.

## Tested path

The `publishSignedToNarrowEmulator` function in `experiments/signed-narrow-publisher-emulator.mjs` takes a **rules-constrained emulator client identity**, a synthetic canonical device envelope and signed server receipt, operator-supplied expected Ed25519 signer fingerprint, enabled device registry, confirmed-ingest record and trusted lab clock.

1. Fail closed unless the environment is explicitly the `127.0.0.1:9000` database emulator and signed-bridge test flag is present.
2. Reject invalid server-public-key material and Ed25519 signer fingerprint mismatch. The caller cannot substitute an attacker-generated signing key without matching the **separately supplied trusted fingerprint**.
3. Read the existing publication snapshot with a temporary value listener; never implicitly provision or recover a missing checkpoint.
4. Within one transaction at **exactly** `/floodguard/publicationLab/water`, verify the private publication checkpoint, source device/epoch, signed receipt binding and digest, simulated database-confirmed record, source timestamp freshness, strictly advancing per-device sequence and strictly advancing publication time.
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

**The trusted inputs are synthetic.** Neither the `registryBinding` nor the `DATABASE_CONFIRMED` record is independently retrieved from a trusted production datastore by this restricted writer. A real system needs a securely separated upstream verifier/ingestion service and an auditable way to forward an authenticated, tamper-proof confirmation. A receipt alone never proves the physical reading, and RTDB Rules cannot verify Ed25519 signatures. Current simulation does not implement durable end-to-end ingestion, key rotation, nonproduction actual device attestation, backup/restore, network failure recovery or provenance of injected arguments.

This publication path is intentionally different from existing website/mobile subscriptions to `/floodguard/live`; no client has been migrated. **Do not deploy or merge** the experimental rules or publisher, change the old live data, alter hardware/firmware, disclose credentials, or assert that anonymous production writes are repaired. Before cutover, verify the flashed ESP8266 sender, its clock/TLS and credential provisioning, design a durable end-to-end trusted ingest pipeline, plan explicit read-subscription migration and rollbacks, then conduct supervised field testing with owner approval.
