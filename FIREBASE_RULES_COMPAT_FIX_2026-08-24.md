# FloodGuard Firebase Rules / Web Compatibility Fix

The website reads only data under `floodguard/live` (plus Firebase's special `.info/connected` connection metadata). It does not read `floodguard/bot` or `floodguard/test`.

Compatibility fixes included:
- `REMOVED` device states are normalized to `NOT_INSTALLED`.
- legacy `OPENING_WARNING` is reconciled from gate angle/countdown.
- `angle <= 2` with no countdown displays `CLOSED`.
- `countdownSeconds > 0` displays `COUNTDOWN`.
- `angle >= 80` displays `OPEN`.
- malformed live values do not crash the site.
- Rain values should be treated unavailable when the gauge is not installed.
