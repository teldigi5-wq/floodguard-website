# FloodGuard R3 H20 — Withhold unsupported 3D gate pose and honor reduced-motion access

4 November 2026. **DRAFT · UNMERGED · NO DEPLOY · PHYSICAL / PRODUCTION NO-GO**.

Stacked on website H19 PR #111, exact head `6bf9164a4149de8e954dae84085fbac41fd6d71d`.

## Identified code-level defects

1. H19 qualified the gate angle, but `DamScene` still converted null to zero degrees when rendering geometry. A visual 0° gate and zero modeled discharge can look physically CLOSED to a viewer, even when the controller position is UNKNOWN.
2. The same component read raw `useLive()` Firebase water distance if its `waterDistance` prop was omitted. A future caller could bypass the H19 source-qualification helper.
3. The previous reduced-motion branch invoked `setAnimate(true)`, causing continuously rendered animation on devices requesting reduced motion. No non-WebGL text fallback was supplied.
4. The model's hydraulic section and water-level meter retained a literal SAFE/green appearance despite H19's neutral main water chip.

## Isolated H20 correction

- A pure immutable `describeSceneAvailability` helper admits the illustrative WebGL scene only when both the **already H19-qualified** gate angle and water gap are present, finite, plausible and integral where appropriate, and the user has not requested reduced motion.
- A missing/invalid input suppresses **the Canvas itself**, not just the text overlay. Its static replacement states gate position UNKNOWN, explicitly prevents a visual all-clear and preserves the known unverified report values without creating a simulated pose.
- `DamScene` no longer imports `useLive` or silently fetches raw Firebase water data. Both inputs default to null, not a usable closed-state coordinate.
- The reduced-motion preference is checked at initialization, and changes are watched. The same static text alternative replaces all active 3D animation, tour, flow and orbit controls under reduced motion.
- A WebGL-unavailable fallback is declared for supported React Three Fiber implementations. This is not a substitute for real-browser inspection.
- The 3D hydraulic section and level meter no longer expose an unqualified green SAFE display.
- Responsive static-view CSS supplies keyboard- and screen-reader-readable observation fields. This is source display only; no commands.

## Synthetic verification and limitations

- New Node standard-library tests assert boundary cases: missing, stale/null, malformed, contradictory-derived null, out-of-range, reduced motion, no raw Firebase fallback, and actual UI source structure.
- CI on Node 22/24 must run all inherited offline tests, the new tests, strict TypeScript, ESLint and non-deploy Next build. Check exact final SHA and job logs; skipped Firebase emulator tests must not be counted as passing.
- Browser/Android/desktop touch, keyboard, screen-reader, fallback-on-actual-no-WebGL, actual reduced-motion rendering, performance and physical firmware acceptance are NOT verified by source tests or a Next build.
- Source timestamps remain unsigned; a coherent database report does NOT independently verify a gate position, sensor calibration, hardware safety, an authenticated ESP8266 or current field conditions.
- No Firebase Rules/IAM, physical hardware, firmware, recipient messaging, production deployment, other repos, protected branches or existing PR stacks have been changed.

**No merge, deploy, real-world safety claims or warning-channel changes authorized. Production remains NO-GO.**
