# FloodGuard R3 — Isolated service-token custody in a local child process

**2 November 2026 · successor to verified draft PR #82 `4106257f821db022fe8bb2bab0fe345ba12f0f5a` · DRAFT / UNMERGED / PRODUCTION NO-GO.**

## Problem and precise scope

PR #82 verified signed immutable confirmation in the **local** Firebase Auth + Realtime Database Emulators using a distinct `service-confirm-stage` service identity. It also demonstrated a critical bypass: anyone possessing that role's bearer token can PUT a schema-valid but **cryptographically unverified** confirmed record directly to RTDB. This cannot be corrected by ordinary RTDB Rules: they do not execute FloodGuard's arbitrary Ed25519 verifier, and a privileged Admin credential can bypass Rules entirely.

This stage tests a **separate-process custody boundary**, not a production service, production identity or complete anti-theft control. The parent test harness has **no access to the worker's synthetic Auth token or password**, and the child exports only narrow request/response messages through a private Node IPC channel. The worker is still a **test process on a shared CI host**, not an independently administered, sandboxed, hardened workload or key enclave.

## Implemented

`experiments/r3-isolated-service-confirmer-worker.mjs`:

- Refuses to start without a Node child IPC channel, exact `demo-r3-isolated-service-confirmer` project, exact localhost Auth/RTDB Emulator settings and explicit test-only environment flags. No production Firebase configuration, real HTTP listener, Vercel deployment, Admin RTDB client or cloud secret reader.
- **In the worker process only**, creates a generated synthetic user/password using Firebase **Admin Auth Emulator**, binds the exact `service-confirm-stage` UID and `fg_server_confirm_v1` claim, signs in to obtain an actual Auth Emulator-issued token and retains the bearer token **only in worker memory**. Its token and password are never returned via IPC or written to argv/process environment. **Real production identity provisioning must never be done by the service itself.**
- Receives once, from the **trusted synthetic operator test harness**, the two fixed Ed25519 device and Stage 8 receipt *public* trust roots. This is intentionally test-injected, not authenticated operator provisioning or real secure boot. It refuses the same trust root used for both roles.
- Creates a tiny RTDB read/write adapter that admits only four exact test-only read paths (operator authorization, device authorization, staged frame and one immutable confirmed record). **Only the single confirmation leaf may be written**. The module reuses the existing `createVersionedEmulatorConfirmer`. No public telemetry publication, remote gate command, message notification or Cloud ACK.
- Processes only strict `confirm` IPC messages containing signed evidence. No `exportToken`, `write(path,value)`, arbitrary RPC methods, remote network server, unsafe configurable path or private key access exposed to callers. Concurrent overlapping messages refuse `worker-busy-denied`; unexpected errors return fixed denial codes without echoing credentials.
- A positive response reports the synthetic immutable confirmation sequence/kind only, and explicitly sets all publishing/gate/production authorizations false.

`tests/r3-isolated-service-confirmer-ipc-emulator.mjs` starts the worker with a minimal environment and a generated, ephemeral local-only signer fixture. The parent creates ordinary device, attestor and unprivileged identities with actual local Auth-issued ID tokens; **only the child** generates and retains the service signer token. Tests exercise correct signed confirmation, invalid device and receipt signatures, malformed request/unknown method, attempted token export and gate path, client credential denial, revoked device/disabled operator, exact signed replay reconciliation and no token in IPC response/argv. Root seeding uses special RTDB Emulator `access_token=owner` only inside explicitly marked test setup, never as a worker/service identity.

A dedicated pinned Node 22 + Java 17 + Firebase CLI 14.18.0 localhost Auth/RTDB CI job exercises the worker; the prior pinned NodeMCU/LittleFS, security and website suites remain mandatory on the **same exact PR head**. No physical board is flashed.

## Security limitations and next authorization gate

**A child process does NOT eliminate bearer-token theft or make Ed25519 mandatory within Firebase.** A compromised worker process, compromised host, exposed token in memory, malicious patched library, same-user process introspection, or untrusted code executing inside the worker can still directly PUT a forged record with its role token. This stage narrows what is exported by the IPC interface; it is **not** a proof of a production least-privileged process, trusted IAM configuration, unforgeable token custody, container isolation, network egress policy or signed binary provenance.

The child bootstrap trusts public keys passed by its **test harness** and can be subverted if that harness is untrusted. The worker's local Admin Auth Emulator role is a test bootstrap shortcut, not safe production account provisioning. Operator and device authorization are still checked as independent RTDB reads around writes; no atomic revocation fence or separately anchored durable witness has been established. A compromised or broad Admin RTDB credential bypasses candidate Rules. Host tests do not demonstrate power-loss durable confirmation or physical ESP8266/UNO safety.

**Next:** design a real operator-provisioned, short-lived least-privilege service identity and isolate it at the OS/container/IAM boundary in a disposable, owner-approved nonproduction environment. Define and test exact egress paths, process identity, secret provisioning and rotation, negative direct-RTDB writes under compromised client identity, independent durable receipt and revocation fencing. Then design a signed, separately verified publisher. Only then consider real field acquisition, hardware gate/alerts or production migration with supervised approval.

**No merge, production Firebase Rules/data mutation, deployed service, firmware flash, cloud ACK, warning dispatch or gate action. PRODUCTION NO-GO.**
