# Stage 13 — Authenticated Telemetry Design, Freshness and Rollout Gates

**14 October 2026 · NO-GO · review-only and offline · no field experiments.**

This stage extends [Stage 12](./STAGE12_OFFLINE_ACCEPTANCE.md) without editing any website/mobile/bot runtime, Firebase Rules, firmware, AWS/Windows live host, WhatsApp session, alert sender or private repo setting.

## What is actually verified

The test-only module `experiments/stage13-security-gap-review.mjs` compares proposed migration requirements and *synthetic claims*; it provisions **no identities** and performs **no cryptographic or TLS handshake**. The `tests/stage13-security-gap-review.test.mjs` suite checks that unsafe shortcuts remain blocked regardless of proposed evidence flags, and models fixed freshness boundaries without changing any threshold. The accompanying `STAGE13_DECISION_GATES.json` deliberately records every production approval as **false**. Existing Stage 5–10 tests are isolated simulation evidence, not deployable ingestion infrastructure.

Run `npm run audit:stage13` or `npm test`. The results can identify missing design gates, but **cannot convert assertions into proof or grant deployment authorization**.

## Route comparison — neither is approved

| Candidate | Identity/bootstrap requirement | Security and operations blockers |
| --- | --- | --- |
| Direct authenticated ESP8266 → Firebase RTDB | A provisioned device-scoped Firebase Auth identity, validated Firebase token lifecycle, secure credential storage and a review of the exact firmware API contract | Cannot safely preserve current anonymous parent `PUT/PATCH`; actual flashed sketch unknown, authenticated TLS/certificate trust unproven, reboot/replay sequence persistence and revocation unproven |
| ESP8266 → trusted local gateway → Firebase | Independent hardware/source authentication *to gateway*, secure TLS identity verification, approved host and durable minimal ingress schema | A gateway must never just relabel anonymous traffic as authenticated; Admin SDK bypasses Firebase client Rules, so authorization, size/rate controls, idempotency, secret handling, audit, outage/rollback and isolation must be secured independently |

A Windows-PC gateway might eventually avoid a recurring cloud host fee, but its availability, physical connectivity and operator administration need a separate cost/security review. No listening service or Windows task is created now. Previously working and already-flashed Arduino/ESP8266 wiring/firmware stays unchanged. The previously suspended AWS host is unavailable; **the bot remains `npm run start:demo` only**. No WhatsApp linking/pairing is approved.

### Device-auth protocol contract — requirements only

- **Identity:** issue a unique, reviewed device ID and scope; the owner, not untrusted firmware input, binds identity to specific allowed paths. Support disable, renewal and revocation independently of a field sensor reading.
- **TLS:** require genuine peer certificate chain and hostname validation on whichever endpoint the device actually calls; never accept `setInsecure()` as a secure migration.
- **Input boundaries:** versioned telemetry envelope with range-checked fields; keep `esp8266/ip`, `esp8266/wifi`, Wi-Fi keys, subscriber/contact and other sensitive fields out of public descendants.
- **Replay and reboot:** persistent sequence/epoch discipline that cannot reset unnoticed; source-time validity must not assume the current firmware has a synchronized clock.
- **Delivery:** separate signed/accepted, actually persisted in Firebase, and genuinely received alerts; synthetic signed receipts, outbox and fake provider acknowledgements are **not** field evidence.
- **Compatibility:** privately identify actually flashed upload path and behavior through owner-approved **read-only** observation when available; no firmware reflashing, reset or physical gate action to pass an offline unit test.

### Freshness-policy review — do not align thresholds by guess

| Client | Inspected default | At 20 s after the field timestamp |
| --- | --- | --- |
| Website | 10 s | Window is stale |
| Bot | 15 s | Window is stale |
| Mobile | 30 s | Window could still be within the configured threshold; actual UI requires separate validation |

Stage 13 tests boundaries at **10, 11, 15, 16, 20, 30 and 31 seconds**. Disconnected, missing and future-invalid clocks are treated as stale/unavailable in the synthetic model. This is a **policy comparison, not a replay of actual Flutter or bot rendering**. The thresholds remain unchanged in their respective repositories. Obtain the actual field publishing cadence, source clock error bounds, reconnection behavior, and owner review before choosing a unified policy. A reconnection must not retroactively update the source timestamp or imply working physical hardware.

## Supervised Phase A rollout (not authorized)

1. Authorized operator **privately** reads exact *currently effective* production Firebase Rules and inventories all descendants under public `water`, `rain`, `gate`, `alarm`, `devices`, `system` branches. These ancestor public-read grants expose all descendants.
2. Save authenticated, access-controlled backup of current rules, verification checksum and rollback plan. Do not include production data or credentials in a public PR.
3. Validate all nine child-only read targets from website, bot and Android app against an isolated Firebase Emulator target. Physical phone acceptance, offline/stale UI and accessibility still require independent review.
4. Confirm the Phase A candidate's **anonymous `/floodguard/live/.write:true` remains a production integrity risk**. Do not describe it as hardened or publish the candidate without separate explicit owner sign-off on that residual exposure, compatibility and rollback.
5. When hardware becomes available, perform supervised **read-only** identification of the flashed firmware/upload shape. Do not power, reflash, move a servo, reconnect WhatsApp or publish Firebase rules just to satisfy this review.
6. Propose a reviewed, securely authenticated future write path and an actual compatible migration plan. Phase B Emulator tests exercise an incomplete prototype that **rejects current legacy parent writes**.
7. Any future publication must be a separately approved, monitored maintenance change with a named operator, timing, monitoring, success/failure/rollback triggers and independent post-change mobile/web/bot acceptance. Keep draft PRs unmerged in the interim.
8. Re-check the mobile repository's historical archive/security issue before considering any visibility change; keep the repo **private**.

### Hard NO-GO

**No effective production Rules have been obtained in this stage, no live endpoints contacted, and no physical Android/ESP8266 test has occurred.** No live Firebase rule change, WhatsApp pairing, deploy, commit to bot/mobile, or hardware command is included. Operators must not use `syntheticChecklistFullyClaimed` or passing CI as authorization. Stage 13 decision outputs **NO_GO** unconditionally.
