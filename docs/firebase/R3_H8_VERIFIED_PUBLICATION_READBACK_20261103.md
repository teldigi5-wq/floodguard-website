# FloodGuard R3 H8 — independent RTDB readback and H7 signed acknowledgement (Emulator-only)

**3 November 2026. Successor stacked on verified H7 PR #101, exact head `7ac2107d7eb4a70d3c0142f2a6fa51d5b2bf3ef4`. DRAFT / NO MERGE / NO PRODUCTION FIREBASE / NO PHYSICAL ACTUATION / NO-GO.**

## Reason for H8

The H7 offline lab could accept a correctly signed acknowledgement even if no Firebase publication happened, because its synthetic witness signer did not independently observe a database commit. H6's mandatory publication worker actually performed an Auth+Realtime Database Emulator ETag conditional PUT, but its own worker response was not independent attestation. H8 tests this missing boundary **without replacing H4's three-signature verifier, H6's worker, H7's incident ledger or their validated Rules**.

## New read-only observer

`experiments/r3-h8-verified-readback-observer.mjs` accepts an injected **test-only** publication reader, H7 witness snapshot capability, an ephemeral Ed25519 acknowledgement *private* key, and a clock. It has no Firebase SDK, network call, credential provisioning, filesystem writer, device API, or alert/gate control.

A signed H7 acknowledgement is produced **only if** all of the following hold:

1. The witness has a single pending reservation matching the supplied H4-verified candidate's device, incident epoch, next sequence, digest and observed timestamp. The witness must be non-quarantined. An unknown/missing state or invalid reservation refuses.
2. The proposed water observation and replay checkpoint have exactly the expected key sets and are fresh under the established 30-second past/2-second future window; overallRisk remains explicitly `UNKNOWN`.
3. The injected observer independently fetches the **actual** `/floodguard/publicationLab/water` record from the disposable local Realtime Database Emulator. Its entire `current` and `checkpoint` objects must deeply equal the approved candidate. A purported worker success response, signature alone, partial row, altered `SAFE` status, extra field, changed digest, missing record, read timeout or failed fetch cannot substitute for readback.
4. The witness and its externally anchored revision, incident flag, pending reservation and clock are rechecked *after* the database read. If anything changed between the two witness reads (including operator quarantine) no signature is returned.
5. Only then does the observer sign the **existing H7 acknowledgement contract** with a separate ephemeral attestor key. H7 independently verifies that acknowledgement again before advancing its durable checkpoint. Revocation **after signing but before H7 acknowledgement** is still rejected by H7's state machine.

All observer results retain `releaseDecision:'NO_GO'`, `canPublish:false`, `canWriteFirebase:false`, and `canOperateGate:false`. This read-only observer is not an alternate publication writer.

## Actual Emulator integration, not just mocked responses

H8 adds integration scenarios to the inherited H6 test harness, reusing H6's three real synthetic Ed25519 signers and mandatory signed-worker IPC. H7 remains a separate fsync/HMAC-sealed local ledger with an injected **in-memory** monotonic external anchor. Its operator/witness signer keys are still in the **same disposable CI process** and do not constitute independent custody.

The tests now exercise the full sequence: H4 signed proof → H7 pending reservation → existing H6 worker's actual Firebase Emulator conditional PUT → independently fetched complete database node → H8 signed readback acknowledgement → H7 durable advancement. They also check that no signed acknowledgement is possible before a commit, after a privileged synthetic false-`SAFE` rewrite, while the database is unavailable, following quarantine before or during readback, or after quarantine between H8 signing and H7 acknowledgement. A test simulates loss of the H6 worker **after a known completed commit**, showing independent readback still permits reconciliation without relying on its message. This is **not** a deterministic crash injected exactly between HTTP PUT and ACK; that fault-injection work remains pending.

The earlier H6 Auth+RTDB tests re-run unchanged in intent: stolen issuer/publisher client tokens still cannot write, forged Ed25519 evidence is refused, and an Emulator owner still has a demonstrated privileged bypass. Pure offline H8 contract tests re-run together with H7 incident, rollback and inherited H4 signature suites. The new H8 scope is an observer and test harness; **no alternative RTDB Rules change and no production public path change**.

## Open race, trust and recovery problems (blocking)

1. **Cross-node non-atomicity remains.** H6's privileged worker can read non-quarantined authority and then issue its PUT while an operator changes the incident flag in a different node; the ETag only fences the publication node. H8 detects quarantine by refusing witness acknowledgement **after** a raced commit but cannot undo a dangerous public observation already written. It is a fail-closed accounting step, not atomic revocation.
2. **No independently protected witness infrastructure.** The “external anchor” is still an in-memory CI double. The H8 reader is an injected callback, not a separately authenticated remote observer or distinct failure domain, and the attestor signing key shares the CI host. Coordinated compromise could forge a data read or roll back both ledgers.
3. **Privileged Firebase owner/Admin bypass remains.** As H6 demonstrated, a privileged actor may write fabricated `SAFE` observations even if all client Rules deny publication. An H8 observer may detect mismatches against the expected candidate but cannot guarantee prevention of an unrelated public forged write.
4. **No verified actual writer crash boundary.** The test does not yet kill the worker in the narrow window after a successful PUT but before receiving its response; recovery and exactly-once handling of that ambiguous event remain unresolved. No manual replay/auto-clear is permitted for a pending reservation without independent evidence.
5. **No real field acceptance.** The Firebase production `system.lastUpdate` was still the old 25 August 2026 timestamp on the last user-observed checks. Authenticated ESP8266 upload, trusted TLS and key custody, sensor calibration, power recovery, alerts and automatic Arduino UNO gate safety remain unverified. Never represent a historical `SAFE` label as the current physical state.

## Release and review

Run `.github/workflows/r3-h8-verified-readback.yml` on the exact draft head. Its 2 jobs are pure offline H7/H8/H4 regression and a separate **actual** localhost H6 Auth+RTDB Emulator run including H8 readback. Only synthetic keys, `demo-r3-h6-publication`, `127.0.0.1:9099` and `127.0.0.1:9000` are permitted. No real project data, real operator credentials, production Rules, firmware or gate controls are accessed.

**Next gate:** design a single atomic incident-epoch fence at the only publishable node, independently witness successful commits in a separate trust domain, and test kill-before/after-PUT plus durable idempotent reconciliation and privileged compromise recovery. It is incorrect to declare production-ready merely because the offline and Emulator checks pass.

**DRAFT · UNMERGED · NO DEPLOY · PRODUCTION NO-GO.**
