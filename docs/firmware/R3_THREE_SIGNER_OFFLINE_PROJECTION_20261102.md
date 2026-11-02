# FloodGuard R3 — Three-signature water projection admission contract

**2026-11-02 · staged successor to PR #72 exact head `63887851010152a6184a02662451017fe0a4dabc`. REVIEW ONLY. PRODUCTION NO-GO.**

## Verified source finding

Earlier offline modules already validate signed source envelopes (Stage 7), signed acceptance receipts (Stage 8), candidate durable delivery (Stage 9), and five-scalar public water projections. The existing `planSignedWaterLeafBridgeLab` ultimately relies on a caller-supplied `databaseRecord.status = 'DATABASE_CONFIRMED'`. It explicitly documents that such a supplied object **does not independently prove an actual database commit**. The separate `synthetic-publication-attestation` module validates a second Ed25519 signature, but the previous leaf planner does not require that signed attestation.

This checkpoint composes those pre-existing contracts into **one offline-only admission boundary**, `experiments/three-signer-water-projection-gate.mjs`, without replacing old APIs or launching any service.

## Strict proposed trust chain

1. **Device signature:** the canonical, allowlisted water envelope must verify against the explicitly injected device Ed25519 public key. Its supplied operator binding must exactly identify the device, epoch and `prototype-ingest-v1` scope and be marked enabled. A network client's claim cannot supply this binding in any future real service.
2. **Acceptance receipt signature:** the Stage 8 receipt must verify against a separately trusted receipt-issuer Ed25519 key and cryptographically bind exact device ID, epoch, sequence and SHA-256 digest of that canonical envelope.
3. **Persisted-confirmation attestation signature:** a **third, different Ed25519 signer** must sign `floodguard-synthetic-persisted-attestation-v1` with matching device ID, epoch, sequence, digest and acceptance time, bounded confirmation time, enabled scope and `DATABASE_CONFIRMED`. The existing database record must also agree exactly; the record alone cannot advance projection. Reusing any signer key for another role is rejected.
4. **Replay and recovery:** a valid pre-existing publication checkpoint is mandatory. No `initialized:false` auto-bootstrap, missing state, replayed sequence or unexpected epoch change can produce an offline plan.
5. **Narrow, nonoperational output:** after the existing water-leaf safety planner accepts these inputs, the new module returns only a *frozen* five-scalar candidate under `/floodguard/publicTelemetryLabV1`. It explicitly denies publishing, outbox acknowledgement, notifications, gate operations or a physical safety clearance. Overall flood risk stays `UNKNOWN` even when a signed source reports `SAFE`.

### Critical trust limits

All keys, operator binding, signed receipts and database confirmation evidence are injected by synthetic host tests. A convincing cryptographic signature **does not establish** that a signer operated a real, independently authenticated service or physically inspected a sensor. Real production must protect keys; authenticate and authorize an operator-controlled immutable device registry; ensure the database attestation is minted *only after an independently verified durable commit* (with atomic revocation and replay checkpoints); pin issuers with rotation and compromise recovery; use authenticated TLS transport; and propagate conservative UNKNOWN/STALE output to the site, mobile and WhatsApp clients.

The test module imports no Firebase client, Admin credentials, sockets, environment secrets, filesystem writers or device-actuator API. It **does not** run a server or handle web requests, and does not modify the existing live publisher or create a path under `/floodguard/live`. No local positive test is a production receipt.

## Acceptance tests

`tests/three-signer-water-projection-gate.test.mjs` generates ephemeral separate Ed25519 key pairs and synthetic water reports. Negative cases cover absent/forged/stale/revoked database attestations, signer-role confusion, mismatched device signature, forged receipt, tampered database claim, missing durable publication history, replayed sequence and wrong epoch, unsafe actuator fields and cross-clock violations. A synthetic reported `SAFE` frame can propose its water scalar, but overall risk and physical gate clearance remain UNKNOWN/unverified.

The existing `npm test`, security policy, pinned NodeMCU compiler and protected API negatives, exact-method LittleFS RAM tests, source-pinned flash menu checks, HTTPS ingress and website lint/typecheck/build must pass on the **exact head SHA** before reporting success.

## Production blockers remain

- No operational ESP8266 signed publisher, safe onboard retained-frame writer, validated hardware flash/OTA backup, or real brownout acceptance.
- No trusted independently operated database attestation issuer, durable RTDB confirmation, ACL/tenant isolation, bound KMS key rotation or replay-safe cloud outbox.
- No legitimate live public projection or end-to-end verified warning notification receipt.
- No independently commissioned Arduino UNO alarm/servo gates or verified public safety status.
- Historic public RTDB write access must **not** be reopened.

**No merge, deployment, production Firebase mutation, firmware flash, alert dispatch or gate command. PRODUCTION NO-GO.**
