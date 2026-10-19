import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBoxScore, renderPendingBoxScore } from "../page/js/box-score-view.js";
import { isEarlierBoxScore } from "../page/js/game-sheet.js";
import { listSeasonDays } from "../page/js/games-view.js";
import { renderPreview } from "../page/js/preview-view.js";
import { buildSeasonWithLeaders } from "./player-fixtures.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import { describePreview } from "../worker/src/preview.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";
import { normalizeSpaces } from "../../../tests/text.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The afternoon, with the leading scorers the store works out from the season's totals.
const SEASON = buildSeasonWithLeaders(AFTERNOON.responses, { season: 2026, now: NOW });
const FEVER_AT_ACES = { away: "IND", home: "LVA" };

// Each tag reads as a space, and the page's separator as a bar.
const readText = (markup) =>
  normalizeSpaces(markup.text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** @param {string} id */
const readBoxScore = (id) => describeBoxScore(GAMES.boxScores[id]);

// Valkyries at Wings, Game 2, as if it were still in the third quarter.
function readLiveBoxScore() {
  const box = readBoxScore("1042600112");
  box.state = "live";
  box.period = 3;
  return box;
}

/** @param {any} markup */
const listRows = (markup, table) =>
  [...markup.text.matchAll(new RegExp(`<table class="${table}[^"]*">[\\s\\S]*?</table>`, "g"))].map(
    ([found]) =>
      [...found.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => readText({ text: row })),
  );

/** @param {any} markup */
const countPlayerTables = (markup) => markup.text.split('<table class="players').length - 1;

/**
 * Each team's part of the players table, its heading row then its players, each row as text.
 * @param {any} markup
 */
const listPlayerGroups = (markup) =>
  [...markup.text.matchAll(/<table class="players[^"]*">[\s\S]*?<\/table>/g)].flatMap(([table]) =>
    [...table.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(([, group]) =>
      [...group.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => readText({ text: row })),
    ),
  );

/**
 * The two bars of the tape row a measure names, away then home, as "lead 52" or "42".
 * @param {any} markup
 * @param {string} label
 */
function readTapeBars(markup, label) {
  const row = markup.text
    .split('<div class="tape-row">')
    .find((chunk) => readText({ text: chunk }).includes(` ${label} `));
  return [...row.matchAll(/<i class="(lead)?" style="width: (\d+)%">/g)].map(([, lead, width]) =>
    lead ? `lead ${width}` : width,
  );
}

test("every game with both teams known opens its sheet, named for the game", () => {
  const markup = listSeasonDays(SEASON, null, NOW)
    .days.map(({ markup: day }) => day.text)
    .join("");
  const labels = [...markup.matchAll(/class="game-open" aria-label="([^"]*)"/g)].map(
    ([, label]) => label,
  );
  assert.ok(labels.includes("Game details: Aces at Fever, First Round Game 2"));
  assert.ok(labels.includes("Game details: Fever at Aces, First Round Game 3"));
  assert.equal(new Set(labels).size, labels.length);
  const withTeams = SEASON.games.filter((game) => game.away.team && game.home.team).length;
  assert.equal(labels.length, withTeams);
  assert.ok(SEASON.games.some((game) => !game.home.team));
});

/** @param {{ text: string }} markup */
const listTeamButtons = (markup) =>
  [...markup.text.matchAll(/<button type="button" class="club team-open" data-team="(\w+)"/g)].map(
    ([, team]) => team,
  );

test("each team in a box score opens its sheet: its line score row, its team stats, and its scorers", () => {
  const box = readBoxScore("1042600122");
  const teams = [box.away.team, box.home.team];
  assert.deepEqual(listTeamButtons(renderBoxScore(box)), [...teams, ...teams, ...teams]);
  assert.deepEqual(
    listTeamButtons(renderPendingBoxScore({ away: box.away.team, home: box.home.team })),
    [...teams, ...teams, ...teams],
  );
});

test("a final's line score gives every quarter, and dims the loser's total", () => {
  const [lineScore] = listRows(renderBoxScore(readBoxScore("1042600122")), "line-score");
  assert.deepEqual(lineScore, ["1 2 3 4 T", "Aces 26 17 17 29 89", "Fever 18 30 24 27 99"]);
  assert.match(renderBoxScore(readBoxScore("1042600122")).text, /<td class="total lost">89/);
});

test("a game in overtime gets a column for it", () => {
  const [lineScore] = listRows(renderBoxScore(readBoxScore("1042600112")), "line-score");
  assert.deepEqual(lineScore, [
    "1 2 3 4 OT T",
    "Valkyries 26 19 29 19 7 100",
    "Wings 23 27 22 21 15 108",
  ]);
});

test("while a game is on, its line score marks the quarter under way and leaves the rest blank", () => {
  const markup = renderBoxScore(readLiveBoxScore());
  const [lineScore] = listRows(markup, "line-score");
  assert.deepEqual(lineScore.slice(1), ["Valkyries 26 19 29 - - 100", "Wings 23 27 22 - - 108"]);
  assert.match(markup.text, /<th class="now">3<\/th>/);
  assert.match(readText(markup), /Team stats So far/);
});

test("team stats face off with each side's shooting, and the better side leads each row", () => {
  const markup = renderBoxScore(readBoxScore("1042600122"));
  const text = readText(markup);
  assert.match(text, /42\.4% 25-59 Field goals 52\.1% 37-71/);
  assert.match(text, /26 Points in the paint 58/);
  assert.match(text, /Biggest lead: Aces 11, Fever 15 \| Lead changes: 4 \| Ties: 4/);
  assert.doesNotMatch(text, /Timeouts left/);
  assert.deepEqual(readTapeBars(markup, "Field goals"), ["42", "lead 52"]);
  assert.deepEqual(readTapeBars(markup, "Points in the paint"), ["45", "lead 100"]);
});

test("with the lead through the game on the sheet, Biggest lead says what its chart marks, not the league's count", () => {
  /** @type {import("../page/js/lead-chart.js").Lead} */
  const lead = {
    periods: 4,
    isOver: true,
    scores: [
      [0, 0, 0],
      [60, 5, 0],
      [120, 5, 9],
      [200, 20, 9],
    ],
  };
  const text = readText(renderBoxScore(readBoxScore("1042600122"), { lead }));
  assert.match(text, /Biggest lead: Aces 11, Fever 4 \| Lead changes: 4/);
});

test("fewer turnovers lead, and a tie leads neither way", () => {
  assert.deepEqual(readTapeBars(renderBoxScore(readBoxScore("1042600122")), "Turnovers"), [
    "100",
    "100",
  ]);
  const box = readBoxScore("1042600122");
  box.away.stats.turnovers = 9;
  assert.deepEqual(readTapeBars(renderBoxScore(box), "Turnovers"), ["lead 75", "100"]);
});

test("each team's top five scorers show in one table, minutes last, a tie going to who played longer, and a live game flags a player in foul trouble", () => {
  const final = renderBoxScore(readBoxScore("1042600122"));
  assert.equal(countPlayerTables(final), 1);
  const [aces, fever] = listPlayerGroups(final);
  assert.deepEqual(aces, [
    "Aces Pts Reb Ast Min",
    "Jackie Young 31 4 5 36",
    "A'ja Wilson 22 9 2 34",
    "Chelsea Gray 10 1 7 37",
    "Stephanie Talbot 9 5 1 27",
    "Cheyenne Parker-Tyus 9 3 0 15",
  ]);
  assert.equal(fever[1], "Caitlin Clark Fouled out 27 7 15 33");

  const [, wings] = listPlayerGroups(renderBoxScore(readLiveBoxScore()));
  assert.deepEqual(wings.slice(1, 3), [
    "Arike Ogunbowale 5 fouls 45 7 4 42",
    "Alysha Clark 4 fouls 21 3 2 31",
  ]);
  assert.match(readText(renderBoxScore(readLiveBoxScore())), /Timeouts left: Valkyries 0, Wings 1/);
  const [, finalWings] = listPlayerGroups(renderBoxScore(readBoxScore("1042600112")));
  assert.ok(!finalWings.some((row) => /fouls/.test(row)));
});

test("a live game's timeouts left name only a team the league counts them for, and none leaves the line out", () => {
  const live = readLiveBoxScore();
  live.home.timeouts = null;
  assert.match(readText(renderBoxScore(live)), /Timeouts left: Valkyries 0(?!,)/);
  live.away.timeouts = null;
  const text = readText(renderBoxScore(live));
  assert.doesNotMatch(text, /Timeouts left/);
  assert.doesNotMatch(text, /null/);
});

/** @param {any} markup */
const countPlaying = (markup) => (markup.text.match(/data-player-playing="1"/g) ?? []).length;

test("a box score of a game under way or ended today marks each top scorer who has played as playing now, and one from before today marks none", () => {
  const live = readLiveBoxScore();
  assert.equal(countPlaying(renderBoxScore(live)), 10);
  const [leader] = [...live.home.players].sort((first, second) => second.points - first.points);
  leader.minutes = 0;
  const unplayed = renderBoxScore(live);
  assert.equal(countPlaying(unplayed), 9);
  assert.match(
    unplayed.text,
    new RegExp(`data-player="${leader.id}" data-player-team="[A-Z]+" data-player-name="[^"]+">`),
  );

  const final = readBoxScore("1042600112");
  assert.equal(countPlaying(renderBoxScore(final, {}, true)), 10);
  assert.equal(countPlaying(renderBoxScore(final)), 0);
});

/**
 * The preview of the Fever at the Aces in the playoffs, with the season and meetings it would have.
 * @param {Partial<Parameters<typeof renderPreview>[0]>} [parts]
 */
const renderFeverAtAces = (parts = {}) =>
  renderPreview({
    teams: FEVER_AT_ACES,
    season: SEASON,
    meetings: describePreview(GAMES.preview.schedule, { season: 2026, ...FEVER_AT_ACES }).meetings,
    isLoading: false,
    isSeriesOver: true,
    ...parts,
  });

/** @param {any} markup */
const listMeetingRows = (markup) =>
  [...markup.text.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, row]) => readText({ text: row }));

test("each team in a preview opens its sheet: each meeting's winner and the team it beat, the season stats, and the leading scorers", () =>
  checkInTimeZone(EASTERN, () => {
    const buttons = listTeamButtons(renderFeverAtAces());
    assert.deepEqual(buttons.slice(-4), ["IND", "LVA", "IND", "LVA"]);
    assert.deepEqual([...new Set(buttons)].sort(), ["IND", "LVA"]);
    assert.equal(buttons.length, 7);
    const meetings =
      renderFeverAtAces().text.match(/<ul class="meetings">[\s\S]*?<\/ul>/)?.[0] ?? "";
    assert.deepEqual(
      [...meetings.matchAll(/class="team-open" data-team="(\w+)"/g)].map(([, team]) => team),
      ["LVA", "LVA", "IND"],
    );
  }));

test("a preview lists the regular season's meetings, first to last, each by its winner and where it was played, under who won the season series", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderFeverAtAces();
    assert.match(readText(markup), /Season series Fever won 2-1/);
    const rows = listMeetingRows(markup);
    assert.deepEqual(rows, [
      "Jul 5 Fever 84-68 at Aces",
      "Jul 12 Fever 109-75 at Aces",
      "Aug 6 Aces 86-84 at Fever",
    ]);
    const text = readText(markup);
    const homeWin = {
      id: "1022600001",
      start: "2026-06-01T23:00:00Z",
      away: { team: "IND", score: 70 },
      home: { team: "LVA", score: 80 },
    };
    assert.match(readText(renderFeverAtAces({ meetings: [homeWin] })), /Jun 1 Aces 80-70 vs Fever/);
    assert.doesNotMatch(text, /Sep 2\d|1st Rd/);
  }));

test("a preview compares the season stats from the saved standings, the visitors on the road and the hosts at home", () => {
  const markup = renderFeverAtAces();
  const text = readText(markup);
  assert.match(text, /Season stats Fever Aces 28-16 Record 31-13/);
  assert.match(text, /96\.0 PPG 91\.5/);
  assert.match(text, /90\.4 Opp PPG 85\.8/);
  assert.match(text, /\+5\.5 Margin \+5\.7/);
  assert.match(text, /13-9 Road Home 15-7/);
  assert.match(text, /8-2 Leading scorers/);
  assert.deepEqual(readTapeBars(markup, "Opp PPG"), ["100", "lead 95"]);
  assert.deepEqual(readTapeBars(markup, "Road Home"), ["59", "lead 68"]);
});

test("a preview's margin that rounds to nothing shows no sign, as a team's sheet shows it", () => {
  const standings = SEASON.standings.map((row) =>
    row.team === "IND" ? { ...row, margin: -0.04 } : row,
  );
  assert.match(
    readText(renderFeverAtAces({ season: { ...SEASON, standings } })),
    / 0\.0 Margin \+5\.7/,
  );
});

test("a preview lists each team's five saved leading scorers, as its team sheet does, in one table, best first, with how well each shoots and how much she plays", () => {
  assert.equal(countPlayerTables(renderFeverAtAces()), 1);
  const [fever, aces] = listPlayerGroups(renderFeverAtAces());
  assert.deepEqual(fever, [
    "Fever Pts Reb Ast FG% Min",
    "Kelsey Mitchell 24.7 1.7 2.8 50.9 32.5",
    "Caitlin Clark 22.3 4.0 8.3 44.5 31.1",
    "Aliyah Boston 16.1 8.0 3.0 52.8 27.1",
    "Sophie Cunningham 7.9 2.3 1.2 46.0 22.2",
    "Monique Billings 6.5 4.8 1.0 51.6 18.7",
  ]);
  assert.equal(aces.length, 6);
  assert.equal(aces[1], "A'ja Wilson 26.2 9.4 3.2 52.7 32.0");
});

test("a preview missing a part says so, with Try again for the meetings it reads, and a split season series says that", () => {
  const missing = renderFeverAtAces({
    season: { ...SEASON, standings: [], leaders: [] },
    meetings: null,
  });
  const text = readText(missing);
  assert.match(text, /Couldn't load this season's meetings(?!\.) Try again/);
  assert.match(text, /Couldn't load the standings(?!\.)/);
  assert.match(text, /Couldn't load the players' averages(?!\.)/);
  assert.match(missing.text, /class="retry-note"/);
  assert.equal(missing.text.split("data-retry").length - 1, 1);

  const { meetings } = describePreview(GAMES.preview.schedule, { season: 2026, ...FEVER_AT_ACES });
  const split = meetings.filter((meeting) => meeting.id !== "1022600153");
  assert.match(readText(renderFeverAtAces({ meetings: split })), /Season series Split 1-1/);
});

test("before the playoffs, a preview's season series says who leads it, or that it's tied, since more meetings may come", () => {
  const { meetings } = describePreview(GAMES.preview.schedule, { season: 2026, ...FEVER_AT_ACES });
  const midSeason = { isSeriesOver: false };
  assert.match(readText(renderFeverAtAces(midSeason)), /Season series Fever lead 2-1/);
  const tied = meetings.filter((meeting) => meeting.id !== "1022600153");
  assert.match(
    readText(renderFeverAtAces({ ...midSeason, meetings: tied })),
    /Season series Tied 1-1/,
  );
});

test("a preview of teams yet to meet says so in a short note", () => {
  assert.match(readText(renderFeverAtAces({ meetings: [] })), /They haven't met this season(?!\.)/);
});

/**
 * The titles of a sheet's parts, and the names of its measures, in order.
 * @param {any} markup
 */
const readShape = (markup) =>
  [...markup.text.matchAll(/<(?:h3|span class="tape-label")>([^<]*)</g)].map(([, name]) => name);

/** @param {any} markup */
const countPlaceholders = (markup) => markup.text.split('class="placeholder"').length - 1;

test("a box score still loading has the loaded one's parts and measures, with placeholders for its numbers", () => {
  const pending = renderPendingBoxScore({ away: "LVA", home: "IND" });
  assert.deepEqual(readShape(pending), readShape(renderBoxScore(readBoxScore("1042600122"))));
  assert.deepEqual(listRows(pending, "line-score")[0], [
    "1 2 3 4 T",
    "Aces 00 00 00 00 00",
    "Fever 00 00 00 00 00",
  ]);
  assert.deepEqual(
    listPlayerGroups(pending).map((rows) => rows.length),
    [6, 6],
  );
  assert.ok(countPlaceholders(pending) > 0);
});

test("a preview still loading holds the meetings' shape with placeholders, and shows the rest at once", () => {
  const pending = renderFeverAtAces({ meetings: null, isLoading: true });
  const loaded = renderFeverAtAces();
  assert.deepEqual(readShape(pending), readShape(loaded));
  assert.equal(pending.text.split("<li>").length - 1, 3);
  assert.ok(countPlaceholders(pending) > 0);
  assert.equal(
    pending.text.slice(pending.text.indexOf("Season stats")),
    loaded.text.slice(loaded.text.indexOf("Season stats")),
  );
});

test("a pushed box score with fewer points than the one the sheet shows is from before it, and dropped", () => {
  const scoring = (away, home) => ({ away: { score: away }, home: { score: home } });
  assert.equal(isEarlierBoxScore(scoring(40, 38), scoring(42, 38)), true);
  assert.equal(isEarlierBoxScore(scoring(42, 38), scoring(40, 38)), false);
  assert.equal(isEarlierBoxScore(scoring(40, 38), scoring(40, 38)), false);
  assert.equal(isEarlierBoxScore(scoring(40, 38), null), false);
});
