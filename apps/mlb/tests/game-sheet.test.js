import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBoxScore } from "../page/js/box-score-view.js";
import { isEarlierBoxScore, renderGameBody, renderWhen, titleGame } from "../page/js/game-sheet.js";
import { listSides, renderMatchupBody } from "../page/js/matchup.js";
import { session } from "../page/js/session.js";
import { buildSnapshot } from "../worker/src/adapters/mlb.js";
import { convertToText } from "#shared/html.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";

useTimeZone(EASTERN);

const BROADCASTS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-broadcasts.json`, "utf8"),
);
// MLB's live feed for each of the Division Series' games on the evening of Oct 7.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-games.json`, "utf8"),
);
const { slate } = buildSnapshot(BROADCASTS.responses, {
  season: BROADCASTS.season,
  now: Date.parse(BROADCASTS.now),
});

/** @param {(game: any) => boolean} isWanted */
function renderSlateGame(isWanted) {
  const game = { ...[...slate.today.games, ...slate.previous].find(isWanted), today: true };
  return String(renderGameBody(game, listSides(game)));
}

test("a game still to come shows where to watch it, between its row and its starters", () => {
  const markup = renderSlateGame((game) => game.away === "MIL" && game.home === "SD");
  const where = markup.indexOf('aria-label="Where to watch"');
  assert.ok(markup.indexOf("game-row") < where && where < markup.indexOf("starters-open"));
  assert.match(markup, /alt="FS1"/);
  assert.match(markup, /alt="FOX One"/);
});

test("a live game still shows where it's on", () => {
  const markup = renderSlateGame((game) => game.away === "CLE" && game.state === "live");
  assert.match(markup, /aria-label="Where to watch"/);
  assert.match(markup, /<span class="network-name">TruTV<\/span>/);
});

test("a game that has ended no longer says where it was on", () => {
  const markup = renderSlateGame((game) => game.state === "final");
  assert.doesNotMatch(markup, /class="networks/);
});

test("a game still to come with no channels listed yet says to check back", () => {
  const game = { ...slate.today.games.find((each) => each.state === "pre"), networks: undefined };
  const markup = String(renderGameBody({ ...game, today: true }, listSides(game)));
  assert.match(markup, /Check back for where to watch/);
});

test("the starters' line is named by its starters, then what it opens, for a screen reader", () => {
  const markup = renderSlateGame((game) => game.away === "MIL" && game.home === "SD");
  const button =
    markup.match(/<button type="button" class="starters-open[^]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(button, /aria-label/);
  assert.match(
    button,
    /Gasser[^]*Buehler[^]*<span class="spoken-only">, pitching matchup<\/span>\s*<\/button>$/,
  );
});

/** @param {string} id */
const describeGame = (id) => describeBoxScore(id, GAMES.feeds[id]);

/**
 * Each row of each table of a kind in markup, as its cells' text.
 * @param {string} markup
 * @param {string} tableClass
 */
function readRows(markup, tableClass) {
  const tables = markup.split(`<table class="st ${tableClass}">`).slice(1);
  return tables.map((table) =>
    [...table.split("</table>")[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
      [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) =>
        cell[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ),
  );
}

test("a box score the store kept without its pitchers' pitches shows a dash for them", () => {
  const boxScore = describeGame("849819");
  for (const pitcher of boxScore.away.pitchers) delete pitcher.pitches;
  const markup = String(renderBoxScore({ away: "LAD", home: "ATL" }, boxScore));
  const [, pitchers] = readRows(markup, "box-table");
  assert.deepEqual(pitchers[1], ["Yamamoto W", "7", "-", "4", "1", "1", "1", "10"]);
});

test("a pitcher's innings read as the rest of the app writes them, in thirds", () => {
  const boxScore = describeGame("849819");
  boxScore.away.pitchers[0].inningsPitched = "5.2";
  const markup = String(renderBoxScore({ away: "LAD", home: "ATL" }, boxScore));
  const [, pitchers] = readRows(markup, "box-table");
  assert.equal(pitchers[1][1], "5 2/3");
});

test("a club's total shows a dash where a batter has none of a number, as his own row does", () => {
  const boxScore = describeGame("849819");
  delete boxScore.away.batters[0].walks;
  const markup = String(renderBoxScore({ away: "LAD", home: "ATL" }, boxScore));
  const [batters] = readRows(markup, "box-table");
  assert.deepEqual(batters[1], ["Betts SS", "5", "0", "2", "0", "-", "1"]);
  assert.deepEqual(batters.at(-1), ["Team", "36", "3", "8", "3", "-", "12"]);
});

test("a final's Innings show each club's runs in each, an x where the home club never batted, and its runs, hits, and errors", () => {
  const markup = String(renderBoxScore({ away: "MIL", home: "SD" }, describeGame("849826")));
  assert.deepEqual(readRows(markup, "line-score")[0], [
    ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "R", "H", "E"],
    ["MIL", "0", "0", "0", "1", "1", "0", "1", "0", "0", "3", "11", "1"],
    ["SD", "0", "0", "2", "0", "1", "1", "0", "0", "x", "4", "6", "0"],
  ]);
});

test("a game being played leaves the half innings still to come blank", () => {
  const markup = String(renderBoxScore({ away: "CLE", home: "CWS" }, describeGame("849833")));
  assert.deepEqual(readRows(markup, "line-score")[0][2], [
    "CWS",
    "1",
    "0",
    "0",
    "1",
    "0",
    "1",
    "0",
    "",
    "",
    "3",
    "6",
    "0",
  ]);
});

test("each club's batters, with their team's totals, come before its pitchers, with each one's decision", () => {
  const markup = String(renderBoxScore({ away: "LAD", home: "ATL" }, describeGame("849819")));
  const [batters, pitchers] = readRows(markup, "box-table");
  assert.deepEqual(batters[0], ["Batters", "AB", "R", "H", "RBI", "BB", "K"]);
  assert.deepEqual(batters[1], ["Betts SS", "5", "0", "2", "0", "0", "1"]);
  assert.deepEqual(batters.at(-1), ["Team", "36", "3", "8", "3", "2", "12"]);
  assert.deepEqual(pitchers[0], ["Pitchers", "IP", "P", "H", "R", "ER", "BB", "K"]);
  assert.deepEqual(pitchers[1], ["Yamamoto W", "7", "98", "4", "1", "1", "1", "10"]);
  assert.deepEqual(pitchers.map((row) => row[0]).slice(1), ["Yamamoto W", "Scott", "Díaz S"]);
  assert.match(
    markup,
    /<tr class="box-sub">\s*<td class="team row-button-cell"><button type="button" class="player-open box-name" data-player="\d+" data-player-team="LAD" data-player-name="Muncy" data-player-number="">Muncy<\/button>/,
  );
});

test("before first pitch, each club's posted lineup shows its batters' seasons, and no innings", () => {
  const markup = String(renderBoxScore({ away: "TB", home: "NYY" }, describeGame("849838")));
  assert.doesNotMatch(markup, /line-score/);
  const lineups = readRows(markup, "box-table");
  assert.equal(lineups.length, 2);
  assert.deepEqual(lineups[0].slice(0, 2), [
    ["Batters", "AVG", "HR", "RBI"],
    ["Díaz, Y DH", ".293", "22", "85"],
  ]);
  assert.equal((markup.match(/<span>Lineup<\/span>/g) ?? []).length, 2);
});
test("a game whose clubs haven't posted their lineups shows nothing below its starters", () => {
  const game = { ...slate.next.find((each) => each.id === "849832"), today: false };
  const markup = String(renderGameBody(game, listSides(game), describeGame("849832")));
  assert.doesNotMatch(markup, /sheet-part/);
});

test("the box score follows the game's row and its starters", () => {
  const game = {
    ...slate.today.games.find((each) => each.id === "849838"),
    date: slate.today.date,
    today: true,
  };
  const markup = String(renderGameBody(game, listSides(game), describeGame("849838")));
  assert.ok(markup.indexOf("starters-open") < markup.indexOf("Lineup"));
});

test("a box score from before the one shown is passed over, and one from after it, or the same, is taken", () => {
  const live = describeGame("849822");
  const later = structuredClone(live);
  later.away.batters[0].atBats += 1;
  const final = { ...structuredClone(later), state: "final" };
  const lineups = describeGame("849838");

  assert.equal(isEarlierBoxScore(live, later), true);
  assert.equal(isEarlierBoxScore(later, final), true);
  assert.equal(isEarlierBoxScore(lineups, live), true);
  assert.equal(isEarlierBoxScore(later, live), false);
  assert.equal(isEarlierBoxScore(live, live), false);
  assert.equal(isEarlierBoxScore(live, null), false);
});

test("each batter's and pitcher's name in a box score, and each batter's in a lineup, opens his sheet with his club", () => {
  const final = String(renderBoxScore({ away: "LAD", home: "ATL" }, describeGame("849819")));
  assert.match(final, /data-player="605141" data-player-team="LAD" data-player-name="Betts"/);
  const pitcher = describeGame("849819").home.pitchers[0];
  assert.match(
    final,
    new RegExp(`data-player="${pitcher.id}" data-player-team="ATL" data-player-name="Sale"`),
  );
  const lineup = String(renderBoxScore({ away: "TB", home: "NYY" }, describeGame("849838")));
  assert.match(lineup, /data-player="650490" data-player-team="TB" data-player-name="Díaz, Y"/);
});

/** @param {string} markup */
const countPlaying = (markup) => (markup.match(/data-player-playing="1"/g) ?? []).length;

test("a box score of a game under way or ended today marks every batter and pitcher in it as playing now, subs too, and one from before today or a lineup marks none", () => {
  const boxScore = describeGame("849819");
  const players = ["away", "home"].flatMap((side) => [
    ...boxScore[side].batters,
    ...boxScore[side].pitchers,
  ]);
  const clubs = { away: "LAD", home: "ATL" };

  const today = String(renderBoxScore({ ...clubs, state: "final", today: true }, boxScore));
  assert.equal(countPlaying(today), players.length);
  assert.match(today, /data-player-name="Muncy" data-player-number="" data-player-playing="1">/);
  const live = String(renderBoxScore({ ...clubs, state: "live", today: true }, boxScore));
  assert.equal(countPlaying(live), players.length);

  assert.equal(countPlaying(String(renderBoxScore({ ...clubs, state: "final" }, boxScore))), 0);
  const lineup = describeGame("849838");
  assert.equal(
    countPlaying(
      String(renderBoxScore({ away: "TB", home: "NYY", state: "pre", today: true }, lineup)),
    ),
    0,
  );
});

test("a box score kept without its players' ids names them plainly", () => {
  const boxScore = describeGame("849819");
  for (const side of ["away", "home"])
    for (const player of [...boxScore[side].batters, ...boxScore[side].pitchers]) delete player.id;
  const markup = String(renderBoxScore({ away: "LAD", home: "ATL" }, boxScore));
  assert.doesNotMatch(markup, /player-open/);
  assert.match(markup, /<span class="box-name">Betts<\/span>/);
});

test("each named starter's name in the matchup opens his sheet with his club", () => {
  const game = { ...slate.today.games.find((each) => each.starters?.[0]?.id), today: true };
  const sides = listSides(game);
  const markup = String(renderMatchupBody(game, sides, () => null));
  for (const side of sides.filter((each) => each.starter?.id))
    assert.match(
      markup,
      new RegExp(
        `class="player-open pitcher-name" data-player="${side.starter.id}" data-player-team="${side.club}"`,
      ),
    );
});

const SEASON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-09-season.json`, "utf8"),
);

/**
 * A game of MLB's 2026 season, as the store kept it on Oct 9, by its day and visiting club.
 * @param {string} date
 * @param {string} away
 */
function findSeasonGame(date, away) {
  const snapshot = buildSnapshot(SEASON.responses, {
    season: SEASON.season,
    now: Date.parse(SEASON.now),
  });
  session.state = snapshot;
  session.schedule = Object.values(snapshot.schedule).flat();
  return session.schedule.find((game) => game.date === date && game.away === away);
}

/** @param {any} game */
function readWhen(game) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(SEASON.now) });
  try {
    return convertToText(renderWhen(game));
  } finally {
    mock.timers.reset();
  }
}

test("a postseason game's sheet is titled with its round and game, and any other with its clubs", () => {
  assert.equal(titleGame(findSeasonGame("2026-10-10", "CWS")), "ALDS Game 5");
  assert.equal(titleGame(findSeasonGame("2026-09-30", "PHI")), "NL Wild Card Series Game 2");
  assert.equal(titleGame(findSeasonGame("2026-10-11", "LAD")), "NLCS Game 1");
  assert.equal(titleGame(findSeasonGame("2026-09-27", "LAD")), "Dodgers @ Giants");
});

test("a postseason game's sheet says where its series stood at the game, then its day, and leaves the time to its row", () => {
  assert.equal(readWhen(findSeasonGame("2026-10-10", "CWS")), "Tied 2-2 \u2022 Tomorrow");
  assert.equal(
    readWhen(findSeasonGame("2026-10-08", "CLE")),
    "Guardians won to tie 2-2 \u2022 Yesterday",
  );
  assert.equal(
    readWhen(findSeasonGame("2026-09-30", "PHI")),
    "Phillies won to tie 1-1 \u2022 Wed, Sep 30",
  );
  assert.equal(
    readWhen(findSeasonGame("2026-09-30", "CWS")),
    "White Sox won the series 2-0 \u2022 Wed, Sep 30",
  );
  assert.equal(readWhen(findSeasonGame("2026-10-11", "LAD")), "Tied 0-0 \u2022 Sun, Oct 11");
  assert.equal(
    readWhen(findSeasonGame("2026-10-07", "TB")),
    "Rays won the series 3-0 \u2022 Wed, Oct 7",
  );
});

test("a regular season game's sheet says only its day under its title", () => {
  assert.equal(readWhen(findSeasonGame("2026-09-27", "LAD")), "Sun, Sep 27");
});

test("a postseason game's sheet heads its Game section with its series as it stood at the game", () => {
  const game = { ...findSeasonGame("2026-09-30", "PHI"), today: false };
  const row = String(renderGameBody(game, []));
  assert.match(row, /NL WC <span class="series-count tabular">1-1<\/span>/);
  assert.match(row, /Final\/10/);
});
