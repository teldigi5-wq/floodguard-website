# Atomic private-to-public projection — Firebase emulator only

**Status:** experimental security integration, **NO-GO for production**. This prototype is deliberately stacked on the consolidated website draft PR #13. No production Firebase rules, secrets, real ESP8266, gate or WhatsApp connection is involved.

## What is now integrated

The `experiments/strict-emulator-atomic-projector.mjs` function uses the **actual local Firebase Realtime Database Emulator** to execute one atomic transaction at the fixed `/floodguard` test root. It tests the critical boundary between an independently confirmed device frame and the nine public read-only streams. A successful transaction:

- Independently reads an enabled, exact-scope operator device binding from emulator state, plus a previously initialized private projector checkpoint.
- Requires a **single operator-provisioned waterAuthority** record specifying the sole approved water-device UID and epoch. Another enrolled device with independently valid staged frames and replay history **cannot** replace shared public water readings without an explicit privileged authority handoff.
- Pins the accepted Ed25519 receipt-verification public key to the SHA-256 fingerprint of its SPKI DER bytes in private operator-owned waterAuthority state. A caller-supplied alternate verifier key—even one matching a forged signed receipt—cannot silently become the trusted server signer.
- Requires the *currently staged* frame to match the cryptographically bound canonical frame and the private server-confirmed ingest record to match its signed Ed25519 receipt/digest.
- Uses the tested Phase B signed projection planner with explicit freshness and replay checks.
- Inside **one emulator RTDB transaction**, updates ONLY these five public child values: `live/water/distanceCm`, `live/water/levelCm`, `live/water/status`, `live/system/lastUpdate`, `live/system/overallRisk` (always `UNKNOWN`).
- Atomically advances the private per-device publication checkpoint so duplicate/concurrent deliveries cannot advance or roll back readings. Existing gate, alarm, rainfall, ESP private metadata, identity and staging subtrees are preserved.
- Aborts without mutation when checkpoints or confirmation records are missing, device enrollment is revoked, the staging frame differs, source clocks are stale, or a signed receipt is invalid.
- Gives an explicit `OFFLINE_EMULATOR_PROJECTED_NOT_PRODUCTION` result, not a declaration of receipt, physical safety or public emergency alert delivery.

## Security architecture limitations

The test intentionally uses `withSecurityRulesDisabled`—a **privileged emulator-only context**. Privileged database writes bypass RTDB client Security Rules. A generic root-level server transaction is not a least-privilege deployment strategy: a production service would require a separately audited narrow backend architecture, potentially an isolated publication data model that preserves client subscriptions while preventing access to commands, device secrets and broad database descendants.

The test seeds `confirmedIngest` through an operator-test context. It has **no authenticated durable production receipt/persistence service**. The current flashed ESP8266 revision and its on-device signature/TLS/clock provisioning have not been verified. A malicious client cannot access the mocked confirmed-ingest path under these local rules, but this does not prove a deployed cloud IAM policy or firmware identity.

The transaction reads the complete root in the emulator and is **not designed for production data volume, concurrency, cost, or independent identity rotation**. Exclusive source authority and signer binding are now tested in the emulator, including legitimate operator-controlled handoff. Production still needs audited credential lifecycle, issuer rotation, multi-source arbitration policy and safe operation during authority changes; the test-only record alone is not a deployment solution. Any ambiguous post-commit network outcome would require checkpoint reconciliation. Initial checkpoint provisioning and deletion prevention must be externally controlled and audited; this lab forbids implicit initialization.

## Run offline

```bash
npm ci
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-strict-projector --config firebase.phase-b-strict.json \
  "FG_STRICT_EMULATOR_PROJECTOR_TEST=1 node --test tests/strict-emulator-atomic-projector.mjs"
```

The emulator suite validates permitted public reads and private denial, actual atomic frame update, source preservation, replay/ordering, concurrent duplicate calls, revocation, forged and stale records, missing staging/confirmation/checkpoints, and hard block against production runtime imports.

**No actual live data is read or modified.** Review the workflow results on the exact PR head before claiming passing integration evidence. Do not auto-merge, deploy Firebase rules, provision real keys, modify firmware or operate the physical gate without explicit owner approval.
