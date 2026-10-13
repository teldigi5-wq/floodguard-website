# FloodGuard Stage 39 — Loader Recovery + Live Gate Rescue

- Removed blocking route-level loading screen.
- FloodProvider now subscribes once to `/floodguard/live` instead of waiting on optional child nodes.
- Initial UI releases after first snapshot or a 3-second guard.
- Gate state reconciliation remains angle/countdown authoritative.
- Service-worker cache is purged so old route-loading code cannot survive a deployment.
- Amplify artifact includes an independent live gate rescue view for legacy static-build failures.
