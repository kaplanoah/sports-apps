import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { session } from "../page/js/session.js";
import { listFreshUpdates, listPlayoffWins } from "../page/js/updates.js";
import { refuseAccess, useSavedStorage, useStorage } from "../../../tests/saved-storage.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: Date.parse(AFTERNOON.now) });

/** @param {{ text: { text: string } }} update */
const readText = (update) => update.text.text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

/** @param {any} season */
const readWins = (season) => listPlayoffWins(season).map(readText);

/** @param {any} season */
function readFreshWins(season) {
  session.season = season;
  return listFreshUpdates().map(readText);
}

const TUESDAY_WINS = [
  "Liberty beat the Lynx 87-71 to win the First Round 2-0",
  "Fever beat the Aces 99-89 in Game 2, tie the First Round 1-1",
];

test("each finished playoff game is an update, newest first, with where its series stood after it", () => {
  assert.deepEqual(readWins(SEASON), [
    "Liberty beat the Lynx 87-71 to win the First Round 2-0",
    "Fever beat the Aces 99-89 in Game 2, tie the First Round 1-1",
    "Valkyries beat the Wings 104-80 in Game 1, lead the First Round 1-0",
    "Dream beat the Mystics 92-77 in Game 1, lead the First Round 1-0",
    "Aces beat the Fever 102-85 in Game 1, lead the First Round 1-0",
    "Liberty beat the Lynx 91-75 in Game 1, lead the First Round 1-0",
  ]);
});

test("a game goes by when the Worker found it final, or by its start when it wasn't seen live", () => {
  const isFeverGame1 = (game) => game.home.team === "LVA" && game.away.team === "IND";
  const games = SEASON.games.map((game) =>
    isFeverGame1(game) && game.number === 1 ? { ...game, end: "2026-10-01T03:00:00Z" } : game,
  );
  const [newest] = listPlayoffWins({ ...SEASON, games });

  assert.equal(newest.at, Date.parse("2026-10-01T03:00:00Z"));
  assert.match(readText(newest), /^Aces beat the Fever 102-85 in Game/);
});

test("each update's winner and loser open their teams' sheets", () => {
  const texts = listPlayoffWins(SEASON).map((win) => win.text.text);
  const teams = texts.map((text) =>
    [...text.matchAll(/<b><button type="button" class="team-open" data-team="(\w+)"/g)].map(
      ([, team]) => team,
    ),
  );
  assert.ok(teams.length > 0);
  for (const pair of teams) assert.equal(new Set(pair).size, 2);
  assert.match(
    texts.find((text, index) => teams[index][0] === "LVA"),
    /Las Vegas Aces">Aces</,
  );
});

test("each update opens its game's sheet, named for a screen reader", () => {
  const [newest] = listPlayoffWins(SEASON);
  const game = SEASON.games.find(
    (each) => each.away.team === "MIN" && each.home.team === "NYL" && each.number === 2,
  );

  assert.equal(
    newest.action && newest.action.text,
    `<button type="button" class="game-open" aria-label="Game details: Lynx at Liberty, First Round Game 2" data-game="${game?.id}"></button>`,
  );
});

test("a team down in a longer series trails it after a win, and games still to finish aren't news", () => {
  const semis = (number, away, home, state = "final") => ({
    id: `10426002${number}`,
    round: 2,
    series: "2-0",
    number,
    start: `2026-10-0${number}T23:00:00Z`,
    state,
    away: { team: "NYL", score: away },
    home: { team: "ATL", score: home },
  });
  const games = [semis(1, 70, 80), semis(2, 75, 81), semis(3, 90, 84), semis(4, 40, 38, "live")];

  assert.deepEqual(readWins({ games }), [
    "Liberty beat the Dream 90-84 in Game 3, trail the Semifinals 1-2",
    "Dream beat the Liberty 81-75 in Game 2, lead the Semifinals 2-0",
    "Dream beat the Liberty 80-70 in Game 1, lead the Semifinals 1-0",
  ]);
});

const THROUGH_SUNDAY = {
  ...SEASON,
  games: SEASON.games.filter((game) => Date.parse(game.start) < Date.parse("2026-09-29")),
};

test("a device's first look lists none of the finals already out", () => {
  useSavedStorage(new Map());

  assert.deepEqual(readFreshWins(SEASON), []);
});

test("a device keeps its first look's start, so every final after it shows until it's dismissed", () => {
  useSavedStorage(new Map());

  assert.deepEqual(readFreshWins(THROUGH_SUNDAY), []);
  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a game live at a device's first look shows once it's final, though its last play came before that look", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-02T12:00:00Z") });
  useSavedStorage(new Map());
  const isLibertyGame2 = (game) =>
    game.away.team === "MIN" && game.home.team === "NYL" && game.number === 2;
  const libertyLive = {
    ...SEASON,
    games: SEASON.games.map((game) =>
      isLibertyGame2(game) ? { ...game, state: "live", end: undefined } : game,
    ),
  };

  assert.deepEqual(readFreshWins(libertyLive), []);
  assert.deepEqual(readFreshWins(SEASON), [TUESDAY_WINS[0]]);
});

test("a device's first look before any playoff final lists every final after it", () => {
  useSavedStorage(new Map());

  assert.deepEqual(readFreshWins({ ...SEASON, games: [] }), []);
  assert.deepEqual(readFreshWins(THROUGH_SUNDAY).length, 4);
});

test("a device's first look before the page has read the season keeps no start", () => {
  const saved = new Map();
  useSavedStorage(saved);

  assert.deepEqual(readFreshWins(null), []);
  assert.equal(saved.has("updatesSeenAt"), false);
});

test("after a dismissal the box lists only the finals since", () => {
  useSavedStorage(new Map([["updatesSeenAt", String(Date.parse("2026-09-28T01:00:00Z"))]]));

  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a device whose storage refuses access keeps its first look's start while the page is open", () => {
  useStorage({ getItem: refuseAccess, setItem: refuseAccess });

  assert.deepEqual(readFreshWins(THROUGH_SUNDAY), []);
  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a final names the viewer's day it started on, and says when it ended past midnight", () =>
  checkInTimeZone(EASTERN, () => {
    const isFeverGame2 = (game) =>
      game.number === 2 && [game.away.team, game.home.team].includes("IND");
    const feverGame2 = SEASON.games.find(isFeverGame2);
    const startDay = new Date(feverGame2.start).toDateString();
    const games = SEASON.games.map((game) =>
      game === feverGame2 ? { ...game, end: "2026-09-30T04:30:00Z" } : game,
    );
    const win = listPlayoffWins({ ...SEASON, games }).find(
      (candidate) => candidate.at === Date.parse("2026-09-30T04:30:00Z"),
    );

    assert.equal(win?.day?.toDateString(), startDay);
    assert.notEqual(new Date(win.at).toDateString(), startDay);
    assert.equal(win.endedNextDay, true);
    assert.equal(
      listPlayoffWins(SEASON).some((other) => other.endedNextDay),
      false,
    );
  }));
