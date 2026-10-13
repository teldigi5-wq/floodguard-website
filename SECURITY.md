# Security policy · FloodGuard

FloodGuard is a public-source **educational IoT monitoring prototype**. This site is not a certified flood warning, emergency response, or dam-control system.

## Reporting a vulnerability

Avoid posting exploitable details, credentials, private database contents, or network configuration in a public issue. Use [GitHub private vulnerability reporting](https://github.com/teldigi5-wq/floodguard-website/security/advisories/new) **if it is enabled**, or contact the maintainer through their [GitHub profile](https://github.com/teldigi5-wq) to arrange a private channel.

Include a concise impact statement, affected component/version, and safe reproduction steps. Please do not test against real physical gate hardware or change Firebase production rules without owner permission.

## Trust boundaries

- **Arduino firmware:** sole physical gate and alarm controller; the browser never sends actuator commands.
- **ESP8266 / writer identity:** publishes sensor reports. The authenticated writer configuration of the real hardware has **not been independently verified**.
- **Firebase RTDB:** security rules are the access boundary, not an obscured database URL. Client SDK access uses intentionally public configuration.
- **Public browser:** read-only presentation with allowlisted Firebase child paths, Zod validation and historical-state labels. IP/Wi-Fi network details are intentionally excluded from subscriptions.

## Minimum security requirements

1. Review historical repository commits for leaked credentials before considering a release security-complete. If any secret was exposed, **rotate it**; deleting it from a current file is insufficient.
2. Review the actual Firebase Console RTDB rules and test **unauthenticated writes are denied**, private child reads are denied, and authorized controller uploads still work. Do **not** blindly deploy the included template.
3. Use narrowly scoped credentials for device publishing; do not embed private keys or controller secrets in browser-visible environment variables.
4. Keep dependencies reviewed through Dependabot, CodeQL, and GitHub Actions.
5. Keep stale telemetry labelled historical even when the Firebase client is connected.

## Disclosure and scope

No public security guarantee is implied by the existence of test scripts or a passing deployment. The repository's [firebase.rules.json](./firebase.rules.json) is a **template**; it is not proof of the production database's effective policy. Read the [Firebase implementation notes](./FIREBASE_SECURITY.md).

This public repository has **no open-source license** at present. Visibility does not constitute permission to redistribute or incorporate its source.
