# Phase B authenticated-write proof of concept — NOT FOR DEPLOYMENT

STATUS: review-only experiment, never used by production or the active Phase A config.

This separate local-Emulator experiment models an operator-provisioned Firebase Authentication UID with enabled=true and scope=prototype-primary-telemetry in a nonpublic deviceAuthorization registry. All identities, addresses and readings are synthetic. It grants device-demo-a write permission on only six example telemetry leaves (three water fields, gate status/angle, and esp8266/status). It rejects anonymous, unapproved, revoked and wrong-scope identities, parent overwrites, private ESP metadata, deletions and malformed readings.

The scope is intentionally INCOMPLETE. Real firmware PUT/PATCH operations at the live parent would fail, by design. No attempt is made to authenticate the actual ESP8266, configure TLS or rotate secrets. Before designing full Phase B, privately identify the flashed firmware, all paths, authentication/certificate capabilities, and required status fields. Never put credentials or original firmware Wi-Fi configuration into public GitHub.

Use only the isolated firebase.phase-b.json emulator configuration and the firebase-phase-b-prototype.yml workflow. None of these files is deployed. Phase A remains separately reviewed and continues allowing anonymous device writes until a supervised migration.

Remaining design gates: direct leaf writes versus trusted ingestion proxy, ID-token renewal, certificate and hostname validation without setInsecure(), replay/freshness protection, malicious writers, bounded retry/offline behavior, unknown-field rejection, complete schema validation, and physical and EC2 tests.

Related private issue: https://github.com/teldigi5-wq/floodguard-mobile/issues/2
