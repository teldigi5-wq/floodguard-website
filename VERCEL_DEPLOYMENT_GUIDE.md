# FloodGuard — Vercel production checklist

## Important: recovered source, not a certified live deployment
The original source was found in the owner's ChatGPT project archive; it has not been redeployed from this cleaned tree yet. The unrelated archived Cloudflare starter scaffolding was removed; the current build uses `next build` for Vercel.

## Steps
1. Create a GitHub repository named `floodguard-website` under `teldigi5-wq` (public only after checking private data).
2. Unzip this source archive, then commit the CONTENTS of its folder, not the ZIP itself, to `main`.
3. Verify GitHub Actions passes test, lint, typecheck, and build.
4. In Vercel, **Add New -> Project -> Import Git Repository** `teldigi5-wq/floodguard-website`.
5. Configure **Framework Preset: Next.js**, **Root Directory: .**, **Install Command: npm ci**, **Build Command: npm run build**, **Output Directory: out** (only if Vercel does not auto-detect Next.js static export), **Node.js: 22.x**.
6. Add environment variables for Production, Preview and Development: `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (your public Firebase RTDB URL), `NEXT_PUBLIC_FIREBASE_LIVE_PATH=floodguard/live`, and optional `NEXT_PUBLIC_SITE_URL` (actual Vercel production URL). Do NOT add private Firebase service account keys to `NEXT_PUBLIC_` variables.
7. In Firebase console, review currently deployed RTDB rules BEFORE enabling a public website. The recovered original rule allowed anyone to write to `/floodguard/live`; this is unsafe. `firebase.rules.json` in this source is now a conservative, read-only template. Do not apply it blindly: it will stop unauthenticated ESP uploads. Authenticate the ESP writer with a trusted scoped credential before changing live rules.
8. Verify all ten routes; exercise mobile/tablet navigation, reduced-motion mode, 3D scene fallback, actual firebase listener, refresh of deep links, and safe offline/no-data states.
9. Check production Vercel logs and browser console; only then mark deploy complete.

## Security and prototype limitations
- This dashboard is a monitoring prototype, NOT a certified warning system or remote gate-control tool.
- Water, gate, rainfall readings reflect only successfully received live telemetry. The visual model uses illustrative geometry based on that telemetry; it is not a physical hydraulic simulation.
- Never publish firmware Wi-Fi credentials, `.pem` keys, tokens, private telemetry paths, exported RTDB snapshots containing personal information, or AWS account credentials.
- Firebase public database URLs are not credentials, and Firebase rules are essential even when your website has no server.
- Do not authorize *all* signed-in users to write monitoring data; use a dedicated device identity with least-privilege writes.
