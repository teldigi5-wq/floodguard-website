# FloodGuard R3 H19 — Homepage and 3D visual observation provenance

**4 November 2026 · DRAFT · UNMERGED · REVIEW ONLY · NO DEPLOY · PRODUCTION NO-GO.**

Exact parent: website H18 PR #110 at commit d3c49190c9368329a7937ee3d9e3212f3034373c.
H19 is limited to public presentation, homepage, animated ribbon, network preview and illustrative 3D model. No changes to production Firebase, device firmware, real gate commands, bot startup, or Android.

## Source defect

H18 hardened diagnostics and exports, but the actual homepage still passed raw data.gate.angle directly into a model without checking whether gate fields were contradictory or stale. Its hero panel displayed raw water, ESP and gate records as "Field system", ahead of the safety warning. TelemetryRibbon and NetworkScope showed raw water/gate states and the literal alarm CLEAR. A viewer could interpret these as current physical evidence despite unsigned telemetry.

The 3D model's prominent low-range water indicator also rendered bare SAFE with green styling, creating an inappropriate visual all-clear cue.

## Review-only correction

- A pure immutable helper, lib/public-monitor-view.mjs, reuses H15 gate and H16 water constraints and freshness-aware alarm logic. Physical flood safety is always UNKNOWN · UNVERIFIED; it grants no gate, alert or clearance authority.
- Homepage, ribbon and network preview now show qualified source reports. Stale, absent or contradictory gate, water, ESP and alarm information cannot remain current.
- Even timestamp-recent LOW/SAFE, CLOSED, OFF and ONLINE remain REPORTED · UNVERIFIED; potentially elevated hazards remain visible as investigation leads.
- Homepage passes qualified gate angle and water air gap to DamScene. Missing values stay null rather than falling back to historical Firebase values. A neutral 3D pose is illustrative, not a measured closed gate.
- DamScene's low water chip is neutral, LOW · UNVERIFIED rather than green SAFE. Warning and danger reports remain labeled as possible unverified hazards.
- The helper neither requests private Firebase ancestor paths nor exposes Wi-Fi details, credentials, arbitrary payloads, or service authority.

## Acceptance and explicit limitations

1. Exact-head H19 CI on Node.js 22/24: lockfile install without scripts, full offline tests, TypeScript, ESLint, non-deploy Next build.
2. Native synthetic/source tests cover missing, stale, contradictory and elevated reports, plus actual homepage/ribbon/3D source wiring.
3. Review the exact final SHA and CI logs; inherited skipped emulator tests are not passed tests.
4. Browser, mobile landscape, reduced-motion, 3D fallback and physical phone testing remain to be performed.
5. No change or proof of published Firebase Rules/IAM, field TLS, signer/witness custody, calibrations, hardware safety, real WhatsApp delivery or release owner approval.

**DO NOT MERGE OR DEPLOY. Physical and production release: NO-GO.**
