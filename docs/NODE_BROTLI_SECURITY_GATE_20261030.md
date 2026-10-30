# FloodGuard Website — Node.js Brotli remediation declaration (2026-10-30)

Status: draft-only repository configuration; **NOT a verified production runtime upgrade**.

- CVE-2026-111497 is a known exploited vulnerability in vulnerable Node.js Brotli decoder releases.
- The repository now requires fixed supported runtime lines (Node.js 22.23.4+, 24.22.1+, 26.12.1+) in the app manifest and lockfile, pins the development default to 22.23.4, and enforces npm engine checks.
- Protected-main CI is configured to execute on Node.js 22.23.4 rather than floating 22.x.
- The pre-existing npm site cache settings and other .npmrc options have been preserved.

## Deployment verification gate

1. Identify the actual website hosting/deployment runtime (build and serverless/SSR runtime separately), e.g. inspect Vercel's effective Node setting and deployment build logs.
2. Confirm exact Node.js versions and container digests if applicable. A build on patched Node.js does not prove production function runtimes were upgraded.
3. Run exact-head npm ci, offline tests, lint, typecheck and build; review preview output without touching production Firebase.
4. Require explicit release review and rollback before production promotion. Do not merge protected main on CI success alone.

This does not prove an exploitable Brotli path exists in the site; it removes declared permissive Node ranges and establishes reproducible checks. No real Firebase rules, firmware, bot sessions, gate controls or production releases changed.

Reference: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
