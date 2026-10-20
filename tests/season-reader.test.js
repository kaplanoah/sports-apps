import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonPicks, createSeasonReader } from "../shared/page/season-reader.js";
import { createFakeStore } from "./fake-store.js";

const SEASON_2026 = { year: 2026, games: ["opener"] };
const SEASON_2027 = { year: 2027, games: ["next opener"] };

function startReader(documents, options = {}) {
  const { store, deliver, holdReads } = createFakeStore(documents, options);
  const shown = {
    year: null,
    season: null,
    changes: 0,
    status: undefined,
    currentYears: [],
    failures: 0,
    unreadable: 0,
  };
  const reader = createSeasonReader({
    store,
    version: 1,
    showUnreadable: () => shown.unreadable++,
    guessYear: () => options.guessedYear ?? 2026,
    keepSeason: (year, season) => Object.assign(shown, { year, season }),
    showChange: () => shown.changes++,
    showStatus: (status) => {
      shown.status = status;
    },
    showLoadFailure: () => shown.failures++,
    noteCurrentYear: (year) => shown.currentYears.push(year),
  });
  return { reader, shown, deliver, holdReads };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the page loads the season the store says is current, without redrawing for it", async () => {
  const { reader, shown } = startReader({
    "live/current": { season: 2026 },
    "seasons/2026": SEASON_2026,
    "seasons/2027": SEASON_2027,
  });

  await reader.loadCurrentSeason();

  assert.deepEqual([shown.year, shown.season, shown.changes], [2026, SEASON_2026, 0]);
});

test("until the store says which season is current, the clock's guess is, once it has a record", async () => {
  const { reader, shown } = startReader(
    { "seasons/2027": SEASON_2027, "seasons/2026": SEASON_2026 },
    { guessedYear: 2027 },
  );

  await reader.loadCurrentSeason();

  assert.equal(shown.year, 2027);
});

test("a guess the store has no record for falls back to the season before", async () => {
  const { reader, shown } = startReader({ "seasons/2026": SEASON_2026 }, { guessedYear: 2027 });

  await reader.loadCurrentSeason();

  assert.deepEqual([shown.year, shown.season], [2026, SEASON_2026]);
});

test("a change to the season after it loads is kept and redrawn, and a gap in it is not", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2026": SEASON_2026,
  });
  await reader.loadCurrentSeason();

  const later = { ...SEASON_2026, games: ["opener", "second game"] };
  deliver("seasons/2026", later);
  deliver("seasons/2026", undefined);

  assert.deepEqual([shown.season, shown.changes], [later, 1]);
});

test("when the store moves on to a new season, a page showing the current one moves on with it", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2026": SEASON_2026,
    "seasons/2027": SEASON_2027,
  });
  await reader.loadCurrentSeason();
  await settle();

  deliver("live/current", { season: 2027 });
  await settle();

  assert.deepEqual([shown.year, shown.season, shown.changes], [2027, SEASON_2027, 1]);
  assert.deepEqual(shown.currentYears, [2027]);
});

test("a new season that can't be read as the store moves on to it is a failure the page loads again from", async () => {
  const documents = {
    "live/current": { season: 2026 },
    "seasons/2026": SEASON_2026,
    "seasons/2027": SEASON_2027,
  };
  const unreadable = [];
  const { reader, shown, deliver } = startReader(documents, { unreadable });
  await reader.loadCurrentSeason();
  await settle();

  unreadable.push("seasons/2027");
  deliver("live/current", { season: 2027 });
  await settle();
  assert.equal(shown.failures, 1);

  unreadable.length = 0;
  await reader.loadCurrentSeason();
  assert.deepEqual([shown.year, shown.season], [2027, SEASON_2027]);
});

test("a page showing a past season stays on it when the store moves on, and hears of the new one", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2025": { year: 2025 },
    "seasons/2026": SEASON_2026,
  });
  await reader.loadCurrentSeason();
  await settle();
  await reader.showYear(2025);

  deliver("live/current", { season: 2027 });
  await settle();

  assert.equal(shown.year, 2025);
  assert.deepEqual(shown.currentYears, [2027]);
});

test("a season that can't be read leaves the season shown before followed", async () => {
  const { reader, shown, deliver } = startReader(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 },
    { unreadable: ["seasons/2025"] },
  );
  await reader.loadCurrentSeason();
  await settle();

  await assert.rejects(reader.showYear(2025));
  const later = { ...SEASON_2026, games: ["opener", "second game"] };
  deliver("seasons/2026", later);

  assert.deepEqual([shown.year, shown.season], [2026, later]);
});

test("a change to the season shown while another's read is out is shown once that read fails", async () => {
  const unreadable = [];
  const { reader, shown, deliver, holdReads } = startReader(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 },
    { unreadable },
  );
  await reader.loadCurrentSeason();
  await settle();
  const release = holdReads("seasons/2025");
  const picked = reader.showYear(2025);

  const later = { ...SEASON_2026, games: ["opener", "second game"] };
  deliver("seasons/2026", later);
  assert.deepEqual(shown.season, SEASON_2026);
  unreadable.push("seasons/2025");
  release();

  await assert.rejects(picked);
  assert.deepEqual([shown.year, shown.season, shown.changes], [2026, later, 1]);
});

test("two picks that can't be read, the older failing first, leave the season shown followed", async () => {
  const { reader, shown, deliver, holdReads } = startReader(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 },
    { unreadable: ["seasons/2025", "seasons/2024"] },
  );
  await reader.loadCurrentSeason();
  await settle();
  const releaseOlder = holdReads("seasons/2025");
  const releaseNewer = holdReads("seasons/2024");
  const older = reader.showYear(2025);
  const newer = reader.showYear(2024);

  releaseOlder();
  await assert.rejects(older);
  releaseNewer();
  await assert.rejects(newer);

  assert.equal(reader.readShownYear(), 2026);
  const later = { ...SEASON_2026, games: ["opener", "second game"] };
  deliver("seasons/2026", later);
  assert.deepEqual([shown.year, shown.season], [2026, later]);
});

/**
 * A viewer's picks with the reader, kept as an app keeps them, and how often each said the store
 * can't be reached.
 * @param {ReturnType<typeof startReader>["reader"]} reader
 * @param {number | null} pickBefore
 */
function startPicks(reader, pickBefore) {
  const picks = { picked: pickBefore, unreachable: 0 };
  const pickSeason = createSeasonPicks({
    reader,
    readPick: () => picks.picked,
    keepPick: (year) => {
      picks.picked = year;
    },
    noteUnreachable: () => picks.unreachable++,
  });
  return { picks, pickSeason };
}

test("a pick that can't be read keeps the season shown, and says the store can't be reached", async () => {
  const { reader } = startReader(
    { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 },
    { unreadable: ["seasons/2025"] },
  );
  await reader.loadCurrentSeason();
  const { picks, pickSeason } = startPicks(reader, 2026);

  assert.equal(await pickSeason(2025), "unread");

  assert.deepEqual(picks, { picked: 2026, unreachable: 1 });
});

test("before any season has loaded, a pick that can't be read keeps the pick before it", async () => {
  const { reader } = startReader({}, { unreadable: ["seasons/2025"] });
  const { picks, pickSeason } = startPicks(reader, null);

  assert.equal(await pickSeason(2025), "unread");

  assert.deepEqual(picks, { picked: null, unreachable: 1 });
});

test("before any season has loaded, two picks that can't be read keep the pick before both", async () => {
  const { reader, holdReads } = startReader({}, { unreadable: ["seasons/2025", "seasons/2024"] });
  const { picks, pickSeason } = startPicks(reader, null);
  const releaseOlder = holdReads("seasons/2025");
  const releaseNewer = holdReads("seasons/2024");
  const older = pickSeason(2025);
  const newer = pickSeason(2024);

  releaseOlder();
  assert.equal(await older, "replaced");
  releaseNewer();
  assert.equal(await newer, "unread");

  assert.deepEqual(picks, { picked: null, unreachable: 1 });
});

test("a page whose picked season's read is out stays on the pick when the store moves on", async () => {
  const { reader, shown, deliver, holdReads } = startReader({
    "live/current": { season: 2026 },
    "seasons/2025": { year: 2025 },
    "seasons/2026": SEASON_2026,
    "seasons/2027": SEASON_2027,
  });
  await reader.loadCurrentSeason();
  await settle();
  const release = holdReads("seasons/2025");
  const picked = reader.showYear(2025);

  deliver("live/current", { season: 2027 });
  await settle();
  release();
  await picked;

  assert.equal(shown.year, 2025);
  assert.deepEqual(shown.currentYears, [2027]);
});

test("a pick that fails after a newer one replaced it changes nothing", async () => {
  const { reader, holdReads } = startReader(
    {
      "live/current": { season: 2026 },
      "seasons/2026": SEASON_2026,
      "seasons/2024": { year: 2024 },
    },
    { unreadable: ["seasons/2025"] },
  );
  await reader.loadCurrentSeason();
  const { picks, pickSeason } = startPicks(reader, 2026);
  const release = holdReads("seasons/2025");

  const replaced = pickSeason(2025);
  assert.equal(await pickSeason(2024), "shown");
  release();

  assert.equal(await replaced, "replaced");
  assert.deepEqual(picks, { picked: 2024, unreachable: 0 });
});

test("an answer for a season the page has moved off is dropped", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2025": { year: 2025 },
    "seasons/2026": SEASON_2026,
  });
  await reader.loadCurrentSeason();
  await reader.showYear(2025);

  deliver("seasons/2026", { ...SEASON_2026, games: [] });

  assert.equal(shown.year, 2025);
});

test("a record in a version the page doesn't read is left out, and the app hears of it", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2026": { ...SEASON_2026, version: 2 },
  });

  await reader.loadCurrentSeason();
  assert.deepEqual([shown.season, shown.unreadable], [null, 1]);

  const readable = { ...SEASON_2026, version: 1 };
  deliver("seasons/2026", readable);
  assert.deepEqual([shown.season, shown.unreadable], [readable, 1]);
});

test("the store's status is handed on as it changes", async () => {
  const { reader, shown, deliver } = startReader({
    "live/current": { season: 2026 },
    "seasons/2026": SEASON_2026,
    "live/status": { error: "" },
  });
  await reader.loadCurrentSeason();
  await settle();

  deliver("live/status", { error: "upstream_error" });

  assert.deepEqual(shown.status, { error: "upstream_error" });
});

test("a load the store can't answer fails, and loading again reads the current season again", async () => {
  const documents = { "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 };
  const unreadable = ["live/current"];
  const { reader, shown } = startReader(documents, { unreadable });

  await assert.rejects(reader.loadCurrentSeason(), /unreadable/);
  unreadable.length = 0;
  await reader.loadCurrentSeason();

  assert.deepEqual([shown.year, shown.season], [2026, SEASON_2026]);
});
