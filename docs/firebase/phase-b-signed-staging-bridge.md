# Signed device evidence to scoped Firebase staging — local lab only

**Status: Draft PR only. NOT a production or real-device Firebase ingestion gateway.**
No firmware, live Firebase rules, main-branch deployment, real credentials, WhatsApp
delivery or physical actuator controls are touched.

## Narrow trust boundaries

The new `experiments/signed-staging-emulator-writer.mjs` requires an explicitly
injected RTDB **test-client** context authenticated with matching device UID
and `fg_ingest_v1: true` in the local Firebase RTDB Emulator. It never mints
Firebase credentials, uses Admin SDK, writes root/parent telemetry, reads
private staging values, publishes `live` telemetry or accepts device-command
fields. The entire source is inert outside
`FG_SIGNED_STAGING_BRIDGE_TEST=1` and
`FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`.

Each call verifies, before writing:

1. An exactly canonical Stage 7 envelope (one scoped device ID, epoch,
   observedAtMs and four validated frame fields), with a 30-second maximum
   observation age and 2-second maximum future skew, sampled at dispatch.
2. The **current** sealed operator registry identity: enabled, matching
   scope, epoch and Ed25519 public key; no cached, client-provided registry
   binding is accepted.
3. The device's Ed25519 signature over the exact canonical envelope.
4. A **separate trusted receipt issuer's** Ed25519 signature, with exact
   identity, epoch, sequence, SHA-256 content digest and reasonable receipt
   timestamp. The test receipt is **not** a Firebase persistence receipt.
5. The independent sealed Stage 7 replay-ledger checkpoint matching
   that device public-key fingerprint, epoch and exact accepted sequence.

Only then does a scoped client call
`set({sequence,distanceCm,levelCm,risk})` at
`/floodguard/staging/ingestV1/{deviceId}`. The RTDB Rules must separately
allow the exact authenticated UID and claim, operator-controlled cloud
authorization, full-frame replacement and strictly higher sequence. A
resolved SDK write returns `EMULATOR_CLIENT_WRITE_ACK_ONLY`, NOT durable
cloud persistence, genuine hardware provenance, public publication, or
field acceptance. All thrown SDK errors—including an ACK lost *after*
server commit—return `staging-write-outcome-unverified`, without retries
or an unauthorized staging read. An independent trusted attestor is
required to reconcile ambiguity.

## Executable verification

The strict emulator workflow invokes:

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-floodguard-strict \
  --config firebase.phase-b-strict.json \
  "FG_SIGNED_STAGING_BRIDGE_TEST=1 node --test tests/signed-staging-emulator.mjs"
```

The tests use synthetic keys and locally commissioned HMAC-sealed registries.
They prove a valid signed source and signed receipt can be staged using
ordinary authenticated client access, while invalid signatures, altered
data, expired time windows, missing ledger evidence, replay attempts,
wrong claims/UIDs, revoked Firebase and local operator identities, and
cross-path writes are denied. A simulated lost ACK verifies that a
successful server-side emulator write can still yield an *unknown*
client outcome, not an invented confirmation.

**Critical explicit gap:** RTDB Rules do not verify the independent
Ed25519 device signature or the local signed receipt. A client with a
valid, enabled `fg_ingest_v1` mock claim can bypass this optional bridge
and submit any schema-valid higher-sequence frame. An emulator test
deliberately demonstrates that limitation. **Do not interpret these tests
as proof that all production ingestion clients must use the bridge.**
A production architecture must place trusted verification on an
unbypassable authority side, restrict Firebase writer permissions to
that authority, verify token issuance, least-privilege IAM, replay and
crash consistency, and ensure real ESP8266 credential custody and
certificate-verified TLS.

## Remaining NO-GO gates

- Independently verify actual current Firebase Rules, authorization grants
  and the anonymous live-write exposure using an operator-authorized audit.
- Verify exact flashed ESP8266 code/upload shape, safe clock, secure TLS,
  key custody and supervised device enrollment/rotation.
- Implement a trusted non-production authenticated gateway or equally
  independently enforced signer-authority binding and test genuine Firebase
  Auth/token lifecycle; emulator custom claims are simulation, not identity.
- Reconcile independent cloud staging durability, immutable signed
  confirmations, public projection, crash and lost-ACK recovery.
- Verify cross-client web/mobile/bot reads and real Flutter native CI.
- Obtain separate owner permission before any production deployment,
  firmware reflash, Firebase Rules publication or live notifications.
