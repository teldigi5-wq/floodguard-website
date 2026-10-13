# FloodGuard live-state/cache fix

- Gate display is reconciled from countdown and physical servo angle.
- 0-2 degrees + zero countdown = CLOSED.
- Positive countdown = COUNTDOWN.
- 80-180 degrees + zero countdown = OPEN.
- Legacy OPENING_WARNING cannot override a physically closed gate.
- REMOVED device values normalize to NOT_INSTALLED.
- UNKNOWN/NOT_INSTALLED rainfall does not display zero as measured rainfall.
- Legacy service-worker caches are cleared/unregistered to prevent old JavaScript chunks from mixing with new deployment files.
