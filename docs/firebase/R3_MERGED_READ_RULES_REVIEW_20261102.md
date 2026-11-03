# FloodGuard R3 — merged Firebase RTDB Rules review (NO DEPLOY)

**2 November 2026. Review-only successor to website draft PR #88. Production NO-GO.**

## Evidence recovered

The owner-provided Firebase Console Rules deny all reads and writes at root and `/floodguard/live`. Android QA screenshots showed **HTTP 401** at three exact public child paths (`devices`, `system`, `esp8266/connection`). The current Flutter app is an anonymous read-only child-stream client, so this is consistent with the deployed read denial.

The owner's RTDB export contains all six core branches (`water`, `rain`, `gate`, `alarm`, `devices`, `system`) and ESP metadata. The export included private ESP networking fields; **none of their values or the raw export is committed here**. Exported `system.lastUpdate` is `2026-08-25T14:30:41.226Z`, not proof of current cloud or hardware status.

## Complete candidate, deliberately not deployable

`R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json` is a standalone, **offline-only** review file. We have **not** replaced the existing `firebase.rules.json` in this repository or the effective Firebase Console Rules.

It retains all **11 exact `.validate` expressions** from the owner-provided deployed rules for `water`, `rain` and `gate`. It proposes nine read-only paths required by the existing mobile client: the six core branches plus `esp8266/connection`, `esp8266/rssi` and `esp8266/status`. Root, live and ESP parent reads remain denied. ESP `ip` / `wifi`, `test`, `bot` remain private. All public/unauthenticated client writes remain denied.

## Why publication is blocked

1. **Privacy:** `.read:true` on a branch exposes **all current and future descendants**, including any accidentally added secrets. Child `.read:false` cannot revoke ancestor grants. The historical export is not an authoritative current complete schema inventory. Independently audit descendants; prefer a separately validated public projection for long-term design.
2. **Sensor ingestion:** Existing `.write:false` blocks normal client/REST writes; a privileged Admin client may bypass Rules. The real ESP8266/host uploader's identity, credentials, TLS verification, buffering and write path remain unverified. Do not set `.write:true`, publish the candidate, overwrite data or flash firmware.
3. **Validation gaps:** Original validation expressions protect only 11 leaves, not every exported field, schema descendant or deletion. Preserve them for compatibility while scheduling separately tested auth/schema hardening, not by broadening permissions.
4. **Live status:** Even successful reads can return null/stale/invalid data. Do not convert missing or old data to SAFE or live.
5. **Coordination:** Mobile PR #9, website PR #88 and bot PR #69 are draft and unmerged; their data contracts must be verified together before any live cutover.

## Test and release evidence

`node --test tests/r3-merged-rules-review.test.mjs` verifies the literal offline candidate's nine read grants, protected ancestors/private ESP paths, denial of all client writes and exact preservation of all 11 validation rules. This is **not** a Firebase Emulator or proof of deployed Rules. Review the exact-head GitHub Actions result, then separately test the Firebase RTDB Emulator with negative requests and an authorized sender in nonproduction.

**Deployment authorization: denied.** Retain an unchanged private rollback copy of effective Rules, inventory live public descendants (field names/types only), establish authenticated data ingestion and owner-approved fallback/rollback before proposing production rollout. Never grant reads to `/floodguard/live` or `/floodguard/live/esp8266` as an expedient fix.

Rules semantics: https://firebase.google.com/docs/database/security/core-syntax and https://firebase.google.com/docs/database/security/rules-conditions

## Historical ESP8266 writer sources recovered — private/offline evidence

Earlier uploaded Arduino sketches were located and **examined privately**:
- `FloodGuard_ESP8266_REAL_RAIN_FIREBASE_FINAL.ino` (454 extracted lines): uses ESP8266 HTTPS REST `PATCH` to the live database, and calls `WiFiClientSecure.setInsecure()`.
- `FloodGuard_ESP8266_Firebase_Realtime_1s_FULL.ino` (449 extracted lines): uses ESP8266 HTTPS REST `PUT` to the live database, and calls `WiFiClientSecure.setInsecure()`.

Neither reviewed file contained a clear Firebase REST authorization method or CA certificate validation call. **This is a static source observation, not a statement that the device runs either exact sketch or that every possible authorization path was exhaustively checked.** Raw sketches, credential strings, endpoint payloads and any device/ESP local network details have **not** been uploaded to GitHub.

Historical hardware checkpoint: user reported the prototype's Arduino/ESP8266 switched off or disconnected during security containment on 1 November. The current physical power state and flashed firmware remain unverified.

Owner's two timestamp reads on 2 November were `2026-08-25T14:30:41.226Z` approximately 16 seconds apart, while the nine public GET paths returned HTTP 200 and the four checked protected paths HTTP 401. Therefore the **last reported system update is stale**, and restored Firebase read access is not proof of live data.

**Ingress mismatch:** the current deployed Rules shown by the owner deny ordinary client writes; the historical sketches expect direct, unauthenticated REST writes. Do not enable `.write:true` at any public ancestor or simply switch on actuators to make the dashboard appear live. A physical emergency gate must not be controlled by remote testing.

### Local, privacy-preserving firmware preflight

For a saved private sketch file, run this **on the user's authorized WSL machine** from a checked-out review branch:

```bash
node scripts/r3-private-firmware-ingress-preflight.mjs \
  "/absolute/path/outside-git-to-your-private-sketch.ino"
```

Only fixed boolean indicators are printed. The script refuses symlinks, non-`.ino` files, empty/oversized files, never sends network requests, and deliberately exits **2 (NO_GO)** for every result. It cannot attest that the source was flashed, that credentials are valid, that the TLS identity is trustworthy, or that sensor readings represent the field. **Do not paste firmware sources, tokens, Wi-Fi settings, or secret diagnostics into public PRs or chat.**

### Subsequent secure architecture gate

Select an authorized, least-privilege ingestion identity and **cryptographically authenticated transport** that can be renewed/revoked; terminate sensitive verification in a trusted gateway or server environment rather than embedding a service-account private key or long-lived admin secret on an ESP8266. Firebase RTDB REST supports Firebase ID tokens or Google OAuth access tokens, with different privilege semantics; service-account Admin access can bypass RTDB Rules, so it requires especially tight storage and scope. Consider a protected server-side publisher that validates source identity, timestamp monotonicity, ranges/measurement provenance, and writes a sanitized public projection. Keep physical gate authority on the Arduino.

Use the Firebase Realtime Database **Local Emulator Suite** for positive/negative permission tests and authorized mock writer tests before a supervised hardware test. Do not substitute local static tests for Emulator behavior. Avoid destructive live HTTP PUT/PATCH/POST tests.

**Status: source findings recorded, local preflight CI pending, current writer identity and physical hardware unverified. Production NO_GO.**

### Later v6 sketch cross-check (private source only)

A further earlier-uploaded `FloodGuard_ESP8266_FIREBASE_FINAL_v6.ino` (519 extracted lines) was inspected privately. It also contains `WiFiClientSecure.setInsecure()`, direct HTTPS REST `PATCH` targeting the Firebase live path, and Arduino serial ingest indicators, without a clear Firebase REST authentication/CA-validation mechanism. A separate `FloodGuard_ESP8266_FINAL_FIREBASE.ino` (352 extracted lines) shows the same static indicators. These matches strengthen the **historical source-design finding only**; none identifies the version currently flashed. They do not establish that hardware is currently powered or whether the network is accessible.

Static preflight outcome: the dedicated GitHub workflow on this draft branch passed **11/11 synthetic/offline tests** at `261bdfa59b5c6f9d837c8611d0741d6e2c9c6c93` (5 merged Rules source checks and 6 firmware preflight checks), including no-credential-output regressions. This is not a Firebase Emulator or on-device test and never overrides `NO_GO`.


## 2026-11-03 — Firebase Realtime Database Emulator acceptance (offline only)

**Evidence:** GitHub Actions https://github.com/teldigi5-wq/floodguard-website/actions/runs/41621812265 at commit 0818e63962dc3b5e78dfa63337dc4b71ba83ca17. All jobs completed successfully with Firebase CLI 15.34.2, Java 21, a fixed loopback host 127.0.0.1:19001, the disposable demo-floodguard-r3 project, and the review-only Rules candidate. No production credentials or device commands were used.

- **7/7 Firebase Rules Emulator tests passed:** fixed local environment; synthetic, deliberately stale local fixture via emulator-only owner bearer; nine approved unauthenticated child reads; protected ESP/parent/test/bot read denials; PUT denied at nine public children and protected paths; PATCH/DELETE denied; synthetic fixture readable afterward. The literal owner bearer is solely an emulator fixture mechanism, not production authorization.
- **5/5 static Rules source tests passed**, including exact 11 historical validators.
- **6/6 private firmware preflight tests passed**, including credential-redaction behavior.
- **Total 18/18 passing checks**, no test failures in the final exact-head run.

Two earlier runs did fail: one due to default Java 17 (Firebase CLI requires 21), another due to a mistaken emulator-only seeding credential syntax. Both were corrected without changing Rules; the final exact-head run is green. Do not describe the earlier failures as successes.

To reenact safely from an authorized checked-out copy with Node 22+ and Java 21:

    GCLOUD_PROJECT=demo-floodguard-r3 npx --yes firebase-tools@15.34.2 emulators:exec --only database --project demo-floodguard-r3 --config r3-firebase-emulator.json "node --test tests/r3-firebase-emulator.test.mjs"

The test hard-codes local 127.0.0.1:19001 and a demo project. Never redirect it to a production endpoint, use private datasets as fixtures, or equate an emulator-only owner bypass with a deployable credential.

**Remaining blocking gates:** exact deployed Rules provenance/rollback; complete public-child descendants privacy inventory; authenticated revocable device ingestion; replay/monotonic clock validation; fresh physical sensor verification; fail-closed on-device safety and gate control. The owner-observed system.lastUpdate remains 2026-08-25T14:30:41.226Z. **Production NO_GO.** PR draft/unmerged, no Firebase production deployment and no hardware changes.
