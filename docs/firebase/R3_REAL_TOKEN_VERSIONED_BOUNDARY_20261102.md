# FloodGuard R3 — Emulator-issued Auth tokens against versioned confirmation Rules

**2 November 2026 · stacked successor to draft PR #79 at `9de8093e7062a6e486db83e852fff74648fee905` · LAB ONLY · PRODUCTION NO-GO.**

## Specific missing evidence

The existing `tests/versioned-confirmation-emulator.mjs` exercises authenticated path and schema Rules with `@firebase/rules-unit-testing` and `authenticatedContext` identities, which supply mock claims. The separate earlier `tests/auth-emulator-lifecycle.mjs` obtains **real localhost Auth Emulator-issued Firebase ID tokens**, but evaluates a different staging/revocation policy. These provide valuable independent checks but do not establish that the versioned confirmer, attestor and publisher policy actually recognizes ID tokens minted from **their concrete Auth Emulator user records and custom claims**.

This checkpoint introduces a new **test-only Auth+RTDB Emulator** topology using exactly the existing `docs/firebase/phase-b-versioned-confirmation-lab.rules.json`, without touching or replacing it:

- `firebase.r3-real-token-versioned-lab.json`: local Auth at `127.0.0.1:9099`, local Realtime Database at `127.0.0.1:9000`, dedicated `demo-r3-real-token-versioned` project ID, no emulator UI and no production project config.
- `tests/r3-real-token-versioned-authority-emulator.mjs`: creates six **ephemeral synthetic** users through `firebase-admin/auth` **only for Auth Emulator setup**, with generated local passwords and explicit custom claims. Signs in via the local Identity Toolkit Emulator to obtain **actual emulator-issued ID tokens**, then calls RTDB ordinary REST with `?auth=<token>`; every test client request is evaluated by Rules. The special local `access_token=owner` bypass is confined to deterministic **test fixture seeding only**.
- The guard requires exact `FG_R3_REAL_TOKEN_VERSIONED_TEST=1`, localhost-only Auth and Database host env vars, and the exact `GCLOUD_PROJECT=demo-r3-real-token-versioned`. Running the test with live or unknown hosts is refused before any user creation or network request.
- Existing narrow versioned rules and historical signed approval/attestor/publisher tests remain untouched. No Admin RTDB database credential is instantiated, no cloud key is provisioned, and neither `firebase.rules.json` nor a production branch is changed.

## Acceptance assertions

1. **Device token**: genuine local `fg_ingest_v1` ID token can write the allowed staging leaf. An anonymous user, ordinary signed-in user, and a **different UID with the same claim** are denied. Device cannot update authorization records or live gate paths.
2. **Confirmer token**: the separate `fg_confirm_ingest_v1` identity can create a schema-valid versioned record only under the assigned device/sequence after the staged frame exists; device/attestor/publisher cannot create it. The first record becomes write-once and cannot be deleted or forged with a different device path.
3. **Attestor token**: only the exact confirmed-record and scoped source information are readable; private parent reads and record/publication writes remain denied.
4. **Publisher token**: only the reviewed narrow `publicationLab/water` state can advance. Device, ordinary, confirmer and attestor token cannot write there, and publisher cannot write live gate controls, root/parent data or operator authorization. Anonymous users can read `publicationLab/water/current` but not the private checkpoint, root or private ESP network metadata. The existing historical `live/water` value remains unchanged.
5. **Revocation**: disabling device authorization through the **emulator-only fixture owner** blocks subsequent device staging, confirmation, attestor read and narrow publication even when a previous synthetic frame is still available. This is rules-behavior evidence only—not an atomic production revocation protocol.
6. **Negative-control bypasses**: a compromised **confirmer** token can create an immutable, syntactically valid confirmation carrying a **fake digest** for a matching staged frame; and a compromised **publisher** token can bypass out-of-band signature/attestation code and write a bounded, higher-sequence public-lab snapshot without actual signed provenance. These are **expected authorization failures of the end-to-end security design**, deliberately exposed even though the emulator's schema/path policy accepts them. They are NOT grounds for production GO.

## Exact CI and interpretation

`.github/workflows/r3-real-token-versioned-authority-lab.yml` runs a pinned Node 22 + Java 17 job, test-only Firebase Admin Auth SDK, and Firebase CLI 14.18.0 emulators in a disposable `demo-*` project. This workflow is branch-scoped and contains no GitHub/Firebase secrets, live API keys, real SMTP, WhatsApp, ESP8266 hardware, gate commands or cloud deploy steps. It must pass on the **exact head SHA**, independently of all previously completed code-level preflight and pinned NodeMCU/website regression checks.

**Important limitations:** Auth Emulator token issuance does not prove a production Identity Platform/Firebase Auth, KMS, IAM, Admin SDK privilege boundary or deployed RTDB Rules; tests cannot assert that a compromised signer is prevented from bypassing signature enforcement at a separate process. Firebase Admin Auth used for test fixture user creation is a privileged **local emulator** operation, not a scoped real-world issuer.

Before safe deployment, enforce mandatory signed frame verification **inside a truly isolated server execution/credential boundary** for both confirmer and publisher; verify actual least-privileged tokens and real IAM in an approved disposable nonproduction Firebase project; ensure independent database durability and anti-rollback, atomic revocation, TLS device identity and physically safe ESP8266/UNO operation, plus supervised warning delivery and fallback. This PR does none of those things.

**Keep draft/unmerged. No live Rules, data, secrets, firmware, notifications or actuators. PRODUCTION NO-GO.**
