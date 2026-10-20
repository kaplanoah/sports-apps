import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSeason, showYear, startSeasonData } from "../page/js/season-data.js";
import { session } from "../page/js/session.js";
import { createFakeStore } from "../../../tests/fake-store.js";

const SEASON_2026 = { season: 2026, games: [], series: [], standings: [] };

/** @param {{ unreadable?: string[] }} [options] */
function startReading(options) {
  const { store } = createFakeStore(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 },
    options,
  );
  session.db = /** @type {any} */ (store);
  startSeasonData({
    showChange: () => {},
    showStamp: () => {},
    showCurrentYear: () => {},
    showUnreadable: () => {},
  });
}

beforeEach(() => {
  Object.assign(session, {
    season: null,
    problem: "",
    year: 2026,
    pickedYear: null,
    currentYear: null,
  });
});

test("picking a season that can't be read puts back the season shown, not the pick before it, and says the store can't be reached", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();
  session.pickedYear = 2024;

  assert.equal(await showYear(2025), "unread");

  assert.deepEqual([session.year, session.pickedYear], [2026, 2026]);
  assert.deepEqual(session.season, SEASON_2026);
  assert.notEqual(session.problem, "");
});

test("before the store or the page's last showing names a season, a pick that can't be read leaves none picked, never the clock's", async () => {
  startReading({ unreadable: ["live/current", "seasons/2025"] });
  Object.assign(session, { year: 2027, pickedYear: null });

  assert.equal(await showYear(2025), "unread");

  assert.equal(session.pickedYear, null);
});

test("a pick that can't be read after a newer pick replaced it leaves the newer one, with no problem", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();

  const replaced = showYear(2025);
  const newer = showYear(2026);

  assert.equal(await replaced, "replaced");
  assert.equal(await newer, "shown");
  assert.equal(session.pickedYear, 2026);
  assert.equal(session.problem, "");
});
