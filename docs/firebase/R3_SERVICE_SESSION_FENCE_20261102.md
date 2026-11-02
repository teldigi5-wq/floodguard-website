# FloodGuard R3 — Operator-controlled service-session revocation and generation (emulator only)

**2 November 2026 · stacked successor to PR #84 verified head `a263af6401473eeb5ff698af0b415b56f8c3042b` · OPEN DRAFT / UNMERGED / PRODUCTION NO-GO.**

## Gap and scope

PR #84 moved local Auth Emulator service-account creation and role provisioning to a separate trusted **test harness**; the worker runs without Admin Auth SDK or identity-provisioning permission. However, a previously issued service bearer token can still satisfy role-only RTDB Rules until token expiry, even after someone removes a user claim. Neither the worker's IPC restriction nor its one-time secret pipe revokes an already minted bearer token.

This stage adds a **new, unpublished Realtime Database Rules candidate**, `docs/firebase/r3-service-session-fence-lab.rules.json`, based on PR #84's prior candidate without editing it. All five *service-specific* grants (the confirmer authorization row, the device authorization row, the exact staged frame, the immutable confirmation record read and create-once write) now additionally require:

- An Auth-issued service token containing positive bounded integer `fg_service_generation`.
- Exact equality between `auth.token.fg_service_generation` and the **operator-seeded** `floodguard/serviceWorkerAuthorization/service-confirm-stage/generation`.
- An explicit `enabled === true` in the same authorization row.

`serviceWorkerAuthorization` has no ordinary public read or write permissions. Root default deny, exact stage/record schema, device and operator authorizations, existing role UIDs, and **unconditional denial of all public-lab publication writes** are preserved. The test worker verifies the bounded generation claim during localhost sign-in but does not administer or refresh the generation. Service generation is not a physical device epoch or globally trusted monotonic counter.

## Real Auth+RTDB Emulator acceptance

The expanded `tests/r3-isolated-service-confirmer-ipc-emulator.mjs` uses **actual local Firebase Auth Emulator-issued ID tokens**, a synthetic operator-only RTDB fixture writer and the original Ed25519-verifying worker. The synthetic fixture begins with `enabled:true,generation:1`, and the separately trusted Auth Emulator operator provisions the service with `fg_server_confirm_v1:true,fg_service_generation:1`. Tests must show:

1. Positive signed frame and Stage 8 receipt still create precisely one immutable confirmed **test** record. A stolen but currently valid service token **can still create a forged, schema-valid record without Ed25519 verification**; this is an expected security-negative case, **not a fix or production authorization**.
2. An operator-only write of `enabled:false` immediately denies both direct REST reads/writes using the previously minted token and the worker's normally signed confirmation, without changing the token's JWT claims.
3. Setting the authorization generation to 2 while leaving `enabled:true` denies the old generation-1 token **and existing worker**. Issuing a fresh generation-2 Auth token by the trusted operator makes database privileges available again **to that fresh token**, including the same potential direct-signature bypass. The worker is not silently refreshed or reprovisioned. A separate supervised restart would be needed for any new authorized runtime.
4. The authorization fence itself cannot be read or altered by ordinary device/reader roles. Structural comparison confirms the new candidate differs from PR #84's Rules **only in five service-specific expressions plus a completely denied authorization subtree**. Original production and Phase B rules remain untouched.

## What the test does not prove

These Rules evaluate a separate RTDB record on each authorized operation, but the operator fixture has the emulator-only owner bypass. In production, a malicious privileged Admin SDK process, stolen root credential, a role that can modify `serviceWorkerAuthorization`, or a compromised operator can rewrite the fence. The generation integer is not a hardware-backed monotonic counter, and reverting both a token/permission state and database would defeat local rollback assumptions. Real Firebase Auth/IAM, actual deployed Rules, token revocation timing, service availability under partitions, races between authorization checks and writes, and an independent durable authority **are not verified** by localhost emulators.

The worker still holds a bearer token in a process under the same CI OS user as the test harness. Any currently valid stolen token can call RTDB directly with forged content, because Rules do not execute the Ed25519 verifier. Production must use a separately protected verifier and credential boundary, authenticated operator-controlled revocation, transport/egress constraints, durable issuance/witness fencing, pinned device keys, real ESP8266 hardware acceptance and supervised UNO alarms/gates. Do not claim zero vulnerabilities.

**Deploying this candidate is not approved.** Its narrow immutable-confirmation service is an isolated test path only; public publication remains entirely disabled. No production Firebase Rules/data/IAM changes, real service account, firmware flash, warning, cloud ACK or gate operation. **PRODUCTION NO-GO.**
