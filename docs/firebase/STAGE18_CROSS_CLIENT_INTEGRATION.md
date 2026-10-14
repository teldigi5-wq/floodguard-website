# Stage 18 — Synthetic cross-client child-stream contract

**NO-GO. Offline/test-only. All three PRs remain draft and unmerged. Mobile stays PRIVATE.**

One *byte-identical* fixture `stage18-shared-child-stream.json` is checked into the three draft PR branches. It includes nine public RTDB child PUTs and eight cases: partial PATCH updates, field deletion, a narrow child PUT, a contradictory 0 cm water reading, invalid future clock, deleted clock, disconnected historical data and a 20-second freshness disagreement.

| Native consumer | This stage actually executes | Not verified |
| --- | --- | --- |
| Website PR #8 | Real website `lib/telemetry-health.mjs` parsing and source-level checks of the actual nine child-only Firebase subscriptions | Does not mount Firebase browser listeners or execute Next.js Zod normalizer with a live Emulator |
| Bot draft PR #12 | Native `src/firebase.js.applyEvent` for the exact common PUT/PATCH events, rejection of private branches, actual `src/floodguard.js.fieldTimeMs` | Does not run `streamLive`, live bot, a real Firebase connection or send WhatsApp messages |
| Private Flutter draft PR #1 | Native `PublicTelemetrySnapshot.apply`, native `parseFieldTimestamp`, and 30-second threshold against the same event fixture | Does not run an Android device, HTTP/SSE transport, private `_mapLiveTree` repository mapper, or a physical gate |

These are **cross-repository contract tests**, not a simultaneously running multi-client integration system. Exactly matching fixture Git **blob SHA** across all three branch heads is required to establish the inputs were identical; tests alone cannot guarantee cross-repo synchronization after a future change. Native transport reconstruction proves neither physical hardware authenticity nor correct overall risk.

**Known P0 discrepancies remain:** 0 cm air gap, conflicting gate status/angle, inconsistent risk derivation and unknown readings. Existing 10 s, 15 s and 30 s windows remain different. Production anonymous Firebase writes remain an unresolved vulnerability. The earlier candidate Phase A still allows anonymous whole-parent PUT/PATCH and is not production-ready.

Rollback is simply removal of isolated test/docs files from draft PR branches; no runtime code, server, firmware, subscriber or production rule migration is performed. Never use these checks to authorize merge, production Firebase publication, WhatsApp linking, deployment, or hardware operation. Owner sign-off, actual flashed firmware compatibility and security/field acceptance remain mandatory.
