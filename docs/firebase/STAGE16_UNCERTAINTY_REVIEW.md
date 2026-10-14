# Stage 16 — Proposed uncertainty-first safety display contract

**14 October 2026 · NO-GO · test-only, no runtime changes, no deployment.**

This stage builds on Stage 14's 12 synthetic divergent scenarios and Stage
15's actual Node/Dart *unit and model* test execution. The new pure JavaScript
module `experiments/stage16-uncertainty-policy.mjs` generates **proposed
review labels only**. No website provider, bot command, Flutter widget,
Firebase Rule, credential, gateway, actual sensor or physical gate is
updated. Run `npm run audit:stage16` to execute its local regression suite.

### Previously verified client-native evidence

- Bot draft [PR #12](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/pull/12)
  at `c0a3fcf9a2d375b19ab6ab7a1f124c7c37a9507c`: [Linux
  70 tests pass](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38557740433),
  with [Windows offline](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38557740513),
  [browser QA](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38557740540)
  and [Firebase Emulator](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38557740434) green.
- Mobile **private** draft PR #1 at
  `3cfb0c6caeb0e9dcac8562ab402bf22b2d42cf45`: [Flutter CI
  passed](https://github.com/teldigi5-wq/floodguard-mobile/actions/runs/38557914571),
  including Dart model tests and debug APK packaging. No real Android
  acceptance or physical device inspection occurred.
- Website Stage 14 `295d6f3d625a88675a923e865f78add7bc3bf2c2`:
  [147 Node tests](https://github.com/teldigi5-wq/floodguard-website/actions/runs/38556474171)
  passed, 6 intentionally skipped. Stage 14's web/bot/mobile comparison
  was a *source-transcribed model*, not multi-runtime integration.

### Candidate display policy (proposal, NOT implemented in clients)

| Input | Suggested display | Why it must be reviewed |
| --- | --- | --- |
| Air gap **0 cm**, conflicting or missing level | `UNVERIFIED_WATER` | Could mean water reached transducer or invalid ultrasonic echo; neither SAFE nor confirmed DANGER is justified without firmware evidence |
| Positive distance and level/status consistent | `SAFE_REPORTED_ONLY`, `WARNING_REPORTED_ONLY`, `DANGER_REPORTED_ONLY` | Still untrusted while anonymous writes remain possible; never assert physical or authenticated status |
| Air gap and supplied level disagree, or declared status contradicts value | `UNVERIFIED_WATER` | Whole-tree/PATCH timing and source precedence unresolved |
| Gate status says OPEN but angle 0°, or CLOSED but angle 45° | `POSITION_CONFLICT` | Cannot infer physical gate position from contradictory telemetry |
| A plausible, consistent gate report | `CLOSED_REPORTED_ONLY`, `OPEN_REPORTED_ONLY`, `COUNTDOWN_REPORTED_ONLY` | Report is not an actuator reading verified in the field |
| CRITICAL rain but system risk says LOW | `REVIEW_REQUIRED` | Published summary may lag another child branch or be spoofed |
| Unknown water/rain sensors | `REVIEW_REQUIRED` | Never silently report LOW just because sources are unavailable |
| Legacy rain ONLINE with dailyMm 120 | `REVIEW_REQUIRED` | Firmware variant / numeric fallback mapping unresolved |
| Field time 20s old | `STALE_UNDER_AT_LEAST_ONE_EXISTING_CLIENT_WINDOW` | Website 10s, bot 15s, mobile 30s; no unapproved threshold change |
| Reconnected browser with invalid/future timestamp | `INVALID_OR_MISSING_FIELD_TIMESTAMP` | A socket reconnection cannot prove recent physical readings |

The pure function emits only bounded **labels, timestamps, reason codes
and existing window comparisons**, not the complete Firebase payload,
network identifiers, Wi-Fi metadata, credentials or subscribers. It
always returns `NO_GO`, `canActuate:false`, `canSendAlerts:false`,
`canDeploy:false` regardless of apparently consistent inputs.

**Caveat:** these are *proposed UI and risk communication semantics*, not
certified water-level thresholds or emergency guidance. The existing
current production presentation remains unchanged. Even a fully
consistent, recently timestamped synthetic sample may be forged under
today's anonymous write permissions, so the displayed label must not
be interpreted as validated safety.

### Gated follow-up before any client-side behavior change

1. Owner-approved **read-only** verification of actual already-flashed
   firmware logic: how 0 cm, invalid echo, and source timestamps are
   encoded; never reflash, reconnect the gate, or power hardware
   for this test-only stage.
2. Decide a shared rule for missing readings, partial multi-location
   PATCHes, redundant water fields and sensor-error precedence.
3. Privately validate physical gate telemetry contract (status, servo
   position, countdown); do not command movement to resolve contradictions.
4. Adopt one evidence-based shared clock freshness policy only after
   measuring actual publish cadence and device clock drift, and test the
   website, bot command formatting and real Android UI independently.
5. Obtain actual effective Firebase Rules privately, prevent unauthorized
   telemetry writes through a separately approved firmware-compatible
   authentication plan with validated TLS, then rehearse backup/rollback
   before publishing changes. No Phase A or Phase B candidates are
   authorized for live use.
6. Retain all PRs as drafts; mobile must stay **private** while historic
   archived sensitivity review issue #3 is open. No WhatsApp pairing,
   live messages, production Firebase, hosting or AWS/EC2 deployment.

A subsequent explicitly reviewed patch may choose to apply portions of
this proposal to app display logic, but current results **do not** grant
permission to change physical safety behavior or to deploy.
