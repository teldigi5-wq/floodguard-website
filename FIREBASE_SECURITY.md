# FloodGuard · Firebase access and field writer security

The current Next.js website is a **read-only monitoring client**. It listens only to these public child paths under `floodguard/live`:

- `water`, `rain`, `gate`, `alarm`, `devices`, `system`
- `esp8266/connection`, `esp8266/rssi`, `esp8266/status`

The website does **not** subscribe to private network fields such as `esp8266/ip` or `esp8266/wifi`.

## What has and has not been verified

- The repository's [firebase.rules.json](./firebase.rules.json) denies all writes and permits only selected reads. **It is a reference template, not a rule deployment.**
- The website reads a configured Firebase URL from a public `NEXT_PUBLIC_` variable and validates incoming client telemetry.
- The actual cloud-side RTDB rules, hardware writer credentials, and all historical changes to Firebase permissions still require an independent audit.
- A public Firebase database URL is not a password. **RTDB rules are the security boundary.**

## Before changing production Firebase rules

1. In Firebase Console, inspect the **currently effective** rules and verify which firmware or service writes into `/floodguard/live`.
2. Confirm a dedicated, least-privilege hardware writer identity, or design one before tightening write rules.
3. In Rules Playground / Emulator, test unauthenticated reads of monitoring children, denied reads of private ESP fields, denied anonymous writes, and authorized device uploads.
4. Use a reviewed deployment-specific rules file that **explicitly permits the authenticated hardware writer**. The repository template deliberately contains no write allowance; applying it unchanged would block **every** writer, including authenticated firmware.
5. Change production rules only after testing a rollback plan and verifying the live prototype still uploads.

Never use publicly visible browser-side Firebase configuration to authorize gate commands or to store secrets. Keep Arduino as the physical control authority.
