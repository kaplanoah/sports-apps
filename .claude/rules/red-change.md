---
paths:
  - "apps/*/page/**"
  - "shared/page/**"
  - "worker/red-change.mjs"
  - "worker/red-change-styles.mjs"
  - "worker/red-approval.mjs"
  - ".github/workflows/red-approvals.yml"
  - ".github/workflows/ci.yml"
---

# Red changes

- A red change is one whose bugs no CI browser would show, since none touches,
  scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong before: parts left undrawn by how layers and sheets stack.
  The gate decides which changes are red: the root's `worker/red-change.mjs` and `worker/red-change-styles.mjs`,
  with `tests/red-change.test.js` for each case.
  Run the red-change command in AGENTS.md's step 3 on your diff rather than judging by eye.
  By design it can't see what a page's other stylesheets take out, or their `display` and `opacity` overriding a shared rule,
  nor a class that markup or a script adds that a shared stacking rule then reaches.
  Tests are never red.
- The owner's phone is a red change's test, through CI's `gate` and `phone` jobs (`.github/workflows/ci.yml`) and the `phone-ok` label.
  The gate also requires the tested head to contain every red commit on `main` and main's red changes to have verified production coverage.
  The Red approvals workflow (`.github/workflows/red-approvals.yml`, `worker/red-approval.mjs`) refreshes the phone status when main or its deploy changes.
  The `ship` skill's "Red changes" and "Step 8: a red PR" say how one ships.
- If parts of a page ever stop drawing on the phone again, the first step is a phone restart and a Diagnostics report from settings, not a code change.
