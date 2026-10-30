import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderRoster } from "../page/js/roster-view.js";
import {
  describeRoster,
  indexSeasonStats,
  trimHitting,
  trimPitching,
  listRosterRequest,
  listSeasonStatsRequest,
} from "../worker/src/rosters.js";

// What MLB answered early on Oct 8: the Guardians' and Dodgers' 40-man rosters and their players'
// regular seasons.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-08-rosters.json`, "utf8"),
);
const { season, answers } = FIXTURE;

/**
 * @param {string} club
 * @param {number} mlbTeamId
 */
const describeClub = (club, mlbTeamId) =>
  describeRoster({
    club,
    season,
    roster: answers[listRosterRequest(mlbTeamId, season)],
    hitting: indexSeasonStats(answers[listSeasonStatsRequest(season, "hitting")], trimHitting),
    pitching: indexSeasonStats(answers[listSeasonStatsRequest(season, "pitching")], trimPitching),
  });

/**
 * Each titled part's title and its rows' names, from a roster's markup.
 * @param {string} markup
 */
function readParts(markup) {
  return [...markup.matchAll(/<h3>([^<]*)<\/h3>([\s\S]*?)<\/section>/g)].map(([, title, body]) => [
    title,
    [...body.matchAll(/class="player-open box-name"[^>]*>([^<]*)<\/button>/g)].map(
      ([, name]) => name,
    ),
  ]);
}

/**
 * The text of each cell in the row of a player's name.
 * @param {string} markup
 * @param {string} name
 */
function readRow(markup, name) {
  const row = markup.split("<tr>").find((each) => each.includes(`>${name}<`)) ?? "";
  return [...row.matchAll(/<td class="tabular">([^<]*)<\/td>/g)].map(([, cell]) => cell);
}

test("a club's roster lists its hitters by plate appearances, its starters by starts, and its bullpen by innings", () => {
  const markup = String(renderRoster(describeClub("CLE", 114), { isLoading: false }));
  const parts = new Map(/** @type {[string, string[]][]} */ (readParts(markup)));

  assert.deepEqual([...parts.keys()], ["Hitters", "Starters", "Bullpen"]);
  assert.deepEqual(parts.get("Hitters")?.slice(0, 2), ["Jo Adell", "Steven Kwan"]);
  assert.deepEqual(parts.get("Starters"), [
    "Tanner Bibee",
    "Gavin Williams",
    "Parker Messick",
    "Foster Griffin",
    "Joey Cantillo",
  ]);
  assert.deepEqual(parts.get("Bullpen"), [
    "Cade Smith",
    "Matt Festa",
    "Hunter Gaddis",
    "Tim Herrin",
    "Erik Sabrowski",
    "Shawn Armstrong",
    "Daniel Espino",
  ]);
  assert.equal((parts.get("Hitters")?.length ?? 0) + 5 + (parts.get("Bullpen")?.length ?? 0), 26);
});

test("each row shows the season's numbers for the player's job, innings in thirds", () => {
  const markup = String(renderRoster(describeClub("CLE", 114), { isLoading: false }));
  assert.deepEqual(readRow(markup, "Steven Kwan"), [".282", "3", "32", ".731"]);
  assert.deepEqual(readRow(markup, "Gavin Williams"), ["3.76", "14-8", "184 1/3", "248"]);
  assert.deepEqual(readRow(markup, "Cade Smith"), ["1.95", "41", "74", "107"]);
  assert.match(
    markup,
    /<span class="roster-number tabular">38<\/span\s*><button type="button" class="player-open box-name" data-player="680757" data-player-team="CLE" data-player-name="Steven Kwan" data-player-number="38">Steven Kwan<\/button>/,
  );
});

test("a two-way player is with both the hitters and the pitchers, and the injured list shows who is on it", () => {
  const markup = String(renderRoster(describeClub("LAD", 119), { isLoading: false }));
  const parts = new Map(/** @type {[string, string[]][]} */ (readParts(markup)));

  assert.ok(parts.get("Hitters")?.includes("Shohei Ohtani"));
  assert.ok(parts.get("Starters")?.includes("Shohei Ohtani"));
  assert.equal(parts.get("Injured list")?.length, 7);
  assert.match(
    markup,
    /Blake Treinen<\/button><span class="box-pos">P<\/span\s*><span class="injured-status">15-day IL</,
  );
});

test("a roster still loading holds its shape, and one that didn't load says why over Try again", () => {
  assert.match(String(renderRoster(null, { isLoading: true })), /class="placeholder/);
  const failed = String(renderRoster(null, { isLoading: false, failure: "offline" }));
  assert.match(failed, /class="retry-block"/);
  assert.match(failed, /<p class="retry-title">Couldn&#39;t connect to the internet<\/p>/);
  assert.match(failed, /<p class="retry-next">Will load roster when back online<\/p>/);
  assert.match(failed, /class="retry-button filled" data-retry/);
});
