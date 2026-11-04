# FloodGuard R3 H26 — Preserve device inventory veto against contradictory online states

4 November 2026 · **REVIEW-ONLY DRAFT · NO MERGE · NO DEPLOY · PRODUCTION NO-GO**

Exact verified H25 parent: `600abcf87f91d72c0eb7b33d92b942db453007ab` (website PR #117). Android H12i PR #19 and WhatsApp H14 PR #72 remain **unchanged**.

## Verified H25 code gap

`lib/public-health-observation.mjs` explicitly supports an optional `devices.esp8266` witness. If that inventory contradicts the `esp8266/status` and `esp8266/connection` children, the public ESP observation must be UNKNOWN with no RSSI. But `providers/flood-provider.tsx`'s Zod `devicesSchema` omitted `esp8266`, silently stripping this optional field before the conservative policy saw it. When a device inventory contained `esp8266:{installed:false,status:'ONLINE'}`, the provider normalized the record by taking the old `status` first. Likewise `rainGauge:{installed:false,status:'ONLINE'}` was normalized to ONLINE, allowing a disconnected/removed sensor to retain an unsigned NORMAL category and 0.0 mm.

This is **presentation integrity**, not proof of physical installation. We prevent optimistic UI labels from contradictory *unsigned* source fields. We never turn inventory into authenticated hardware identity.

## Minimal correction

- Extend only the website's existing public `devicesSchema` to preserve the optional `esp8266` witness (same bounded `deviceValue` schema as other inventory keys).
- Give explicit `installed:false` priority over `status/state/online`. Return `NOT_INSTALLED` rather than misreporting ONLINE; `installed:true` alone does *not* imply connectivity, it normalizes to UNKNOWN without an independent status.
- Preserve H21 public view's existing fail-closed semantics. The ESP report is UNKNOWN and RSSI withheld when its inventory says NOT_INSTALLED/UNKNOWN, even if public ESP children both say ONLINE. Rain records with a faulted/not-installed gauge withhold numerics and reported NORMAL.
- No permission grants, production Firebase URL, service account, device key, network-side write, alert, gate command or actual hardware behavior added.

## Real SDK acceptance

The existing H25 disposable demo-only emulator+Chromium job is reused and gains **two** live-update tests:
1. `devices.esp8266:{installed:false,status:'ONLINE'}` vetoes ESP ONLINE and cached -62 dBm; `installed:true` alone cannot promote it; an explicit `status:ONLINE` after reinstallation restores a reported unverified ONLINE; a subsequent `installed:false` again revokes it.
2. `devices.rainGauge:{installed:false,status:'ONLINE'}` withholds synthetic 0.0 mm and NORMAL; `installed:true` alone cannot clear a fault; explicit later ONLINE allows unsigned readings; a subsequent `installed:false` again withholds them.

`tests/r3-h26-inventory-install-veto.test.mjs` includes pure policy and concrete source/CI wiring guards. The H26 workflow inherits the full H25 job matrix: Node 22/24 source tests + TS/lint/static build, offline Chromium, real 7-case restrictive Rules emulator, and real Firebase SDK browser transitions (now 7 groups). The original six permissive Phase A cases remain intentionally separate/skipped; do not treat them as a release gate.

## Non-claims and release gates

A green local emulator and real browser pass would demonstrate **synthetic unsigned input handling only**. It would *not* certify effective production RTDB Rules/IAM, device provenance, actual sensor installation/calibration, hardware TLS, gate position, independent alarm delivery, native phone behavior, WebGL with authenticated inputs, or owner-approved release.

All default branches unchanged, no live Firebase project accessed. **Production / physical FloodGuard: NO-GO**.
