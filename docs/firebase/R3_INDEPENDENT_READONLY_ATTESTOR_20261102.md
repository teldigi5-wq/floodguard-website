# FloodGuard R3 — real local Auth-token read-only attestation over immutable confirmations

**2026-11-02 · stacked on draft PR #86 head `2e4c3fcab2254e42e5204d381486a93cc4539ba7` · OFFLINE EMULATOR ONLY · PRODUCTION NO-GO.**

## Finding, trust model, and purpose

Earlier PRs #80–#86 proved a valid stolen *service-confirmation writer* token can bypass optional app-level Ed25519 verification and PUT a **syntactically valid but cryptographically forged** immutable record. PR #86 proved five fixed revocation/staging/immutability races deny stale writes, but no cross-role real-token integration test yet established that the existing **independently signing, read-only attestor** actually rejects such an immutable forgery under the new session-fenced Rules candidate.

This checkpoint directly tests **containment at the next trust boundary**, not elimination of the upstream credential theft. It reuses the unchanged `createVersionedEmulatorAttestor` (device+Stage8 signatures, exact immutable record, live device/attestor authorization, independent Ed25519 signing) with a new narrowly constrained localhost **GET-only** adapter `experiments/r3-readonly-attestor-auth-emulator.mjs`. Its bearer token is a separately minted `attestor-stage` Auth Emulator identity carrying `fg_attest_ingest_v1`, not a copied confirmer token. Its ephemeral Ed25519 private signing key is distinct from both the device and Stage 8 receipt signer keys.

## Source and tests

The adapter requires all exact test-only flags, `demo-r3-isolated-service-confirmer` project, pinned localhost Auth and RTDB hosts, and a locally minted token. It supports **only** three fixed paths: attestor authorization, the exact device authorization, and the immutable confirmation leaf. It exposes only `ref(path).get()`; no `set/update/remove`, publisher, Firebase Admin SDK, cloud listener, physical device or gate API.

Nine new cases appended to the existing true Auth+RTDB Emulator suite:

1. A legitimately signed device frame, accepted receipt and confirmed immutable record produced by the isolated worker is **read back and signed by the distinct read-only attestor**. `verifySyntheticPublicationAttestation` validates the independent signature against the exact receipt and freshness. It does not publish.
2. A **stolen active service writer token** can STILL PUT an unsigned/forged-but-schema-valid immutable record (expected-negative upstream defect); independent attestor **refuses to sign it** despite the persisted DB status. The forged record is not rewritten, healed, erased or deemed valid.
3. A matching digest alone is insufficient: incorrect accepted timestamp, frame risk or observation timestamp, and extra fields are refused rather than signed.
4. The attestor cannot read broad parent paths, private ESP IP, or service worker authorization via its adapter, and cannot write confirmation, gate or public lab telemetry through real RTDB Rules.
5. Revoked device and disabled attestor authorization refuse signing, even with an old immutable record.
6. Downstream attestation verification rejects field tampering, wrong key, wrong receipt, modified signature and replay after its freshness window.
7. Ordinary and device Auth tokens cannot substitute for the exact read-only attestor role.
8. **Expected security-policy negative:** disabling the confirmer service identity by itself does **not** invalidate earlier already-confirmed records at the attestor; the separate attestor is still authorized to sign an otherwise valid historical record. Incident handling must decide whether service-level compromise/revocation should also quarantine historical confirmations; do NOT treat a service disable as retroactive record revocation.
9. Static policy checks ensure the adapter has no privileged SDK, write API or public network listener.

The expanded integration suite targets **29 cases**, alongside the same pinned ESP8266 core 3.1.2, host LittleFS, firmware static policy, HTTPS ingress, POSIX journal and website lint/type/build regression CI. All must pass on the exact PR head.

## No false safety claim

An independently **test-key** signed attestation is only trusted if the attestor key and its real runtime are separately secured. In this lab, signer private keys and Auth fixture users are generated in the same CI process; there is **no independently operated KMS, OS process protection, real IAM/cloud identity, externally durable receipt, trusted monotonic witness, or field device identity**. A compromised attestor or private key can sign malicious data. A valid stolen writer still creates forged private records, which may poison the immutable history even if this attestor rejects them. The public publisher remains completely disabled by the unpublished Rules candidate, and the UNO gate/physical flood alerts are not operationally tested.

Before an authorized production cutover, implement independent protected signer/witness custody and key rotation, deployment-enforced mandatory verification, owner-controlled historical quarantine/recovery, least-privilege actual Firebase IAM and credential checks, durable commit/readback, attestation-to-publication integration, hardware acceptance and supervised safe fallback. Do NOT merge, deploy, publish Rules, change live Firebase data, provision production keys, flash firmware, send real alerts or control gates.

**OPEN DRAFT / UNMERGED / PRODUCTION NO-GO.**
