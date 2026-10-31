# FloodGuard R3-D2 — independent high-water witness protocol laboratory

**Draft / isolated synthetic witness + loopback Firebase emulator.** This work is stacked on PR #28 → #27 → #26 → #25 → #24 → #23 → #22 → #21 → #20 → #18 → #14. It does not install an external witness, create a cloud service, change production RTDB rules, modify `main`, run hardware, operate gates or deliver alarms.

## Why another signature is insufficient

V2 correctly separates gateway-owned signed `admittedAtMs` from source-signed observations. Its acknowledged RTDB single-leaf write remains **non-atomic with an independent high-water authority**. A compromised privileged restore can replace a legitimate database record with an older, still cryptographically signed record. A signed local HMAC file can also be restored to an older still-valid version. Signing a checkpoint **does not make its storage rollback-resistant**.

## Protocol contract (what is actually implemented)

`experiments/r3-v2-independent-witness-reconciliation-lab.mjs` requires three pinned, independent public-key roles per water/rain stream: source signer, issuer signer and **external witness** signer. The coordinator only receives injected functions `readPublished`, `readWitness`, `publish` and `witnessCAS`; it cannot access an external witness private key, create witness trust roots or choose a Firebase path. A public checkpoint has exact canonical fields:

```json
{"version":"floodguard-r3-v2-high-water-witness-lab-v1","stream":"water","sourceAlias":"water-primary","epoch":1,"sequence":1,"envelopeDigest":"<sha256-of-exact-dual-signed-public-envelope>"}
```

It is independently signed by the witness. The envelope digest includes the exact report and admission signatures, not only the sensor sample.

Before each operation, the coordinator verifies the report/issuer signatures, their source/epoch/sequence and digest/time binding, and the witness signature. It compares their high-water state. An absent, forged or corrupted witness is **not** silently bootstrapped. If Firebase is behind the external witness, it reports `database-behind-external-witness`. If Firebase is ahead, it reports `database-ahead-requires-signed-operator-catchup`. If sequence is equal but payload/signature digest differs, it reports `same-sequence-digest-conflict`. None of these paths auto-repairs or deletes data.

Only when the database and signed witness match does it accept **exactly one next source sequence**, delegate to the separately governed V2 gateway, re-read and verify the acknowledged published envelope, then request `witnessCAS` with both the exact expected checkpoint and next checkpoint. The witness authority is contractually required to perform **independent atomic compare-and-swap, monotonic persistence and independently signed responses**. A trustworthy production witness provider is NOT created by this code. Failures and ambiguous acknowledgments are reported as requiring independent operator review; no blind replay, automatic resync or epoch reset. Per-stream in-memory same-process locks prevent local duplicate operations but provide **no distributed fencing**.

## What tests demonstrate

- The pure test fixture models an independent witness in a **separate in-memory closure** with a distinct Ed25519 private key. It can survive a coordinator object restart in the same process. That is **not durable storage or real multi-host isolation**.
- Actual localhost Firebase Realtime Database Emulator integration verifies signed publication of both water and rain, independently signed witness CAS and a fresh coordinator inspection, privileged DB restore/rollback detection, witness outage after RTDB commit, and a stolen writer-claim bypass poisoning the public record.
- Negative crash windows: a lost RTDB response after commit leaves Firebase ahead of the witness; a lost witness CAS response after it updates its in-memory state leaves an ambiguous outcome that is inspected but **not automatically retried**. Forged CAS replies fail. Same-sequence conflicts and both-store restored-old-file simulations remain explicit.

## Security and release blockers

1. **Independent nonrollback authority absent.** A real witness must authenticate writers and operator approvals; keep signing keys outside the ingest gateway; use durable monotonic state (with backup/restore/fencing semantics); and pass independent crash, partition, restart and privileged-restore tests.
2. **Not cross-system atomic.** Firebase publication and witness CAS are separate writes. A partial failure requires an independently signed recovery decision; the existing PR #24 operator catch-up is a V1 lab and is NOT automatically applicable to V2 envelopes.
3. **A restored database and restored valid witness together can evade this lab.** The unit test deliberately demonstrates this. Only a separate trusted nonrollback history or monotonic hardware-backed/externally auditable authority can limit that risk.
4. **Raw RTDB writer secrets remain dangerous.** A stolen scoped Firebase writer credential can bypass the gateway because Security Rules cannot verify Ed25519 signatures. The browser rejects forged signatures, but availability, integrity until detection and rollback can still be attacked.
5. **Hardware, mobile, browser and operations unverified.** There is no real enrolled ESP8266 key, calibrated ultrasonic/rain sensor, production IAM/KMS/issuer service, cross-host witness, physical gate safety test, actual Chrome/Safari/Android matrix, Flutter integration or reliable bot delivery. The synthetic test witness and ephemeral signers are not production endpoints.

The coordinator returns `LAB_ACK_AND_WITNESS_CAS_NOT_PROVEN_DURABLE` and `productionDurabilityVerified:false` on a successful synthetic rehearsal. **Do not promote its tests as durability evidence.**

### Test instructions

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/r3-v2-independent-witness-reconciliation-lab.test.mjs
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r3-v2-witness --config firebase.r3-v2-admission-lab.json \
  "FG_R3_V2_ADMISSION_LAB_TEST=1 FG_R3_WITNESS_RECONCILIATION_LAB_TEST=1 node --test tests/r3-v2-independent-witness-emulator.mjs"
```

**Stage R3-D2: witness reconciliation contract lab, not external durability. FloodGuard production NO-GO.**
