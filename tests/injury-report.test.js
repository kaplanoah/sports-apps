import test from "node:test";
import assert from "node:assert/strict";
import {
  listReportedPlayers,
  nameInjuryReportRequest,
  readNameLetters,
} from "../shared/worker/injury-report.js";

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
