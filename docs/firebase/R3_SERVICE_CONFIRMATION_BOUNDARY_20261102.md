# FloodGuard R3 — Narrow signed service confirmation rehearsal

**2 November 2026. Successor to verified draft PR #81 head `5043edb410826d2c4efeec8d6fe9fe533d9619a1`. OPEN DRAFT / UNMERGED / PRODUCTION NO-GO.**

## Specific gap and scope

PR #80 demonstrated that a legitimate user-scoped confirmer or publisher token can bypass optional JavaScript Ed25519 verification by directly issuing a schema-valid Realtime Database write. PR #81 stopped these two routes in a separate unpublished **candidate** by denying confirmed-record and public-lab writes. However, that proposal intentionally made the old direct-token confirmation/publishing workflow nonfunctional and did not provide any controlled replacement.

This stage explores **one part** of a replacement, only in a disposable localhost Auth + RTDB Emulator: accept an independently verified Ed25519 source frame and Stage 8 receipt, then store a tightly scoped immutable confirmation with a **distinct test-service Auth UID and role claim**. Crucially, it does **not** reopen publication. Every public-lab write remains denied.

## Candidate Rules and identity scope

`docs/firebase/r3-service-confirmation-lab.rules.json` is an **unpublished candidate** branched from PR #81's blocked-writer Rules. It retains all parent/root denies and:
- Allows only fixed `auth.uid === 'service-confirm-stage'` with `auth.token.fg_server_confirm_v1 === true` to read exact operational inputs needed by the confirmer: its authorized registry record, the assigned device authorization, the assigned staged frame and exact immutable confirmed record. The existing operator/epoch/authorized-device enabled/scope tests remain.
- Restores confirmed-record **leaf-only, create-once** writes for this service identity using the **original schema, staging-equality, device authorization, sequence and immutability checks**, replacing the former ordinary confirmer claim/UID with the distinct service-only claim/UID. This service identity must not be conflated with the ordinary `confirmer-stage` user.
- Preserves `publicationLab/water/.write === false` unconditionally; no publication credential or Android/web/WhatsApp client can publish through this stage. It does not add a Firebase Admin credential or broaden any parent or live gate path.

The test service role is **only a test identity minted by localhost Auth Emulator**, not a separately deployed backend, verified IAM principal or securely isolated production machine.

## Verified-application path

`tests/r3-service-confirmation-signatures-emulator.mjs` connects the existing `createVersionedEmulatorConfirmer` to a **minimal explicit read/write adapter** using only its four approved RTDB paths and real local emulator-issued service token. The verification function checks source Ed25519 signature against an operator-provided pinned public key, canonical SHA-256 digest, signed Stage 8 receipt, device authorization, operator key fingerprint, staged-frame equality, freshness and immutable outcome recovery **before** calling the write adapter. The adapter does not expose network or credentials to other components in this test. The test uses generated local-only Ed25519 keys and seeded synthetic device observations. It does not connect to a real board, live Firebase project or physical alarm.

Tests cover legitimate signed confirmation, forged device/receipt signatures, mismatched staging, disabled operator and revoked device, ordinary confirmer/publisher/client denial, read-only attestor restrictions, private gate/publication write denial and a **CRITICAL expected-negative**:

A holder of the **service writer token itself can still bypass the application verifier** and directly create a schema-valid, signed-looking immutable confirmation. Realtime Database Rules cannot verify arbitrary Ed25519 signatures; they only enforce the scoped token, field schema and equality checks. This test verifies the service's application code behaves defensively and shows precisely **why the bearer credential must never be distributed to the device, browser, mobile app, bot, low-trust worker or other untrusted code**. A real deployment needs independent service process isolation and credential custody, mandatory server-side policy, audited runtime and a way to revoke keys/token access. An admin bypass continues to exist for unrestricted Firebase Admin credentials. A stolen service token remains a security exposure until it expires or is otherwise invalidated.

## Operational blockers and migration risks

Even a green integration run will establish only Auth Emulator-issued identity plus the tested application verifier. It cannot establish real Firebase IAM, deployed Rules, private key custody, KMS, independent durable confirmed commits, global revocation/issuance transaction, nonrollback witness, availability under network partition, or physical identity. No public publish path is active, so this is **not a live flood-warning pipeline**. The website/mobile/WhatsApp UIs may have different current live data paths; do not overwrite them or silently migrate a real device.

The next release-independent milestone is a **separately isolated least-privilege publisher service** that verifies the independent third-party attestation, reads the exact immutable confirmed record using trusted credentials, rechecks revocation and uses a durable CAS/fencing protocol before publishing. Then a supervised real Firebase *nonproduction* deployment and eventually ESP8266/UNO hardware tests are required before any authorized production cutover.

**No merge, deploy, live Firebase Rule/data/credential changes, device firmware flashing, cloud ACK, alert delivery or gate operation. PRODUCTION NO-GO.**
