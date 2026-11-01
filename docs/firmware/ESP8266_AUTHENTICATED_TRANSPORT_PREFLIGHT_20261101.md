# FloodGuard — ESP8266 authenticated transport migration preflight (2026-11-01)

**Scope: REVIEW-ONLY signed device transport contract + genuine LOCALHOST HTTPS tests. Not ESP8266 firmware. Not a live web endpoint, cloud publisher, production Firebase rule change, field warning, notification or gate actuation. NO-GO.**

## Verified predecessor and missing source

This draft stacks on [PR #49](https://github.com/teldigi5-wq/floodguard-website/pull/49), exact verified head `018343e8c63699389abbc3c41af098c08668194d`. Its V4 isolated RTDB Emulator capsule verifies pinned synthetic Ed25519 device identity and operator-disabled source inside the test publication transaction. PR #41 provided a **separate real loopback TLS** ingress and fsynced local signed outbox, not a public device endpoint.

The repository trees reviewed for `teldigi5-wq/floodguard-website`, `teldigi5-wq/floodguard-mobile`, and `teldigi5-wq/floodguard-whatsapp-bot` contain **no checked-in Arduino `.ino` sketch or ESP8266 firmware build project**. Archived v6 firmware has been described as using `WiFiClientSecure.setInsecure()` and anonymous RTDB `PATCH /floodguard/live`; this stage does NOT claim a fresh source-code audit of that unmounted archival firmware. Do not fabricate firmware modifications, toolchain compilation or real hardware results. Actual v6 source, board/Arduino core version, flash/RAM constraints and wiring need to be supplied/verified before modifying or flashing a device.

## Real device-to-ingress contract for a later firmware port

`experiments/esp8266-transport-migration-preflight.mjs` sends an **externally pre-signed** canonical Stage 7 frame via Node.js `https.request` to the existing test-only `/synthetic/v1/ingest` endpoint on `127.0.0.1`, checking the `localhost` certificate SAN with an explicitly trusted CA. It does NOT implement embedded-device signing, a production gateway, a public listener, Firebase SDK, token issuance, cloud receipt verification, sensor read, servo control, or an automatic/background retry loop.

The authenticated envelope remains:

```json
{
  "envelope": {
    "version": "floodguard-offline-envelope-v1",
    "deviceId": "device-stage-a",
    "epoch": 1,
    "observedAtMs": 1793450000000,
    "frame": {
      "sequence": 1,
      "distanceCm": 16.5,
      "levelCm": 8.5,
      "risk": "WARNING"
    }
  },
  "signature": "<86-character base64url Ed25519 signature over canonical envelope>"
}
```

This example is a **shape** only; a placeholder signature is never accepted. The gateway fixes canonical field order, validates exact fields, ≤1024-byte request body, a ≤30-second past/2-second future event clock window, 25-cm installation depth and reported level/risk consistency; it stores an accepted signed frame in the sealed local journal before returning **201 `LOCAL_DURABLE_ADMISSION_ONLY`**.

For a later real ESP8266 port, the team must independently determine whether that MCU and chosen open-source crypto implementation can generate Ed25519 securely with adequate entropy, key protection and flash/RAM, or select a reviewed alternative *with corresponding backend and contract changes*. No code here pretends BearSSL provides an Ed25519 signing API for the board.

## Response semantics and fail-safe behavior

| Network result | Local client interpretation | Mandatory follow-up |
|---|---|---|
| Valid CA + hostname, HTTP 201, exact `LOCAL_DURABLE_ADMISSION_ONLY` | **Locally buffered only** | Retain device-side sequence identity and do not report cloud or human delivery |
| HTTP 409 replay or identity conflict | **Conflict, not a cloud ACK** | Retain original record; independently reconcile under operator-approved policy, no blind sequence reset |
| HTTP 503 or connection reset/timeout | **Unknown / retry uncertain** | Retain *identical* signed event and sequence; do not sign a different event to force acceptance |
| HTTP 403 revoked or signature-invalid, HTTP 422 stale/invalid | **Denied** | Do not upload via anonymous Firebase; operator inspection and safe local warning required |
| Unknown/forged HTTP 201 text | **Unverified response** | Never treat as local admission, cloud confirmation or success |
| Untrusted/expired/wrong-host certificate | **TLS failure** | Stop upload; never disable peer validation to recover |

The Node test must use genuine ephemeral HTTPS sockets and separately generated trusted/untrusted certificates. Positive, duplicate, lost-response-after-fsync, fake cloud 201, TLS CA/SAN mismatch, stale timestamp, revoked/forged source, unavailable journal, input validation and absence of production hooks are covered. No user credentials or real private signing keys are committed. **Only exact-head GitHub Actions green makes this an accepted *local transport* checkpoint.**

## Release blockers

1. Obtain and inspect the genuine archived ESP8266/UNO sketch. Build a version-pinned board/Arduino core toolchain and deterministic firmware tests. Supervise battery/power interruptions and warning/gate behaviors.
2. Provision a unique device secret/key *off-repo*, store appropriate trust anchors, validate the public gateway hostname and certificate chain (rotation/revocation, time synchronization, CA validity, memory consumption). Do not ship `setInsecure` or an anonymous Firebase fallback.
3. Build an authenticated, rate-limited **public** ingress with audited device authorization, durable replay/epoch fencing and no unsafe open enrollment. The present ingress deliberately rejects non-loopback sockets.
4. Independently govern Firebase publisher and signed cloud receipt/witness issuance, per-reading recovery, legitimate alert-delivery evidence and crash-safe outbox retirement. A local HTTP 201 is not cloud durable and no 409 alone authorizes deletion.
5. Restore website/Flutter/WhatsApp only in separately reviewed preview and show stale/denied/offline warnings. Test physical HC-SR04 invalid echo, buzzer, servo, manual override, OTA/rollback and safe behavior during loss of network and power under supervision.
6. Protect `main` and enforce checks/reviews before any future merge. Current verified `main` is unprotected, and all staged PRs remain draft/unmerged.

**Do not flash, activate hardware, weaken TLS, change live Firebase rules, deploy or merge. Production NO-GO.**
