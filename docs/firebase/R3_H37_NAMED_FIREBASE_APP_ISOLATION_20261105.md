# FloodGuard H37 — Named Firebase App / RTDB Tenant Isolation

**5 November 2026 · DRAFT · UNMERGED · NO PRODUCTION PROMOTION · PHYSICAL RELEASE NO-GO**

Exact parent H36 PR #128: `3cb0c656140be45f550538779b5e4b4536ba3e38`.

## Source-backed bug / scope

`lib/firebase.ts` previously used `getDatabase(getApps()[0] ?? initializeApp({databaseURL}))` for **non-preview** monitoring. Firebase's modular SDK `getApps()` returns all registered client apps, without guaranteeing that the first one uses FloodGuard's configured RTDB. A second Firebase integration (or shared client initializer) could register a different default app first. The public monitor could then subscribe to an incorrect project's database even when `FLOODGUARD_COMPILED_DATABASE_URL` had been validated. No real production incident or unauthorized reading was observed, but the source-level behavior is not an acceptable trust boundary.

Firebase SDK docs: https://firebase.google.com/docs/reference/js/app and https://firebase.google.com/docs/reference/js/app.firebaseapp.

## Minimal correction

- `lib/firebase-app-policy.mjs` exports a pure, synchronous `getScopedPublicMonitorApp` selector. It uses a dedicated name, `floodguard-public-monitor`, unrelated to both the default app and the existing `floodguard-r3-h25-browser-lab` emulator app.
- Given a validated URL, if the named app does not exist, initialize **only** that name with `{databaseURL}`. If it exists, require **exact** database URL equality and no additional options/credentials; any mismatch fails closed with a fixed non-sensitive error. An unrelated default app is not reused.
- `lib/firebase.ts` now calls that selector before `getDatabase(app)`; H35 early preview denial, H36 compiled URL scrubbing, H25 fixed localhost demo emulator, and existing RTDB URL validation remain unchanged.
- Type declaration `lib/firebase-app-policy.d.mts` maintains TypeScript import safety.
- `tests/r3-h37-firebase-named-app-sdk.test.mjs` uses the **actual Firebase JavaScript SDK** to initialize benign and foreign mock apps, verify correct selection and exact reuse, reject mismatched app URL, reject extra options on a colliding named app, and deny malformed/non-HTTPS URLs. No database listener, network call, real tenant, Admin credentials or write.
- `tests/r3-h37-firebase-app-isolation.test.mjs` verifies the actual website uses this policy after preview and URL guards. Three inherited H25/H35/H36 source tests are updated to expect the stricter selector without relaxing their original negative guards.
- Dedicated `.github/workflows/r3-h37-firebase-app-isolation.yml` runs actual SDK registry tests on Node 22 and 24, the full inherited source suite, TypeScript, ESLint and nondeploy Next build, actual restrictive Rules emulator, nonpreview SDK+Chromium with the disposable demo tenant, original Chromium no-source checks, preview compiled-bundle scan and preview Chromium network denial.

## NO-GO and remaining owner controls

The browser monitor's data remains an **unsigned observation**, not trusted field telemetry or proof of a physically closed gate or safe water conditions. This change ensures client app selection does not silently switch to a different Firebase app; it cannot authenticate production Firebase Rules, IAM, device identity or firmware. It does not alter published Rules or eliminate exposure to malicious external clients. There is no new authentication authority, data write or gate operation.

Vercel preview and production still share Firebase environment variable target scope until an authorized owner changes the project configuration; H35/H36 only mitigate preview frontend behavior in new builds. Website and Android main still lack verified protection. The physical alarm, independent warning path and owner-approved release attestation remain blocked.

No production/preview settings mutation, private-file export, recipient contact, Firebase cloud operation, merge, production promotion or physical action was performed.

**FLOODGUARD PHYSICAL / PRODUCTION RELEASE: NO-GO.**
