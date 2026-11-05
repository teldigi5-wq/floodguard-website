# FloodGuard H36 — Preview Firebase URL bundle scrubbing

**5 November 2026 · DRAFT, UNMERGED, NO PRODUCTION RELEASE · Physical safety NO-GO**

**Exact parent:** H35 PR #127, `9edc296b1be10af531ef7850497afd7c8a5e45fe`.

## Verified boundary and residual risk

Read-only Vercel metadata shows both `NEXT_PUBLIC_FIREBASE_DATABASE_URL` and `NEXT_PUBLIC_FIREBASE_LIVE_PATH` currently target **production** and **preview**. Their values were **not decrypted**, inspected or sent to CI. Vercel creates SSO-protected automatic previews for reviewed draft commits. H35's `database()` guard prevented Firebase connection in synthetic compiled preview tests, but source code still directly referenced `process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL`, a variable which Next.js may inline into client JavaScript. A public RTDB URL is not a credential, yet a preview should not unnecessarily disclose its configured production-looking endpoint, especially before effective published Rules and IAM have been independently attested.

## H36 minimal defense-in-depth

- `next.config.ts` sets only `FLOODGUARD_COMPILED_DATABASE_URL`, an immutable build-time client value: **empty** when `VERCEL_ENV=preview`; otherwise equal to existing `NEXT_PUBLIC_FIREBASE_DATABASE_URL` or empty. H35's preview block remains present.
- `lib/firebase.ts` reads this compiled value instead of directly reading `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. H35 denies preview initialization **before** URL use; fixed H25 demo emulator and normal nonpreview initialization remain.
- Source regression tests ensure compiler separation, preview URL scrubbing, original SDK behavior and no unaudited cloud operations.
- The new preview CI job compiles a *real Next static export* with `VERCEL_ENV=preview` and a synthetic valid-looking URL `https://demo-preview-forbidden-default-rtdb.firebasedatabase.app`. An offline file scanner fails if the synthetic hostname appears in any generated JS, HTML, JSON, CSS, text or sourcemap file. It checks both client JS and HTML are present; it does not log source contents.
- The **same** job then runs H35's four real Chromium preview tests after hydration, requiring unavailable status and zero outbound HTTP/WebSocket. A separate nonpreview build continues the eleven synthetic Firebase SDK+restrictive emulator browser checks. Node 22/24, restrictive Rules emulator and original Chromium gates remain unchanged.

## What this does not prove or change

This scrubbing applies **only** to new builds with correctly supplied `VERCEL_ENV=preview` and to this app's checked source references. It is not Firebase access control, does not revoke public links or old deployment artifacts, cannot stop another client from constructing a public Firebase URL, and does not prove the current SSO-protected Vercel preview actually ran this code. A URL is not a password; do **not** portray URL visibility alone as unauthorized data access. On non-Vercel hosts `VERCEL_ENV` may be unset; review their settings separately.

**Owner action (not performed):** In Vercel project environment settings, remove production Firebase URLs from Preview or replace them with a deliberately disposable test tenant as appropriate; separately examine old preview deployments and SSO, and approve Ignored Build Step rules if offline-only security branches should not produce deployments. Apply protection/review rules to unprotected website/Android main branches. Obtain independently authenticated current Firebase Rules/IAM, ESP source signing, field calibration, gate movement and real warning/fallback evidence before any production promotion.

This PR changes only review source/tests/docs/CI. No Vercel settings, production Firebase Rules/data, operator private file, credential, real messaging, physical hardware, protected branch or production deployment was modified.

**FLOODGUARD PRODUCTION AND PHYSICAL OPERATIONS: NO-GO.**
