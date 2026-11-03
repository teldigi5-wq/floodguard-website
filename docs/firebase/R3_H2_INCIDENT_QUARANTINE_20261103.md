# FloodGuard R3 H2 — operator-controlled incident quarantine for confirmed sensor records

3 November 2026. Review-only successor to PR #89 head 5001b7b96995cc8b08e6b289be369566922febeb. NO DEPLOY, NO MERGE, NO PRODUCTION FIREBASE ACCESS, NO HARDWARE OR GATE OPERATIONS. PRODUCTION NO-GO.

## The gap

PR #87's real local Auth+RTDB Emulator demonstrated that disabling a compromised confirmer service identity does not stop the independent read-only attestor from signing historically valid, immutable confirmations. This is an explicit documented policy gap, not evidence of attestor signature forgery. The record stays intact, while a still-enabled device and attestor can certify its history.

Earlier PRs #73–#87 already implement three-signer water proposals, replay and durable-confirmation research, an isolated signed confirmer worker, session generation revocation, and a separate read-only attestor. This stage does not replace or duplicate those components.

## Unpublished H2 Rules experiment

New file: docs/firebase/r3-h2-incident-quarantine-lab.rules.json, derived from docs/firebase/r3-service-session-fence-lab.rules.json. It does NOT replace the prior candidate, firebase.rules.json, or deployed Console Rules.

- Adds a private, client read/write-denied /floodguard/incidentQuarantine/$deviceId/blocked marker. The local Emulator's privileged owner fixture seeds this value; it is NOT a real deployed operator authority.
- Four existing attestor-role read permissions gain an explicit check that blocked is precisely the boolean false: device authorization, staged frame, attestor authorization, and confirmed immutable record. Missing blocked data and a true value both deny read.
- All other Rules remain unchanged, enforced by a structure-only source comparison against the exact previous candidate. The confirmer role and its immutable records remain intact.
- Publication and old /floodguard/live writes remain denied. The single fixed test device is device-stage-a; production multi-device design remains unverified.

## Emulator and source tests

The existing isolated Auth+RTDB confirmer and attestor tests run again against the alternative candidate. Four additional integration cases cover:

1. Successful legitimate attestation followed by an operator quarantine: no further attestor read/signature, immutable confirmation preserved.
2. Missing quarantine row: fail closed, rather than implicitly treating it as false.
3. Confirmer token revoked: historical attestation is still possible until an explicit separate incident quarantine is set. This policy distinction is intentional.
4. Device, ordinary, attestor, and currently valid service-confirmation credentials cannot read or mutate the incident control.

Four additional static tests prove exactly the four inserted predicates, denial of direct incident reads/writes, no other changed Rules, and fixed loopback-only demo emulator configuration. Test identities and signing keys are synthetic and generated in CI.

## Important remaining risks

H2 cannot invalidate signatures already issued before a quarantine. A downstream publisher must independently check incident/epoch state just before a final commit, with protected revocation and durable monotonic fencing; the current five-second attestation freshness window is NOT an incident clearance.

A stolen valid confirmer writer token can STILL directly forge schema-valid immutable data if it is allowed by the underlying Rules. The independent attestor can reject a forged signature, but H2 does not stop the attempted storage mutation. A stolen attestor signing key likewise remains a severe risk.

This is not production IAM evidence, an independent operator service, a cross-failure-domain persistent witness, a physical device authentication protocol, cloud-write capability, real sensor-freshness proof or a safe gate test.

## Execution and release state

The dedicated workflow runs synthetic fixtures only in demo-r3-isolated-service-confirmer on fixed localhost Auth port 9099 and RTDB port 9000. It uses the earlier pinned Firebase CLI 14.18.0 and Java 17 known to support the prior suite. No production secrets or personal firmware are uploaded. The Emulator owner bypass is a test mechanism, not a production role.

Further gates: independently protected incident authority and witnessed recovery; safe publisher-boundary check; actual Firebase IAM/Rules inventory; authenticated device TLS and credentials; verified hardware, alert and UNO gate operation; human release approval.

DRAFT / UNMERGED / PRODUCTION NO-GO.
