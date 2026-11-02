# FloodGuard R3 — isolated database-read attestation issuer lab

**2 November 2026 · successor to verified draft PR #73 at `2f30f0edae91167edead5554edc6369867eefb69`. OPEN DRAFT. UNMERGED. PRODUCTION NO-GO.**

## Concrete trust gap

PR #73 verifies three separate synthetic Ed25519 signatures **when supplied** a database-confirmation attestation. It does **not** establish who issued that attestation or prove an independent authoritative database read occurred. This stage implements a **local, isolated, non-network** issuer reference backed by the existing Stage 9 HMAC-sealed **synthetic** database and independently commissioned HMAC-sealed operator-device registry. It is a test-only capability, NOT a Firebase service or production attestation issuer.

## What `createIndependentDbConfirmationIssuerLab` does

The factory is explicitly given (by the offline test harness, **never by an incoming network request**) a **frozen read-only database capability**, frozen operator registry with `get()` and revisioned `status()`, pinned Stage 8 Ed25519 receipt public key, distinct third-party Ed25519 issuer signing-key pair, and bounded clock.

The sole `attest({receipt,receiptSignature})` entry point requires exactly those two fields; rejects any injected `databaseRecord`, privileged attributes, client timestamp, signer key or arbitrary request metadata. It checks the signed Stage 8 receipt and a maximum 5-second local acceptance-to-confirmation window. It then reads the operator registry status and enabled, correct-epoch, correct-scope device public key. Its **sole database evidence** comes from calling the independently configured `databaseReader.get(deviceId)` and must be exactly `DATABASE_CONFIRMED` for the receipt's device ID, epoch, sequence, canonical digest and acceptance timestamp. It rechecks operator authorization and revision *after the read*; any changed revision/key, revocation, missing or corrupted registry/DB, incompatible epoch, wrong signer, stale receipt, lost history or failed read blocks signing. Key fingerprints prevent device, acceptance issuer and DB signer from sharing the same key.

Only after all those checks does it sign a fixed-order `floodguard-synthetic-persisted-attestation-v1` payload using the third Ed25519 key, self-verify that signature and return the **locally read** confirmed record. The result is always labelled `LOCAL_SYNTHETIC_DB_READ_ATTESTATION_NOT_PUBLISHED` with `canPublish=false`, `canAcknowledge=false`, `canSendAlert=false` and `canOperateGate=false`. It has **no network port, service account, Firebase SDK, cloud writer, physical gate or notification interface**.

A positive local issuer result is then tested as input to PR #73's `planThreeSignerWaterProjectionGate`, which may yield only a five-leaf *offline candidate* under `/floodguard/publicTelemetryLabV1`; even a signed source reading of SAFE cannot establish physical safety, overall risk or actuator position.

## Host tests and failure injection

The new tests generate **ephemeral synthetic** Ed25519 role keys, registry and database HMAC keys independently, and actual POSIX local files for the sealed registry and confirmed database. Tests exercise local stored read, positive three-signer composition, denied uncommitted or spoofed database claims, forged receipts, mismatched receipt/issuer keys, missing/corrupted/incorrectly sealed DB, revoked or missing/locked operator history, deliberately changed operator revision **while the reader executes**, stale/future/invalid timestamps, request smuggling and no network/writer/actuator API. Test code never uses a real device, RTDB URL, secret or production system.

All existing `npm test`, pinned NodeMCU build, protected-API compiler negatives, exact-source LittleFS RAM tests, HTTPS ingress, Python flash-layout/backup tests, lint/typecheck and Next.js build remain mandatory at the new exact GitHub PR SHA. Do not claim passed before successful CI.

## Explicit unresolved production requirements

This is **not yet a trusted service**. A frozen function object and HMAC-protected Stage 9 local file are useful rehearsal boundaries but **not proof** that an injected reader is trustworthy, that a physical device generated telemetry, or that a production Firebase transaction was committed durably. The current Stage 9 database fixture can synthesize a confirmed record and does not establish a commissioned, monotonic production database recovery epoch. A registry revision read both before and after a local read is **not an atomic authorization fence** across actual RTDB transactions, signers and remote operator revocation. A signed attestation alone can be replayed inside its time window without durable issuer-side issuance history; the three-signer gate separately requires a pre-existing publication checkpoint.

A real deployment additionally needs a separately operated service with least-privileged authenticated database read capability, independently verified and durable commit receipt, operator-approved immutable registry and atomic revocation, authenticated device transport and firmware signing keys, clock/key rotation, replay history, availability under failure, audit logs without sensitive payloads, and a **no-data-loss** recovery plan. The actual ESP8266 flash/OTA layout, retained-frame writer, brownout behavior, and supervised Arduino UNO alarm/gate commissioning remain unverified.

Do **not** reopen unauthenticated Firebase writes. Do not merge this draft, create/rotate live keys, deploy a server, flash hardware, alter active flood alerts or operate any servo/gate.

**PRODUCTION NO-GO.**
