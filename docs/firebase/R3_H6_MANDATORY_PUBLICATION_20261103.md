# FloodGuard R3 H6 — Mandatory Signed Publication Boundary (disposable Emulator only)

**3 November 2026 | Successor to H5 draft PR #99 at afef0ddaba12104bc2cb121f6ed5ed26f588d5d0. Review-only, draft/unmerged, NO DEPLOY, NO PRODUCTION FIREBASE OR IAM, NO ALERTS, NO GATE/ESP HARDWARE. Production NO-GO.**

## Why H6 exists

Earlier H5 work introduced an isolated Auth Emulator issuer credential, but the actual RTDB Rules let a holder of that currently valid bearer mint a schema-conforming fake admission ticket without undergoing H4 Ed25519 validation. If a publisher credential was also present, the fake ticket could cause a synthetic false SAFE publication. This is a serious bypass: checking signatures only in an optional application-level verifier is insufficient while a direct database-write path remains.

The current prototype is built on previous signed source envelope, server receipt, independent persisted-confirmation attestation and immutable/replay experiments. It reuses `createH4OfflineAdmissionIssuer`; it does not introduce a new sensor protocol or claim to have fixed upstream stolen-confirmer writer credentials.

## Narrow alternate Rules candidate

`docs/firebase/r3-h6-mandatory-publication-lab.rules.json` is copied from H5 but sets **only** two existing client write conditions to the literal boolean false:

- `/floodguard/publicationAdmission/device-stage-a/.write = false`
- `/floodguard/publicationLab/water/.write = false`

Everything else in the unpublished H5 candidate is unchanged, including non-public authority paths and other preexisting research Rules. This is enforced by structural comparison against the exact previous candidate, not inferred from comments. Even stolen, currently valid issuer and publisher Auth Emulator ID tokens now **cannot directly create admission tickets or submit a public water record** through those paths. These are Emulator observations, not production enforcement evidence.

The existing deployed Firebase Rules, `firebase.rules.json`, Android reads, real data and field hardware were not modified. The test publication remains under the experimental `/floodguard/publicationLab/water` subtree, not the live app's `/floodguard/live` fields.

## Mandatory local trusted-worker experiment

`experiments/r3-h6-mandatory-publication-worker.mjs` runs as a child process only under fixed `demo-r3-h6-publication` and `127.0.0.1:9000` RTDB / `127.0.0.1:9099` Auth Emulators. It refuses non-demo, non-IPC invocation. A one-use fd4 bootstrap supplies *only* three ephemeral, distinct Ed25519 trusted public keys from the synthetic harness. Client IPC cannot provide its own trust roots, approval identity, database path or database method.

The child:

1. Reads existing **test** issuer, publisher, device, quarantine and publication checkpoint state using fixed database paths.
2. Uses the unchanged H4 signer gate to verify canonical sensor envelope, acceptance receipt and independent confirmation signatures, matching digest, strictly increasing sequence, bounded observed timestamps and an UNKNOWN overall-risk projection. H4 rereads authority and rejects changes or bad clocks.
3. Rereads and compares complete authorization state, checks that the previous publication checkpoint agrees with signed evidence, and obtains the publication node's RTDB ETag.
4. Issues a single **conditional whole-record PUT with if-match**, preventing a silent overwrite if that one publication node has changed. It then performs exact private readback.
5. Returns only a synthetic sequence/digest and `releaseDecision:NO_GO`. On a rejected, timed-out, uncertain or concurrent write it never automatically retries or assumes success. It has no arbitrary database path, public HTTP listener, Firebase user provisioning, alert sender or gate actuation interface.

The literal Emulator REST owner bypass is deliberately hardcoded behind the demo and loopback checks. It is **not** a secure credential, tenant boundary, production workload identity or suitable implementation for a real trusted service. The test harness itself has full Emulator ownership. A real operator-supplied privileged identity must be independently provisioned, isolated, revocable and auditable.

## What the tests establish

The synthetic Auth+RTDB Emulator suite uses actual Firebase Rules decisions to test denial of direct ticket/water/physical-gate writes for publisher, issuer, ordinary and anonymous clients; mandatory three-signature positive commit; replay denial; forged source/receipt/attestor/DB evidence refusal; issuer/publisher/device revocation and quarantine; invalid IPC and out-of-scope requests. It also explicitly demonstrates the residual **EXPECTED OPEN DEFECT**: a compromised privileged Emulator owner can still PUT a fake schema-valid water record even though all client Rules deny writes. This must remain a failing *security release gate*, even if the demonstration test passes as an expected negative.

Separate static checks verify exactly two changed write conditions, inherited source/privacy constraints, fixed local-only Emulator configuration, and zero Firebase Admin SDK in the worker module. H4 and the historical three-signer tests are rerun.

## Still-open failure modes — do not deploy

- A stolen Emulator owner/production Admin-like credential **bypasses Rules**. Real protected workload identity and mandatory verification at the only publication path are not implemented. Same-host test processes are not independently isolated.
- The worker's H4 authority reads are independent GETs, **not one durable monotonic snapshot**, and the final ETag CAS only protects the *water node*. A quarantine, issuer revocation or checkpoint manipulation in a separate node **after the worker's final authority read but before its PUT** is not atomically fenced. A separate external durable incident epoch/witness, an independent audited operator authority and server-side atomic commit orchestration are still required.
- No physical sensor/ESP8266/UNO acceptance, true calibrated water level, signed hardware TLS provisioning, root key custody/rotation, notification delivery, backup/recovery or safe servo/interlock commissioning was performed.
- The real Firebase `system.lastUpdate` remained 25 August 2026 at the user's last check, and production read access was restored without proving live authenticated uploads. Android can display historical data; never equate it to current SAFE flood conditions.
- The current experimental rules remain a chained research stack, not a reviewed production deploy bundle; versions of upstream confirmed-record and issuer credentials may still permit storage forgery in those earlier test paths.

**Next:** independent durable monotonic incident/witness authority, credential custody/containment, consented nonproduction IAM and replay tests, then supervised hardware safety testing. The test must remain NO-GO even if all synthetic checks pass.

## Review disposition

**DRAFT · UNMERGED · NO PRODUCTION FIREBASE RULES OR DATA CHANGES · NO DEVICE FLASH · NO ALERTS · NO GATE MOVEMENT · PRODUCTION NO-GO.** Exact-head GitHub Actions outcome is required before labeling this lab verified.
