# Stage 17 — display-only uncertainty review components (NO-GO)

**Review-only additions to website draft PR #8. No runtime integration.**

- `experiments/stage17-review-display.mjs`: pure adapter from Stage 16's proposed
  uncertainty classifications to four simple read-only notice objects:
  water, gate, risk and freshness. Every result is marked synthetic, not live,
  and never grants deployment/alert/gate permissions.
- `components/stage17-review-notice.tsx`: a reusable **unmounted** accessible
  React notice section with an explicit textual heading, description, warning
  cue, synthetic-only disclosure and stable accessible names.
- `tests/stage17-review-display.test.mjs` verifies all Stage 14 examples,
  including 0 cm conflicts, gate contradiction, unknown risk, future timestamps
  and 20-second freshness disagreement; it also statically audits the
  component's landmark/label attributes and that the actual dashboard does
  **not** import it.

These are candidate **UI elements**, not fixes to sensor classification,
authentication, firmware, physical gate state or emergency warning delivery.
The existing dashboard has not been modified. No page links, deployment flags
or listening services were added.

Before using these notices in any live data view, obtain field evidence of
actual uploaded sensor schema, validate screen reader and contrast on browser,
review all affected client reports on a shared synthetic fixture, and approve
a tested rollback plan. The Stage 11–16 NO-GO blockers, especially anonymous
Firebase parent writes, continue to apply. All PRs stay draft.
