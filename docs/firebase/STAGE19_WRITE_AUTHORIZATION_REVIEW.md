# Stage 19 — Phase B negative authorization matrix (offline only)

**Status: REVIEW ONLY / NO-GO for production.** This is a stacked, isolated change to website draft PR #8. It does not modify RTDB rules, deployed website routes, Flutter, the WhatsApp bot, firmware, or host credentials.

## What the additional tests check

- Five synthetic writer classes (anonymous, ordinary signed-in, revoked, incorrect scope, and unregistered) are refused on all six live telemetry leaves that the Phase B prototype permits for its registered test device.
- A previously permitted device is revoked using the test environment's privileged setup context; every attempted replacement and deletion is then denied, and the last stored reading is checked unchanged.
- A legitimate leaf-level device identity cannot expand access by issuing a mixed root PATCH, a parent PUT, changing system risk, or editing its own authorization record.
- Static policy tests require UID-scoped, enabled-registry, reviewed-scope, nondeletion conditions on all six prototype write expressions, and reject any literal `.write: true` anywhere in the candidate.

**Verification requirements:** run `npm test` and the existing `firebase-phase-b-prototype.yml` workflow using the isolated `firebase.phase-b.json` emulator configuration. GitHub/Emulator success must be observed for the exact new head SHA; newly committed tests are not automatically treated as passing.

## What the tests cannot prove

The prototype remains a partial rules model: it does not support the flashed ESP8266's historical anonymous parent PUT/PATCH schema. There is no device token provisioning, renewal, server-certificate verification, trusted ingestion bridge, firmware migration, independent downstream database confirmation, production role binding, or actual sensor/WhatsApp receipt verification.

**Do not merge/publish rules merely because these tests pass.** The current Phase A read-containment candidate continues to permit anonymous writes, and cannot be characterized as resolving integrity risk. A real Phase B rollout requires the owner to observe the currently flashed firmware without disrupting it, independently approve an authenticated uploader and compatibility plan, test all nine public child subscriptions, verify the RTDB Emulator authorization/replay matrix, and separately authorize production cutover with backup and rollback.
