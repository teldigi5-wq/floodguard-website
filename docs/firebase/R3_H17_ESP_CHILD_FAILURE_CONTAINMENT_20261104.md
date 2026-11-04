# FloodGuard R3 H17 — ESP8266 independent child failure containment

**4 November 2026 · DRAFT / NONPRODUCTION / NO-GO.** Stacked on verified website [PR #108](https://github.com/teldigi5-wq/floodguard-website/pull/108) at `3880bc7d78d4b09bb7dc609adb9bcaabe19b07f7`.

## Real source issue

The public website individually subscribes to `esp8266/connection`, `esp8266/status` and `esp8266/rssi` (never private `ip` or `wifi`). Previously, a malformed ESP child returned early without clearing cached data. A Firebase listener cancellation or authorization/network error only called `release()`, so a formerly valid `ONLINE` status could remain in the `esp8266` object indefinitely while independently subscribed water/system callbacks and timestamps advanced. Neither an old ONLINE nor an RTDB timestamp proves the ESP is currently connected.

## Corrective behavior

- `createEspChildObservationTracker` keeps a single in-memory observation epoch for the three explicitly public ESP child snapshots. It only emits a **reported** group after all three have each supplied an independently valid callback since the last failure.
- Malformed input or any failed/cancelled ESP callback clears all three cached values. Sibling updates cannot revive an old ONLINE until all children independently report again.
- The **actual** `FloodProvider` removes `esp8266` from its live state when the tracker is incomplete or has failed. Other independent sensor groups, warning reports, loading, and critical water/system failure containment are not modified. An optional RSSI value of `null` remains allowed but is never fabricated.
- No parent `esp8266` read is introduced: private `esp8266/ip` and `esp8266/wifi` remain unrequested. No new database writes, IAM policies, firmware commands, WhatsApp sends, secrets or production configuration.
- Offline tests cover order independence, partial startup, invalid RSSI, denied listener, retained ONLINE, sibling events, recovery only after all three valid callbacks, unknown/malformed keys and source wiring. CI exercises full npm tests, TypeScript, lint and Next production build on Node 22 and 24.

## Limitations / safety

This is **client display state containment only**. Even all three fresh public Firebase snapshots cannot authenticate the ESP8266 identity or prove physical connectivity: they may be forged, cached, stale, or delayed. Source timestamps are still unsigned. No live Firebase subscription, real-phone, physical sensor, actual gate, alarm, recipient delivery, independently signed H11 witness or owner release acceptance has been tested here.

**Never treat this CI as production approval or a reason to interrupt a working warning channel. Do not merge, deploy, publish Rules, send messages, change hardware, or expose credentials based on this draft. Production remains NO-GO.**
