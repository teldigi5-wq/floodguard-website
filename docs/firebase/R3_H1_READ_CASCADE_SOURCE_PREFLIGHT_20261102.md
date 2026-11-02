# FloodGuard R3-H1/A — offline Firebase read-rule cascade preflight hardening

**Review-only candidate. 2 November 2026. Base: FloodGuard website PR #87 exact head `ea6b204990c104c06a065549d3fe12dec81a8c2e`. No merge, deploy, cloud changes or hardware activity. Production: NO-GO.**

## Verified defect

The existing `scripts/r3-real-authority-preflight.mjs` checks nine fixed `floodguard/live` public `.read` grants and denies unexpected `.write` grants. It did not independently reject newly added `.read: true` or conditional `.read` on `/floodguard`, `/floodguard/live` or `/floodguard/live/esp8266`. This matters because Firebase Realtime Database `.read` grants are inherited by descendants, and child `.read: false` cannot revoke ancestor access. The previous static preflight mistakenly returned `reviewValid: true` after those edits, despite private ESP network child paths carrying `.read: false`. This is a source-review gate defect, NOT proof of currently deployed database exposure.

Source: https://firebase.google.com/docs/database/security/core-syntax

## Candidate change

- Preserve the exact nine existing source-review public grant paths and require only literal `true` at these exact locations.
- Traverse all other rule-tree nodes and refuse any other grant besides literal `false`, including conditional strings requiring a separate authorization review. Any unexpected read grant returns the existing generic `LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED`, without echoing path names, data or sensitive configuration.
- Preserve preflight's current root and descendant write checks, exact manifest requirements, six proposed roles and eleven unverified real-world gates.
- Preserve `releaseDecision: NO_GO` and every explicit prohibition on rule changes, publishing, merging, hardware and gate actuation.

## Verified local tests

The source copy used for preparation matched GitHub blob `facca320c120d6db55e0b6dd8ff15ae9dfdf29f8`; the baseline `firebase.rules.json`, preflight manifest and original test file also matched their exact PR #87 Git blobs. With the unmodified baseline, seven new negative tests FAIL as expected because the preflight incorrectly accepts broadened reads. The patched local candidate passes all 19 focused Node tests (the ten original repository tests and nine new checks), running Node.js 22.16.0 in a disconnected environment.

This is NOT the complete 515-test website suite, Firebase Auth+RTDB Emulator suite, security scan, pinned firmware compile, cloud IAM check or physical acceptance. CI at this new candidate SHA is not available because this is only a local patch; no GitHub branch or PR was created.

## Known limitations / remaining real boundary

This check verifies only the source file's declared grants. Existing public grants on `water`, `rain`, `gate`, `alarm`, `devices` and `system` inherit to ALL their stored descendants, including any new confidential fields. A private inventory of actual live descendants and effective deployed rules is still essential; the checked-in Rules file may differ from the deployed one. Dynamic rules semantics and claims must be exercised in an emulator and a disposable nonproduction Firebase project before promotion. Firebase Admin clients may bypass regular Rules. A stolen *currently valid* confirmer token still directly creates forged private records in the reviewed test candidate, and the read-only attestor is only downstream containment. Independent signer and witness custody, incident quarantine and real hardware/alert acceptance are unresolved.

## Next gate

After reviewing this isolated patch, perform **operator-approved read-only** inventory of effective Firebase rules, IAM/service identities and nine public subtree descendants. Keep that inventory private and redact sensitive data. Do not issue credentials or open production writes. Design a separated verifier/confirmation service with mandatory cryptographic verification and independent key custody; prove denial of directly forged submissions in a disposable Firebase project. Preserve Arduino Uno local gate/alarm authority and the existing live monitoring purpose.

**Status: locally tested code preview only. DRAFT / UNMERGED / NO-GO.**
