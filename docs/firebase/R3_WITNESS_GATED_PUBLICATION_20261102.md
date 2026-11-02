# FloodGuard R3 — downstream publication witness-gate contract (offline only)

**2 November 2026 · Draft successor to PR #93 · NOT a cloud publisher · NO DEPLOY · PRODUCTION NO-GO**

## Starting state

- Draft PR #93: signed-ingestion/attestor Rules emulator prototype denies old epoch-1 attestor reads after a device quarantine and local incident epoch bump, even if the confirmation service is later re-enabled. Exact-head local Auth+RTDB Emulator: 10/10 tests passed.
- **That alone does not revoke already issued signed attestations.** Earlier `verifySyntheticPublicationAttestation` checked signature, receipt and freshness but did not consult any incident authority.
- Owner-reported mobile Firebase read access restored and six public branches shape-checked, but `system.lastUpdate` remained frozen on 25 August 2026. None of this proves hardware freshness or authorized writes.

## New standalone, offline-only downstream verifier

`experiments/r3-witness-gated-publication.mjs` deliberately imports and preserves the existing `verifySyntheticPublicationAttestation`. Its additional contract requires:

1. A separate **Ed25519 public key** and a signature over an exact, canonical **synthetic incident witness** claim: `version`, exact `deviceId`, `currentEpoch`, monotonic `revision`, `quarantined`, `issuedAtMs`, `expiresAtMs`, and narrow `scope`.
2. A **caller-supplied trusted minimum** `trustedMinimumEpoch` **and** `trustedMinimumRevision`. Both are mandatory, positive bounded integers. This prevents accepting a signed but older witness if a trustworthy outside observer has advanced its minimum floor.
3. The witness is unexpired, short-lived (at most 15 seconds), not issued too far in the future, and not quarantined; witness/attestation device and epoch must match exactly.
4. The attestation signature and witness signature must verify under **different Ed25519 keys**. Validating the witness does **not** bypass the original attestation, receipt, accepted-time or freshness checks.
5. Missing witness, missing trusted floor, key confusion, malformed or replayed claim, stale timestamps, changed signature, or a mismatch must fail closed. Import without `FG_R3_WITNESS_CONTRACT_TEST=1` always denies.

The helper contains **no signing private key, network request, Firebase SDK, deployment, data write, device control, notification or public publication method**. The offline test suite generates two disposable signers and tests positive and negative scenarios with synthetic receipt/attestation records. Existing private-payload audit regressions also run in CI.

## Critical limits / attack model

- **Not an independently durable witness.** The test harness generates both key pairs in one CI runner; real key separation, signer authorization, process isolation, HSM/KMS, external audit/append-only durable storage and an incident root-of-trust are absent.
- **Rollback still possible without a trusted external floor.** A correctly signed, still-unexpired historical non-quarantined witness can be replayed if the verifier has not learned a newer `trustedMinimumEpoch` or `trustedMinimumRevision`. This API *requires* both floor inputs, but it cannot establish their provenance or integrity. Passing floors copied from the compromised Firebase instance does not solve rollback.
- **No automatic push revocation.** Previously issued signatures remain cryptographically valid; only verifiers that obtain and enforce the current trusted incident floor will deny them. Unreachable/offline clients must fail closed for live safety decisions.
- **No production publisher/actuator.** The test cannot prove verified physical sample origin, authenticated ESP8266 ingest, RTC consistency, real notifications, gate safety, or running cloud services. It does not alter existing Prisma/Next.js/frontend services or Firebase Rules.
- **Explicit no-go:** the underlying legacy direct Firebase ESP8266 source disabled TLS verification and had no verified scoped uploader credential. Last user-observed timestamp was stale. Real flood decisions must remain independent of experimental cloud attestations.

## Staged acceptance after this unit-level checkpoint

Review an independently controlled monotonic witness store and signed incident-event chain; test crash/restart, conflicting receipts, role-rotation, forged equal-epoch revisions, stolen signer, stale cache and partition behavior; integrate the verified witness floor into a **disconnected synthetic** publisher test, then only later design supervised device and operator acceptance. Avoid any public writer grant or service-account private key in ESP firmware.

**All branches remain DRAFT and UNMERGED. NO production Firebase/IAM/data modification, firmware flash, gate actuation, public alert, merge or deployment.**
