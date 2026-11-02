# FloodGuard R3 — deny direct confirmer and publisher writes (candidate Rules)

**2026-11-02 · stacked on draft PR #80 exact verified head `fc6322ba1f34f186e8bd5305dda5ae9e0fa3130e` · OFFLINE EMULATOR ONLY · NO-GO.**

## Prior verified security gap

PR #80 tests used **actual Firebase Auth Emulator-minted ID tokens** against the existing `phase-b-versioned-confirmation-lab.rules.json`. Two accepted, deliberately UNSIGNED requests demonstrated that a holder of the scoped confirmer role token can create a schema-valid immutable record without proving an Ed25519 signature, and that a holder of the scoped publisher token can directly advance the bounded public water snapshot without a signed attestation. Application-level cryptographic verification is **optional from a compromised token's perspective** because RTDB Security Rules validate claims and data schema, not arbitrary application Ed25519 signatures. These are **architecture-level end-to-end vulnerabilities in the proposed lab pipeline**; there is no evidence of corresponding live deployment or exploitation.

## Narrow change

`docs/firebase/r3-credential-containment-lab.rules.json` is a **new, unpublished candidate** derived from the exact previous rules with only two changes:

1. Under `floodguard/confirmedLab/records/$deviceId/$sequence`, replace the confirmer role's direct `.write` grant with `false`.
2. Under `floodguard/publicationLab/water`, replace the publisher role's direct `.write` grant with `false`.

No other Rules expression, ancestor read grant, private network-field policy, staging schema, authorization record or public read subtree is changed. The original Phase B rules are not edited, and no production Firebase Rules have been published.

**Consequence:** the old direct role-token confirmer/publisher workflow intentionally cannot create confirmed records or publish telemetry under this candidate. This is a necessary **negative-denial boundary**, not a completed functioning ingestion/alert pipeline. Device `staging/ingestV1/<device>` writes remain explicitly **untrusted input**; a field engineer still must prove source authenticity independently.

## Local integration and negative controls

`firebase.r3-credential-containment-lab.json` starts only Auth/RTDB Emulators on 127.0.0.1 ports 9099/9000 under a synthetic `demo-r3-credential-containment` project. `tests/r3-contained-token-authority-emulator.mjs` issues real local ID tokens for generated device, confirmer, attestor, publisher and ordinary users; uses ordinary `auth=<ID token>` RTDB REST calls for all role tests, with special emulator `access_token=owner` **only to seed isolated fixtures**. No Firebase Admin RTDB client or cloud credential is used.

The tests assert:

- Device can stage a bounded untrusted frame, but cannot alter authorization/gate; confirmer/publisher/ordinary cannot stage.
- **Even with proper real Auth Emulator custom claims**, confirmer, device, attestor, publisher and ordinary identities cannot create a confirmed record.
- **Even with the correct publisher role**, no app identity can publish a bounded snapshot directly; nested `current`/`checkpoint` and root/parent updates remain denied.
- Previous public current reads, attestor read-only confirmed record access (fixture-seeded only), private ESP network denial and device-revocation denial remain intact.
- A structural comparison asserts the hardened candidate differs from the previous historical rules in **exactly those two intended write grants**, with root default-deny preserved.

A dedicated pinned Node 22, Java 17, Firebase CLI 14.18.0 **localhost-only** CI workflow runs these tests; the original NodeMCU compiler, LittleFS, firmware static and website regressions remain mandatory on the exact PR head. No real device/physical gate test is involved.

## Trust and availability trade-offs

**A passing candidate may break the old direct-token pipeline by design. DO NOT PROMOTE IT AS IS.** RTDB Rules cannot force an arbitrary Ed25519 signature to be checked on a trusted server simply by removing these grants. A future operational confirmer/publisher must run in a **separately governed, authenticated server execution boundary**, with signed source and acceptance verification mandatory, revocation/monotonic durable history, strictly controlled keys, audited reads, fail-closed outcomes, and explicitly constrained database-write capability. A broad Firebase Admin SDK credential can bypass Rules; this candidate cannot protect against stolen Admin credentials or other privileged owner paths.

It is not yet proven which least-privileged server identity mechanism is available and safe for this actual deployed Firebase configuration. Verification must occur in an approved disposable nonproduction project before choosing Admin, limited Auth or an alternative backend; IAM configuration alone, code-level allowlists and a \`databaseAuthVariableOverride\` claim are insufficient evidence.

There is still no independently controlled cloud confirmer, trusted monotonic witness, physical ESP8266 TLS+signed firmware, field flash/OTA/brownout acceptance, actual alert delivery across Flutter/website/bot or supervised UNO gate/alarm commissioning. Do not weaken live authentication to restore functionality.

**DRAFT/UNMERGED. NO production Firebase changes, deploy, firmware flash, gate/alert or cloud ACK. PRODUCTION NO-GO.**
