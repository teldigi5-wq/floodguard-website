# Recovered source — GitHub preparation notes

- This archive is **source code**. It is not the directly uploadable Amplify deployment bundle.
- Recovered from the August 25, 2026 `FloodGuard_Web_Source_PRESENTATION_FINAL_v7.zip` package.
- The original `.openai/hosting.json` (ChatGPT workspace-specific metadata) and `tsconfig.tsbuildinfo` (generated build cache) were intentionally excluded.
- The original template README has been replaced with a FloodGuard-specific README.
- `.env.example` is tracked; `.env.local` and secret-bearing `.env` files must remain untracked.
- The original site uses Firebase RTDB data at `/floodguard/live`; public Firebase endpoints are not access control.
- Package dependencies and AWS Amplify build have **not** been installed or executed as part of recovery.
- Do not put hardware passwords, private Firebase service-account credentials, AWS access keys or private keys into GitHub.
