# FloodGuard R3 H25 — Actual Firebase SDK subscription and browser transitions

Date: 4 November 2026. **DRAFT · NON-PRODUCTION · UNMERGED · RELEASE NO-GO**.

Canonical H25 parent is website H24 draft PR #116, exact SHA `1ed670bea79b5846f0317130450b219b2c774234`. Android H12i and WhatsApp H14 are inspected boundaries, **not changed or activated**.

## Gap after H24

H24 proved the restrictive **proposed** local RTDB Rules with 7/7 emulator tests and the website's unavailable-data UI in real Chromium with 5/5 tests. But those acceptance checks did **not yet exercise the actual Firebase JavaScript SDK subscribing to separate public children** while synthetic fields transitioned from coherent to contradictory, sensor-fault, and stale data. They did not prove the dashboard reacted after a real subscription callback.

## Test-only connection boundary (fail closed)

`lib/firebase.ts` preserves the normal production database path verbatim and adds a branch enabled only by the **compiled test-only** `NEXT_PUBLIC_FG_R3_EMULATOR_LAB=1` flag. Even with this flag, it refuses to initialize unless all these conditions match:

- Browser origin exactly `http://127.0.0.1:4173`.
- Database URL exactly `https://demo-floodguard-r3-default-rtdb.firebasedatabase.app`.
- Public path exactly `floodguard/live`.
- Firebase SDK connects only to loopback `127.0.0.1:19001` through `connectDatabaseEmulator`; its dedicated named app is not the normal production app.

A deployed app with the test flag fails closed, instead of falling back to real Firebase. This test branch is **not** a deployment configuration or an authorization model. No cloud keys, service-account credentials, tokens or production paths are used.

## Genuine read-only client, synthetic local writer

The H25 disposable CI job builds a Next static export using only demo environment variables, runs the fixed R3 Rules emulator with project `demo-floodguard-r3`, and starts a loopback-only Python HTTP server for a real Chromium browser. The **test driver** uses a fixed localhost REST URL with the emulator-only privileged seed; its URL construction asserts project/namespace/path, and all test payloads are synthetic reserved data (including a sentinel private ESP IP/Wi-Fi value). Browser external HTTP and service-worker requests are blocked and any nonlocal WebSocket connection fails the test. No real Firebase, recipients, public gateway, physical controller or internet web application can be reached by this test.

The browser checks actual onValue SDK subscriptions against the Rules engine and verifies:

1. Coherent ONLINE/CONNECTED ESP reports render only as **REPORTED ONLINE · UNVERIFIED**, with a plausible reported RSSI. Private ESP IP/Wi-Fi sentinel never appears in DOM.
2. A live ESP connection contradiction removes ONLINE and cached RSSI; recovery only after both children agree.
3. Rain sensor-health change to OFFLINE hides previously reported 0.0 mm readings, rather than claiming NORMAL.
4. Gate status OPEN with angle 0 cannot remain confidently CLOSED; a stale source timestamp suppresses current physical-state claims.
5. An active alarm is explicitly an **unverified report**, and an old timestamp reclassifies the banner as a historical status, never a verified siren/notification.

The H24 Node 22/24 source tests, non-deploy builds, offline Chromium, R3 emulator Rules job and H25 static guards all remain CI requirements. The new SDK browser job and actual tests must pass at the final exact PR SHA before marking H25 verified. **No test is to be deleted or reclassified just to obtain green CI.**

## Outstanding security/acceptance boundaries

All data in this lab is **synthetic and unsigned**. A successful Firebase SDK observer does not establish physical sensor authenticity, calibration, real controller gate travel, cryptographic device identity, real production Rules/IAM parity, field TLS, mobile device acceptance, real recipient/WhatsApp delivery, evacuation authority, or operational human override. The six old Phase A anonymous-write tests remain a deliberately isolated historical compatibility suite; they are not R3 production acceptance.

Do not merge, deploy, change live Firebase rules, share secrets, send public alerts, or actuate hardware. Production status remains **NO-GO**.
