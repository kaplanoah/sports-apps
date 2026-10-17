import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBracket,
  describeFirstPitchWait,
  findHomeSide,
  findPreferredSide,
  orderRows,
} from "../page/js/bracket.js";

function buildField() {
  const teams = {};
  const clubs = {
    AL: ["NYY", "TOR", "SEA", "BOS", "DET", "CLE"],
    NL: ["LAD", "MIL", "PHI", "CHC", "SD", "CIN"],
  };
  for (const [league, ids] of Object.entries(clubs))
    ids.forEach(
      (id, index) => (teams[id] = { league, seed: index + 1, w: 95 - index, l: 67 + index }),
    );
  return teams;
}

const STATE = {
  teams: buildField(),
  series: { AL_WC2: { winsA: 2, winsB: 0 }, AL_DS1: { winsA: 1, winsB: 3 } },
};

test("a draw builds the bracket once for a field and its series, and again once either changes", () => {
  const bracket = buildBracket(STATE);
  assert.equal(buildBracket({ ...STATE }), bracket);
  const series = { ...STATE.series, AL_WC1: { winsA: 1, winsB: 0, started: true } };
  const changed = buildBracket({ ...STATE, series });
  assert.notEqual(changed, bracket);
  assert.equal(changed.al.wc[0].winsA, 1);
});

test("the higher seed hosts in its league, and the better record in the World Series, on the card's bottom row", () => {
  const { teams } = STATE;
  const division = { round: "DS", teamA: "NYY", teamB: "BOS" };
  assert.equal(findHomeSide(division, teams), "A");
  assert.deepEqual(orderRows(division, teams), ["B", "A"]);
  const worldSeries = { round: "WS", teamA: "SEA", teamB: "LAD" };
  assert.equal(findHomeSide(worldSeries, teams), "B");
  assert.deepEqual(orderRows(worldSeries, teams), ["A", "B"]);
});

test("a card whose clubs aren't known puts the higher seed's side on the bottom in the early rounds", () => {
  const { teams } = STATE;
  assert.equal(findHomeSide({ round: "CS", teamA: null, teamB: null }, teams), null);
  assert.deepEqual(orderRows({ round: "WC", teamA: null, teamB: null }, teams), ["B", "A"]);
  assert.deepEqual(orderRows({ round: "CS", teamA: null, teamB: null }, teams), ["A", "B"]);
});

test("a side is preferred only when every club that could fill it ranks above every club on the other", () => {
  const championship = buildBracket(STATE).al.cs[0];
  assert.equal(findPreferredSide(STATE, championship, ["BOS", "SEA", "TOR"]), "A");
  assert.equal(findPreferredSide(STATE, championship, ["SEA", "TOR", "CLE", "BOS"]), "B");
  assert.equal(findPreferredSide(STATE, championship, ["TOR", "BOS", "SEA"]), null);
});

test("a card counts down to first pitch only in the half hour before it, then says Warmup or its delay", () => {
  const start = "2026-10-04T20:08:00Z";
  const at = (minutes) => Date.parse(start) - minutes * 60 * 1000;
  assert.equal(describeFirstPitchWait({ start }, at(31)), null);
  assert.deepEqual(describeFirstPitchWait({ start }, at(30)), {
    text: "First pitch in 30 min",
    isDelayed: false,
  });
  assert.deepEqual(describeFirstPitchWait({ start }, at(0.5)), {
    text: "First pitch in 1 min",
    isDelayed: false,
  });
  assert.deepEqual(describeFirstPitchWait({ start }, at(-3)), { text: "Warmup", isDelayed: false });
  assert.deepEqual(describeFirstPitchWait({ start, delay: "Delayed: Rain" }, at(5)), {
    text: "Delayed: Rain",
    isDelayed: true,
  });
  assert.equal(describeFirstPitchWait({ start, tbd: true }, at(5)), null);
});
