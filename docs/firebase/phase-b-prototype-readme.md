# Phase B authenticated-write proof of concept — NOT FOR DEPLOYMENT

STATUS: review-only experiment, never used by production or the active Phase A config.

This separate local-Emulator experiment models an operator-provisioned Firebase Authentication UID with enabled=true and scope=prototype-primary-telemetry in a nonpublic deviceAuthorization registry. All identities, addresses and readings are synthetic. It grants device-demo-a write permission on only six example telemetry leaves (three water fields, gate status/angle, and esp8266/status). It rejects anonymous, unapproved, revoked and wrong-scope identities, parent overwrites, private ESP metadata, deletions and malformed readings.

The scope is intentionally INCOMPLETE. Real firmware PUT/PATCH operations at the live parent would fail, by design. No attempt is made to authenticate the actual ESP8266, configure TLS or rotate secrets. Before designing full Phase B, privately identify the flashed firmware, all paths, authentication/certificate capabilities, and required status fields. The owner reports the Arduino/ESP8266 were successfully flashed and worked correctly before becoming currently offline to us; preserve that functioning baseline. An exact flashed revision is not required to keep developing synthetic/offline tests. Do not ask for a reflash or treat old telemetry as a hardware failure. Never put credentials or original firmware Wi-Fi configuration into public GitHub.

Use only the isolated firebase.phase-b.json emulator configuration and the firebase-phase-b-prototype.yml workflow. None of these files is deployed. Phase A remains separately reviewed and continues allowing anonymous device writes until a supervised migration.

Remaining design gates: direct leaf writes versus trusted ingestion proxy, ID-token renewal, certificate and hostname validation without setInsecure(), replay/freshness protection, malicious writers, bounded retry/offline behavior, unknown-field rejection, complete schema validation, and physical and EC2 tests.

Related private issue: https://github.com/teldigi5-wq/floodguard-mobile/issues/2


## Stage 5 — isolated, versioned authenticated ingestion rehearsal

The **same nonproduction Phase B emulator-only rules** now include a private
`/floodguard/staging/ingestV1/{deviceUid}` lane, alongside the existing six
partial live-leaf demonstrations. This is **not** a new application endpoint and
is **not** used by the working firmware. The staging lane does not grant public
read access, edit live telemetry, or permit actuator commands.

A staging frame contains exactly four synthetic fields:
`sequence` (integer 1..2147483647), `distanceCm` (0..400),
`levelCm` (0..25), and `risk` (SAFE/WARNING/DANGER/SENSOR_ERROR).
The emulator accepts a write only when the signed-in UID exactly matches the
device path, a **trusted custom claim** `fg_ingest_v1: true` is present, and
the nonpublic `deviceAuthorization/{uid}` entry is `enabled: true` with
scope `prototype-ingest-v1`. It rejects stale or repeated sequence numbers
against the last stored frame, deletions, unknown fields, untrusted origins
within rules' visibility, cross-device writes and ancestor overwrites.

**Critical limitations:** A custom claim can only be trusted when provisioned
by an approved server-side identity authority; emulator-injected claims do not
prove real token issuance. The sequence is an in-database monotonic counter,
*not* a complete cryptographic replay defense, producer timestamp, guaranteed
message order, or resilience to device re-provisioning. The current
already-flashed ESP8266 uploads different anonymous parent PUT/PATCH shapes;
those uploads are incompatible with this lane. There is no device credential
rotation, revocation of already-issued tokens, certificate pinning, renewal,
bootstrap, ingestion bridge, or real hardware integration here. No service is
created or deployed and no secrets are stored in this repository.


## Stage 6 — offline gateway research harness

See `experiments/offline-ingestion-gateway.mjs` and
`tests/offline-ingestion-gateway.test.mjs`. Neither module runs in the
website, Node bot, Firebase, Arduino or ESP8266. Mock tokens and mock transport
proofs are deliberately minted inside an in-process test harness and cannot
replace Firebase JWT verification, a TLS handshake or true cryptographic
identity. No network path, REST endpoint, database write, access to an old
WhatsApp session, or live hardware command is implemented.

The synthetic legacy compatibility inspector recognizes example whole-live
`PUT` and root slash-key `PATCH` shapes and reports why neither may be
transparently forwarded to authenticated staging; it never returns captured
network identifiers. Simulated expiry, revocation, monotonic frame sequence,
bounded queue overflow, retry exhaustion and reconnect stale-frame behavior
are covered by Node tests without hardware access.


## Stage 7 — restart-aware research evidence, not a Firebase change

Stage 7 adds `experiments/stage7-durable-ingress.mjs` and
`tests/stage7-durable-ingress.test.mjs` for offline Node tests. No RTDB
rules, real database paths or deployment configurations were changed.
Test-only Ed25519 signed envelopes bind the device UID, epoch, timestamp
and Stage 5 frame. An exclusive-locked, HMAC-sealed, temporary filesystem
ledger rejects replays across recreated harness instances; expired/future
frames, wrong signatures, unprovisioned devices, tampered ledgers and
missing transport proof fail closed. Its transport proof is explicitly fake,
and no certificate chain or TLS session is established.

The Stage 6 memory-only harness remains separate for lower-level
migration/queue experiments. Neither harness authorizes use of the
existing already-flashed ESP8266 or attempts to turn old anonymous
parent writes into trusted telemetry. Both are **review-only**.
