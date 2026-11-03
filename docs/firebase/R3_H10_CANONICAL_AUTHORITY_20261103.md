# FloodGuard R3 H10 — Canonical authorization state at the publication CAS boundary

**3 November 2026 · stacked on H9 draft PR #103 exact head `785c90753312d1a745662f7f7ba803525b824dba`. REVIEW ONLY / UNPUBLISHED RULES / NO MERGE / NO PRODUCTION FIREBASE / NO ESP8266 FLASH / NO ALERT OR GATE ACTUATION. PRODUCTION NO-GO.**

## Recovered architecture and purpose

H9 used an actual local Firebase Auth+RTDB Emulator to demonstrate three-signer verification, a conditional whole-node water publication, quarantine invalidating that node's ETag, and deterministic worker crashes before and after a successful CAS. H9's remaining cross-node authority race was explicit: device, issuer, and publisher authorization were read from *other* database nodes that the water publication's ETag did not cover.

Earlier stages are preserved. Stage 7/8 supplied signed ingress and crash/replay research; H4 supplied the original three-independent-Ed25519 verifier; H6 required signed publication through a privileged test worker; H7 supplied offline incident/witness reservations; H8 independently verified readback; H9 protected incident and publication together. H10 extends **only the isolated H9 publication experiment**, without modifying those prior implementation branches.

## New unpublished control schema

The H10 alternative Rules candidate is `docs/firebase/r3-h10-canonical-authority-lab.rules.json`. It extends the H9 single `/floodguard/atomicPublicationLab/device-stage-a` record with three exact child authorizers under `control`:

- `device:{enabled,scope}` (scope fixed to `prototype-ingest-v1`)
- `publisher:{enabled,deviceId,epoch,scope}` (fixed device, epoch 1, and `publication-lab-water-v1`)
- `issuer:{enabled,generation,scope}` (generation integer, scope `lab-signed-admission-v1`)

The pre-existing `control:{epoch,blocked,revision}`, water `current`, and publication `checkpoint` remain. The new required fields and exact-child validators constrain **schema format**, not privileges of an Admin/owner identity. This is a single experimental publication-authority record, **not** a migration of all FloodGuard device or backend authorization.

All user/client writes to the entire new atomic publication node still remain **false**. The only read authorization remains the H8 exact, generation-revocable read-only observer principal. Anonymous clients do not gain full-record/control/checkpoint access. Previous unpublished Rules candidates and deployed Firebase Rules are untouched.

## Mandatory worker changes

`experiments/r3-h10-canonical-authority-worker.mjs` is derived from the verified H9 worker. Unlike H9, it fetches **only** that one publication node for the three authorizer states, the incident flag and the replay checkpoint; it does not read/fallback to `admissionIssuerAuthorization`, `publisherLabAuthorization`, or `deviceAuthorization` during publication. Its H4 issuer input is derived from the same node, using three distinct *synthetic public keys* supplied by a pinned disposable test harness.

The worker checks a complete, non-quarantined, enabled source/issuer/publisher control schema and the replay checkpoint. H4 still performs the three signature and freshness checks. After verification, H10 rereads the complete node and compares the ETag and object. Its only write is a **whole-node `If-Match` CAS** containing the unchanged control and newly signed water/current/checkpoint. A concurrent update to device, publisher, issuer, generation, incident or checkpoint changes the same ETag and causes the stale write to be refused. The worker never automatically retries uncertain writes or makes a SAFE/gate decision.

`pauseBefore` and `pauseAfter` IPC hooks remain gated by the fixed `demo-r3-h10-canonical` project, localhost Auth/RTDB Emulators, and child-process connection. The latter signals the test after the Emulator confirms HTTP 200 for the CAS and before the worker sends its normal response; it is not proof of an unknown network outcome.

## Test evidence required for acceptance

`tests/r3-h10-canonical-authority-rules.test.mjs` must prove the entire previous Rules candidate is unchanged except the nested control schema; no original public/private or write permission changes, and no legacy authority reads remain in the worker.

`tests/r3-h10-canonical-authority-emulator.mjs` repeats H9's signed-commit/replay, quarantine, and SIGKILL pre/post-CAS reconciliation, and adds:

1. Paused CAS invalidation after **each** canonical control change: device revocation, publisher revocation, issuer revocation, generation change, or incident quarantine.
2. Newly started writes with disabled canonical device, publisher or issuer authorization fail closed.
3. Previously existing **separate legacy authorization rows are deliberately disabled** in positive fixtures, and even when subsequently enabled cannot override disabled canonical publisher authorization.
4. The privileged Emulator-owner bypass remains a visible **EXPECTED OPEN DEFECT**: a compromised privileged writer can directly forge a schema-valid synthetic SAFE observation without invoking the H4 verifier.

Two jobs run only against disposable `demo-r3-h10-canonical` on `127.0.0.1:9000` (RTDB) and `127.0.0.1:9099` (Auth), with ephemeral test signing keys and no production secrets or real user data. The exact PR head and both CI job results must be inspected before calling this lab verified.

## Threats still unresolved and release blockers

- **Privileged identity compromise:** Firebase Admin/privileged writer bypasses client Rules. H10 does not provide externally authenticated operator custody, hardware-bound keys, a protected production service, or prevention of fake writes by a compromised admin.
- **Authority scope:** Canonical controls are authoritative only for this **synthetic publication path**. Earlier confirming/attesting/ingestion paths still use their own lab permissions; a stolen upstream confirmer writer token can still submit forged-but-schema-valid records in earlier experiments. The H4 independent attestor checks detect some downstream forgeries but cannot prevent those storage mutations.
- **Canonical authority write control:** In this Emulator, a privileged `owner` fixture updates authorization and publishes. The canonical design reduces a *cross-node CAS race* but does not prove that authorization writers and publishers are in separate administrative failure domains, or that an independent operator can revoke a compromised publisher.
- **Witness and recovery:** H7's second monotonic anchor is still a same-process test double; H8 keys and observer role are synthetic. H10 repeats deterministic crash tests but does not prove correctness under real outages, unknown HTTP acknowledgement, multi-instance contention, or rollback of both anchor and journal.
- **Real-time flood safety:** Live field firmware, authenticated TLS ingestion, physical sensor accuracy, on-device warning independence, alarm delivery, and local gate safety interlocks remain unverified. At the last user-measured check, Firebase's real `system/lastUpdate` still reflected **25 August 2026**, so historical SAFE readings cannot be used as current all-clear.

**Next design gates:** independently provision and protect a constrained cloud writer, enforce sole authoritative control with operator-owned revocation and a monotonic external witness, rehearse unknown-commit recovery under network partitions, then plan supervised device/servo/alarm commissioning. No production deployment without an explicit review and user approval.

**REVIEW ONLY · DRAFT / UNMERGED · PRODUCTION NO-GO.**
