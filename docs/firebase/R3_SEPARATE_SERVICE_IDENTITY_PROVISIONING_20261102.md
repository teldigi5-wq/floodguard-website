# FloodGuard R3 — Separate local service identity provisioning from runtime

**2 November 2026.** Successor to PR #83 exact verified head `5ba9a81ae40410448facf391235c7400895b1ba6`. **DRAFT / UNMERGED / NO-GO.**

## Concrete security regression removed from the test worker

PR #83 did isolate a synthetic bearer token in a Node child process, but the **child itself imported the privileged Firebase Admin Auth SDK**, created a new user with UID `service-confirm-stage` and granted itself the custom claim `fg_server_confirm_v1` before signing in. This is unsuitable separation of duties. A compromised process with identity-provisioning authority could mint new test principals or change claims and would not be constrained to using a pre-approved identity.

The new implementation removes **all `firebase-admin` imports and all user/claim-management operations from the worker**. It retains only local Identity Toolkit *sign-in* against the strictly pinned `demo-r3-isolated-service-confirmer` Auth Emulator and scoped Realtime Database requests.

## One-use operator-provisioned bootstrap

The **separate trusted test harness**, outside the worker, uses the Admin **Auth Emulator only** to create `service-confirm-stage` and set the exact `fg_server_confirm_v1` test claim. It generates a random test-only password, then starts the worker with the existing narrow IPC channel **and an additional anonymous fd 4 pipe**:

- `child.stdio[4].end(JSON.stringify({email,password}))` supplies the pre-existing synthetic identity only once through the dedicated pipe, not normal confirmation IPC, command-line parameters, process environment or repository files.
- The worker consumes fd 4 once with an upper bound of 1,024 bytes; refuses empty/malformed/oversized content, the wrong fixed email, unexpected properties and malformed password. The stream is closed after reading. It **does not** call `createUser` or `setCustomUserClaims`.
- The worker independently signs into the localhost Auth Emulator and checks that the returned JWT claims identify the fixed service UID, demo audience and exact scoped confirmation role. Actual RTDB Rules, not an unverified decoded token claim alone, authorize any database read/write.
- Its normal IPC continues to expose **only** `confirm` with signed evidence. No token export, arbitrary user creation, claim changes, path selection, public publication, remote gate, alert or ACK API.
- Tests verify that the worker receives no password/token in argv/environment, its bootstrap pipe is closed, the operator harness explicitly issued the service identity/claim, and malformed bootstrap or attempted IPC provisioning is denied. Existing positive/negative signed-confirmation, revocation, source trust, replay and no-publisher tests must continue to pass.

The worker still holds a scoped bearer token in process memory after sign-in; this remains sensitive. The bootstrap test harness necessarily knows the ephemeral password, and both processes run with the **same effective host user in CI**. The pipe alone does **not** establish OS isolation, secret independence from the trusted harness, kernel-enforced IPC authentication, credential revocation, independent provisioning or a production trust boundary.

## Security and availability blockers retained

- **Stolen worker token remains a bypass**: an attacker with the service token can directly write a schema-valid, cryptographically forged record to RTDB because Rules do not execute arbitrary Ed25519 checks. A compromised worker or malicious dependency may do the same.
- Real identity provisioning must be a separate, authenticated operational control, not a process issuing itself custom claims. Production needs independently restricted workload identity, protected secret delivery/rotation, strict network egress, log filtering, rollback/revocation fencing and **real nonproduction** IAM/Rules evaluation. There is no owner-authorized cloud project or identity here.
- This phase **does not** implement an independently confirmed Firebase durable commit, real monotonic witness, publisher, device key custody, hardware flash/OTA/brownout validation, alert delivery, or safe UNO gate control. The public-lab publisher remains denied, and physical overall-risk clearance remains UNKNOWN.
- The external Vercel status on PR #83 was a **build-rate-limit failure**, not a passed deploy check. Do not change paid plan or initiate deployment solely to remove that status. Full GitHub firmware/web CI remains mandatory on every exact new head.

The two dedicated reviews are `experiments/r3-isolated-service-confirmer-worker.mjs` and `tests/r3-isolated-service-confirmer-ipc-emulator.mjs`. The existing isolated Auth+RTDB Emulator workflow must run the expanded bootstrap suite on the new branch, alongside the pinned NodeMCU/LittleFS firmware and website regression workflow.

**No merge, production Firebase/IAM/Rules/data changes, deploy, real service token, firmware flash, sensor alarm, WhatsApp alert, or gate operation. PRODUCTION NO-GO.**
