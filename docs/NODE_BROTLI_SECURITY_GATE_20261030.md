# FloodGuard Website — Node.js Brotli remediation declaration (2026-10-30)

Status: **draft review candidate; not yet promoted to production**.

## Why Node 24 specifically

Vercel currently configures this project for Node.js 24.x. On 29 October 2026, Vercel released Node.js 26 LTS and documented that broad `engines.node` ranges permitting 26 can trigger an automatic major upgrade. An early version of this draft with a combined 22/24/26 range **did** produce a Vercel preview warning that 26.x would be selected, overriding project settings. This was corrected before release.

- Package manifest and lockfile now require **`^24.22.1`**, a patched Node.js 24 range, deliberately excluding 22 and 26 from website deployment.
- `.nvmrc` and the protected-main CI matrix use **24.22.1** for consistent developer and build baselines.
- The existing `.npmrc` site-specific settings are preserved and `engine-strict=true` is added.
- A standalone `scripts/check-node-runtime.mjs` rejects an unpatched Node 24 build or unexpected major; both `build` and `build:amplify` run the gate.
- Vercel rolls out Node 24 patch updates automatically; selecting `^24.22.1` and the build guard must still be validated against actual Vercel preview logs.

## Production and host verification

The currently listed Vercel production deployment is on protected `main`, commit `42e8d9ab28a75057486cf2a0238e822b05ec036f`, not on this candidate. The Vercel project reports Node.js `24.x`, **not an exact patch version**. No production runtime patch level or physical sensor readiness is thereby established.

1. Inspect exact-head PR CI, CodeQL, and Vercel preview build log; confirm no unexpected 26.x fallback and a passing patch guard.
2. Verify the selected production build **and any serverless/SSR function** run a supported patched Node.js runtime. A build on patched Node.js alone does not establish the function runtime.
3. Review preview UI independently; do not confuse preview READY with operational acceptance.
4. Require explicit protected-main release approval and rollback plan before promotion.

No deployed Firebase rules, firmware, WhatsApp accounts, production aliases, or physical gate was modified. Final flood-monitoring release remains NO-GO.

References:
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://vercel.com/changelog/node-js-26-lts-is-now-generally-available-on-vercel
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
