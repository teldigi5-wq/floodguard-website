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
