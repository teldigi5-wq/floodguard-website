# FloodGuard · Verified Vercel deployment

**Public website:** https://floodguard-website-teldigi5-wq.vercel.app/

**Source repository:** https://github.com/teldigi5-wq/floodguard-website

The recovered FloodGuard website has been imported into Vercel and connected to the GitHub `main` branch. Production deployments trigger automatically on pushes to that branch. The original AWS Amplify deployment remains separate.

## Reproduce the deployment

1. Clone the repository and run `npm ci`, `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
2. Import the project into Vercel with **Next.js** and the repository root as the build directory. Its `next.config.ts` uses `output: "export"`, so it is statically hosted.
3. Configure `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, `NEXT_PUBLIC_FIREBASE_LIVE_PATH=floodguard/live` and `NEXT_PUBLIC_SITE_URL` under Vercel Project Settings → Environment Variables.
4. Trigger a deployment, wait for **READY**, confirm routing, and verify the browser-side Firebase connection and historical field timestamp.
5. Inspect production as a public visitor, including `/dashboard/`, `/gate/`, `/rainfall/`, `/devices/`, and `/diagnostics/`.

These `NEXT_PUBLIC_` values are client-visible. Do not insert Firebase service account keys, device credentials, secrets or private Wi-Fi details.

## Operator acceptance checks

- All **11** current website routes are present and render.
- On a powered-off field controller, the last reported numbers remain visible with **LAST RECORDED** instead of claiming live hardware.
- Device status, countdown and discharge visuals must never imply active operation based solely on historical reports.
- RTDB child reads succeed under intended permissions; private ESP network children are restricted.
- A GitHub Actions build passing is necessary but **does not** prove hardware operation or active Firebase write authorization.

## Limitations

The existing prototype telemetry data is stored as a current snapshot, not as an immutable historical time series. Playwright cross-browser testing, Firebase Emulator security-rule tests, cloud-side rule verification, and actual hardware integration certification remain tracked work.

See [engineering roadmap](./docs/ENGINEERING_ROADMAP.md) and [security policy](./SECURITY.md).
