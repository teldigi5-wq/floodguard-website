# FloodGuard H35 — Vercel preview Firebase client isolation

**5 November 2026 · DRAFT · UNMERGED · NO AUTOMATIC PRODUCTION PROMOTION · PHYSICAL RELEASE NO-GO**

Exact H34 parent PR #126 at `92c80da94b711042e01bf0d44f86960aad38346c`. Android H12i PR #19 and WhatsApp H14 PR #72 were inspected and not changed.

## Verified production/preview boundary gap

Read-only connected Vercel project metadata showed that `NEXT_PUBLIC_FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_LIVE_PATH` are each configured for **both** Vercel `production` and `preview` targets. Values are encrypted in Vercel and **were not decrypted or logged**. Separate READY Vercel preview deployments of intermediate offline security branch commits exist. Preview SSO protection is enabled. We did **not** establish that previews actually accessed the live RTDB, or that their public value matched the production URL; no live network test or production credential was used.

For a safety-adjacent website, a review preview should not initiate a public Firebase subscription at all, even when a URL is misconfigured or shared with production. SSO is not RTDB isolation and public Firebase client URLs are not a source of device or user identity.

## Minimal fail-closed code fix

- `next.config.ts`: derive only a Boolean string `FLOODGUARD_VERCEL_PREVIEW_BLOCK` from **Vercel build-time** `VERCEL_ENV === "preview"` through Next's static `env` inlining. No secret, URL, endpoint or tenant is added to this signal. Non-Vercel/manual builds and Vercel production retain prior code paths.
- `lib/firebase.ts`: check that flag **before** testing emulator configuration and before any `initializeApp`, `getDatabase`, `getApps` or `connectDatabaseEmulator` call. When true, throw a fixed unavailable-condition error. No cloud/emulator listener can start through `database()`. H25's fixed loopback-only emulator lab and normal production initialization remain intact in non-preview builds.
- `providers/flood-provider.tsx`: preserve catch/release/no-telemetry behavior and supply an explicit message stating that review previews do not provide a live flood status. No false clear/risk/gate assertions.

## Actual executable acceptance

- Five source/config tests check build signal, guard ordering, uninterrupted local emulator and production paths, and dedicated CI wiring.
- Four new real headless Chromium tests run a **static Next export built with `VERCEL_ENV=preview` and a synthetic valid-looking Firebase URL**, served only at `127.0.0.1:4173`. They inspect homepage, dashboard, devices and gate. After React hydration they require an unavailable status and **zero nonlocal browser HTTP requests, zero WebSockets and zero uncaught errors**; external requests are blocked and recorded. No real Firebase project or credential is used.
- The H35 workflow inherits the H28 source regression on Node 22/24, strict TypeScript, ESLint, non-deploy Next builds, original unavailable-source Chromium, seven actual restrictive candidate RTDB emulator Rules tests, and eleven live **synthetic** Firebase JS SDK + Chromium tests in a **separate nonpreview demo-only build**. The new preview Chromium job is added, not substituted.

## Limitations and required owner governance

This is a **client-bundle safety guard** when the Vercel build actually sets `VERCEL_ENV=preview`. It is not a Firebase Rules or tenant permission boundary; a malicious client can still try a public URL directly, and the database must enforce correct published Rules. It does not undo or revoke previously created Vercel preview deployments, change already generated bundles, isolate the environment variables in Vercel settings, disable Vercel auto builds, or prove preview SSO access on actual browsers. Operator should separately review Vercel preview env targets and restrict them to disposable/synthetic tenants if any connected previews are approved.

Do not merge or deploy on this evidence alone. Production effective RTDB Rules, IAM, device signatures, field calibration, independent warning fallback, physical gate safety and human release signoff remain unverified. `main` branch protections remain unresolved. No Firebase rules/reads/writes, messages, device operations, Vercel production promotions, or Vercel settings were changed by this draft.

**PHYSICAL FLOODGUARD / PRODUCTION: NO-GO.**
