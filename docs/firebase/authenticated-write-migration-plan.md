# Authenticated ESP8266 writes — design and acceptance gates

Status: REVIEW PLAN ONLY. No firmware edits, credentials provisioned, production writes, rules publication, or physical tests are authorized by this document.

## Release order and read containment

1. Keep mobile PR #1, bot PR #12 and website PR #8 under review. Record exact heads and passing run URLs immediately before any approval.
2. Obtain owner approval for the supervised bot migration described in production-privacy-rollout-runbook.md. Confirm manual-only workflow behavior on the actual merged revision, production environment controls, exact deployed SHA, and rollback readiness.
3. Verify bot child-only reads, Android live/demo/stale behavior and website field timestamps under the candidate policy using an isolated target first. Physical and EC2 evidence remain pending.
4. Only after separate owner approval, publish Phase A in a supervised window with a private backup and rollback. Verify parent/private denial, safe-child reads and continuing device uploads.
5. Follow with a separately reviewed authenticated-write implementation and maintenance decision. Phase A leaves anonymous writes open and does not close telemetry integrity risk.

Public grants on water, rain, gate, alarm, devices and system expose all descendants. Before approval, inventory these subtrees privately and verify that they contain only intended public telemetry. New private fields must live outside public ancestors. A descendant denial cannot undo an ancestor grant.

## Device identity and trust boundary

Identify the actually flashed firmware, complete PUT/PATCH paths, payload shape, reset behavior and ownership of every field before selecting a transport. Preserve the mobile v7 visual identity and existing public read contracts.

**Existing working hardware baseline (owner-reported, 13 October 2026):** Arduino and ESP8266 are already flashed and function correctly when available, but the system is currently offline for remote testing. Do not require reflashing, device resetting or touching the physical gate to design Phase B. Prototype all new auth/TLS paths with synthetic local tests; only propose a firmware replacement as a separate, explicitly approved migration after safe verification of the installed unit. The archived firmware examples do not identify the flashed revision.

Preferred design for review: a dedicated, provisioned Firebase Authentication identity per device with a trusted operator-controlled binding to its allowed telemetry paths. Only an authorized backend/operator may provision or change that binding. A user-supplied deviceId, anonymous account, or any signed-in account is insufficient authorization. Provisioning, credential storage, renewal and revocation require an explicit design review.

Direct REST writes must use a Firebase ID token issued after authentication. Never ship Admin SDK/service-account keys or database secrets in firmware or app clients. Protect refresh credentials; never log tokens, token-bearing URLs or request bodies containing secrets. Review device compromise and replacement procedures, and prove that disabling the device prevents subsequent writes within the documented revocation window.

If reliable credential renewal and certificate verification cannot fit the ESP8266 constraints, evaluate a separately approved authenticated ingestion service. It must bind identities to paths, validate schema, bound request sizes/rates and enforce replay policy before writing; privileged backend writes bypass client Rules.

Verify TLS trust, hostname and device clock bootstrap. Reject untrusted certificates and fail closed; never fall back to setInsecure() or anonymous uploads when authentication fails. Use bounded retry/backoff and a bounded offline queue without overwriting newer readings after reconnect.

## Phase B rules design requirements

Remove every unconditional write grant at /floodguard/live and its ancestors; child restrictions cannot override an inherited grant. Grant only identified devices the inventoried telemetry leaves, with an operator-controlled enabled/revoked binding and exact UID/path match. Web/mobile/bot readers receive no telemetry write role.

Define create/update/delete policy explicitly. RTDB .validate checks do not run for deleted values; required values and deletion bans must be enforced in authorization and structure rules as appropriate. Reject unknown fields with a reviewed schema; constrain numbers, strings and payload shape. Deny device writes to identity/authorization records, bot state, test data and any actuator-command paths. Sensor status is telemetry, not permission to command hardware.

Document timestamp trust, sequence/replay behavior and reset recovery. A device-reported timestamp alone does not prove freshness or authenticity. Do not grant a broad parent write merely to preserve multi-path PATCH compatibility; prove each actual upload shape under the narrow policy or design its replacement separately.

## Required isolated acceptance matrix

| Case | Required result |
| --- | --- |
| Unauthenticated or ordinary application user writes | Denied on every device-owned leaf |
| Correct enabled device writes its approved telemetry | Allowed for reviewed PUT/PATCH shapes |
| Another device, disabled identity, invalid or expired token | Denied; no anonymous retry |
| Device edits its own authorization or role | Denied |
| Parent overwrite, mixed allowed/forbidden multi-path update | Denied atomically |
| Required-field deletion, wrong type, out-of-range or oversized value, unknown child | Denied according to the approved schema |
| Cross-device write, bot/test/private metadata or command write | Denied |
| Public monitoring and private/parent reads | Preserve Phase A contract |
| Token expiry/refresh, offline/reconnect, reboot and clock bootstrap | Bounded recovery; no false fresh status |
| Revoked credential and invalid TLS certificate | Fail closed within documented limits |

First run authorization tests in the Firebase Emulator, then authenticated REST integration in an isolated non-production project. Emulator identity simulation alone does not prove real token refresh, TLS or device behavior. Record reviewed rules SHA, test source SHA and CI URLs.

A competent operator must later supervise real-device verification without gate actuation or emergency broadcasts. Keep that evidence private. Only then seek explicit approval for firmware rollout and a separate Phase B rules publication. Preserve rollback without leaving indefinite anonymous-write fallback; specify who can authorize temporary rollback, its exposure and its expiry.

## Approval evidence

- Actual flashed firmware inventory and private telemetry schema review: pending **only for migration compatibility**; functioning flashed hardware is confirmed by owner, and no reflash is requested.
- Device provisioning/renewal/revocation and TLS design: pending.
- Phase B limited synthetic-identity rules and Emulator authorization tests: implemented and passing on draft PR; complete production rules, identity provisioning, actual firmware integration, REST authentication and TLS tests remain pending.
- Supervised hardware, EC2 and client verification: not performed by this plan.
- Owner approval for rollout and rules publication: pending.

Sources: [RTDB rule cascading](https://firebase.google.com/docs/database/security/core-syntax), [authorization and validation](https://firebase.google.com/docs/database/security/rules-conditions), [REST authentication](https://firebase.google.com/docs/database/rest/auth).


## Stage 5 evidence — emulator-only per-device staging lane

A separate **private staging path** in the Phase B experiment has been added
at `/floodguard/staging/ingestV1/{deviceUid}`, gated by matching authenticated
UID, an operator-issued `fg_ingest_v1` custom claim, and an enabled registry
entry scoped to `prototype-ingest-v1`. Synthetic frames are type/range
checked and require a strictly increasing per-device sequence number. The
Emulator denies anonymous and normal app users, inactive or wrong-scope devices,
cross-device writes, unknown/malformed fields, parent overwrites, deletions and
replays; it preserves the existing read contract for public monitoring children.

**Do not equate the staging rules with an end-to-end upload mechanism.** Real
firmware currently has neither the reviewed staging envelope nor a provisioned
device identity and its saved versions used unverified TLS. Observing the
actually flashed firmware and choosing between a future firmware migration
and a trusted ingestion gateway are both separate approval decisions. A gateway
with administrative credentials would bypass client RTDB Rules and would need
its own authorization, replay, rate/size, audit and network-security controls.
The current prototype never connects to production. Existing live-leaf Phase B
examples remain deliberately incomplete and should not be published.


## Stage 6 — offline gateway versus device-auth comparison (review only)

**No service or upload endpoint was created.** `experiments/offline-ingestion-gateway.mjs`
is a deterministic, in-memory teaching harness imported exclusively by automated
tests; it has **no listener, Firebase writes, transport code, hardware control,
secret management or persistence**. It deliberately cannot ingest anonymous
legacy uploads into live Firebase.

| Option | Benefit | Unresolved release blocker |
| --- | --- | --- |
| Direct authenticated ESP8266 → versioned private RTDB staging | Fewer managed components; database Rules enforce per-device claims and schema | Currently flashed firmware sends anonymous whole-tree PUT or parent PATCH, with unverified TLS in saved variants; safe token renewal, certificate validation, sequence persistence and device migration unproven |
| ESP8266 → trusted ingestion gateway → RTDB | Central schema checking, telemetry redaction, clock discipline and credential lifecycle potentially without RTDB tokens stored on device | **Not a bypass for device identity or TLS**: the existing unauthenticated firmware cannot securely identify to the gateway without a separately approved transport, firmware, or physical trusted intermediary. Gateway Admin SDK writes bypass RTDB client Rules; the service itself needs rigorous auth, rate limiting, replay controls, provenance, audit and secure hosting |
| Continue legacy anonymous PUT/PATCH | Preserves observed old firmware behavior until a supervised migration | Untrusted writers remain able to forge readings; unacceptable as the final secure design |

**Chosen next research direction, not a production decision:** retain direct scoped
RTDB writes as the conceptual end state; investigate whether a trusted local
intermediary can provide device authentication, validated TLS, and non-billable
hosting before committing to a gateway. Never silently strip `esp8266/ip` or
`esp8266/wifi` and forward anonymous uploads as if authenticated.

The Stage 6 dry-run harness demonstrates only unforgeable **in-process** mock
credentials/proofs, fixed UID allowlisting, mock expiry, revocation, bounded
retry delays, bounded in-memory queue, strict frame schema and per-process
monotonic sequence checks. This is **not real cryptography, TLS verification,
a durable anti-replay guarantee, an offline queue implementation for firmware,
secure persisted identity, a token refresh protocol, or a production gateway**.
A restart can reset the harness sequence counter. An untrusted producer clock
cannot be used alone to establish freshness; real field readings remain offline.

**Required Stage 7 research gates:** privately observe the actual flashed
firmware's network/API behavior without operating hardware; establish trusted
device authentication and secure cert chain verification (no `setInsecure()`);
define durable atomic per-device sequence/reboot reset or signed epoch policy;
implement a separate test-only authenticated transport boundary in an isolated
test project; bound request size/rate and retention; prove lost-network recovery
without false freshness or loss of confirmed events. Phase A/B production rules,
WhatsApp pairing, hardware updates, bot deployment and GitHub PR merges remain
independent owner-approval gates.


## Stage 7 — signed-frame and restart-safe replay research (test-only)

The `experiments/stage7-durable-ingress.mjs` module is **not a deployed service**.
It uses ephemeral Ed25519 keypairs generated inside unit tests, an explicitly
provided temporary directory, a caller-held test-only HMAC key, and an
in-process marker that is **not actual TLS/certificate verification**. The
module opens no network socket and is not imported by the website application,
Flutter client, WhatsApp bot, Firebase SDK or the real ESP8266.

The new `floodguard-offline-envelope-v1` research contract signs the
canonical encoding of `{version,deviceId,epoch,observedAtMs,frame}` with
an Ed25519 private key; the frame reuses Stage 5's four fields. Checks include
strict field allowlisting and sizes, approved test-device public key/scope,
signature authenticity, a 30-second past / 2-second future clock window,
an explicit synthetic channel marker, and per-identity sequence monotonicity.

The offline ledger is sealed with HMAC-SHA256; writes use an exclusive lock,
file fsync, atomic rename and attempted directory sync. Tests cover restart
rejection of replayed frames, corruption/tampering, missing or incorrect
integrity keys, lock contention, revocation, alternate keys, and blocked
silent epoch rollover. **All test records are synthetic and disposable.**
They cannot be used to restore real telemetry, WhatsApp sessions, firmware
or production Firebase records.

**Release limitations and design decisions:**
- Actual TLS peer validation, hostname trust, certificate renewal/pinning,
  device clock bootstrap, hardware secure key storage and true network
  authentication have **not** been implemented or validated. An in-process
  marker is not a trusted TLS connection.
- Persisting an HMAC requires safe **independent** protection, rotation,
  backup and recovery of the integrity key; loss of the key blocks recovery.
  Test keys must never be copied into firmware or a production service.
- After an unclean stop an exclusive lock may remain. This harness
  deliberately fails closed and does not auto-remove that lock.
- The file journal prevents simple accidental rollback/tampering **only
  while its integrity key and state are protected**; privileged attackers
  with both can rewrite accepted history. Directory durability varies by
  filesystem and platform; no cross-process contention, power-loss,
  disaster-recovery or Windows NTFS guarantees are claimed.
- The ledger advances before an acknowledgement is returned. A crash in
  between creates an *unknown-ack* case: a replay is rejected and the sender
  must reconcile through a separately designed trusted read-only receipt.
  Do not retry by resetting the counter or replaying anonymous writes.
- A hardware reboot could reset a device-local sequence or clock; no
  automatic epoch reset is allowed. Explicit re-provisioning, authenticated
  clock bootstrap and monotonic sequence persistence need separate
  approval, design and physical tests.
- This Ed25519 gateway-facing experiment is an **alternative** to direct
  Firebase ID-token uploads, not a Firebase token issuance implementation.
  A gateway with Admin SDK privileges would bypass RTDB client security
  rules and require its own audited ingress, service isolation, authorization,
  anti-replay persistence, throttling and safe downstream transaction model.
- Real firmware upload shapes remain unauthenticated parent PUT/PATCH and
  cannot be safely promoted to this contract without an approved hardware
  or trusted-intermediary migration. No production Firebase rule was changed.

**Stage 8 candidate:** design *receipt/ack reconciliation* with signed,
test-only acknowledgements and crash-injection tests, then assess local
certificate trust via a standalone nonproduction TLS fixture. Continue only
after checking that a proposed design does not imply physical readiness.


## Stage 8 — lost acknowledgement, signed receipt and reconciliation (offline research)

The `experiments/stage8-ack-reconciliation.mjs` module and
`tests/stage8-ack-reconciliation.test.mjs` model a **separate synthetic
ledger experiment**. They do not extend or run the Stage 7 acceptance process
and are not imported by the website, firmware, bot or Flutter application.

A signed Stage 7-format frame is checked against a test-only Ed25519 device
public key, the operator-provisioned synthetic identity, a strict timestamp
window, and a mock in-process channel marker (**not TLS**). A server test key
signs a compact receipt binding the device, epoch, sequence and SHA-256 hash of
the canonical frame bytes. The receipt and the sequence record are written
**in one synthetic HMAC-sealed filesystem transaction** with an exclusive lock,
temporary file, fsync and atomic rename. No telemetry or remote alerts are
published. The store retains **only the last accepted receipt per device**.

On a simulated crash *before* the commit there is no receipt; a legitimate
retry may be newly accepted. On simulated acknowledgement loss *after* the
commit, the same frame is **not accepted twice**. Following restart, the
device sends a newly signed query with a fresh timestamp and the frame digest;
a provisioned verifier may return the stored **server-signed receipt** without
updating state. A receipt cannot be queried by an unauthorized, revoked or
wrong-key device, or by submitting guessed sequence numbers alone. Old
receipts may be unavailable after a newer frame: **not-found does not prove
a frame was never accepted** and must not justify an unsafe replay reset.

The tests cover forged signatures, payload conflicts at the same sequence,
corrupted storage, missing integrity keys, abandoned locks, stale queries,
identity revocation, false channel markers and device restart. An
acknowledgement is **receipt evidence only**: it does not establish that
Firebase saved telemetry, that a WhatsApp message was delivered or that a
physical warning or gate action took place.

### Unresolved Stage 8 limitations

- The in-process channel marker is **not certificate validation, TLS,
  hostname verification, or device attestation**. Real firmware still sends
  anonymous legacy writes and is not compatible with these signed envelopes.
- No power-loss durability certification, cross-host atomicity, multi-region
  replication, certificate/identity provisioning, secure receipt-signing-key
  storage, key rotation, or offline-field trials were performed.
- Privileged access to the HMAC integrity key and filesystem could permit
  ledger rollback. An independent durable counter/audit anchor is needed.
- A production gateway would need real authenticated TLS, rate/size limiting,
  path isolation, secure audit, operator monitoring, idempotent downstream
  Firebase writes and explicit separation of receipt states (accepted,
  database committed, alert delivered, device acknowledged).
- Phase A/Phase B production rules, real firmware and hardware, WhatsApp
  pairing, EC2/Windows live hosting and PR merges remain **separate owner
  approvals**. Never infer that this exercise mitigates current production
  anonymous-write exposure.

**Next research milestone:** crash-recovery at the *downstream transaction*
boundary and isolated TLS certificate validation using test certificates,
without introducing a live service or changing production telemetry.
