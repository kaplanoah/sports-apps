---
paths:
  - "tests/**"
  - "apps/*/tests/**"
---

# Tests

- Test what people type the way they type it, never only the words a test's author thought of:
  in lowercase, a key at a time, every name and the ways fans write it, alone and inside the searches they make,
  as each app's `tests/search-typing.test.js` types every team and place with the root's `tests/search-sweep.js`.
- Test what searches, matches, or ranks across a league against all of it, recorded, never a few rows picked by hand,
  which hide the collisions a whole league has, like a first name that starts a city's,
  as the sweep reads every player on a roster from `apps/mlb/tests/fixtures/2026-10-13-player-index.json`.
- Tests pass in any `TZ`: a test that asserts a time picks its zone with the root's `tests/time-zone.js` or `test.use({ timezoneId })`.
- Keep date/time tests in `tests/time-zone-sensitive.json` when the native Date/Intl coverage guard asks for them.
  CI repeats that list and changed Node tests in Honolulu.
