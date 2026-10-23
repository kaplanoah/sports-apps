import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSeason, showYear, startSeasonData } from "../page/js/season-data.js";
import { session } from "../page/js/session.js";
import { createFakeStore, settle } from "../../../tests/fake-store.js";
import { checkSeasonFailureReports } from "../../../tests/season-failure-check.js";

const STARTING_YEARS = {
  year: session.year,
  pickedYear: session.pickedYear,
  currentYear: session.currentYear,
};

const SEASON_2026 = { season: 2026, games: [], series: [], standings: [] };

/**
 * @param {{ unreadable?: string[] }} [options]
 * @param {Record<string, any>} [documents]
 */
function startReading(options, documents = {}) {
  const fake = createFakeStore(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026, ...documents },
    options,
  );
  session.db = /** @type {any} */ (fake.store);
  const redraws = { stamps: 0 };
  startSeasonData({
    showChange: () => {},
    showStamp: () => redraws.stamps++,
    showCurrentYear: () => {},
    showUnreadable: () => {},
  });
  return { ...fake, redraws };
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

test("a page whose last showing was a past season loads it again, not the current one", async () => {
  const season2025 = { ...SEASON_2026, season: 2025 };
  startReading({}, { "seasons/2025": season2025 });
  Object.assign(session, { year: 2025, pickedYear: 2025, currentYear: 2026 });

  await loadSeason();

  assert.deepEqual([session.year, session.currentYear], [2025, 2026]);
  assert.deepEqual(session.season, season2025);
});

test("a page whose last showing was the current season loads the one the store now says is current", async () => {
  const season2027 = { ...SEASON_2026, season: 2027 };
  startReading({}, { "live/current": { season: 2027 }, "seasons/2027": season2027 });
  Object.assign(session, { year: 2026, pickedYear: 2026, currentYear: 2026 });

  await loadSeason();

  assert.deepEqual([session.year, session.currentYear], [2027, 2027]);
  assert.deepEqual(session.season, season2027);
});

test("the restored pick stays selected while the first current read is pending", async () => {
  const { holdReads } = startReading();
  session.pickedYear = 2026;
  const release = holdReads("live/current");
  const loaded = loadSeason();
  assert.equal(session.pickedYear, 2026);
  release();
  await loaded;
  assert.equal(session.pickedYear, 2026);
});

test("a reload during a pending past pick restores the season actually shown", async () => {
  const { holdReads } = startReading({}, { "seasons/2025": { ...SEASON_2026, season: 2025 } });
  await loadSeason();
  const release = holdReads("seasons/2025");
  const picked = showYear(2025);
  assert.equal(session.pickedYear, 2025);
  const reloaded = loadSeason();
  await settle();
  release();
  await Promise.all([picked, reloaded]);
  assert.deepEqual([session.year, session.pickedYear, session.season], [2026, 2026, SEASON_2026]);
});

for (const firstFailure of [null, "live/current", "seasons/2026"]) {
  test(`before any record loads, a pending pick cannot choose a reload after ${firstFailure ?? "no initial load"}`, async () => {
    const unreadable = firstFailure ? [firstFailure] : [];
    const { holdReads } = startReading(
      { unreadable },
      { "seasons/2024": { ...SEASON_2026, season: 2024 } },
    );
    Object.assign(session, { pickedYear: 2026, currentYear: 2026 });
    if (firstFailure) {
      await loadSeason();
      assert.notEqual(session.problem, "");
      unreadable.length = 0;
    }
    const release = holdReads("seasons/2024");
    const picked = showYear(2024);
    const reloaded = loadSeason();
    await settle();
    release();
    await Promise.all([picked, reloaded]);
    assert.deepEqual([session.year, session.pickedYear, session.season], [2026, 2026, SEASON_2026]);
    assert.equal(session.problem, "");
  });
}

test("each failed load, pick or current-season advance reports its problem and stamp once", async () => {
  const unreadable = [];
  const { deliver, redraws } = startReading({ unreadable });
  await loadSeason();
  await settle();
  await checkSeasonFailureReports({ session, redraws, unreadable, deliver, loadSeason, showYear });
});

test("a first load with no last showing, while the store can't be reached, shows no season, never the clock's", async () => {
  assert.deepEqual(STARTING_YEARS, { year: null, pickedYear: null, currentYear: null });
  startReading({ unreadable: ["live/current"] });
  Object.assign(session, STARTING_YEARS);

  await loadSeason();

  assert.deepEqual([session.year, session.currentYear], [null, null]);
});

test("picking a season that can't be read puts back the season shown, not the pick before it, and says the store can't be reached", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();
  session.pickedYear = 2024;

  await showYear(2025);

  assert.deepEqual([session.year, session.pickedYear], [2026, 2026]);
  assert.deepEqual(session.season, SEASON_2026);
  assert.notEqual(session.problem, "");
});

test("before the store or the page's last showing names a season, a pick that can't be read leaves none picked, never the clock's", async () => {
  startReading({ unreadable: ["live/current", "seasons/2025"] });
  Object.assign(session, { year: 2027, pickedYear: null });

  await showYear(2025);

  assert.equal(session.pickedYear, null);
});

test("a pick that can't be read after a newer pick replaced it leaves the newer one, with no problem", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();

  const replaced = showYear(2025);
  const newer = showYear(2026);

  await replaced;
  await newer;
  assert.equal(session.pickedYear, 2026);
  assert.equal(session.problem, "");
});
