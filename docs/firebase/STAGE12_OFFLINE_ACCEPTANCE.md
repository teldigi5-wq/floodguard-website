# Stage 12 — Offline Acceptance & Release Evidence Gate

**14 October 2026 · NO-GO · Review only · No production or real-device testing**

This note extends [Stage 11](./STAGE11_CROSS_REPO_RELEASE_READINESS.md),
which captured the exact website, bot and private mobile draft PR revisions.
Stage 12 preserves all three draft/unmerged branches, mobile repository privacy,
the previously working flashed Arduino/ESP8266, and the owner's request **not**
to pair WhatsApp or connect the offline command center to live services.

## What this stage verifies in CI

- Representative **synthetic** firmware-shaped Firebase REST
  `PUT /floodguard/live` and multi-location `PATCH /floodguard/live`
  payloads; they are only fixtures, **not captures from the flashed ESP8266**.
- The exercise extracts a narrow public projection while refusing to promote
  the old anonymous input into an authenticated message, database write,
  WhatsApp notification, gate action or production endpoint.
- Synthetic network identifiers and Wi-Fi labels are intentionally fake and
  never returned by the projection. Unknown descendants of broadly readable
  children are **flagged**, not silently declared safe.
- Website pure timestamp/freshness parsing against fresh, stale, missing,
  future-dated, disconnected and historical synthetic observations.
- Existing Phase A/Phase B Firebase Emulator CI remains the source of
  **emulator** read/write authorization evidence; it does not validate current
  effective production rules.
- `STAGE12_ACCEPTANCE_GATES.json` remains **NO_GO**, with every physical,
  privacy, hosting, notification, firmware, deployment and recovery gate marked
  **UNVERIFIED**. Tests refuse a false sign-off in this snapshot.

Files: `experiments/stage12-legacy-acceptance.mjs`,
`docs/firebase/stage12-synthetic-fixtures.json`,
`tests/stage12-offline-acceptance.test.mjs`,
`docs/firebase/STAGE12_ACCEPTANCE_GATES.json`. Run
`node --test tests/stage12-offline-acceptance.test.mjs` or `npm test`.
No credentials, sockets, Firebase SDK or hardware access are needed.

## Newly confirmed review blocker: divergent stale-data windows

Inspected source at the Stage 11 review snapshots declares:

| Client | Source | Stale window |
| --- | --- | --- |
| Website | `lib/telemetry-health.mjs` | 10 seconds |
| Bot | `src/floodguard.js` (`FLOODGUARD_STALE_MS` default) | 15 seconds |
| Flutter | `lib/core/constants/thresholds.dart` | 30 seconds |

At **20 seconds** after the same last reported field timestamp, the website
would mark data stale; the bot's default would mark it stale; the mobile time
window alone could still consider it recent. Actual Flutter screen treatment
also depends on connectivity, parsing and UI logic, **so this table is
not evidence that the app shows LIVE at 20 seconds**. Likewise, a Firebase
socket reconnect must never refresh an old sensor timestamp.

**Do not align these automatically.** Changing a safety/staleness threshold
without physical packet cadence, known firmware timestamps and independent
client validation risks both false alarms and false reassurance. Field-team
approval is required for a shared freshness policy, error/unknown states,
clock drift and data ageing in all three clients.

## More review boundaries

1. **Public descendants:** Phase A `.read: true` at `water`, `rain`,
   `gate`, `alarm`, `devices`, `system` grants public access to
   *every* child under those nodes. Inspect actual descendants privately
   before considering Phase A, even though ESP8266 `ip` and `wifi`
   are denied under their own read-restricted ancestor.
2. **Anonymous writes:** Candidate Phase A leaves parent
   `/floodguard/live/.write: true`; malicious or mistaken clients may
   forge telemetry. Phase B experiments do not support existing whole-parent
   anonymous PUT/PATCH uploads and are **not** ready for live operation.
3. **No false end-to-end evidence:** Stage 5–10's signed frames, outbox,
   mock acknowledgement, offline LEDGER and localhost TLS tests do not
   establish ESP8266 authenticators, field calibration, genuine Firebase
   persistence, WhatsApp delivery or real alert reliability.
4. **Hosting:** Former AWS account is inaccessible. GitHub Windows CI is not
   a Windows-PC installation. Neither a local PC live host nor EC2
   deployment is authorized. Only the already reviewed `npm run start:demo`
   offline demonstration is permitted.
5. **Mobile confidentiality:** Keep mobile private while historic archive
   issue #3 remains open. No action on PRs, deployment, session backup,
   secrets or physical firmware is authorized by this document.

## Operator acceptance sequence (all currently unverified)

The checklist is a **record of future required evidence**, not an instruction
to operate devices now. Stop if any step unexpectedly requires a live
connection, physical gate actuation, credential disclosure or changes to
the deployed rules.

1. Owner privately reviews the exact *effective* Firebase Rules and privately
   inventories any potentially sensitive descendants under public ancestors.
   Record a backed-up rules revision, restoration plan and a read-only
   preflight result. Avoid storing identifying RTDB values in CI logs.
2. Owner identifies the running ESP8266 firmware/upload shape by safe,
   **read-only** observation if and when the already-flashed system is
   available. Do **not** reflash or modify wiring to pass Stage 12.
3. Review physical sample intervals, clock source, disconnect handling, and
   choose one evidence-backed cross-client freshness contract. Confirm
   sample classification on the real Android device and browser.
4. In a separate isolated test target, run the bot child-only read test and
   Flutter/website scenario checks against safe synthetic data. Real
   production telemetry is **not** a test fixture.
5. Obtain separate, explicit authorization before selecting a replacement
   host, restoring/pairing a WhatsApp session or sending any real alert.
6. Design and validate a device-identity/TLS migration before *closing*
   anonymous writes. A separate owner-approved supervised maintenance
   window, backup, operator and rollback trigger are required to change any
   production rules.
7. Run accessibility and physical Android acceptance, then decide
   separately whether to advance each draft PR. No auto-merge or auto-deploy.

**Decision remains NO-GO.** Automated tests and documents are necessary
evidence, not a substitute for field approval or security review.
