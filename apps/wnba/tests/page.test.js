import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { renderBracket } from "../page/js/bracket-view.js";
import { renderDot } from "../page/js/clubs.js";
import { readGameDay } from "../page/js/days.js";
import {
  describeFinalInSeries,
  listSeasonDays,
  listSeasonGames,
  renderHeadline,
} from "../page/js/games-view.js";
import { renderScoreboard } from "../page/js/scoreboard.js";
import { describeSeriesStanding, isPlayoffsOver } from "../page/js/series.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeStampProblem, renderStampLines } from "../page/js/stamp.js";
import { renderStandings } from "../page/js/standings-view.js";
import { renderTeamSheet } from "../page/js/team-view.js";
import { placeOnRange } from "../../../shared/page/rank-curve.js";
import { TEAMS } from "../page/js/teams.js";
import { normalizeSpaces } from "../../../tests/text.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The afternoon's recording has no players' averages, so the next day's stand in for them.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const SEASON = buildSnapshot(
  { ...AFTERNOON.responses, players: GAMES.preview.players },
  { season: 2026, now: NOW },
);

// Each tag reads as a space, and the page's separator as a bar.
const readText = (markup) =>
  normalizeSpaces(markup.text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/\s+/g, " ")
    .trim();
const inEastern = (check) => checkInTimeZone(EASTERN, check);

/**
 * The Games list's days, with the season's own games or with its list of every game.
 * @param {object} season
 * @param {{ schedule?: { games: any[] } | null, now?: number }} [options]
 */
const listDays = (season, { schedule = null, now = NOW } = {}) =>
  listSeasonDays(season, schedule, now);

/**
 * One day of the Games list, as it reads.
 * @param {object} season
 * @param {string} day "YYYY-MM-DD"
 */
function readDay(season, day) {
  const listed = listDays(season).days.find((each) => each.day === day);
  return listed ? readText(listed.markup) : "";
}

/** @param {object} season */
const readGameMarkup = (season) =>
  listDays(season)
    .days.map(({ markup }) => markup.text)
    .join("");

/**
 * The games of each day of the Games list, by their IDs.
 * @param {ReturnType<typeof listDays>["days"]} days
 */
const listGameIds = (days) =>
  Object.fromEntries(
    days.map(({ day, markup }) => [
      day,
      [...markup.text.matchAll(/data-game="(\d+)"/g)].map(([, id]) => id),
    ]),
  );

// Every game of the season, from the whole season's schedule of the next day.
const WHOLE_SCHEDULE = {
  games: buildSnapshot(
    { ...AFTERNOON.responses, schedule: GAMES.preview.schedule },
    { season: 2026, now: NOW },
  ).schedule,
};

function replaceGame(season, id, changes) {
  return {
    ...season,
    games: season.games.map((game) => (game.id === id ? { ...game, ...changes } : game)),
  };
}

/**
 * The season with only the games that pass `isKept`, among its own and each team's nearest.
 * @param {any} season
 * @param {(game: any) => boolean} isKept
 */
const keepGames = (season, isKept) => ({
  ...season,
  games: season.games.filter(isKept),
  nearestGames: season.nearestGames.filter(isKept),
});

// Tonight's Dream and Mystics game, under way in the fourth.
const LIVE_TONIGHT = replaceGame(SEASON, "1042600132", {
  state: "live",
  status: "Q4 3:48",
  period: 4,
  clock: "3:48",
  away: { team: "ATL", seed: 4, score: 71, seriesWins: 1, isInBonus: false, timeouts: 2 },
  home: { team: "WAS", seed: 5, score: 68, seriesWins: 0, isInBonus: true, timeouts: 1 },
});

test("a team's dot shows its logo's colors, top then bottom, with a lighter half given less room", () => {
  assert.match(renderDot("WAS").text, /--color:#002b5c;--color2:#e03a3e;--split:51%/);
  assert.match(renderDot("IND").text, /--color:#20305d;--color2:#fad412;--split:52%/);
  assert.match(renderDot("NYL").text, /--color:#87d5b5;--color2:#100f0d;--split:48%/);
  assert.match(renderDot("PHX").text, /--color:#fa4b0a;--color2:#3c286e;--split:50%/);
});

test("a series reads as who leads, a tie, or who won it", () => {
  const [liberty, valkyries, aces] = SEASON.series;
  assert.equal(describeSeriesStanding(liberty), "Liberty win 2-0");
  assert.equal(describeSeriesStanding(valkyries), "Valkyries lead 1-0");
  assert.equal(describeSeriesStanding(aces), "Tied 1-1");
  assert.equal(describeSeriesStanding(SEASON.series.find((series) => series.id === "2-1")), "");
});

test("the playoffs are over only once the Finals has a winner", () => {
  const finals = SEASON.series.find((series) => series.round === 3);
  const withFinals = (winner) =>
    SEASON.series.map((series) => (series === finals ? { ...series, winner } : series));

  assert.equal(isPlayoffsOver(SEASON.series), false);
  assert.equal(isPlayoffsOver(withFinals("NYL")), true);
  assert.equal(isPlayoffsOver(SEASON.series.filter((series) => series.round < 3)), false);
});

test("a final reads as how its winner left the series: ahead, level, behind, or through", () => {
  const readFinal = (id) =>
    describeFinalInSeries(
      SEASON.games.find((game) => game.id === id),
      SEASON.games,
    );
  assert.equal(readFinal("1042600101"), "Liberty won to lead 1-0");
  assert.equal(readFinal("1042600122"), "Fever won to tie 1-1");
  assert.equal(readFinal("1042600102"), "Liberty won the series 2-0");
});

test("a final's series reads the same from the Games list's copy of the game, merged over the schedule's", () => {
  const { games } = WHOLE_SCHEDULE;
  const copy = listSeasonGames(SEASON, { games }).find((game) => game.id === "1042600122");
  assert.equal(describeFinalInSeries(copy, SEASON.games), "Fever won to tie 1-1");
});

test("the Games list runs day by day from the season's first game to its last, each day's games in order, and opens on today", () =>
  inEastern(() => {
    const { days, today, startDay } = listDays(SEASON);
    assert.equal(today, "2026-09-30");
    assert.equal(startDay, "2026-09-30");
    const ids = listGameIds(days);
    assert.deepEqual(Object.keys(ids).slice(0, 4), [
      "2026-09-27",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    assert.deepEqual(Object.keys(ids), [...Object.keys(ids)].sort());
    assert.deepEqual(ids["2026-09-30"], ["1042600132", "1042600112"]);
    assert.deepEqual(ids["2026-09-29"], ["1042600122", "1042600102"]);
    assert.deepEqual(ids["2026-09-27"], ["1042600101", "1042600121", "1042600131", "1042600111"]);
    assert.equal(ids["2026-10-01"][0], "1042600123");
  }));

test("the Games list takes every game of the season from the store's list of them, with the season's own copy of a game over it", () =>
  inEastern(() => {
    const { days } = listDays(LIVE_TONIGHT, { schedule: WHOLE_SCHEDULE });
    const ids = listGameIds(days);
    assert.ok(days[0].day < "2026-06-01");
    assert.ok(days.length > 100);
    assert.equal(Object.values(ids).flat().length, new Set(Object.values(ids).flat()).size);
    const today = readText(days.find(({ day }) => day === "2026-09-30").markup);
    assert.match(today, /^Sep 30 Wed 4 Dream 1st Rd 1-0 71 68 Q4 3:48 5 Mystics /);
  }));

test("a Finals game before either team is known lists as its number between two to-be-decided sides", () =>
  inEastern(() => {
    const { days } = listDays(SEASON, { schedule: WHOLE_SCHEDULE });
    assert.match(readText(days.at(-1).markup), /^\w+ \d+ \w+ TBD Finals G\d+ .* TBD$/);
  }));

test("a game without a set time falls on the league's day, even out west", () => {
  const tbd = SEASON.games.find((game) => game.id === "1042600201");
  const readDay = () => {
    const day = readGameDay(tbd);
    return [day.getMonth() + 1, day.getDate()];
  };
  assert.deepEqual(checkInTimeZone("America/Los_Angeles", readDay), [10, 4]);
});

test("a live game shows its clock and who's in the bonus", () =>
  inEastern(() => {
    const text = readDay(LIVE_TONIGHT, "2026-09-30");
    assert.match(text, /^Sep 30 Wed 4 Dream 1st Rd 1-0 71 68 Q4 3:48 5 Mystics Bonus 2 Valkyries /);
  }));

test("a game still under way past midnight stays on the day it began, which the list opens on", () =>
  inEastern(() => {
    const afterMidnight = Date.parse("2026-10-01T04:30:00Z");
    const { today, startDay } = listDays(LIVE_TONIGHT, { now: afterMidnight });
    assert.equal(today, "2026-10-01");
    assert.equal(startDay, "2026-09-30");
    assert.equal(listDays(SEASON, { now: afterMidnight }).startDay, "2026-10-01");
  }));

test("a final dims the loser, and a game not yet played shows its start in the viewer's time", () =>
  inEastern(() => {
    assert.match(
      readGameMarkup(SEASON),
      /data-game="1042600102">\s*<span class="game-side away lost">/,
    );
    assert.match(readDay(SEASON, "2026-09-30"), /^Sep 30 Wed 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics/);
    const western = checkInTimeZone("America/Los_Angeles", () => readDay(SEASON, "2026-09-30"));
    assert.match(western, /^Sep 30 Wed 4 Dream 1st Rd 1-0 4:00 PM 5 Mystics/);
  }));

test("a date without games a tap brings into the list says so beside its date, named as the list names a day", () =>
  inEastern(() => {
    const { renderQuietDay } = listDays(SEASON);
    assert.equal(readText(renderQuietDay("2026-09-28")), "Sep 28 Mon No games");
    assert.equal(readText(renderQuietDay("2026-10-01")), "Oct 1 Tmrw No games");
    assert.match(renderQuietDay("2026-09-28").text, /class="game-day no-games quiet-day"/);
  }));

test("the All-Star Game's row names it, and shows each team's name beside its star, the visitors' orange and the home team's white, and opens nothing", () =>
  inEastern(() => {
    const whole = buildSnapshot(
      { ...AFTERNOON.responses, schedule: GAMES.preview.schedule, players: GAMES.preview.players },
      { season: 2026, now: NOW },
    );
    const { days } = listDays(whole, { schedule: { games: whole.schedule } });
    const { markup } = days.find(({ day }) => day === "2026-07-25") ?? {};
    assert.match(readText(markup), /^Jul 25 Sat Spoon All-Star Game 129 122 Final Coop$/);
    assert.match(
      markup.text,
      /class="game-side away"><span class="club"><svg class="all-star-mark"[^>]*--all-star-color: #ee6730/,
    );
    assert.match(
      markup.text,
      /class="game-side home lost"><span class="club"><svg class="all-star-mark"[^>]*--all-star-color: #ffffff/,
    );
    assert.doesNotMatch(markup.text, /class="game-open"|class="dot/);
  }));

test("a game the league plays away from its home team's arena names the city in its label, and one at home names nothing", () =>
  inEastern(() => {
    const arena = { name: "Rogers Arena", city: "Vancouver", state: "BC" };
    const readJune11 = (/** @type {object} */ changes) => {
      const games = WHOLE_SCHEDULE.games.map((game) =>
        game.id === "1022600092" ? { ...game, arena, ...changes } : game,
      );
      const { days } = listDays(SEASON, { schedule: { games } });
      return readText(days.find(({ day }) => day === "2026-06-11")?.markup);
    };
    assert.match(readJune11({ isNeutral: true }), /In Vancouver/);
    assert.doesNotMatch(readJune11({}), /In Vancouver/);
  }));

test("on a day without games inside the season, the list says so at today's place and opens on it", () =>
  inEastern(() => {
    const TODAYS = ["1042600132", "1042600112"];
    const dayOff = keepGames(SEASON, (game) => !TODAYS.includes(game.id));
    const { days, startDay } = listDays(dayOff);
    const keys = days.map(({ day }) => day);
    assert.equal(keys.indexOf("2026-09-30"), keys.indexOf("2026-09-29") + 1);
    assert.equal(readDay(dayOff, "2026-09-30"), "Sep 30 Wed No games today");
    assert.equal(startDay, "2026-09-30");
    assert.match(
      days[keys.indexOf("2026-09-30")].markup.text,
      /class="game-day no-games is-today"/,
    );
  }));

test("a list over before today opens on its last day, one not begun on its first, and neither says there are no games today", () =>
  inEastern(() => {
    const onlyResults = keepGames(SEASON, (game) => game.state === "final");
    const over = listDays(onlyResults);
    assert.equal(over.startDay, "2026-09-29");
    assert.equal(over.days.at(-1).day, "2026-09-29");
    assert.doesNotMatch(readGameMarkup(onlyResults), /No games today/);
    const notBegun = listDays(SEASON, { now: Date.parse("2026-09-20T16:00:00Z") });
    assert.equal(notBegun.startDay, "2026-09-27");
    assert.ok(notBegun.days.every(({ markup }) => !/No games today/.test(markup.text)));
  }));

test("a game a finished series no longer needs is left off, and a season without games says so", () =>
  inEastern(() => {
    const game3 = {
      ...SEASON.games.find((game) => game.id === "1042600102"),
      id: "1042600103",
      number: 3,
      state: "pre",
      isIfNeeded: true,
      start: "2026-10-02T23:00:00Z",
    };
    const season = { ...SEASON, games: [...SEASON.games, game3] };
    assert.doesNotMatch(readGameMarkup(season), /1042600103/);
    const empty = listDays({ games: [] });
    assert.deepEqual(empty.days, []);
    assert.equal(empty.emptyNote, "No games scheduled yet");
  }));

test("the bracket and standings say in a short note when they have nothing yet", () => {
  assert.equal(
    readText(renderBracket(null, NOW)),
    "The bracket fills in once the playoff field is set",
  );
  assert.equal(readText(renderStandings(null)), "No standings yet");
});

test("each game's label counts its series as it stood at tip-off, or after the game once it's final", () =>
  inEastern(() => {
    assert.match(
      readDay(SEASON, "2026-09-30"),
      /^Sep 30 Wed 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics /,
    );
    assert.match(readDay(SEASON, "2026-09-27"), / 8 Liberty 1st Rd 1-0 91 75 Final 1 Lynx /);
    assert.match(readDay(SEASON, "2026-09-29"), / 1 Lynx 1st Rd 0-2 71 87 Final 8 Liberty$/);
    const labels = [...readGameMarkup(SEASON).matchAll(/class="series-label( decided)?"/g)];
    assert.deepEqual(
      labels.filter(([, decided]) => decided).length,
      1,
      "only the game that ended a series marks it decided",
    );
  }));

/**
 * Each day's heading in the Games list, as it reads, or as a screen reader names it.
 * @param {object} season
 * @param {RegExp} pattern
 */
const readDayLabels = (season, pattern = /<h3 class="day-label"[^>]*>([\s\S]*?)<\/h3>/g) =>
  [...readGameMarkup(season).matchAll(pattern)].map(([, label]) => readText({ text: label }));

test("each day's games share a box beside its date, named for yesterday, tomorrow, or its weekday, today's marked", () =>
  inEastern(() => {
    const { days } = listDays(SEASON);
    assert.ok(
      days.every(({ markup }) => markup.text.match(/<section class="game-day/g).length === 1),
    );
    assert.deepEqual(readDayLabels(SEASON).slice(0, 6), [
      "Sep 27 Sun",
      "Sep 29 Yest",
      "Sep 30 Wed",
      "Oct 1 Tmrw",
      "Oct 2 Fri",
      "Oct 4 Sun",
    ]);
    const today = days.find(({ day }) => day === "2026-09-30");
    assert.match(today.markup.text, /<section class="game-day is-today" style="--games: 2">/);
    assert.equal(readGameMarkup(SEASON).match(/is-today/g).length, 1);
  }));

test("a day's date reads in full to a screen reader, and every day's name looks alike", () =>
  inEastern(() => {
    assert.deepEqual(
      readDayLabels(SEASON, /<h3 class="day-label" aria-label="([^"]*)"/g).slice(0, 5),
      [
        "Sunday, Sep 27",
        "Yesterday, Sep 29",
        "Wednesday, Sep 30",
        "Tomorrow, Oct 1",
        "Friday, Oct 2",
      ],
    );
    const classes = [...readGameMarkup(SEASON).matchAll(/<span class="(day-name[^"]*)">/g)].map(
      ([, name]) => name,
    );
    assert.deepEqual(new Set(classes), new Set(["day-name"]));
  }));

test("a game whose teams aren't both known yet names its number instead of a series count", () =>
  inEastern(() => {
    const text = readText({ text: readGameMarkup(SEASON) });
    assert.match(text, / 8 Liberty Semis G1 TBD TBD /);
    assert.match(text, / TBD Semis G3 TBD 8 Liberty /);
  }));

test("a game that may not be needed says so under its time", () =>
  inEastern(() => {
    assert.match(
      readGameMarkup(SEASON),
      /<span class="time tabular">TBD<\/span><\/span\s*><span class="game-status"><span class="if-needed">If needed<\/span><\/span>/,
    );
  }));

test("the bracket pairs each semifinal with the first-round series that feed it", () =>
  inEastern(() => {
    const markup = renderBracket(SEASON, NOW).text;
    const order = [...markup.matchAll(/data-series="([\d-]+)"/g)].map((match) => match[1]);
    assert.deepEqual(order, ["1-0", "1-3", "1-1", "1-2", "2-0", "2-1", "3-0"]);
    const text = readText(renderBracket(SEASON, NOW));
    assert.match(
      text,
      /^First Round Best of 3 Semifinals Best of 5 WNBA Finals Best of 7 1 seed Lynx 0 8 seed Liberty 2 4 seed Dream 1 5 seed Mystics 0 Next game today at 7:00 PM 2 seed Valkyries 1 7 seed Wings 0 /,
    );
    assert.match(
      text,
      / 6 seed Fever 1 Next game tomorrow at 9:00 PM Liberty 0 TBD Next game TBD TBD TBD Next game TBD TBD TBD Next game TBD$/,
    );
    assert.match(markup, /class="team-line out"[\s\S]*?Lynx/);
  }));

test("every series still to finish has a note under its card, which leaves out the game's number", () =>
  inEastern(() => {
    const markup = renderBracket(SEASON, NOW).text;
    const notes = [
      ...markup.matchAll(/data-series="([\d-]+)"(?:(?!data-series)[\s\S])*?class="card-note"/g),
    ];
    assert.deepEqual(
      notes.map((note) => note[1]),
      ["1-3", "1-1", "1-2", "2-0", "2-1", "3-0"],
    );
    assert.doesNotMatch(markup, /Game \d|win 2-0|Waits on|Starts after/);
  }));

test("a series still waiting on a team says its next game is TBD", () =>
  inEastern(() => {
    const text = readText(renderBracket(SEASON, NOW));
    assert.match(text, / Liberty 0 TBD Next game TBD /);
    assert.match(readText(renderBracket(finishFirstRound(), NOW)), / TBD TBD Next game TBD$/);
  }));

test("a next game without a set time says its time is TBD, and without a day says only TBD", () =>
  inEastern(() => {
    const nextId = SEASON.series.find((series) => series.id === "1-3")?.nextGame?.id;
    const untimed = replaceGame(SEASON, nextId, { isTimeSet: false });
    assert.match(readText(renderBracket(untimed, NOW)), /Mystics 0 Next game today, time TBD /);
    const undated = replaceGame(SEASON, nextId, { isTimeSet: false, start: null });
    assert.match(readText(renderBracket(undated, NOW)), /Mystics 0 Next game TBD /);
  }));

test("a series with a game under way says its score, top team first, and where the game is", () =>
  inEastern(() => {
    const text = readText(renderBracket(LIVE_TONIGHT, NOW));
    assert.match(text, /4 seed Dream 1 5 seed Mystics 0 71-68 with 3:48 in Q4 /);
    assert.match(renderBracket(LIVE_TONIGHT, NOW).text, /class="card-note live"/);
    const dreamAtHome = replaceGame(LIVE_TONIGHT, "1042600132", {
      away: { team: "WAS", seed: 5, score: 68, seriesWins: 0, isInBonus: false, timeouts: 1 },
      home: { team: "ATL", seed: 4, score: 71, seriesWins: 1, isInBonus: true, timeouts: 2 },
    });
    assert.match(readText(renderBracket(dreamAtHome, NOW)), /Mystics 0 71-68 with 3:48 in Q4 /);
  }));

test("a live game's note says where the game is in overtime, at halftime, and after a quarter", () =>
  inEastern(() => {
    const readNote = (changes) =>
      readText(renderBracket(replaceGame(LIVE_TONIGHT, "1042600132", changes), NOW));
    assert.match(readNote({ period: 5, clock: "2:05" }), /Mystics 0 71-68 with 2:05 in OT /);
    assert.match(readNote({ period: 4, clock: "42.3" }), /Mystics 0 71-68 with 42.3 in Q4 /);
    assert.match(
      readNote({ period: 2, clock: "0.0", status: "Half" }),
      /Mystics 0 71-68 at halftime /,
    );
    assert.match(readNote({ period: 3, clock: "0.0" }), /Mystics 0 71-68 after Q3 /);
  }));

test("a live game without its score yet still says where it is", () =>
  inEastern(() => {
    const noScores = replaceGame(LIVE_TONIGHT, "1042600132", {
      away: { team: "ATL", seed: 4, score: null, seriesWins: 1, isInBonus: false, timeouts: 2 },
      home: { team: "WAS", seed: 5, score: null, seriesWins: 0, isInBonus: false, timeouts: 1 },
    });
    assert.match(readText(renderBracket(noScores, NOW)), /Mystics 0 Live with 3:48 in Q4 /);
  }));

/**
 * The afternoon's season with every first-round series won by the side named, and the semifinals
 * set with the higher seed on top.
 */
function finishFirstRound() {
  const season = structuredClone(SEASON);
  const findSeries = (id) => season.series.find((series) => series.id === id);
  const finish = (id, side) => {
    const series = findSeries(id);
    series.winner = series[side].team;
    series[side].wins = 2;
  };
  finish("1-1", "top");
  finish("1-2", "bottom");
  finish("1-3", "top");
  const semifinal = findSeries("2-0");
  semifinal.top = { team: "ATL", seed: 4, wins: 0 };
  semifinal.bottom = { team: "NYL", seed: 8, wins: 0 };
  Object.assign(findSeries("2-1"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "IND", seed: 6, wins: 0 },
  });
  return season;
}

test("a seed is labeled only in the first round, where its team enters the bracket", () =>
  inEastern(() => {
    const text = readText(renderBracket(finishFirstRound(), NOW));
    assert.match(text, / 4 seed Dream 2 5 seed Mystics 0 /);
    assert.match(
      text,
      / Fever 2 Dream 0 Liberty 0 Next game Sun, Oct 4, time TBD Valkyries 0 Fever 0 /,
    );
  }));

test("the bracket opens on the earliest round with a series still to finish", () =>
  inEastern(() => {
    assert.match(renderBracket(SEASON, NOW).text, /data-opening-round="1"/);
    assert.match(renderBracket(finishFirstRound(), NOW).text, /data-opening-round="2"/);
  }));

// The rows of a standings table's body, each with its class and text.
const readStandingsRows = (markup) =>
  markup.text
    .split("<tbody>")[1]
    .split("<tr")
    .slice(1)
    .map((row) => ({
      className: row.match(/^ class="([^"]*)"/)?.[1] ?? "",
      text: readText({ text: `<tr${row}` }),
    }));

// The same standings before the playoff field is set.
const REGULAR_SEASON = { ...SEASON, series: [] };

test("through the regular season, the league's standings show the season, then recent form, with the playoff line above ninth", () => {
  const text = readText(renderStandings(REGULAR_SEASON));
  assert.match(
    text,
    /^Season Recent Team W-L GB L10 Strk 1 Lynx W 33-11 - 6-4 W 1 2 Valkyries W 32-12 1\.0 7-3 W 1 /,
  );
  const rows = readStandingsRows(renderStandings(REGULAR_SEASON));
  const line = rows.findIndex((row) => row.className === "playoff-line");
  assert.equal(line, 8, "eight teams above the line");
  assert.match(rows[line + 1].text, /^9 Fire W 17-27 16\.0 3-7 W 1$/);
  assert.deepEqual(
    rows.filter((row) => row.className === "below").length,
    7,
    "every team below the line is marked",
  );
});

test("a conference's standings rank its own teams, note each playoff team's league seed, and draw the line after its last one", () => {
  const text = readText(renderStandings(REGULAR_SEASON, "East"));
  assert.match(
    text,
    /Strk 1 Dream 4 seed 30-14 - 9-1 W 5 2 Mystics 5 seed 28-16 2\.0 8-2 W 4 3 Fever 6 seed /,
  );
  const rows = readStandingsRows(renderStandings(REGULAR_SEASON, "East"));
  assert.deepEqual(
    rows.map((row) => row.className),
    ["", "", "", "", "playoff-line", "below", "below", "below"],
  );
  assert.match(rows[5].text, /^5 Sky 16-28 14\.0 4-6 L 1$/, "no seed below the line");
  assert.match(readText(renderStandings(REGULAR_SEASON, "West")), /Strk 1 Lynx 1 seed 33-11 - /);
});

test("once the playoff field is set, each team's first round and where its run stands replace recent form", () => {
  const text = readText(renderStandings(SEASON));
  assert.match(text, /^Season Playoffs Team W-L GB Rd 1 Now 1 Lynx W 33-11 - L 0-2 Out /);
  assert.match(text, / Aces W 31-13 2\.0 1-1 Game 3 /, "a first round still being played");
  assert.match(text, / Liberty E 26-18 7\.0 W 2-0 Semis /);
  const rows = readStandingsRows(renderStandings(SEASON));
  assert.match(rows[9].text, /^9 Fire W 17-27 16\.0$/, "nothing for a team that missed them");
});

test("a won first round and a team still in are marked, and a team that's out shows paler", () => {
  const rows = renderStandings(SEASON).text.split("<tr").slice(1);
  const liberty = rows.find((row) => row.includes(">Liberty<"));
  const lynx = rows.find((row) => row.includes(">Lynx<"));
  assert.match(
    liberty,
    /<span class="series-won">W 2-0<\/span>[\s\S]*<span class="still-in">Semis<\/span>/,
  );
  assert.match(lynx, /<td class="tabular recent recent-start">L 0-2<\/td>/);
  assert.match(lynx, /<span class="playoff-out">Out<\/span>/);
});

test("a team's run reads the round it won its way to, even before the bracket lists it there, and Champions once it wins it all", () => {
  const firstRoundOnly = {
    ...SEASON,
    series: SEASON.series.filter((series) => series.round === 1),
  };
  assert.match(readText(renderStandings(firstRoundOnly)), / Liberty E 26-18 7\.0 W 2-0 Semis /);
  const champions = {
    ...SEASON,
    series: [
      ...SEASON.series.filter((series) => series.round < 3),
      {
        id: "3-0",
        round: 3,
        top: { team: "LVA", seed: 3, wins: 2 },
        bottom: { team: "NYL", seed: 8, wins: 4 },
        winner: "NYL",
        status: "",
        nextGame: null,
      },
    ],
  };
  assert.match(readText(renderStandings(champions)), / Liberty E 26-18 7\.0 W 2-0 Champions /);
});

test("each standings table names the view it shows", () => {
  assert.match(renderStandings(SEASON, "West").text, /aria-label="West standings"/);
});

test("a team's next game is marked with Phosphor's caret-right icon, which reading the sheet aloud skips", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  const next = body.text.match(/<div class="team-game next[^"]*">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(
    next,
    /<span class="team-result" aria-hidden="true"><svg class="next-game-icon" viewBox="0 0 256 256" fill="currentColor">\s*<path\s+d="M181\.66,133\.66l-80,80/,
  );
});

test("a winning streak is marked, so one below the line can show paler than one above it", () => {
  const rows = renderStandings(REGULAR_SEASON).text.split("<tr").slice(1);
  const fire = rows.find((row) => row.includes(">Fire<"));
  const lynx = rows.find((row) => row.includes(">Lynx<"));
  assert.match(fire, /^ class="below"[\s\S]*<span class="streak-won">W 1<\/span>/);
  assert.match(lynx, /^ class=""[\s\S]*<span class="streak-won">W 1<\/span>/);
});

/**
 * A team's sheet, as text: its heading, the line of facts under it, and its body.
 * @param {any} season
 * @param {string} code
 */
function readTeam(season, code) {
  const { heading, note, body } = renderTeamSheet(season, code, { year: 2026, now: NOW });
  return { heading: readText(heading), note: readText(note), body: readText(body) };
}

// The afternoon, with the whole season's schedule from the next day, its regular season and all.
const WHOLE_SEASON = buildSnapshot(
  { ...AFTERNOON.responses, schedule: GAMES.preview.schedule, players: GAMES.preview.players },
  { season: 2026, now: NOW },
);
const SEATTLES_LAST = WHOLE_SEASON.nearestGames.find((game) => game.id === "1022600325");

/**
 * Seattle's season with a game in Chicago tonight, as `game` has it.
 * @param {object} game
 */
function addSeattleAtChicago(game) {
  const tonight = {
    ...SEATTLES_LAST,
    id: "1022600400",
    start: "2026-09-30T23:00:00Z",
    away: { ...SEATTLES_LAST.home, score: null },
    home: { ...SEATTLES_LAST.away, team: "CHI", score: null },
    ...game,
  };
  return { ...WHOLE_SEASON, nearestGames: [...WHOLE_SEASON.nearestGames, tonight] };
}

/**
 * @param {number} own Seattle's points
 * @param {number} theirs Chicago's
 * @param {object} [clock]
 */
const playSeattleAtChicago = (own, theirs, clock = { period: 3, clock: "4:12" }) =>
  addSeattleAtChicago({
    state: "live",
    ...clock,
    away: { ...SEATTLES_LAST.home, score: own },
    home: { ...SEATTLES_LAST.away, team: "CHI", score: theirs },
  });

/** @param {object} season */
const readGameCards = (season) => readTeam(season, "SEA").body.replace(/ Regular season .*$/, "");

test("a team's sheet opens on its last game, the one it's playing, and its next, each its team's score first", () =>
  inEastern(() => {
    assert.equal(readGameCards(WHOLE_SEASON), "Last game Sep 23 L 91-103 vs Wings");
    assert.equal(
      readGameCards(playSeattleAtChicago(61, 58)),
      "Last game Sep 23 L 91-103 vs Wings Now Q3 4:12 UP 61-58 @ Sky",
    );
    assert.equal(
      readGameCards(addSeattleAtChicago({ state: "pre" })),
      "Last game Sep 23 L 91-103 vs Wings Next game Sep 30 7:00 PM @ Sky",
    );
    assert.match(readTeam(WHOLE_SEASON, "ATL").body, /^Last game Sep 27 W 92-77 vs Mystics /);
  }));

test("a game being played says whether the team is up, down, or tied, and between periods which break it's in", () =>
  inEastern(() => {
    assert.match(readGameCards(playSeattleAtChicago(58, 61)), / Now Q3 4:12 DOWN 58-61 @ Sky$/);
    assert.match(readGameCards(playSeattleAtChicago(60, 60)), / Now Q3 4:12 TIED 60-60 @ Sky$/);
    const halftime = { period: 2, clock: "0.0", status: "Half" };
    assert.match(readGameCards(playSeattleAtChicago(40, 38, halftime)), / Now Half UP 40-38 /);
  }));

test("a next game whose time isn't set says TBD", () =>
  inEastern(() => {
    const unset = addSeattleAtChicago({
      state: "pre",
      isTimeSet: false,
      start: "2026-10-02T04:00:00Z",
    });
    assert.match(readGameCards(unset), / Next game Oct 2 TBD @ Sky$/);
  }));

test("each card opens its game, and shows the other team's dot, never the team's own", () =>
  inEastern(() => {
    const { body } = renderTeamSheet(playSeattleAtChicago(61, 58), "SEA", {
      year: 2026,
      now: NOW,
    });
    const cards = body.text.slice(0, body.text.indexOf("<section"));
    const buttons = [
      ...cards.matchAll(
        /<button\s+type="button"\s+class="game-card-button"\s+data-game="(\d+)"\s+aria-label="([^"]+)"/g,
      ),
    ];
    assert.deepEqual(
      buttons.map(([, id, label]) => [id, label]),
      [
        ["1022600325", "Game details: Wings at Storm, Sep 23"],
        ["1022600400", "Game details: Storm at Sky, Sep 30"],
      ],
    );
    assert.equal([...cards.matchAll(/class="dot"/g)].length, 2);
    assert.ok(cards.includes(renderDot("DAL").text) && cards.includes(renderDot("CHI").text));
    assert.ok(!cards.includes(renderDot("SEA").text));
    assert.match(cards, /<span class="game-card-result lost">L<\/span>/);
  }));

test("a season saved before it kept each team's nearest games takes them from its playoff games", () =>
  inEastern(() => {
    const { nearestGames, ...saved } = SEASON;
    assert.ok(nearestGames.length > 0);
    assert.match(
      readTeam(saved, "ATL").body,
      /^Last game Sep 27 W 92-77 vs Mystics Next game Sep 30 7:00 PM @ Mystics Playoffs /,
    );
  }));

test("a team's sheet names it over its conference, seed, and record", () => {
  assert.deepEqual(
    [readTeam(SEASON, "MIN").heading, readTeam(SEASON, "MIN").note],
    ["Minnesota Lynx", "West | 1 seed | 33-11"],
  );
  assert.equal(readTeam(SEASON, "DAL").note, "West | 7 seed | 27-17");
  assert.equal(readTeam(SEASON, "SEA").note, "West | 8-36");
  assert.match(
    renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW }).heading.text,
    /class="dot"/,
  );
});

test("a team's Playoffs chip names its round, the same on a game day as any other", () =>
  inEastern(() => {
    assert.match(readTeam(SEASON, "ATL").body, / Playoffs 1st Rd G1 /);
    assert.match(
      renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW }).body.text,
      /<span class="status-chip alive">1st Rd<\/span>/,
    );
    assert.match(
      readTeam(ATLANTA_SEASON, "ATL").body,
      / Playoffs 1st Rd G1 .* G13 vs Mystics 1st Rd Live /,
    );
  }));

test("a team's sheet shows its nearest games, its playoffs across from the field's with its record by its name, then its regular season ranked among every team's, its leading scorers, and its titles", () =>
  inEastern(() => {
    assert.equal(
      readTeam(SEASON, "ATL").body,
      "Last game Sep 27 W 92-77 vs Mystics Next game Sep 30 7:00 PM @ Mystics " +
        "Playoffs 1st Rd G1 W vs Mystics 1st Rd 92-77 G2 at Mystics 1st Rd Today 7:00 PM " +
        "Dream 1-0 Playoff field PPG 92.0 87.7 Opp PPG 77.0 87.7 Margin +15.0 0.0 " +
        "Home 1-0 5-1 Road 0-0 1-5 " +
        "Regular season 44 games PPG 91.3 3rd of 15 Opp PPG 84.5 4th of 15 Margin +6.9 3rd of 15 " +
        "Home 15-7 3rd of 15 Road 15-7 3rd of 15 Last 10 9-1 Streak W 5 " +
        "Leading scorers Per game Player Pts Reb Ast FG% Min Allisha Gray 19.0 3.5 2.6 46.2 32.6 " +
        "Rhyne Howard 17.7 3.8 3.7 40.5 34.2 Angel Reese 16.4 12.1 2.8 45.1 31.0 " +
        "Jordin Canada 11.6 3.5 7.3 43.1 31.1 DeWanna Bonner 10.4 6.0 1.6 40.2 26.8 Titles None yet",
    );
    assert.match(
      readTeam(SEASON, "DAL").body,
      / Playoffs 1st Rd .* Titles 3 \| 2008, 2006, 2003 \(as Detroit Shock\)$/,
    );
    assert.match(
      readTeam(SEASON, "MIN").body,
      /^Last game Sep 29 L 71-87 @ Liberty Playoffs Out 1st Rd G1 L vs Liberty 1st Rd 75-91 G2 L at Liberty 1st Rd 71-87 Lynx 0-2 Playoff field .* Regular season /,
    );
    assert.match(readTeam(SEASON, "SEA").body, /^Regular season .* Playoffs Missed Titles /);
  }));

/**
 * One of Atlanta's playoff games, at home or on the road, as the snapshot has it.
 * @param {{ number: number, day: number, place: "home" | "away", own: number, theirs: number, state?: string }} game
 */
function makeAtlantaGame({ number, day, place, own, theirs, state = "final" }) {
  const side = { seriesWins: 0, isInBonus: false, timeouts: null };
  const atlanta = { ...side, team: "ATL", seed: 4, score: own };
  const washington = { ...side, team: "WAS", seed: 5, score: theirs };
  return {
    id: `10426001${String(number).padStart(2, "0")}`,
    round: 1,
    series: "1-3",
    number,
    start: `2026-09-${String(day).padStart(2, "0")}T23:00:00Z`,
    state,
    status: "",
    isTimeSet: true,
    period: null,
    clock: null,
    isIfNeeded: false,
    away: place === "away" ? atlanta : washington,
    home: place === "home" ? atlanta : washington,
    networks: [],
  };
}

// Twelve games, home on odd days: W W L W W W W W L W L L, each won 90-80 or lost 80-90.
const ATLANTA_RESULTS = [
  true,
  true,
  false,
  true,
  true,
  true,
  true,
  true,
  false,
  true,
  false,
  false,
];
const ATLANTA_GAMES = ATLANTA_RESULTS.map((isWin, index) =>
  makeAtlantaGame({
    number: index + 1,
    day: index + 1,
    place: index % 2 === 0 ? "home" : "away",
    own: isWin ? 90 : 80,
    theirs: isWin ? 80 : 90,
  }),
);
const ATLANTA_SEASON = {
  ...SEASON,
  games: [
    ...ATLANTA_GAMES,
    makeAtlantaGame({ number: 13, day: 13, place: "home", own: 60, theirs: 2, state: "live" }),
  ],
};

test("a team's playoff numbers count its finished playoff games: its record, its averages, and its records at home and on the road", () => {
  assert.match(
    readTeam(ATLANTA_SEASON, "ATL").body,
    / Dream 8-4 Playoff field PPG 86\.7 .* Opp PPG 83\.3 .* Margin \+3\.3 .* Home 3-3 .* Road 5-1 .* Regular season /,
  );
});

test("the playoff field's side counts every finished playoff game: the points each team scored a game, and how home and road teams did", () => {
  assert.match(
    readTeam(ATLANTA_SEASON, "ATL").body,
    / PPG 86\.7 85\.0 Opp PPG 83\.3 85\.0 Margin \+3\.3 0\.0 Home 3-3 4-8 Road 5-1 8-4 /,
  );
});

/**
 * Where the team's dot and the field's sit on a playoff measure's line, from 0 to 100.
 * @param {any} season
 * @param {string} code
 * @param {string} label
 */
function findPlaces(season, code, label) {
  const { body } = renderTeamSheet(season, code, { year: 2026, now: NOW });
  const row = body.text
    .split('<div class="player-rank-row">')
    .find((each) => each.includes(`>${label}</span>`) && each.includes("placed-line"));
  const readPlace = (whose) => {
    const left = row?.match(new RegExp(`<i class="${whose}" style="left: ([\\d.]+)%"`))?.[1];
    return left == null ? null : Number(left);
  };
  return { own: readPlace("own"), other: readPlace("other") };
}

test("each playoff number sits on a line across the range of every team's regular season, its better end on the right, fewer points allowed better, and a record from no wins to all", () => {
  /** @param {string} key */
  const readRange = (key) => {
    const values = SEASON.standings.map((row) => row[key]);
    return /** @type {[number, number]} */ ([Math.min(...values), Math.max(...values)]);
  };
  const points = readRange("pointsFor");
  const allowed = readRange("pointsAgainst");
  assert.deepEqual(findPlaces(ATLANTA_SEASON, "ATL", "PPG"), {
    own: placeOnRange(260 / 3, points),
    other: placeOnRange(85, points),
  });
  assert.deepEqual(findPlaces(ATLANTA_SEASON, "ATL", "Opp PPG"), {
    own: placeOnRange(250 / 3, allowed, true),
    other: placeOnRange(85, allowed, true),
  });
  assert.ok(placeOnRange(250 / 3, allowed, true) > placeOnRange(85, allowed, true));
  assert.deepEqual(findPlaces(ATLANTA_SEASON, "ATL", "Home"), { own: 50, other: 33.3 });
  assert.deepEqual(findPlaces(ATLANTA_SEASON, "ATL", "Road"), { own: 83.3, other: 66.7 });
});

test("a playoff number past the regular season's range sits at its end, and a record with no games has no dot", () => {
  assert.deepEqual(findPlaces(SEASON, "ATL", "Margin").own, 100);
  assert.deepEqual(findPlaces(SEASON, "ATL", "Road"), { own: null, other: 16.7 });
});

test("the team's dot is drawn over the field's, so the team's shows where the two meet", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  const lines = [
    ...body.text.matchAll(/<span class="placed-line" aria-hidden="true"><span>(.*?)<\/span>/g),
  ];
  assert.equal(lines.length, 5);
  for (const [, line] of lines.slice(0, 4))
    assert.match(line, /^<i class="other"[^>]*><\/i><i class="own"/);
});

test("a team's regular season ranks it among every team's, fewest points allowed first and its records by their share of games won, tied teams sharing a rank, beside how many games it played", () => {
  assert.match(
    readTeam(SEASON, "ATL").body,
    / Regular season 44 games PPG 91\.3 3rd of 15 Opp PPG 84\.5 4th of 15 Margin \+6\.9 3rd of 15 Home 15-7 3rd of 15 Road 15-7 3rd of 15 Last 10 /,
  );
  assert.match(readTeam(SEASON, "SEA").body, / Opp PPG 88\.9 10th of 15 /);
  assert.match(readTeam(SEASON, "IND").body, / PPG 96\.0 1st of 15 /);
  const curves = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW }).body.text.match(
    /<span class="player-curve"/g,
  );
  assert.equal(curves?.length, 5);
});

test("a team's record sits by its name over its numbers, not in a row of its own, since the league has none to measure it against", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  assert.deepEqual(
    [...body.text.matchAll(/<span class="team-record tabular">(.*?)<\/span>/g)].map(
      ([, record]) => record,
    ),
    ["1-0"],
  );
  assert.doesNotMatch(body.text, />Record<\/span>/);
});

test("Last 10 and Streak show only for the regular season, under its numbers and set like them, with a winning streak marked", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  assert.deepEqual(
    [...body.text.matchAll(/<span class="streak-won">(.*?)<\/span>/g)].map(([, streak]) => streak),
    ["W 5"],
  );
  assert.doesNotMatch(body.text, /class="player-rank-label">(Last 10|Streak)</);
  assert.match(
    body.text,
    /<dl class="team-form">\s*<dt class="tape-label">Last 10<\/dt><dd class="tape-value tabular">9-1<\/dd><dt class="tape-label">Streak<\/dt>/,
  );
  assert.match(readTeam(SEASON, "ATL").body, / 3rd of 15 Last 10 9-1 Streak W 5 Leading scorers /);
  assert.doesNotMatch(
    renderTeamSheet(SEASON, "SEA", { year: 2026, now: NOW }).body.text,
    /streak-won/,
  );
});

test("over its numbers, a team is named without its dot, which the sheet's title already shows", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  const heads = [...body.text.matchAll(/<div class="tape-teams">([\s\S]*?)<\/div>/g)].map(
    ([, head]) => head,
  );
  assert.equal(heads.length, 1);
  for (const head of heads) assert.doesNotMatch(head, /class="dot"/);
  assert.match(readTeam(SEASON, "ATL").body, / Dream 1-0 Playoff field /);
});

test("a team's marks on its numbers are drawn in its mark color on each theme, as a player's are", () => {
  const { body } = renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW });
  const [light, dark] = [TEAMS.ATL.markColors.light, TEAMS.ATL.markColors.dark];
  const styled = body.text.match(/class="player-ranks team-ranks" style="([^"]*)"/g) ?? [];
  assert.equal(styled.length, 2);
  for (const each of styled)
    assert.ok(each.includes(`--mark-light: ${light}; --mark-dark: ${dark};`));
});

test("a team's next game is in the round it's playing, not one left over from a round it won", () =>
  inEastern(() => {
    assert.match(
      readTeam(SEASON, "NYL").body,
      / Playoffs Semis .* G1 at TBD Semis Sun, Oct 4 Liberty 2-0 Playoff field /,
    );
  }));

test("a champion counts this season's title, and the team it beat is out in the Finals", () => {
  const finals = {
    id: "3-0",
    round: 3,
    top: { team: "DAL", seed: 7, wins: 4 },
    bottom: { team: "LVA", seed: 3, wins: 2 },
    winner: "DAL",
    status: "DAL wins 4-2",
    nextGame: null,
  };
  const season = {
    ...SEASON,
    series: [...SEASON.series.filter((series) => series.id !== "3-0"), finals],
  };
  const dallas = readTeam(season, "DAL");
  assert.match(
    dallas.body,
    / Playoffs Champions .* Titles 4 \| 2026, 2008, 2006, 2003 \(as Detroit Shock\)$/,
  );
  assert.match(readTeam(season, "LVA").body, / Playoffs Out Finals /);
});

test("before the playoffs, a team has no seed or playoff run, and its season shows what it has", () => {
  const standings = SEASON.standings.map(({ team, conference, wins, losses, place, lastTen }) => ({
    team,
    conference,
    wins,
    losses,
    place,
    lastTen,
  }));
  const minnesota = readTeam({ standings, series: [], games: [] }, "MIN");
  assert.equal(minnesota.note, "West | 33-11");
  assert.equal(
    minnesota.body,
    "Regular season 44 games Last 10 6-4 Titles 4 | 2017, 2015, 2013, 2011",
  );
});

/** @param {{ text: string }} markup */
const listTeamButtons = (markup) =>
  [...markup.text.matchAll(/<button type="button" class="[^"]*team-open" data-team="(\w+)"/g)].map(
    ([, team]) => team,
  );

test("a game's row that opens the game names its teams plainly, and a row still waiting on a team has the other open its sheet", () => {
  const markup = { text: readGameMarkup(SEASON) };
  const waiting = SEASON.games.filter((game) => !game.away.team !== !game.home.team);
  assert.ok(waiting.length > 0);
  assert.deepEqual(
    listTeamButtons(markup).sort(),
    waiting.map((game) => game.away.team || game.home.team).sort(),
  );
  assert.match(markup.text, /<span class="club tbd">/);
  assert.match(
    markup.text,
    /<span class="club"><span class="dot"[^>]*><\/span><span class="seed">3<\/span><span class="team-name">Aces<\/span><\/span>/,
  );
});

test("a team's leading scorers set their shooting and minutes apart, and a leader saved without them shows dashes", () => {
  assert.match(
    renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW }).body.text,
    /<td>2\.6<\/td>\s*<td class="quiet-stat">46\.2<\/td>\s*<td class="quiet-stat">32\.6<\/td>/,
  );
  const leaders = SEASON.leaders.map(({ minutes, fieldGoalShare, ...leader }) => leader);
  assert.match(readTeam({ ...SEASON, leaders }, "ATL").body, / Allisha Gray 19\.0 3\.5 2\.6 - - /);
});

test("a team's sheet names each opponent with a button to its own sheet", () => {
  const { body } = renderTeamSheet(SEASON, "IND", { year: 2026, now: NOW });
  const matchups = [...body.text.matchAll(/<span class="team-matchup">([\s\S]*?)<\/span>\n/g)];
  assert.ok(matchups.length > 0);
  for (const [matchup] of matchups) assert.deepEqual(listTeamButtons({ text: matchup }), ["LVA"]);
});

test("each standings row and each team in the bracket opens its team's sheet", () => {
  const rows = renderStandings(SEASON)
    .text.split("<tr")
    .filter((row) => !row.includes("playoff-line"))
    .slice(3);
  assert.deepEqual(
    rows.map((row) => row.match(/data-team="(\w+)"/)?.[1]),
    SEASON.standings.map((row) => row.team),
  );
  for (const row of rows)
    assert.match(
      row,
      /<button type="button" class="team-open" data-team="\w+" aria-label="Team details: /,
    );
  assert.match(rows[0], /aria-label="Team details: Minnesota Lynx"/);
  const bracket = renderBracket(SEASON, NOW).text;
  assert.match(
    bracket,
    /<div class="team-line[^"]*" data-team="LVA">[\s\S]*?aria-label="Team details: Las Vegas Aces"/,
  );
  assert.doesNotMatch(bracket, /class="team-line tbd" data-team/);
});

/**
 * @param {any} season
 * @param {number} now
 */
const readStampLines = (season, now) =>
  renderStampLines(season, now).map((line) => readText(line).replace(/&mdash;|\u2014/g, "-"));

/**
 * @param {any} season
 * @param {string} id
 * @param {(game: any) => void} change
 */
function changeGame(season, id, change) {
  const games = structuredClone(season.games);
  change(games.find((game) => game.id === id));
  return { ...season, games };
}

test("the header says how the latest game ended and when the next one tips off, not when the page last saved", () =>
  inEastern(() => {
    assert.deepEqual(readStampLines(SEASON, NOW), [
      "Last game Liberty 87 Lynx 71 final yesterday - Liberty won series 2-0",
      "Next tip-off 7:00 PM - Dream @ Mystics",
    ]);
    assert.match(normalizeSpaces(renderStampLines(SEASON, NOW)[0]), /final <b>yesterday<\/b>/);
    const nextMorning = Date.parse("2026-10-01T14:00:00Z");
    assert.deepEqual(readStampLines(SEASON, nextMorning), [
      "Last game Liberty 87 Lynx 71 final Tuesday - Liberty won series 2-0",
      "Next tip-off yesterday 7:00 PM - Dream @ Mystics",
    ]);
  }));

test("a game the Worker saw end says when, its time and day set apart as the next tip-off's are", () =>
  inEastern(() => {
    const ended = changeGame(SEASON, "1042600102", (game) => {
      game.end = "2026-09-30T02:41:00Z";
    });
    assert.equal(
      readStampLines(ended, NOW)[0],
      "Last game Liberty 87 Lynx 71 final at 10:41 PM yesterday - Liberty won series 2-0",
    );
    assert.match(
      normalizeSpaces(renderStampLines(ended, NOW)[0]),
      /final at <b>10:41<span class="ap">PM<\/span> yesterday<\/b>/,
    );
    const endedToday = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game, { end: "2026-09-30T19:10:00Z" });
      Object.assign(game.away, { score: 80 });
      Object.assign(game.home, { score: 70 });
    });
    assert.equal(
      readStampLines(endedToday, NOW)[0],
      "Last game Dream 80 Mystics 70 final at 3:10 PM - Dream lead series 1-0",
    );
  }));

test("a game that ended today is still the last game, without its day", () =>
  inEastern(() => {
    const atAfternoon = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game.away, { score: 80 });
      Object.assign(game.home, { score: 70 });
    });
    assert.equal(
      readStampLines(atAfternoon, NOW)[0],
      "Last game Dream 80 Mystics 70 final - Dream lead series 1-0",
    );
  }));

test("a final names its series as won, tied, or led", () =>
  inEastern(() => {
    const tiedSeries = changeGame(SEASON, "1042600123", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game.away, { score: 84 });
      Object.assign(game.home, { score: 90 });
    });
    assert.equal(
      readStampLines(tiedSeries, NOW)[0],
      "Last game Aces 90 Fever 84 final - series tied 1-1",
    );
  }));

test("while a game is on, the header gives its score and clock, and still the next tip-off", () =>
  inEastern(() => {
    const live = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27 });
    });
    assert.deepEqual(readStampLines(live, NOW), [
      "NOW Dream @ Mystics 30-27 with 5:10 in Q2",
      "Next tip-off 9:00 PM - Valkyries @ Wings",
    ]);
    const atHalf = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "Half", period: 2, clock: "0.0" });
    });
    assert.equal(readStampLines(atHalf, NOW)[0], "NOW Dream @ Mystics 30-27 at halftime");
    const afterThird = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "End of Q3", period: 3, clock: "0.0" });
    });
    assert.equal(readStampLines(afterThird, NOW)[0], "NOW Dream @ Mystics 30-27 at the end of Q3");
    const inOvertime = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "OT 1:12", period: 5, clock: "1:12" });
    });
    assert.equal(readStampLines(inOvertime, NOW)[0], "NOW Dream @ Mystics 30-27 with 1:12 in OT");
    const bothLive = changeGame(live, "1042600112", (game) => {
      Object.assign(game, { state: "live", status: "Q1 2:00", period: 1, clock: "2:00" });
      Object.assign(game.away, { score: 10 });
      Object.assign(game.home, { score: 8 });
    });
    assert.deepEqual(readStampLines(bothLive, NOW), [
      "NOW Dream @ Mystics 30-27 with 5:10 in Q2 | Valkyries @ Wings 10-8 with 2:00 in Q1",
      "Next tip-off tomorrow 9:00 PM - Fever @ Aces",
    ]);
  }));

test("a game whose time isn't set tips off on its day, and one its series no longer needs never does", () =>
  inEastern(() => {
    const finals = ["1042600132", "1042600112", "1042600123"].reduce(
      (season, id) =>
        changeGame(season, id, (game) => {
          Object.assign(game, { state: "final", status: "Final" });
          Object.assign(game.away, { score: 90 });
          Object.assign(game.home, { score: 80 });
        }),
      SEASON,
    );
    const decided = {
      ...finals,
      series: finals.series.map((series) =>
        series.id === "1-1" ? { ...series, winner: "GSV" } : series,
      ),
    };
    const lateThursday = Date.parse("2026-10-02T03:30:00Z");
    assert.equal(
      readStampLines(decided, lateThursday)[1],
      "Next tip-off tomorrow - Mystics @ Dream",
    );
  }));

test("the header names a problem with the page's server or the league's feeds", () => {
  assert.equal(
    describeStampProblem({ status: null, problem: "Can't reach the page's server right now" }),
    "Can't reach the page's server right now",
  );
  assert.equal(describeStampProblem({ status: null, problem: "" }), "");
  const status = { error: "wnba_feeds_missing", detail: "bracket, standings" };
  assert.equal(
    describeStampProblem({ status, problem: "" }),
    "The WNBA stopped sending the bracket and the standings",
  );
  const standingIn = { error: "wnba_feeds_missing", detail: "scoreboard", standIn: "espn" };
  assert.equal(
    describeStampProblem({ status: standingIn, problem: "" }),
    "The WNBA stopped sending today's scores. Scores are from ESPN for now.",
  );
});

test("a score shows in scoreboard digits, and still reads as its number", () => {
  const markup = renderScoreboard(89).text;
  assert.match(markup, /<span class="scoreboard-text">89<\/span>/);
  assert.equal(markup.match(/<svg/g).length, 3);
  assert.deepEqual(
    readLitPlaces({ text: markup }),
    [0, 7, 6],
    "an 8 lights every segment, a 9 all but one",
  );
  assert.match(renderScoreboard(68, { isLoser: true }).text, /class="scoreboard lost"/);
});

// A season's list shows hundreds of scores, so each place draws its lit segments in one shape and
// its dark ones in another.
test("each place of a score draws its segments in at most two shapes, lit and dark", () => {
  const places = renderScoreboard(106).text.split("<svg").slice(1);
  assert.deepEqual(
    places.map((place) => (place.match(/<(path|rect)\b/g) ?? []).length),
    [1, 2, 2],
  );
});

/**
 * How many segments each place of a score lights, one outline each in its lit shape.
 * @param {{ text: string }} markup
 */
const readLitPlaces = (markup) =>
  markup.text
    .split("<svg")
    .slice(1)
    .map((place) => (place.match(/class="on" d="([^"]*)"/)?.[1].match(/M/g) ?? []).length);

test("every score fills a narrow hundreds place and two digits, with the places it doesn't reach dark", () => {
  assert.match(renderScoreboard(7).text, /<svg class="hundreds"/);
  assert.equal(renderScoreboard(7).text.match(/class="hundreds"/g).length, 1);
  assert.deepEqual(readLitPlaces(renderScoreboard(7)), [0, 0, 3]);
  assert.deepEqual(readLitPlaces(renderScoreboard(89)), [0, 7, 6]);
  assert.deepEqual(readLitPlaces(renderScoreboard(100)), [2, 6, 6]);
  assert.deepEqual(readLitPlaces(renderScoreboard(108)), [2, 6, 7]);
});

test("a game's two panels hold the same places, whatever its scores", () => {
  const [game] = structuredClone(SEASON.games.filter((each) => each.state === "final"));
  Object.assign(game.away, { score: 7 });
  Object.assign(game.home, { score: 104 });
  assert.deepEqual(readLitPlaces(renderHeadline(game)), [0, 0, 3, 2, 6, 4]);
});

test("between periods the league's word for the break shows in place of the clock", () =>
  inEastern(() => {
    const running = readGameMarkup(LIVE_TONIGHT);
    assert.match(running, /<span class="clock tabular">Q4 3:48<\/span>/);
    assert.doesNotMatch(running, /class="break"/);
    const atHalf = replaceGame(LIVE_TONIGHT, "1042600132", {
      status: "Half",
      period: 2,
      clock: "0.0",
    });
    const markup = readGameMarkup(atHalf);
    assert.match(markup, /<span class="game-status"><span class="break">Half<\/span><\/span>/);
    assert.doesNotMatch(markup, /class="clock/);
  }));

test("each game's score shows in scoreboard digits, the loser's dimmed", () =>
  inEastern(() => {
    const markup = readGameMarkup(SEASON);
    assert.match(markup, /class="scoreboard lost"\s*><span class="scoreboard-text">71<\/span>/);
    assert.match(markup, /class="scoreboard"\s*><span class="scoreboard-text">87<\/span>/);
  }));

test("each appearance choice shows the home-screen icon it offers, and the page has each one", () => {
  const page = readFileSync(`${import.meta.dirname}/../page/index.html`, "utf8");
  const choices = Object.fromEntries(
    [...page.matchAll(/<label class="appearance-choice">([\s\S]*?)<\/label>/g)].map(
      ([, choice]) => [
        choice.match(/<span>([^<]+)<\/span>\s*$/)[1],
        [...choice.matchAll(/<img src="([^"]+)"/g)].map(([, source]) => source),
      ],
    ),
  );
  assert.deepEqual(choices, {
    System: ["icon-light-180.png", "icon-180.png"],
    Maple: ["icon-light-180.png"],
    Walnut: ["icon-180.png"],
  });
  for (const source of Object.values(choices).flat())
    assert.ok(existsSync(`${import.meta.dirname}/../page/${source}`), source);
});
