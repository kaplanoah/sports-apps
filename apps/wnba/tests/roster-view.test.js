import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chooseSort,
  DEFAULT_SORT,
  describeRosterNote,
  matchAverages,
  renderRoster,
  sortRows,
} from "../page/js/roster-view.js";
import { isStillPlaying } from "../page/js/series.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { listOutPlayers } from "../worker/src/injuries.js";
import { describeRoster } from "../worker/src/roster.js";
import { convertToText, Markup } from "../../../shared/page/html.js";
import { stripTags } from "../../../tests/text.js";
import { readSeasonAverages } from "./player-fixtures.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const ROSTERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-league-rosters.json`, "utf8"),
);
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);
const { series: SERIES } = buildSnapshot(AFTERNOON.responses, {
  season: 2026,
  now: Date.parse(AFTERNOON.now),
});
const { averages: AVERAGES } = readSeasonAverages();
const LIBERTY = describeRoster({
  team: "NYL",
  season: 2026,
  leagueRoster: ROSTERS.rosters["NYL:2026"],
  playerList: ROSTERS.playerList,
  outPlayers: listOutPlayers(INJURIES.report).NYL,
  now: Date.parse(ROSTERS.recordedAt),
});

/** @param {{ sort?: any, isLoading?: boolean, roster?: any, failure?: any, showsOut?: boolean }} [options] */
const renderText = ({
  sort = DEFAULT_SORT,
  isLoading = false,
  roster = LIBERTY,
  failure = null,
  showsOut = true,
} = {}) => renderRoster({ roster, averages: AVERAGES, sort, isLoading, failure, showsOut }).text;

// A line of facts as it reads, each separator a bar.
/** @param {Markup} markup */
const readFacts = (markup) => stripTags(markup).replace(/&bull;/g, " | ");

/** @param {string} markup */
const listLastNames = (markup) =>
  [...markup.matchAll(/<span class="roster-last">([^<]+)/g)].map((match) => match[1]);

/**
 * The text of each plain cell in the row with a key.
 * @param {string} markup
 * @param {string} key
 */
function readCells(markup, key) {
  const row = markup.slice(markup.indexOf(`data-key="${key}"`));
  return [...row.slice(0, row.indexOf("</tr>")).matchAll(/<td[^>]*>([^<]*)/g)].map((cell) =>
    convertToText(new Markup(cell[1])),
  );
}

/**
 * Whose row each row of a roster's table is, in its order.
 * @param {string} markup
 * @param {string} table the table's class
 */
function listRowPlayers(markup, table) {
  const start = markup.indexOf(`class="roster ${table}`);
  const rows = markup.slice(start, markup.indexOf("</table>", start));
  return [...rows.matchAll(/data-player-row="([^"]+)"/g)].map((match) => match[1]);
}

test("each player on the roster has her averages from the league, or none before she's played", () => {
  const rows = matchAverages(LIBERTY.players, AVERAGES);
  const findRow = (lastName) => rows.find((row) => row.lastName === lastName);
  assert.equal(rows.length, 15);
  assert.deepEqual(
    [findRow("Stewart").averages.points.toFixed(1), findRow("Stewart").averages.games],
    ["20.8", 42],
  );
  assert.equal(findRow("Balogun").averages, null);
});

test("a player finds her averages by the league's id, under whatever team they were last counted for", () => {
  const player = { ...LIBERTY.players[0], id: "1630149" };
  const averages = [{ ...AVERAGES[0], id: 1630149, team: "TOR" }];
  assert.equal(matchAverages([player], averages)[0].averages, averages[0]);
});

test("a player out shows so only while her team still plays: until the playoff field is set, then until it's out", () => {
  assert.match(renderText(), /Sabally<span class="chip foul-chip">/);
  assert.doesNotMatch(renderText({ showsOut: false }), /foul-chip/);
  assert.equal(isStillPlaying([], "PHX"), true);
  assert.equal(isStillPlaying(SERIES, "NYL"), true);
  assert.equal(isStillPlaying(SERIES, "PHX"), false);
  const lost = {
    ...SERIES[0],
    top: { team: "MIN", seed: 1, wins: 2 },
    bottom: { team: "NYL", seed: 8, wins: 0 },
    winner: "MIN",
  };
  assert.equal(isStillPlaying([lost], "NYL"), false);
});

test("a column's first tap sorts the most first for an average and A to Z or the least first for the rest, and its second reverses it", () => {
  assert.deepEqual(chooseSort(DEFAULT_SORT, "points"), { key: "points", isDescending: true });
  assert.deepEqual(chooseSort({ key: "points", isDescending: true }, "points"), {
    key: "points",
    isDescending: false,
  });
  assert.deepEqual(chooseSort({ key: "points", isDescending: true }, "age"), {
    key: "age",
    isDescending: false,
  });
  assert.deepEqual(chooseSort(DEFAULT_SORT, "name"), { key: "name", isDescending: true });
});

test("players without a value for the sorted column stay last either way, and ties go by name", () => {
  const rows = matchAverages(LIBERTY.players, AVERAGES);
  const byPoints = sortRows(rows, { key: "points", isDescending: true }).map((row) => row.lastName);
  const byFewestPoints = sortRows(rows, { key: "points", isDescending: false }).map(
    (row) => row.lastName,
  );
  assert.equal(byPoints[0], "Stewart");
  assert.equal(byPoints.at(-1), "Balogun");
  assert.equal(byFewestPoints.at(-1), "Balogun");
  const byHeight = sortRows(rows, { key: "height", isDescending: true }).map((row) => row.height);
  assert.deepEqual(byHeight.slice(0, 2), [`6'11"`, `6'6"`]);
  const byHome = sortRows(rows, { key: "home", isDescending: false }).map((row) => row.lastName);
  assert.deepEqual(byHome.slice(-3), ["Sabally", "Gardner", "Carrera"]);
});

test("the roster lists its players by last name with their facts, their points, rebounds, and assists a game, and its coach", () => {
  const markup = renderText();
  assert.deepEqual(listLastNames(markup).slice(0, 3), ["Allen", "Astier", "Balogun"]);
  assert.match(markup, /<dt>Head coach<\/dt>\s*<dd>Chris DeMarco<\/dd>/);
  assert.match(markup, /Balogun<span class="chip foul-chip">Out/);
  assert.match(markup, /<span class="roster-country">France<\/span>/);
  assert.match(markup, /scope="colgroup">Per game</);
  assert.match(markup, /class="roster-player" aria-sort="ascending"/);
  assert.deepEqual(
    [...readCells(markup, "1627668"), ...readCells(markup, "1627668:facts")],
    ["30", "F", `6'4"`, "Connecticut", "32", "2016", "42", "32.9", "20.8", "8.3", "3.3"],
  );
  assert.doesNotMatch(markup, /Steals|Blocks/);
});

test("the roster says its season, and how many players it has once it's loaded", () => {
  assert.equal(readFacts(describeRosterNote(LIBERTY, 2026)), "2026 | 15 players");
  assert.equal(readFacts(describeRosterNote(null, 2025)), "2025");
});

test("the sorted column says which way it sorts", () => {
  const markup = renderText({ sort: { key: "points", isDescending: true } });
  assert.match(markup, /title="Points per game" aria-sort="descending"/);
  assert.equal(listLastNames(markup)[0], "Stewart");
  assert.doesNotMatch(markup, /class="roster-player" aria-sort/);
});

test("while the roster loads, stand-ins hold its shape, and a roster that didn't load says why over Try again", () => {
  const loading = renderText({ roster: null, isLoading: true });
  assert.match(loading, /class="placeholder"/);
  assert.doesNotMatch(loading, /<dt>Head coach/);
  const failed = renderText({ roster: null, isLoading: false, failure: "unreachable" });
  assert.match(failed, /<p class="retry-title">Couldn&#39;t connect to the server<\/p>/);
  assert.match(failed, /<p class="retry-next">Try again to load roster<\/p>/);
  assert.match(failed, /class="retry-button filled" data-retry/);
});

test("the pinned table of numbers and names holds the same players in the same order as the table of facts beside it, whatever the sort", () => {
  for (const sort of [DEFAULT_SORT, { key: "points", isDescending: true }]) {
    const markup = renderText({ sort });
    const pinned = listRowPlayers(markup, "roster-pinned");
    assert.equal(pinned.length, 15);
    assert.deepEqual(listRowPlayers(markup, "roster-facts"), pinned);
  }
  const loading = renderText({ roster: null, isLoading: true });
  const countRows = (table) => {
    const start = loading.indexOf(`class="roster ${table}`);
    return loading.slice(start, loading.indexOf("</table>", start)).match(/<tr>/g)?.length;
  };
  assert.equal(countRows("roster-pinned"), countRows("roster-facts"));
});

test("each row of facts is named by its player's name in the pinned table", () => {
  const markup = renderText();
  const labels = [...markup.matchAll(/data-player-row="([^"]+)" aria-labelledby="([^"]+)"/g)];
  assert.equal(labels.length, 15);
  for (const [, id, label] of labels) {
    const nameCell = markup.match(
      new RegExp(`<th scope="row" class="roster-player" id="${label}">[^]*?</th>`),
    );
    assert.ok(nameCell, label);
    assert.match(nameCell[0], new RegExp(`data-player="${id}"`));
  }
});
