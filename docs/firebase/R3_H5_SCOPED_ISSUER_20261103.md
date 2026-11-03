# FloodGuard R3 H5 — scoped signed-admission issuer worker (offline lab only)

**3 November 2026 · stacked on PR #98 exact verified head 2d453d1294fccd14e134aae12c7df6a6802709c5. DRAFT, NO MERGE, NO PRODUCTION FIREBASE, NO DEVICE FLASH, NO ALERT OR GATE ACTION. PRODUCTION NO-GO.**

## Continuation and key risk

H4 already reuses three independently verified Ed25519 source, acceptance receipt, and immutable-record attestation signatures to propose a four-second admission ticket. However, the H3/H4 Auth+RTDB Emulator harness used a privileged disposable owner fixture to actually put that ticket in RTDB. H5 tests *separately provisioned test identity and least-privilege writes* without changing the core H4 verifier or any deployed Firebase Rules.

The **critical security-negative is not solved by a new token**: a stolen, still-valid issuer bearer token can directly PUT a syntactically valid but cryptographically forged ticket, bypassing the application verifier. A stolen valid confirmer writer token can similarly forge schema-valid immutable confirmation records in the existing earlier lab. Both defects remain **open production blockers**. An untrusted client never becomes trusted by merely sending `DATABASE_CONFIRMED` or a custom role.

## Alternative unpublished Rules candidate

`docs/firebase/r3-h5-scoped-issuer-lab.rules.json` derives from H3 and adds only the test issuer's narrow read surface, a separate fully private `admissionIssuerAuthorization/admission-issuer-stage` authority record, and one exact `publicationAdmission/device-stage-a` create-only ticket capability.

The caller must have an Auth Emulator ID token for exact UID `admission-issuer-stage`, claim `fg_issue_admission_v1:true` and exact `fg_issuer_generation` matched against the **operator-seeded** issuer authorization generation. The row must have enabled:true and scope `lab-signed-admission-v1`. The existing publisher authorization and device authorization must be enabled and correctly scoped, and the independent incident marker must be precisely false.

The ticket path permits create-only, not overwrite/delete. Its source Rules validate exact required fields, digest format, timestamps, sequence corresponding to the present publication checkpoint +1, bounded four-second lifetime and the expected device/epoch. Extraneous fields are invalid. Its writer cannot write the water publication itself, a public parent, the ESP private network subtree, gate, authority records or alerts. Only six fixed local read paths are available in the worker's database adapter; the worker never performs arbitrary client-selected path or method operations.

The existing H3 whole-water-publication Rules remain unchanged: the publisher token separately requires the exact ticket at final publication commit, and checks fresh server clock, incident state, current device authorization, sequence/digest and scalar values at that commit. `/floodguard/live` and the deployed `firebase.rules.json` are untouched.

## Signed issuer process boundary

`experiments/r3-h5-scoped-issuer-worker.mjs` runs only as a child process with a live IPC channel, exact `demo-r3-h5-issuer` project, and localhost-only Auth (9099) and RTDB (9000) Emulator environment variables. A trusted, separate **test harness** generates the synthetic issuer UID/custom claim/password, signs device/receipt/attestor evidence using distinct ephemeral Ed25519 keys, and passes the issuer sign-in material and three trusted *public* keys through a one-use dedicated fd4 pipe.

The child uses no Firebase Admin SDK and cannot create users, set claims, provision credentials, activate deployment, operate the UNO/servo, send alerts or write public telemetry. It signs in to the pinned Auth Emulator, checks its UID/project/generation claims, and stores the bearer only in child memory. It reads effective test issuer, publisher, source-device, incident and published replay state using the scoped token. The unchanged H4 three-signer verifier takes that authority (never the request's own roles or public keys) and re-reads authority before producing a candidate. Only after valid synthetic signatures does the isolated worker attempt one exact scoped ticket PUT. On a successful response it performs exact private ticket readback; on any failure or uncertain acknowledgment it never retries automatically and never issues a success response.

The IPC reply contains only a fixed test kind, sequence/digest and `releaseDecision:NO_GO`; it must never return bearer credentials, raw trusted keys or an arbitrary writable Firebase payload. The frozen H4 pure function still claims no direct write permission; the narrowly authorized H5 process is a separate experiment.

## Local testing

CI runs `tests/r3-h5-scoped-issuer-rules.test.mjs` (exact H3-to-H5 Rules delta, authorization, isolation, test project and worker review), the H4 original three-signer/issuer offline suites, and `tests/r3-h5-scoped-issuer-worker-emulator.mjs` against actual local Auth and RTDB Emulators. Synthetic scenarios cover:

- Valid three-signature evidence -> isolated worker stores exact ticket -> separately scoped publisher commits once, with replay refusal.
- Device, receipt and database attestor signature forgeries -> no ticket.
- Issuer session generation change, incident quarantine and device revocation -> denial with no ticket.
- Exact read/write allowlist; no arbitrary parent, gate, authorization, private metadata or publication writes by issuer.
- Ticket cannot be overwritten or removed by the issuer.
- **EXPECTED OPEN DEFECT:** the test harness intentionally simulates a stolen still-valid issuer token directly writing a forged-but-schema-valid ticket; the separate publisher can then publish synthetic false SAFE data through the lab. This negative is included to prevent misleading claims that scoping or Ed25519 in an *optional application* makes bearer theft safe.

Everything runs under `demo-r3-h5-issuer` on loopback, using Firebase CLI 14.18.0, Java 17 and Node 22. No real credentials, sensors, firmware or production Firebase are accessed. The CI result must be verified on the exact PR head before calling H5's limited lab cases passing.

## Security gaps and architecture needed next

The privileged Emulator operator fixture remains in the same CI host and provisions both the synthetic service identity and test data; the child is not a true independently protected workload. A stolen valid issuer credential (or Admin SDK with broad bypass) can directly mint arbitrary conforming admission tickets. The only durable publication checkpoint is stored in the same test RTDB; there is no independently durable, rollback-resistant CAS witness, production incident authority, real IAM/organization policy inspection, scoped token lifecycle custody, hardware-backed keys or physical-device identity.

**Next proposed gate:** require a separately signed, externally witnessed and revocable admission proof validated by the mandatory publisher before commit, ideally with ticket issuance restricted by protected workload identity plus egress rules and independent key custody. Firebase Rules alone cannot natively verify Ed25519; build and test the real trusted server boundary in a disposable nonproduction environment, document cost/free-tier tradeoffs, then require independent deployment approval. Keep Arduino UNO local alert/gate authority unchanged and show UNKNOWN/STALE when real authenticated readings are missing.

**Status: DRAFT / UNMERGED / PRODUCTION NO-GO. No Firebase production writes, Rules publication, firmware flash, notifications or physical gate action.**
