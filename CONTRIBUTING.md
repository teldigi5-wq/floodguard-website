# Contributing to FloodGuard

FloodGuard is an educational engineering prototype. Public repository visibility does **not** grant an open-source license, so contact the maintainer about reuse or redistribution.

## Working agreement

- Use a descriptive feature branch; avoid direct experimental changes to `main`.
- Install dependencies using `npm ci` with Node.js **22.13+**. Copy `.env.example` to `.env.local` with your own valid public Firebase RTDB settings.
- Before proposing changes, run:
  ```bash
  npm run test
  npm run lint
  npm run typecheck
  npm run build
  ```
- Include meaningful tests for new safety, timestamp, and schema behavior. Changes that produce synthetic live sensor readings, present stale hardware as connected, or permit browser-driven gate control are not acceptable.
- Never commit firmware credentials, database exports, private network details, or access tokens.
- Document architectural changes and tradeoffs in `docs/architecture/`.

## Pull request checklist

- [ ] Change is scoped, described, and reproducible
- [ ] No sensor, gate, or safety status is fabricated
- [ ] Tests and build checks pass
- [ ] UI states include absent, stale and disconnected paths
- [ ] Firebase rules or hardware authorization were **not** changed silently
- [ ] Public documentation and security boundaries remain accurate

For sensitive vulnerability reports, use [SECURITY.md](./SECURITY.md), not a public issue.
