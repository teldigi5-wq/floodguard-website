# FloodGuard privacy migration — supervised production runbook

**Approval state: NOT APPROVED / NOT DEPLOYED**  
This guide coordinates [mobile](https://github.com/teldigi5-wq/floodguard-mobile),
[EC2 WhatsApp bot](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/pull/12),
and [the staged Firebase rules](./phase-a-privacy-candidate.rules.json).
It does not imply the live hardware has been tested. Do **not** merge the bot PR, apply rules,
or rotate device credentials as part of reading this document.

## Hardware baseline — owner-reported, 13 October 2026

The owner confirms the FloodGuard Arduino and ESP8266 are **already flashed**, were **working correctly**, and the system is **currently offline/not available for remote live testing**. Preserve the working firmware and physical wiring. This is an owner-reported working baseline, **not** an independently executed live test or confirmation of the exact flashed sketch and SHA. Do not infer that the device malfunctioned simply because Firebase telemetry is old or unavailable.

**While the hardware is offline:** continue repository CI, synthetic Firebase Emulator authorization checks, offline/stale UI regression tests, and private release documentation. Do not require, schedule, or perform a reflash, factory reset, gate actuation, EC2 restart, or Firebase rules publication to progress these tasks. No field data is expected to update until the system is online again.

**When the owner next chooses to bring the system online:** perform a read-only boot/connectivity/telemetry observation first; privately note the actual running firmware upload *shape* and timestamp behavior if accessible; validate without changing the known-working firmware. Treat a firmware migration as a separate optional approved release, never a prerequisite for confirming existing operation. A successful physical check under the old rules is not proof that the new Phase A or B rules will work.

## Hosting disruption — AWS inaccessible as of 14 October 2026

The owner reports that the AWS account was banned. The WhatsApp bot had **worked when deployed** but the AWS EC2 host and any disk backup are now unconfirmed and should be treated as inaccessible. This is a **hosting outage**, not evidence that the bot, the already-flashed Arduino or ESP8266 failed. The system is currently offline for remote testing. The previous EC2 manual deployment instructions below are **historical, not presently actionable**.

The bot's reviewed draft migration now includes a cloud-provider-independent Node/PM2 configuration and local loopback setup route at [docs/RECOVERY_WITHOUT_AWS.md](https://github.com/teldigi5-wq/floodguard-whatsapp-bot/blob/security/allowlisted-firebase-telemetry-v1/docs/RECOVERY_WITHOUT_AWS.md). The next approved bot deployment, if any, must target a user-approved replacement host with persistent WhatsApp authentication storage, privately provisioned admin credentials and HTTPS-protected setup access. If the original session is unrecoverable, the authorized WhatsApp phone must pair via a fresh QR. Do not imply that the existing EC2 can be accessed, restarted or recovered.

**Separate approvals:** obtain user approval for the **new hosting account and deployment** (including any billing or credentials); then verify actual WhatsApp replies and fresh/historical read behavior on that host. Only after reviewing all active clients and privately checking Firebase child names should Phase A rules publication be considered as a separate decision. Phase B remains a prototype only; never deploy it to replace the existing working firmware's anonymous parent writes.

## Release gate: prerequisites to verify before touching production

- Back up the **actual currently deployed rules** from Firebase Console outside the public repository. Record operator, version, date and rollback location.
- Do not require current ESP8266 uploads while the working hardware is offline. When it is next available with owner participation, **observe rather than reflash**, privately identify the running firmware or upload shape and confirm candidate-rule compatibility; never power or actuate the gate solely to run remote checks.
- Verify the existing web UI, Android debug app (demo, live and offline/stale) and bot's baseline WhatsApp messages under the *current* rules.
- Confirm an operator has approved **replacement-host access** and a persistent backup plan, the authorized WhatsApp phone, Firebase Console editor access and a rollback window. AWS EC2 access cannot be assumed.
- Obtain explicit owner approval for a **new host and supervised bot deployment**. The bot main branch still has the previous EC2 deployment behavior until the draft PR is merged; do not push to main or invoke AWS workflows for recovery. A new host-specific deployment workflow must be reviewed separately before use.
- Candidate passes Firebase Emulator, website CI, and CodeQL. Bot PR must pass CI on its **latest head**; emulator/static tests alone cannot prove live device or WhatsApp connectivity.

## Step 1: supervised replacement-host bot migration (EC2 unavailable)

1. Treat legacy EC2 status and WhatsApp session backup as unknown while AWS is inaccessible. Do not attempt an EC2 restart. Select and explicitly approve a replacement host with persistent storage; preserve/recover a prior auth backup only if available through authorized means, otherwise plan new pairing from the authorized phone. Privately record its bot source SHA, TLS setup, storage path and rollback plan.
2. After owner approval and passing CI, manually deploy the reviewed exact revision to the **replacement host**. Do not use the old EC2 GitHub Actions workflow, which targets the inaccessible AWS instance. Verify private setup token, TLS-protected QR access, persistent auth files, one bot process, source SHA and process health. New host automation must be designed and approved separately; bot PR #12 remains draft until these gates are met.
3. Test, from an authorized WhatsApp number: \`menu\`, \`stats\`, \`water\`, \`risk\`, \`gate\`, \`rain\`, \`devices\`, \`network\`; verify real timestamps, no ESP8266 IP/Wi-Fi disclosure, and no fabricated live status when field updates stop.
4. Observe SSE reconnect and message delivery without triggering any physical gate or emergency broadcast. Roll back if any unexpected alarm message or stale-data misrepresentation appears.
5. If the replacement-host bot rollout fails, stop the new process and restore its previous tested revision/session (when available); do not claim recovery if the old AWS session cannot be accessed. **Do not deploy Phase A rules while active clients are broken or a replacement bot has not been validated and expressly approved.**

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
| Replacement-host bot live-mode QA | Authorized WhatsApp command transcript, privately stored | **Not tested; AWS unavailable** |
| Android physical test | Demo/live/stale views checked on real phone | **Not tested** |
| Website current field QA | Browser screenshots + actual field timestamps | **Not tested** |
| Rule authorization | Firebase Emulator tests | Passed on draft |
| Production Phase A publish | Owner approved + rollback copy + observed post-publish | **Not done** |
| Authenticated ESP writer | Certificate-verified firmware + scoped access | **Not done** |

FloodGuard is an educational prototype and not a certified public-warning or life-safety system.
