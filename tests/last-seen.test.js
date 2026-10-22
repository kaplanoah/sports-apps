import test from "node:test";
import assert from "node:assert/strict";
import { readLastSeenYears } from "../shared/page/last-seen.js";

test("a last showing names the season it showed and the one the store then said was current", () => {
  assert.deepEqual(readLastSeenYears({ year: 2025, currentYear: 2026 }), {
    year: 2025,
    currentYear: 2026,
  });
});

test("a last showing saved before the page kept the current season counts its season as current", () => {
  assert.deepEqual(readLastSeenYears({ year: 2026 }), { year: 2026, currentYear: 2026 });
  assert.deepEqual(readLastSeenYears({ year: 2026, currentYear: null }), {
    year: 2026,
    currentYear: 2026,
  });
});

test("a page with no last showing, or one without a season, has no years", () => {
  assert.equal(readLastSeenYears(null), null);
  assert.equal(readLastSeenYears({}), null);
  assert.equal(readLastSeenYears({ year: "2025" }), null);
  assert.equal(readLastSeenYears({ year: null, currentYear: 2026 }), null);
});
