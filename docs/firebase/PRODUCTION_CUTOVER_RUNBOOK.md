# FloodGuard privacy migration — supervised production runbook

**Approval state: NOT APPROVED / NOT DEPLOYED**  
This guide coordinates [mobile](https://github.com/teldigi5-wq/floodguard-mobile),
[EC2 WhatsApp bot](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/pull/12),
and [the staged Firebase rules](./phase-a-privacy-candidate.rules.json).
It does not imply the live hardware has been tested. Do **not** merge the bot PR, apply rules,
or rotate device credentials as part of reading this document.

## Release gate: prerequisites to verify before touching production

- Back up the **actual currently deployed rules** from Firebase Console outside the public repository. Record operator, version, date and rollback location.
- Establish that the ESP8266 is currently uploading; identify the flashed firmware and confirm whether the upload endpoint/shape is compatible with candidate rules. Do not turn on gate hardware only to exercise tests.
- Verify the existing web UI, Android debug app (demo, live and offline/stale) and bot's baseline WhatsApp messages under the *current* rules.
- Confirm a competent operator has the live EC2 bot access, EC2 deployment recovery path, WhatsApp test number, Firebase Console editor access and a rollback window.
- Obtain explicit owner approval for a supervised bot redeploy. **Until bot PR #12 is merged, the existing production `main` workflow still auto-deploys on pushes.** The proposed PR changes that behavior to a manual, exact-commit `workflow_dispatch` with an approval input and a dedicated production environment. Verify this change is present in the actual merged workflow before merging or deploying.
- Candidate passes Firebase Emulator, website CI, and CodeQL. Bot PR must pass CI on its **latest head**; emulator/static tests alone cannot prove live device or WhatsApp connectivity.

## Step 1: supervised EC2 bot migration

1. Document the exact current bot main SHA and EC2 PM2 status; preserve the last known-working deployment (and private WhatsApp session files) for rollback. Do not publish QR/session credentials.
2. After owner approval and all CI checks, merge bot PR #12 **only after confirming its merged deployment workflow is manual-only**. Merely merging should not restart EC2. During the maintenance window, open GitHub Actions → **Deploy FloodGuard to EC2 (manual approval)**, supply the exact reviewed 40-character `main` commit SHA, choose `DEPLOY`, and observe deployment logs. Verify the actual deployed source SHA and PM2 status; GitHub environment review controls must be configured separately if required.
3. Test, from an authorized WhatsApp number: \`menu\`, \`stats\`, \`water\`, \`risk\`, \`gate\`, \`rain\`, \`devices\`, \`network\`; verify real timestamps, no ESP8266 IP/Wi-Fi disclosure, and no fabricated live status when field updates stop.
4. Observe SSE reconnect and message delivery without triggering any physical gate or emergency broadcast. Roll back if any unexpected alarm message or stale-data misrepresentation appears.
5. If bot rollout fails, restore previous code through an audited revert/rollback and verify PM2 and WhatsApp reconnection. **Do not deploy Phase A rules while bot is broken.**

## Step 2: private-read containment — maintenance window only

1. Re-check Flutter live mode and the Next.js dashboard on a phone and browser.
2. Keep a signed-off copy of the old effective Firebase rules and the Phase A candidate in separate trusted locations.
3. After explicit owner approval and successful emulator tests, paste the reviewed candidate into Firebase Console → Realtime Database → Rules and publish during supervised maintenance.
4. Verify anonymous **safe** child reads succeed and parent/private reads fail with HTTP 401/403. Use the read-only status-only script in this PR:

   \`FG_RTDB_URL=https://floodguard-e3215-default-rtdb.asia-southeast1.firebasedatabase.app node scripts/verify-firebase-read-boundaries.mjs\`

   **The script does not display HTTP response bodies or modify database values.**
5. Verify the real ESP8266 continues uploading, the website/mobile display field timestamps correctly, and the bot still replies and receives updates.
6. If any client or firmware breaks, immediately restore the privately backed-up effective rules; recheck that uploads and client access resume. Record why rollback was necessary.

## Phase A security limitation

**Phase A intentionally leaves \`/floodguard/live/.write: true\`** because the saved firmware uploads
anonymously. This remains vulnerable to malicious telemetry writes. The read containment is urgent but is **not** the final security closure. Do not claim full security after Phase A. There must be a separate write-authentication migration.

## Step 3: authenticated upload migration — independent change

- Identify the firmware **actually flashed**, its telemetry paths, power recovery and connection behavior.
- Design dedicated device identity/token rotation and narrowly authorized write paths. Never embed admin service-account credentials in firmware or Flutter/web clients.
- Verify ESP8266 server TLS certificates; \`client.setInsecure()\` is unacceptable for authenticated uploads.
- Test with Firebase Emulator and a non-production target first. Include unauthorized write rejection, sensor validation, disconnected/reconnected device, backoff and token refresh.
- When the replacement is deployed and uploads proven, remove anonymous write grants with a separately reviewed ruleset and execute a second maintenance/rollback plan.

## Sign-off record to fill at rollout

| Gate | Required evidence | Status |
| --- | --- | --- |
| Bot latest-source CI | Completed run SHA + passing tests | Verify per PR |
| EC2 bot live-mode QA | Authorized WhatsApp command transcript, privately stored | **Not tested** |
| Android physical test | Demo/live/stale views checked on real phone | **Not tested** |
| Website current field QA | Browser screenshots + actual field timestamps | **Not tested** |
| Rule authorization | Firebase Emulator tests | Passed on draft |
| Production Phase A publish | Owner approved + rollback copy + observed post-publish | **Not done** |
| Authenticated ESP writer | Certificate-verified firmware + scoped access | **Not done** |

FloodGuard is an educational prototype and not a certified public-warning or life-safety system.
