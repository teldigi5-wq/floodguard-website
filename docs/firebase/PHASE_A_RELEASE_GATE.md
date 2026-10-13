# Phase A — read privacy containment (review candidate, NOT DEPLOYED)

**State: Draft for review and Firebase Emulator tests only.**

The owner's effective rules as pasted on 13 October 2026 permit unrestricted reads and writes at `/floodguard/live`. Saved ESP8266 firmware uses unauthenticated Firebase REST PATCH/PUT uploads and unverified TLS certificates.

This candidate deliberately keeps `/floodguard/live/.write: true` temporarily to avoid interrupting those uploads. **It is NOT a solution to anonymous write tampering.** The ruleset is an explicit *transition* policy, never the final hardened rule set. DO NOT deploy it without a supervised maintenance decision and successful client tests.

## What changes relative to live production rules

- Remove broad `.read: true` at `/floodguard/live`. Explicit public reads are granted only to `water`, `rain`, `gate`, `alarm`, `devices`, `system`, and the individual `esp8266/{connection,rssi,status}` children.
- Explicitly deny parent reads of `/floodguard/live` and `/floodguard/live/esp8266`, and private `esp8266/ip`, `esp8266/wifi` reads. Ancestor grants must remain restrictive.
- Preserve the owner's present value validation rules for water, gate, and rain, plus the explicit `/floodguard/bot` and `/floodguard/test` denials.
- **Do not** authorize public writes outside `/floodguard/live`; existing **live** writes stay open until device authentication migration.

## Prerequisites to production consideration

1. Deploy and verify the WhatsApp bot's separate read migration **after owner approval** and supervised EC2 restart, not simply after a PR's unit tests. Draft PR: https://github.com/teldigi5-wq/floodguard-whatsapp-bot/pull/12
2. Test the Flutter debug APK in Firebase Live mode and demo mode with real RTDB connectivity and validate that all screens remain usable after read restriction.
3. Confirm web dashboard and bot never depend on `/floodguard/live` parent reads (the bot production version still does until migrated).
4. Run Firebase Emulator tests for anonymous safe-child reads, private reads, temporary writer behavior, range validation, and denial of bot data writes.
5. Backup existing effective Firebase Rules JSON, plan a rollback, and have a maintenance window plus monitoring in place.
6. Verify post-deploy browser/mobile/bot reads; **do not touch write permissions until authenticated, certificate-verified ESP8266 uploads are proven.**

## Tested files

- `docs/firebase/phase-a-privacy-candidate.rules.json` — candidate, never active automatically.
- `firebase.phase-a.json` — Firebase emulator config that loads *only* this candidate.
- `tests/phase-a-policy.test.mjs` — static policy and validation-preservation assertions.
- `tests/phase-a-rtdb-emulator.test.mjs` — emulator-backed REST authorization assertions; no live URLs and no production credentials.

**Never mistake passing tests of this candidate for a claim about the current production database.** Production is still exposed until the *effective deployed rules* are deliberately changed.
