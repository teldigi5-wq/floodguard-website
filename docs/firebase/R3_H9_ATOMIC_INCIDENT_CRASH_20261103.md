# FloodGuard R3 H9 — Same-node incident fencing and deterministic crash reconciliation

**3 November 2026 · stacked successor to H8 draft PR #102 at `8d9a8fa9801664da3b1a8b97679d3b98c4829b09`. DISPOSABLE AUTH+RTDB EMULATOR ONLY. NO MERGE, DEPLOY, REAL FIREBASE, FIRMWARE FLASH, ALERT OR PHYSICAL GATE. PRODUCTION NO-GO.**

## Problem and existing components reused

H8 verified that a separate read-only Auth Emulator observer can fetch the actual full water publication and checkpoint after a signed H6 worker commit, then conditionally sign the H7 acknowledgement. However, H6's ETag protects only the publication node; an operator may separately revoke device/issuer authority or quarantine another node after H6's last check and before a privileged write. H8 can refuse to acknowledge such a committed record but does not prevent the publication.

H9 **does not replace** the existing Stage 7/8 replay protocol, H4 three Ed25519 signatures, H6 mandatory verification, H7 offline sealed witness or H8 independent readback. It tests a stronger *single-node layout* for the narrower incident-quarantine race. Old H8 and deployed Firebase Rules remain unchanged.

## New unpublished alternative Rules experiment

`docs/firebase/r3-h9-atomic-incident-lab.rules.json` derives from the H8 Rules candidate and adds just one isolated subtree:

`/floodguard/atomicPublicationLab/device-stage-a` contains, as a **single RTDB document**, `control:{epoch,blocked,revision}`, `current:{distanceCm,levelCm,status,observedAtMs,overallRisk}`, and `checkpoint:{initialized,deviceId,epoch,sequence,digest,observedAtMs}`.

All Firebase client writes to the new node and its parent are **denied**. Its complete read is authorized only for the existing exact generation-revocable H8 readback observer. Neither anonymous clients nor production Android receive the private control and checkpoint. The legacy `/floodguard/live`, H6 `publicationLab/water`, original `firebase.rules.json` and any deployed Rules/data are unchanged.

The operator's quarantine update in this **synthetic experiment** replaces that same atomic node through an ETag conditional write, increasing incident epoch/revision and setting `blocked:true`. The publisher's signed candidate PUT also carries the unchanged `control` value and matches the **same node's ETag**; a quarantine between verification and PUT changes the ETag, so the pending publication gets a precondition failure instead of writing. This is a same-node CAS guarantee under these two scripted privileged actors. It is NOT a cross-node transaction or a guarantee against a separate Admin write path.

## Mandatory three-signer worker and injected failure points

`experiments/r3-h9-single-node-worker.mjs` executes only as a child with IPC, a fixed `demo-r3-h9-atomic` project, and `127.0.0.1:9000/9099` Emulator environment. The fixture provides three **public** keys through a one-use fd4 pipe; it does not accept caller-supplied trust roots, database paths or arbitrary methods. The existing H4 verifier checks signed sensor envelope, signed acceptance receipt and separate signed persisted-confirmation attestation, as well as freshness and the replay checkpoint drawn from the atomic node.

The worker first reads the whole atomic node with an ETag, obtains verification authority (including the node's control and replay checkpoint), re-reads the node after H4 verification, and refuses any change. It then submits **one** whole-node conditional PUT with `If-Match`. It never retries an uncertain or rejected write, returns `releaseDecision:'NO_GO'`, and has no public listener, firmware, alarm or gate interface.

In the disposable Emulator test only, a special IPC mode pauses just before the CAS (`pauseBefore`) or pauses **after the RTDB has returned HTTP 200 for the CAS but before the normal acknowledgement** (`pauseAfter`). The test harness deterministically sends `SIGKILL` at the selected boundary. These hooks do not run outside the fixed demo test guard, and are **not production control endpoints**.

## Acceptance tests

- Exact-source test verifies H9 adds only one new client-write-denied, read-only-observer-accessible subtree, with prior privacy/write restrictions preserved.
- Actual Auth+RTDB Emulator tests verify a valid three-signer record advances sequence exactly once; forged attestor signatures and replay do not publish.
- A deterministic operator quarantine at the paused pre-CAS phase changes **the same publication-node ETag**. When the worker resumes, its stale CAS fails; the previous publication checkpoint remains intact.
- A deterministic SIGKILL before the CAS leaves publication unchanged and the H7 reservation pending: H8 cannot generate an acknowledgement.
- A deterministic SIGKILL after acknowledged successful CAS but before normal worker response leaves publication advanced, while H8 reads the real whole atomic-node record with a read-only Auth Emulator token. H8 signs the expected H7 acknowledgement only if the atomic control remains non-quarantined and all fields match the H4-verified candidate. H7 then advances its independently simulated monotonic witness and clears the pending reservation.
- Quarantine after a known commit causes H8 readback to refuse acknowledgement; the H7 pending reservation remains unresolved.
- An explicit **expected negative** shows a compromised Emulator-owner privilege can still directly forge a same-node record and advertise false SAFE data, bypassing both Rules and the mandatory worker. This remains a production release blocker.

All test keys are synthetic ephemeral Ed25519 values. Test fixture owner credentials are available **only** against disposable local Emulators, and their bypass is never a model for deployment credentials.

## Unresolved limitations — DO NOT RELEASE

**1. Privileged compromise.** The fixed Emulator `access_token=owner` bypasses database Rules. A real privileged/Admin identity could still forge a public SAFE record or change both the incident state and checkpoint. H9 is **not** independently protected workload identity, operator key custody, egress isolation, production IAM, attested authorization or privileged compromise recovery.

**2. Full incident authority across paths.** The H9 same-node CAS contains only the **one synthetic incident control field**. Separate existing device, issuer and publisher authorization rows read by H4 are NOT part of its ETag. Revocation races on those other nodes remain possible, and an operator must designate exactly one authoritative incident location before any proposed production design. H7 incident epochs and H9 control are maintained by the same synthetic harness here, not a proved cross-service atomic authority.

**3. External witness is still simulated.** H7's "external" monotonic anchor is an in-memory same-process compare-and-advance double; H8's signing key and Auth observer are also test credentials under CI. A joint compromise can rewind local and anchor state or forge readback. The recovered signed acknowledgement is valid under these fixtures, not proof of independent custody, auditability or physical truth.

**4. Crash guarantee is bounded.** H9 deterministically kills the worker **before** PUT or **after HTTP 200** but before the caller receives success. It has not injected a transport failure with an indeterminate HTTP server commit outcome. It does not prove exactly-once behavior across real infrastructure, partial partitions, process restarts or state reconciliation when the origin hardware is off.

**5. Real telemetry and safety.** The production Firebase `system/lastUpdate` was still 25 August 2026 on the user's last check, far older than current date. Existing Android QA read access worked, but cannot certify real sensor upload, physical flood risk, alert delivery, calibration, gate interlocks or safe opening. Historical SAFE is **not a current all-clear**.

## Next acceptance criteria

Review independent privileged workload and operator custody, canonical incident-epoch control, nonproduction Firebase IAM restrictions and protected commit authority, H7 durable external store in a distinct failure domain, observed crash-under-partition with read-after-commit reconciliation, and authenticated ESP8266 firmware before any field release. Preserve private IP/Wi-Fi and prohibit unapproved servo or alarm actuation.

**H9 is a proof of the single-node CAS design in synthetic local Firebase Emulators, not a deployed safe flood-warning system. DRAFT / UNMERGED / PRODUCTION NO-GO.**
