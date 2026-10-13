# FloodGuard — Real-Time Flood Monitoring Website

A responsive monitoring dashboard for the **FloodGuard educational flood-monitoring prototype**. This repository contains the recovered **Next.js website source**, with Firebase Realtime Database integration and interactive water, rainfall, device, and gate-status views.

> **Safety:** FloodGuard is a student engineering prototype, **not** a certified flood-warning, dam-control, or life-safety system. Hardware firmware—not this website—controls the physical gate. Website readings depend on working sensors, connectivity, and valid Firebase permissions; do not treat unavailable values as safe readings.

## Website sections

| Route | Purpose |
| --- | --- |
| `/` | Home and system overview |
| `/dashboard/` | At-a-glance monitoring dashboard |
| `/water/` | Measured water status |
| `/rainfall/` | Rain gauge readings and status |
| `/gate/` | Observed gate state and countdown |
| `/devices/` | Device connectivity and diagnostics |
| `/system/` | Monitoring system details |
| `/safety/` | Safety information |
| `/impact/` | Project impact |
| `/about/` | Project information |

## Stack

- Next.js App Router, React, TypeScript
- CSS, Framer Motion, Three.js / React Three Fiber
- Firebase Realtime Database (client-side telemetry subscriptions)
- Lucide icons
- GitHub Actions: source tests, ESLint, TypeScript check, production build
- Vercel automatic deployments from `main`

## Get started

Use a supported Node.js version (22.13+ or the configured Vercel runtime).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set the following **public, build-time** variables in `.env.local` and **Vercel Project → Settings → Environment Variables**:

```env
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.region.firebasedatabase.app
NEXT_PUBLIC_FIREBASE_LIVE_PATH=floodguard/live
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Use **your own verified FloodGuard Firebase database URL**. These values are publicly embedded in frontend code by Next.js; **do not put secrets, private credentials, service account JSON, or personal access tokens in any `NEXT_PUBLIC_` variable**. Rebuild/redeploy after changing them.

## Validate

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs these checks on pushes and pull requests to `main`. Vercel deploys the static Next.js build automatically once connected.

## Firebase and hardware boundaries

- The website displays monitoring data from `/floodguard/live` and its authorized child telemetry paths; it is **read-only**.
- Firebase rules should deny anonymous writes. Apply any security rule changes in the Firebase console **only after reviewing the existing hardware writer permissions**. Example repository rules are not deployed automatically.
- The gate is controlled by Arduino/ESP firmware. The website displays the observed gate state, not a trusted independent actuator command.
- Missing, stale, or unavailable measurements must remain **unavailable**, not fabricated as zero or `SAFE`.
- Calibrations, thresholds, and warnings must be checked against the deployed hardware firmware before treating readings as representative.

## Deployment notes

The recovered website was previously distributed as an AWS Amplify-ready artifact. This repository contains editable source and a Vercel-compatible static export configuration. The original AWS Amplify deployment is separate and is not overwritten by Vercel.

**Maintainer:** [teldigi5-wq](https://github.com/teldigi5-wq)
