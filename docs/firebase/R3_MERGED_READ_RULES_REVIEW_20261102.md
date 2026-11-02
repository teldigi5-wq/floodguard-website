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
