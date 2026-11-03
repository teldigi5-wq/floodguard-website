# FloodGuard R3 H4 — synthetic signed admission issuer and H3 commit integration

**3 November 2026. Stacked successor to H3 draft PR #97 head 5b5eb4a31ce8c4fb0ed8317eac038d13555c8720. OFFLINE SYNTHETIC DEMO ONLY; NO DEPLOY, MERGE, REAL CLOUD WRITE, FIRMWARE FLASH, ALERT OR GATE COMMAND. PRODUCTION NO-GO.**

## Verified ancestor and exact scope

- H2 PR #96 introduced the separately operator-controlled quarantine marker in an unpublished Auth+Realtime Database Emulator Rules candidate; 37/37 synthetic and integration checks passed at its exact head.
- H3 PR #97 introduced ticket-scoped one-device water publication at the precise Emulator write boundary; 14/14 checks passed at its exact head. The existing `/floodguard/live` production-equivalent path remained denied.
- Earlier PRs #73–#87 already developed the three independent Ed25519 signatures (sensor/receipt/confirmation), signed and durable replay experiments, a narrowly scoped confirmation worker, Firebase session revocation, and a separate read-only attestor. H4 **reuses** the established `planThreeSignerWaterProjectionGate` without rewriting verification or inventing an alternative sensor protocol.

## New H4 work

The pure module `experiments/r3-h4-signed-admission-issuer.mjs` accepts an *injected, frozen, test-only authority reader* and clock. The signed evidence argument is strictly limited to the device envelope and signature, receipt and signature, independent database attestation and signature, and exact DB record. It cannot supply its own approval marker, publisher role, signer public key, or replay baseline.

Each candidate issue attempt:

1. Reads current issuer-enabled generation, publisher scope, device-binding public key, receipt public key, independent attestor public key, incident status and authoritative last-published checkpoint from an injected **synthetic** authority capability.
2. Refuses missing/disabled/revoked authority, incorrect device or epoch, incident quarantine, an uninitialized/changed checkpoint, wrong key types, out-of-order sequence, or an unreliable clock. No fallback is available.
3. Calls the **existing three-signer gate** to cryptographically verify exact canonical source, receipt and separately signed confirmed-record attestation, matching DB claim and five-scalar water proposal. No caller-supplied `DATABASE_CONFIRMED` string or leaked confirmer service token is sufficient.
4. Reads the authority again, refusing changed revision, keys, checkpoint, issuer generation, approval/incident state, or a clock jump. Rechecks the three-signer gate's evidence freshness.
5. On this **local positive only**, returns a frozen H3-shaped candidate: device, epoch, next sequence and digest, exact signed distance/level/status, observation timestamp, issuance time and 4-second expiry. Public overallRisk is forced to `UNKNOWN`. Every result explicitly has `canWriteFirebase:false`, `canPublish:false`, `canOperateGate:false`, `canSendAlert:false` and `releaseDecision:'NO_GO'`.

H4 has no Firebase client, Admin credentials, network socket, file writer or physical device API. It cannot persist a ticket or publish sensor values. The injected reader is **not** a real protected identity or independently operated authority, and the second read is **not an atomic distributed transaction**.

## Local Firebase Emulator integration

The stacked H3 emulator test suite gains three explicit H4 tests:

1. Generate three distinct ephemeral Ed25519 signing keypairs, a signed source envelope, a valid acceptance receipt and matching independent attestation; the H4 module issues the exact H3-shaped ticket. The disposable Emulator-owner fixture seeds that private ticket; actual Auth+RTDB Rules then accept one matching full-record publication and reject replay.
2. An attacker supplies a stored `DATABASE_CONFIRMED` claim but a forged attestation signature. H4 refuses to create a ticket; the Auth Emulator publisher credential cannot write the candidate without that ticket.
3. A valid ticket is produced and seeded, but the separate incident authority becomes blocked before the RTDB write. The RTDB Rules deny the final commit and preserve the prior published checkpoint.

Ten independent offline issuer tests also check all three signatures, tampered DB evidence, key role collision, revocation, incident/quarantine, replay, stale observations, authority races (including changes without a revision increase), clock jumps, injected extraneous request fields and absence of live/cloud-device APIs. The existing original H3 security tests and three-signer gate suite remain included in H4 CI.

## Critical remaining defects / production blockers

- A stolen, currently valid **confirmer writer token** can still store a forged-but-schema-valid private confirmation under previous experimental Rules. A protected, separately signed attestor can reject fake evidence, but this is **downstream containment, not storage prevention**.
- The Emulator-owner fixture that seeds the ticket is highly privileged. A compromised real operator/issuer/Admin identity could create arbitrary tickets; there is no separate OS/key-custody domain, real Firebase IAM, mandatory server-side verifier in a deployed writer, or tested security response to privileged compromise.
- The H4 authority is **in-memory**, not a durable independent monotonic witness, and it cannot prevent a race *after* the final authority read but *before* the privileged write to the admission ticket. H3's actual publication Rules recheck incident state and checkpoint, but the ticket creation and that write are not atomic with external witnesses.
- Issued signatures and tickets are **not retroactively revoked** by a historical flag alone; downstream checks are mandatory. Ticket expiry/replay helps but is not proof of a deployed incident-monitoring pipeline.
- The system does not verify ESP8266's flashed firmware, secure CA TLS upload, power-loss recovery, source authentic calibration, real fresh telemetry, physical Arduino UNO alarm/servo interlocks or flood-warning delivery.

**Next acceptance before any cloud proposal:** define a real independent incident/witness authority and protected credential custody; implement issuer write-path isolation with mandatory cryptographic checks and read-after-commit; test actual nonproduction Firebase IAM and privileged bypass; integrate source-firmware and message freshness only under supervised safe hardware conditions; gain explicit operator approval before any deployment.

No changes to deployed Firebase Rules, data, physical firmware, public application release, alert or gate. The code remains DRAFT / UNMERGED / PRODUCTION NO-GO.
