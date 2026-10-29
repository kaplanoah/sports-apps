import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEAMS } from "../page/js/teams.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import { describeEspnBoxScore } from "../worker/src/espn-box-score.js";
import { readPlayerIndex } from "./player-fixtures.js";

/** @param {string} name */
const loadFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));

// Aces at Fever, Game 2, and Valkyries at Wings, Game 2, which went to overtime, as the league and
// ESPN each answered for them, and every team's roster on ESPN.
const GAMES = loadFixture("2026-10-01-games");
const ESPN = loadFixture("2026-10-29-espn-box-scores");
const INDEX = readPlayerIndex();

/**
 * A box score without where it came from or what ESPN can't give as the league does: timeouts
 * left, and minutes, which ESPN rounds where the league cuts them off.
 * @param {any} box
 */
function describeComparable({ source, ...box }) {
  const describeSide = ({ timeouts, players, ...team }) => ({
    ...team,
    players: players
      .map(({ minutes, ...player }) => player)
      .sort((first, second) => first.id - second.id),
  });
  return { ...box, away: describeSide(box.away), home: describeSide(box.home) };
}

/**
 * Each player's minutes, by her id.
 * @param {any} box
 */
const mapMinutes = (box) =>
  new Map([...box.away.players, ...box.home.players].map((player) => [player.id, player.minutes]));

test("ESPN's box score of a game reads as the league's, but for timeouts left and minutes, which round", () => {
  for (const [id, { summary }] of Object.entries(ESPN.games)) {
    const league = describeBoxScore(GAMES.boxScores[id]);
    const espn = describeEspnBoxScore(summary, id, INDEX);

    assert.deepEqual(describeComparable(espn), describeComparable(league), id);
    assert.equal(espn.source, "espn");
    assert.deepEqual([espn.away.timeouts, espn.home.timeouts], [null, null]);
    const leagueMinutes = mapMinutes(league);
    for (const [playerId, minutes] of mapMinutes(espn))
      assert.ok(Math.abs(minutes - leagueMinutes.get(playerId)) <= 1, `${id} ${playerId}`);
  }
});

/**
 * ESPN's summary of a final with every player on a team's roster on ESPN in its box score.
 * @param {string} team
 * @param {string[]} names
 */
function buildRosterSummary(team, names) {
  const espnId = String(TEAMS[team].espnId);
  const opponent = String(TEAMS[team === "LVA" ? "IND" : "LVA"].espnId);
  const competitor = (/** @type {string} */ homeAway, /** @type {string} */ teamId) => ({
    homeAway,
    team: { id: teamId },
    score: "0",
    linescores: [],
  });
  const athletes = names.map((displayName) => ({
    athlete: { displayName },
    starter: false,
    didNotPlay: false,
    stats: ["1"],
  }));
  return {
    header: {
      competitions: [
        {
          status: { type: { state: "post", completed: true } },
          competitors: [competitor("away", espnId), competitor("home", opponent)],
        },
      ],
    },
    boxscore: {
      teams: [],
      players: [{ team: { id: espnId }, statistics: [{ keys: ["minutes"], athletes }] }],
    },
  };
}

test("every player on a team's roster on ESPN takes her id and name from the league's list of the team's players, but one the list doesn't name", () => {
  const unnamed = [];
  for (const [team, names] of Object.entries(ESPN.rosters)) {
    const box = describeEspnBoxScore(buildRosterSummary(team, names), "1042600122", INDEX);
    assert.equal(box.away.players.length, names.length, team);
    for (const player of box.away.players) {
      if (player.id === null) {
        unnamed.push(`${team} ${player.firstName} ${player.lastName}`);
        continue;
      }
      const listed = INDEX.players.find((entry) => Number(entry.id) === player.id);
      assert.deepEqual(
        [listed.team, listed.firstName, listed.lastName],
        [team, player.firstName, player.lastName],
      );
    }
  }
  assert.deepEqual(unnamed, ["MIN Eliska Joklova"]);
});

test("a player ESPN writes with an accent, punctuation, or case the league's list doesn't still takes her id", () => {
  const index = {
    players: [
      { id: "1", team: "LVA", firstName: "Marine", lastName: "Johannes" },
      { id: "2", team: "LVA", firstName: "A'ja", lastName: "Wilson" },
    ],
  };
  const summary = buildRosterSummary("LVA", ["Marine Johannès", "AJA WILSON"]);
  const box = describeEspnBoxScore(summary, "1042600122", index);
  assert.deepEqual(
    box.away.players.map(({ id, firstName, lastName }) => [id, firstName, lastName]),
    [
      [1, "Marine", "Johannes"],
      [2, "A'ja", "Wilson"],
    ],
  );
});

test("ESPN has no box score of a game that hasn't started, or that it hasn't written one for", () => {
  const { summary } = ESPN.games["1042600122"];
  const pre = structuredClone(summary);
  pre.header.competitions[0].status.type = { state: "pre", completed: false };
  assert.equal(describeEspnBoxScore(pre, "1042600122", INDEX), null);
  assert.equal(
    describeEspnBoxScore({ ...summary, boxscore: undefined }, "1042600122", INDEX),
    null,
  );
  assert.equal(describeEspnBoxScore(null, "1042600122", INDEX), null);
});
