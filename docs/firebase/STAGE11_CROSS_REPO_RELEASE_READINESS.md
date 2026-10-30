# Stage 11 — cross-repository release readiness / NO-GO

**As of 14 October 2026 — review snapshot only. NOT APPROVED, NOT DEPLOYED.**

This assessment joins the **website draft PR #8**, **bot draft PR #12**,
and **private mobile draft PR #1**. It is based on inspected source at the
exact SHAs in `stage11-cross-repo-readiness.json` and successfully completed
GitHub-hosted CI. It is **not** an authorization to merge, expose a repository,
publish Firebase Rules, restart a bot, connect WhatsApp, open a network port,
test firmware, operate the gate or send any flood warning.

## Reviewed revisions and automated evidence

| Component | Inspected PR HEAD | Passing latest relevant checks | Review caveat |
| --- | --- | --- | --- |
| Website / staged rules | `af31dc48d7f38194cc079460635e703f15cc7bac`, [draft PR #8](https://github.com/teldigi5-wq/floodguard-website/pull/8) | [website 109 pass, 6 skipped](https://github.com/teldigi5-wq/floodguard-website/actions/runs/38550985298), [Phase A](https://github.com/teldigi5-wq/floodguard-website/actions/runs/38550985235), [Phase B Emulator 11 pass](https://github.com/teldigi5-wq/floodguard-website/actions/runs/38550985245), [CodeQL](https://github.com/teldigi5-wq/floodguard-website/actions/runs/38550985230) | Stage 5–10 ingress, signed receipt, TLS and notification experiments are synthetic or localhost-only; no production integration |
| Windows/offline bot | `b2048d05d47ccc634c20ea562d1efee3fb158476`, [draft PR #12](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/pull/12) | [Linux Node 60 pass](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38517968749), [Windows 60 pass + synthetic restart](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38517968735), [browser QA 10 pass](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38517968724), [Firebase Emulator 2 pass](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/actions/runs/38517968714) | Only GitHub-hosted Windows runner tested; real PC, WhatsApp and persistent sessions not tested; old AWS account unavailable |
| Flutter mobile v7 | `1b40c15e4e2ed7fae58ab35584794b7502f4f96c`, **private** draft PR #1 | Flutter [analysis/tests/debug APK CI passed](https://github.com/teldigi5-wq/floodguard-mobile/actions/runs/38410398000) | No real Android install, network reconnection, physical display/a11y or field-test sign-off; preserve repository privacy |

Passing CI proves **code-level behavior in the stated environment only**.
All three PRs remain draft and unmerged. The project owner reports that the
Arduino/ESP8266 firmware was already flashed and worked before becoming
unavailable for physical testing. This is not independent validation, and no
firmware alteration is authorized or necessary for the review.

## Cross-repository Firebase read compatibility

The three reviewed clients use the exact same nine child read targets, relative
to `/floodguard/live`: `water`, `rain`, `gate`, `alarm`, `devices`,
`system`, `esp8266/connection`, `esp8266/rssi`, `esp8266/status`.
Source evidence: website `scripts/verify-firebase-read-boundaries.mjs`;
bot `src/firebase.js`; mobile `lib/repositories/firebase_public_telemetry.dart`.

The **candidate** Phase A Rules permit these children and deny parent
`/floodguard/live`, parent `esp8266` and sensitive `esp8266/ip` and
`esp8266/wifi`. The bot draft also exercises child-only SSE reads against
an isolated Firebase Emulator. Flutter has widget/unit smoke tests but no
real-phone Phase A end-to-end test; the website has static and Emulator
policy tests. Parent denial does **not** automatically make every descendant
of publicly readable `water`, `rain`, `gate`, `alarm`, `devices` or
`system` safe. Inventory those branches privately for undisclosed metadata.

### Important distinction: repository rules are not effective production rules

`firebase.rules.json` is a repository file; it is **not** proof of the
effective deployed rules. The owner's previously supplied effective rules
were more permissive; this review did not connect to Firebase production or
read private telemetry. Phase A `/floodguard/live/.write: true` explicitly
**preserves anonymous writers** to avoid breaking legacy firmware. It is
a read-privacy containment candidate, *not* a secure telemetry solution.
Phase B enforces some simulated device identity constraints in the Emulator,
but it is incomplete and would reject the existing firmware's broad
PUT/PATCH shapes. Do **not** apply either policy without separate approval.

## Release blockers (all remain open)

| Severity | Blocker | Evidence required for clearance |
| --- | --- | --- |
| **P0** | Effective production Firebase rules not privately verified; historical broad reads/writes | Authorized owner obtains effective deployed Rules, confirms safe backups and read exposure, performs separately approved maintenance; no secrets or production data in public PR |
| **P0** | Anonymous `/floodguard/live` writes preserved by Phase A | Verified device identity/authenticated scoped write architecture, secure TLS on actual flashed-device-compatible path or approved trusted intermediary, proof of replay/revocation, no anonymous rollback bypass |
| **P0** | Actual ESP8266 firmware revision/upload path and device TLS unknown | Supervised **read-only** field observation when device next available; no reflash/gate command by default; validated firmware/transport migration separately approved |
| **P1** | No verified replacement host or WhatsApp pairing/session recovery | Owner chooses approved host and persistent session storage; independent supervised host/phone/WhatsApp test, delivery records and rollback approval; former EC2 unavailable |
| **P1** | No physical Android acceptance on current CI debug APK | Device smoke test on owner-controlled hardware: five tabs, live/demo, stale timestamps, Firebase child reads, no private metadata, responsive layouts, no gate actuation |
| **P1** | Telemetry schema, timestamp and freshness consistency across all clients still needs field evidence | Private inventory of existing `system/lastUpdate`, sample variants and stale/offline behavior; verify no fake live measurements or fabricated warnings |
| **P1** | No production backup, rollback runbook execution or maintenance authorization | Named operator, rules backup hash, change window, monitoring/rollback plan and explicit approval for **each** action |
| **P1** | Private mobile historical archive issue still open | Resolve its sensitive-content history review before any visibility change; default **private** |

## Independent operator decision gates

1. **Keep software offline.** Refresh the SHAs and CI links before each review.
   A successful draft PR does not authorize merging or deployment.
2. **Read-only inspection and containment planning.** Obtain the real
   production Rules privately and review the exposure. Do not publish,
   overwrite, or even partially deploy Rules from this review.
3. **Cross-client acceptance.** Run live/dry tests on an isolated Firebase
   target with the same authentic field schema; confirm mobile, website and bot
   consumer behavior under candidate child-only reads.
4. **Replacement-host recovery** only after owner approval. The bot is
   presently demo-only; WhatsApp pairing is explicitly not approved.
5. **Device migration** is a separate decision. Preserve the verified
   previously working physical baseline. Validate trusted TLS, scoped device
   identity, secure key handling, reboot/replay and failed-network recovery.
6. **Rule publication and rollback** require a *new* explicit owner's
   authorization, backed-up effective Rules, monitoring window, operator
   acceptance and rollback trigger. Do not use anonymous parent-write
   fallback as a permanent mitigation.
7. **Post-release acceptance** would require real mobile screen reader/
   accessibility checks, physical sensor validation/calibration and honest
   emergency notification status. None is satisfied by Stage 5–10 simulations.

## Local read-only decision helper

Run `npm run audit:stage11` or `node scripts/stage11-release-audit.mjs`.
This reads repository files and the reviewed snapshot **without internet
access, production access, credentials, mutations or secrets**. It reports
`NO_GO` and blockers, and compares the nine reviewed client path snapshots
with the local Phase A candidate. It deliberately **cannot** approve a
release automatically. Refresh the source snapshots by inspecting current
bot/mobile PR HEADs; static tests alone cannot detect future cross-repo drift.
