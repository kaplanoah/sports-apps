import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findTeamCodeByEspnId } from "../apps/wnba/page/js/teams.js";
import {
  describeBasketballLead,
  describeHighlights,
  readNetworkGame,
  fetchInjuryReport,
  listReportedPlayers,
  nameInjuryReportRequest,
  readNameLetters,
} from "../shared/worker/espn-adapter.js";

const REPORT = {
  injuries: [
    {
      id: "19",
      injuries: [
        {
          status: "15-Day-IL",
          date: "2026-10-03T18:34Z",
          shortComment: "Treinen (shoulder) hasn't been ruled out for a return.",
          athlete: { firstName: "Blake", lastName: "Treinen" },
          details: {
            type: "Shoulder",
            side: "Right",
            detail: "Inflammation",
            fantasyStatus: { abbreviation: "15-Day IL" },
          },
        },
        {
          status: "Day-To-Day",
          date: "not a date",
          shortComment: "Out",
          athlete: { firstName: "Teoscar", lastName: "Hernández" },
          details: {},
        },
        { status: "15-Day-IL" },
      ],
    },
    { id: "999", injuries: [{ status: "Out", athlete: { firstName: "No", lastName: "One" } }] },
  ],
};
const findTeam = (/** @type {string} */ id) => (id === "19" ? "LAD" : null);

test("a league's report lists each team's players with a status it shows, by their names' letters, with why, ESPN's status, RotoWire's sentence, and when ESPN changed it", () => {
  assert.deepEqual(listReportedPlayers(REPORT, { findTeam, isShown: () => true }), {
    LAD: [
      {
        name: "blaketreinen",
        status: "15-Day-IL",
        reason: "Right shoulder inflammation",
        fantasyStatus: "15-Day IL",
        sentence: "Treinen (shoulder) hasn't been ruled out for a return.",
        updated: "2026-10-03T18:34:00.000Z",
      },
      {
        name: "teoscarhernandez",
        status: "Day-To-Day",
        reason: null,
        fantasyStatus: null,
        sentence: null,
        updated: null,
      },
    ],
  });
});

test("a status the league doesn't show, a team it doesn't know, and an entry without a player are left out", () => {
  const listed = listReportedPlayers(REPORT, {
    findTeam,
    isShown: (status) => status === "Day-To-Day",
  });
  assert.deepEqual(Object.keys(listed), ["LAD"]);
  assert.deepEqual(
    listed.LAD.map((player) => player.name),
    ["teoscarhernandez"],
  );
  assert.deepEqual(listReportedPlayers(null, { findTeam, isShown: () => true }), {});
});

test("a name's letters match it across accents and punctuation, and each league's report has its own address", () => {
  assert.equal(readNameLetters("Teoscar Hernández"), readNameLetters("Teoscar Hernandez"));
  assert.equal(readNameLetters("Ke'Bryan Hayes Jr."), "kebryanhayesjr");
  assert.equal(
    nameInjuryReportRequest("baseball/mlb"),
    "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
  );
});

test("a report ESPN answers with something other than JSON says what came back", async () => {
  const fetchImpl = async () => new Response("");
  await assert.rejects(fetchInjuryReport(fetchImpl, "basketball/wnba"), {
    message: "ESPN answered its injury report with nothing rather than data",
  });
});

/** @param {string} name */
const readRecorded = (name) =>
  JSON.parse(
    readFileSync(new URL(`../apps/wnba/tests/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

/** @param {() => unknown} read @param {RegExp} path */
function assertInvalidOutput(read, path) {
  assert.throws(read, (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, path);
    assert.doesNotMatch(error.message, /private-payload/);
    return true;
  });
}

test("recorded injuries reject an invalid fantasy status before it can enter either league's cache", async () => {
  const report = readRecorded("2026-10-11-espn-injuries").report;
  const league = { findTeam: findTeamCodeByEspnId, isShown: () => true };
  assert.ok(listReportedPlayers(report, league).ATL.length);
  report.injuries[0].injuries[0].details.fantasyStatus.abbreviation = 42;
  assertInvalidOutput(
    () => listReportedPlayers(report, league),
    /Invalid sports data at ATL.0.fantasyStatus/,
  );
  await assert.rejects(
    () => fetchInjuryReport(async () => new Response(JSON.stringify(report)), "basketball/wnba"),
    /Invalid sports data at 20.0.fantasyStatus/,
  );
});

test("a recorded lead rejects a malformed scoring play without exposing its payload", () => {
  const { summary } = readRecorded("2026-10-01-espn-lead");
  const rules = { regulationPeriods: 4, quarterSeconds: 600, overtimeSeconds: 300 };
  assert.deepEqual(describeBasketballLead(summary, rules).scores[1], [35, 2, 0]);
  summary.plays.find((play) => play.scoringPlay).awayScore = "private-payload";
  assertInvalidOutput(
    () => describeBasketballLead(summary, rules),
    /Invalid sports data at scores.1.1/,
  );
});

test("recorded highlights reject a malformed recap still without exposing its payload", () => {
  const { summary } = readRecorded("2026-10-01-espn-highlights");
  assert.ok(describeHighlights("game", summary).recap.still);
  summary.videos[0].thumbnail = { value: "private-payload" };
  assertInvalidOutput(
    () => describeHighlights("game", summary),
    /Invalid sports data at recap.still/,
  );
});

test("a recorded ESPN listing rejects malformed channels before it can enter a month cache", () => {
  const { answers } = readRecorded("2026-10-02-espn-scoreboard");
  const event = Object.values(answers)
    .flatMap((answer) => answer.events)
    .find((game) => game.competitions[0].broadcasts?.some((broadcast) => broadcast.names?.length));
  assert.ok(event);
  assert.ok(readNetworkGame(event, findTeamCodeByEspnId).networks.length);
  event.competitions[0].broadcasts.find((broadcast) => broadcast.names?.length).names[0] = {
    value: "private-payload",
  };
  assertInvalidOutput(
    () => readNetworkGame(event, findTeamCodeByEspnId),
    /Invalid sports data at networks/,
  );
});
