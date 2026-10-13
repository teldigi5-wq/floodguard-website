# FloodGuard · Firebase access and field writer security

> [!WARNING]
> **Production permissions finding (13 October 2026):** Anonymous reads to the deployed RTDB `esp8266/ip` and `esp8266/wifi` child paths returned nonempty values. We deliberately do not copy those values into this repository. This indicates a **live rules configuration issue**, independently of the safer repository template. A read of the `esp8266` parent was also publicly accessible. **Remediation is still pending.**

### Recommended remediation, preserving hardware writes

1. Inspect the **effective rules** in Firebase Console → Realtime Database → Rules. Specifically check any `.read: true` on `floodguard`, `live`, or `esp8266`. **In Realtime Database, ancestor read grants cascade: a child `.read: false` cannot override an ancestor's `.read: true`.**
2. Remove overly broad public read grants at ancestors; allow unauthenticated reads only to the individual safe monitoring child paths actually needed by the website.
3. Before changing write permissions, establish whether the ESP8266 publishes anonymously or uses a scoped authenticated writer. Do not apply the repository template if that will interrupt hardware telemetry.
4. Test as an unauthenticated visitor that private ESP IP/Wi-Fi nodes return **Permission denied**, safe monitoring children remain readable, and actual authenticated device uploads still succeed.
5. Check whether sensitive tokens/passwords were stored elsewhere. Rotate exposed **credentials** if any are found; IP and Wi-Fi names alone are not necessarily credentials.

This repository and GitHub Actions **cannot update your live Firebase RTDB rules** without Firebase administrator access.


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
