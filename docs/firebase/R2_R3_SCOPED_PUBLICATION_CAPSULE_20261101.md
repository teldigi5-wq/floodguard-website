# FloodGuard R2/R3 — Scoped publication capsule V2 (2026-11-01)

**DRAFT, disposably emulated ONLY. Not a production Firebase rules deployment, public ESP device endpoint, signed receipt issuer, witness service, or alert/gate controller. NO-GO.**

## Checkpoint and observed least-privilege gap

Based on [PR #46](https://github.com/teldigi5-wq/floodguard-website/pull/46), verified head `7af9d0b314a5dadd091e4c615fb912ea6459f06a`. That stage demonstrated a real, successful **RTDB Emulator** transaction with independent protected read-back, including recovery from an HTTP/SDK response lost **after** commit. But it used `withSecurityRulesDisabled` at `/floodguard`, encompassing private device Wi-Fi/IP, device authorization, and unrelated hardware state. **Do not promote that broad-privilege root transaction to production.**

## This stage's restricted, authenticated test boundary

New independent branch and isolated Emulator database root:

```text
/floodguardPublicationLabV2/         transaction root, no unrelated private state
    public/
      water/                         distanceCm, levelCm, status (primitive)
      system/                        lastUpdate, overallRisk="UNKNOWN" (primitive)
    checkpoint/                       epoch, initialized, sequence, digest (private)
    history/                          signed issuer receipts by s_<sequence> (private)

/floodguard/                          legacy private tree: DENY to scoped publisher
```

`tests/fixtures/scoped-publication-capsule-lab.rules.json` denies reads/writes at database root and legacy `/floodguard`. For synthetic tests, a Firebase Auth identity with **both** `uid='publisher-stage-a'` and the `fgCapsulePublisher:true` claim may read/transaction-write `/floodguardPublicationLabV2` only. Anonymous clients may read **individual validated public scalar leaves**, but may neither read ancestors/private history nor write anything. Firebase `.validate` clauses require primitive values, approved water enums, bounded numbers/timestamps, mandatory fields and forbid unknown public leaf names, including nested private data injected by a compromised publisher. These are **test claims**, not provisioned, independently verified production roles.

`experiments/scoped-publication-capsule-lab.mjs` is a pure reducer, requiring the **actual PR #41 sealed journal record**, Ed25519 device signature, canonical Stage 7 envelope, externally provisioned enabled source/epoch, separately pinned signer, original digest, valid signed Stage 8 receipt after local admission, valid event clock and strict approved scalar schema. Its fixed V2 capsule transaction updates **only public water/system**, a private replay high-water checkpoint, and a bounded private per-sequence signed history. The read-only verifier detects already-recorded older frames by their own signed history. It always returns `canAcknowledge:false` and refuses publication of `SENSOR_ERROR` as a water safety statement.

## Real Emulator acceptance gate

`tests/scoped-publication-capsule-emulator.mjs` uses `@firebase/rules-unit-testing` with the **actual scoped authenticated** context for the transaction—**not `withSecurityRulesDisabled` to publish**. The privileged harness is used *only* to seed synthetic initial data. It verifies successful signed transaction and read-back; publisher denial on root and all legacy private network/authorization fields; anonymous, wrong-claim and wrong-UID write/read denials; leaf-only public read; nested-object/unknown-field write rejection even from the scoped publisher; required-field/enum/range constraints; replay; forgery/revocation; and second signed receipt history with unchanged unrelated private data.

The dedicated workflow checks actual Rules and full Next.js regression. **Only final-head GitHub CI passing qualifies as lab acceptance.**

## Critical production limits, not hidden by green tests

1. **Auth provision and revocation**: synthetic Auth UID and claim are *only* Emulator fixtures. Real verified token issuing, tightly scoped server identity, key custody and token revocation are not implemented. This publisher's capsule write privilege still allows a malicious *authorized* writer to alter signed history; rules alone cannot make storage tamper-proof.
2. **Cross-domain atomicity**: source binding, device revocation, server receipt and independent confirmation live **outside** the capsule. The test reducer validates injected snapshots but cannot atomically fence a concurrent revocation or prove independently durable DB receipt issuance. A production design needs strongly defined authority, a safe write protocol and concurrency tests.
3. **Witness/external head**: PR #45's pinned Ed25519 witness still has no separate production issuer/monotonic head. No externally anchored rollback protection or guaranteed alert delivery exists.
4. **Schema safety**: these Rules are intentionally narrow, but Firebase client-rule `.validate` does not replace server-side strict signed publisher enforcement. Leaf grants can expose nested children if a privileged Admin writer bypasses Rules. No Admin write path should write into this root in production.
5. **Operational throughput**: bounded eight-reading private history/outbox means this is **not** a viable continuous flood monitoring pipeline. No deletion/compaction/ACK method or validated alarm/gate safety policy exists. Hardware/Flutter/WhatsApp/website cutover is not authorized.

**The user's real RTDB emergency lockdown remains active; do not copy these test rules into production. Keep all draft branches unmerged and physically operate nothing.**
