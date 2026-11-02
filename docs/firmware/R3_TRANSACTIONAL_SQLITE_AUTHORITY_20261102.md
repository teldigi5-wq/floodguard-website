# FloodGuard R3 — Single transactional local authority rehearsal

**2 November 2026. Stacked successor to verified PR #76 at `567ef0ec97b47817f2ef91abf73a7f49f7b61660`. DRAFT, UNMERGED, PRODUCTION NO-GO.**

## Why PR #76 was not enough

The previous coordinator uses an exclusive local lock over both operator revocation and issuance. It serializes **cooperating callers only**; the raw registry and separate database still have unrelated ownership and commit boundaries. Remote writers can bypass the lock. A stronger rehearsal is to place the authority decision and issuer cursor within **one actual database transaction** rather than more synthetic policy gates.

## Implemented

`experiments/transactional-sqlite-authority-lab.mjs` uses the **built-in Node.js 22+ experimental `node:sqlite` DatabaseSync API** without adding dependencies. It is deliberately only a **host-side, local file test**.

- Explicit one-time synthetic commissioning uses a sidecar marker written and fsynced before the database is created. The device must be explicitly seeded with a nonzero prior sequence/digest; the system does not silently start from an unknown historical cursor. Opening a missing DB refuses creation. A lost marker/DB is not automatically repaired.
- The same SQLite database stores a one-device registry with enabled/epoch/pinned Ed25519 public identity, synthetic confirmed receipts, monotonic issuer cursor, and signed issuance history. It uses foreign-key constraints, SQLite WAL mode, `PRAGMA synchronous=FULL`, `busy_timeout=0`, and `BEGIN IMMEDIATE` to serialize competing writes across all connections that honor that **one SQLite file**.
- Test-only `recordSyntheticConfirmationForTest` inserts a `DATABASE_CONFIRMED` row under a separate explicit **lab fixture option**. This is NOT a real cloud database read or a verified field persistence event. It cannot be enabled by an external network API because this module has no network server.
- `attest({receipt,receiptSignature})` first verifies the Stage 8 receipt signature against a pinned signer key, then **inside one BEGIN IMMEDIATE transaction** checks device enabled/epoch/key, exact contiguous next sequence, a short clock window, and an independently stored synthetic confirmation row matching device, epoch, sequence, digest and accepted time. It signs a canonical Ed25519 persisted-confirmation attestation, checks its signature, atomically updates the issuer cursor and inserts the signed issuance row, and **commits before returning the signature**.
- `revoke(deviceId)` updates the same device enabled state inside `BEGIN IMMEDIATE`. Competing transactions serialize within SQLite. Revocation committed before an attestation denies issuance. An attestation committed first remains an **historically issued signed record** and a later revoke prevents subsequent issuance; this is transaction-order semantics, not retroactive invalidation.
- An injected **before-commit** failure rolls back the entire issued record/cursor; a simulated **after-commit-before-response** failure preserves the committed record and refuses a retry. Duplicate, missing, forged or gapped receipts, mismatched keys, unconfirmed data, and changed/disabled operator identities fail closed.
- Every response denies publish, cloud ACK, alerts, gate operations and production GO. The signed record remains a **local synthetic attestation** only.

### Tests

`tests/transactional-sqlite-authority-lab.test.mjs` creates only synthetic Ed25519 keys, receipts and local databases under temporary test directories. It verifies explicit commissioning and refusal after history loss, duplicate/gap resistance across reopened connections, exact no-issuance on revocation, competing `BEGIN IMMEDIATE` transaction lock contention using a second SQLite connection, rollback and postcommit lost-response handling, signer-key pinning, unique synthetic confirmation records and the integration with PR #73's five-leaf **offline-only** water projection (overall risk remains UNKNOWN). The full existing NodeMCU compiler, LittleFS RAM fault, HTTPS ingress, UI source trust, website test/lint/typecheck/build suites must pass exact-head CI before the checkpoint may be described as verified.

## What this does NOT establish

This is **not a production service** and is not accessible from Firebase. SQLite's local transaction enforces atomicity and serialization for cooperating connections to this single DB but does **not** protect against an attacker with write access to the underlying files, a replaced/rolled-back entire DB+WAL+marker snapshot, stolen Ed25519 signing key, host or storage failure beyond the tested cases, or an independent remote database. The sidecar marker is not a trusted monotonic anchor. `synchronous=FULL` is configured, not proof of physical power-loss survival. The synthetic database-confirmation fixture is **not** a separately authorized, real read-after-commit of Firebase.

This lab also does not remove the need for cryptographically authenticated physical ESP8266 sensor readings, secure device provisioning and revocation, source persistence, independently proven downstream delivery, conservative UNKNOWN/STALE projection across web/mobile/WhatsApp, isolated physical flash/OTA backups and brownout tests, and supervised Arduino UNO gate/alarm acceptance. No real warnings or actuations are authorized.

**No merge, production deploy, Firebase rules/data changes, device flash, cloud publish/ACK, alert or physical gate operation. PRODUCTION NO-GO.**
