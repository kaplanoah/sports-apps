import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeferredSeason,
  loadSeason,
  loadSeasonList,
  showYear,
  startSeasonData,
} from "../page/js/season-data.js";
import { session } from "../page/js/session.js";
import { createFakeStore } from "../../../tests/fake-store.js";

const STARTING_YEARS = { activeYear: session.activeYear, currentSeason: session.currentSeason };

const settle = () => new Promise((resolve) => setImmediate(resolve));

const RECORD_2026 = {
  year: 2026,
  teams: { NYY: { league: "AL", seed: 1 } },
  series: { AL_WC1: { winsA: 1, winsB: 0 } },
  standings: { divisions: {} },
  log: [{ kind: "lock", at: "2026-09-30T00:00:00Z" }],
};

/**
 * @param {Record<string, any>} documents
 * @param {{ unreadable?: string[] }} [options]
 */
function startReading(documents, options) {
  const { store, deliver } = createFakeStore(documents, options);
  const redraws = { changes: 0, stamps: 0, currentYears: 0, unreadable: 0 };
  session.db = store;
  startSeasonData({
    showChange: () => redraws.changes++,
    showStamp: () => redraws.stamps++,
    showCurrentYear: () => redraws.currentYears++,
    showUnreadable: () => redraws.unreadable++,
  });
  return { redraws, deliver };
}

beforeEach(() => {
  Object.assign(session, {
    season: null,
    state: null,
    problem: "",
    isReordering: false,
    activeYear: 2026,
    currentSeason: 2026,
  });
});

test("the page loads the season the store says is current, and drops clubs it doesn't know", async () => {
  startReading({
    "live/current": { season: 2026 },
    "seasons/2026": { ...RECORD_2026, teams: { ...RECORD_2026.teams, "<b>": {} } },
  });

  await loadSeason();

  assert.deepEqual(session.season, RECORD_2026);
  assert.deepEqual(session.state.teams, RECORD_2026.teams);
  assert.equal(session.standings, session.season.standings);
  assert.equal(session.currentSeason, 2026);
});

test("a page whose last showing was a past season loads it again, not the current one", async () => {
  const record2025 = { ...RECORD_2026, year: 2025 };
  startReading({
    "live/current": { season: 2026 },
    "seasons/2025": record2025,
    "seasons/2026": RECORD_2026,
  });
  Object.assign(session, { activeYear: 2025, currentSeason: 2026 });

  await loadSeason();

  assert.deepEqual([session.activeYear, session.currentSeason], [2025, 2026]);
  assert.deepEqual(session.season, record2025);
});

test("a page whose last showing was the current season loads the one the store now says is current", async () => {
  const record2027 = { ...RECORD_2026, year: 2027 };
  startReading({
    "live/current": { season: 2027 },
    "seasons/2026": RECORD_2026,
    "seasons/2027": record2027,
  });

  await loadSeason();

  assert.deepEqual([session.activeYear, session.currentSeason], [2027, 2027]);
  assert.deepEqual(session.season, record2027);
});

test("an update that arrives during a drag waits for it, without a redraw", async () => {
  const { redraws, deliver } = startReading({
    "live/current": { season: 2026 },
    "seasons/2026": RECORD_2026,
  });
  await loadSeason();
  await settle();

  session.isReordering = true;
  const newEntry = { kind: "elim", team: "SEA", at: "2026-10-01T00:00:00Z" };
  deliver("seasons/2026", { ...RECORD_2026, log: [...RECORD_2026.log, newEntry] });
  assert.equal(session.season.log.length, 1);
  assert.equal(redraws.changes, 0);

  session.isReordering = false;
  applyDeferredSeason();
  assert.deepEqual(session.season.log, [...RECORD_2026.log, newEntry]);
});

test("the season's list of players, for search, redraws the page as it arrives, and nothing while the store has none", async () => {
  const { redraws, deliver } = startReading({
    "live/current": { season: 2027 },
    "seasons/2027": { ...RECORD_2026, year: 2027 },
  });
  await loadSeason();
  await settle();
  assert.equal(session.playerIndex, null);
  assert.equal(redraws.changes, 0);

  const index = {
    season: 2027,
    players: [{ id: "1", team: "NYM", number: "12", firstName: "Francisco", lastName: "Lindor" }],
  };
  deliver("player-index/2027", index);

  assert.deepEqual(session.playerIndex, index);
  assert.equal(redraws.changes, 1);
});

test("a season the store can't answer shows as an empty one, and says so", async () => {
  startReading({ "live/current": { season: 2026 } }, { unreadable: ["live/current"] });

  await loadSeason();

  assert.deepEqual(session.season, { year: 2026, teams: {}, series: {}, log: [] });
  assert.equal(session.problem, "Can't reach the page's server right now");
});

test("a first load with no last showing, while the store can't be reached, shows no season, never the clock's", async () => {
  assert.deepEqual(STARTING_YEARS, { activeYear: null, currentSeason: null });
  startReading({}, { unreadable: ["live/current"] });
  Object.assign(session, STARTING_YEARS);

  await loadSeason();

  assert.deepEqual([session.activeYear, session.currentSeason], [null, null]);
});

test("a record in a version the page doesn't read isn't shown, and the page checks for a newer release", async () => {
  const { redraws, deliver } = startReading({
    "live/current": { season: 2026 },
    "seasons/2026": { ...RECORD_2026, version: 1 },
  });
  await loadSeason();
  await settle();

  deliver("seasons/2026", { ...RECORD_2026, version: 2, log: [] });

  assert.equal(session.season.log.length, 1);
  assert.equal(redraws.unreadable, 1);
});

test("picking another season shows its record", async () => {
  const record2025 = { year: 2025, teams: {}, series: {}, log: [] };
  startReading({
    "live/current": { season: 2026 },
    "seasons/2025": record2025,
    "seasons/2026": RECORD_2026,
  });
  await loadSeason();

  await showYear(2025);

  assert.equal(session.activeYear, 2025);
  assert.deepEqual(session.season, record2025);
});

test("picking a season that can't be read puts back the season shown and says the store can't be reached", async () => {
  startReading(
    { "live/current": { season: 2026 }, "seasons/2026": RECORD_2026 },
    { unreadable: ["seasons/2025"] },
  );
  await loadSeason();

  assert.equal((await showYear(2025)).kind, "unread");

  assert.equal(session.activeYear, 2026);
  assert.deepEqual(session.season, RECORD_2026);
  assert.notEqual(session.problem, "");
});

test("a pick that can't be read after a newer pick replaced it leaves the newer one, with no problem", async () => {
  startReading(
    { "live/current": { season: 2026 }, "seasons/2026": RECORD_2026 },
    { unreadable: ["seasons/2025"] },
  );
  await loadSeason();

  const replaced = showYear(2025);
  const newer = showYear(2026);

  assert.equal((await replaced).kind, "replaced");
  assert.equal((await newer).kind, "shown");
  assert.equal(session.activeYear, 2026);
  assert.equal(session.problem, "");
});

// A season whose AL top seed swept through to win the World Series.
function buildSeasonWonBy(champion) {
  const AL = [champion, "NYY", "TOR", "SEA", "BOS", "DET"];
  const NL = ["PHI", "LAD", "MIL", "CHC", "SD", "NYM"];
  const teams = Object.fromEntries([
    ...AL.map((id, index) => [id, { league: "AL", seed: index + 1 }]),
    ...NL.map((id, index) => [id, { league: "NL", seed: index + 1 }]),
  ]);
  const won = (winsA) => ({ winsA, winsB: 0, started: true });
  const leagueSeries = (league) => ({
    [`${league}_WC1`]: won(2),
    [`${league}_WC2`]: won(2),
    [`${league}_DS1`]: won(3),
    [`${league}_DS2`]: won(3),
    [`${league}_CS`]: won(4),
  });
  return { teams, series: { ...leagueSeries("AL"), ...leagueSeries("NL"), WS: won(4) } };
}

test("the seasons the store keeps list newest first, and a club that won more than one keeps each title", async () => {
  startReading({
    "seasons/2026": { year: 2026, ...buildSeasonWonBy("CLE") },
    "seasons/2027": { year: 2027, ...buildSeasonWonBy("HOU") },
    "seasons/2028": { year: 2028, ...buildSeasonWonBy("CLE") },
  });

  const years = await loadSeasonList();

  assert.deepEqual(years, ["2028", "2027", "2026"]);
  assert.deepEqual(session.trackedTitles, { CLE: [2026, 2028], HOU: [2027] });
});
