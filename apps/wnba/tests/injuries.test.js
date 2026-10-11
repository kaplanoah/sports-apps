import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeOutReason, listOutPlayers } from "../worker/src/injuries.js";

// ESPN's injury report, trimmed to what the rosters keep of it.
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);

test("why a player is out reads as a phrase: the side, what's hurt, and what's wrong with it, in the league's words", () => {
  /** @type {[any, string][]} */
  const cases = [
    [{ type: "Knee", side: "Left" }, "Left knee"],
    [{ type: "Knee", side: "Left", detail: "Surgery" }, "Left knee surgery"],
    [{ type: "Back", detail: "Spasms" }, "Back spasms"],
    [{ type: "Foot", side: "Right", detail: "Not Specified" }, "Right foot"],
    [{ type: "Lower Leg", side: "Left" }, "Left lower leg"],
    [{ type: "Concussion" }, "Concussion"],
    [{ type: "Not Injury Related" }, "Not injury related"],
    [{ type: "Personal" }, "Personal reasons"],
    [{ type: "Coach's Decision" }, "Coach's decision"],
    [{ type: "Knee", side: "Right", detail: "ACL" }, "Right knee ACL"],
    [{ type: "Achilles", side: "Left" }, "Left Achilles"],
  ];
  for (const [details, words] of cases) assert.equal(describeOutReason(details), words);
  assert.equal(describeOutReason({}), null);
  assert.equal(describeOutReason(undefined), null);
});

test("ESPN's report lists each team's players out, by name, with why, whether it's for the season, RotoWire's sentence, and when ESPN changed it", () => {
  const byTeam = listOutPlayers(INJURIES.report);

  assert.deepEqual(byTeam.NYL, [
    {
      name: "satousabally",
      reason: "Concussion",
      isForSeason: true,
      sentence: null,
      updated: "2026-10-11T18:00:00.000Z",
    },
    {
      name: "elizabethbalogun",
      reason: "Not injury related",
      isForSeason: false,
      sentence: "Balogun (not with team) is out for Wednesday's game against the Dream.",
      updated: "2026-09-22T21:05:00.000Z",
    },
  ]);
  assert.deepEqual(
    byTeam.ATL.map(({ name, reason, isForSeason }) => [name, reason, isForSeason]),
    [
      ["allishagray", "Left hand", false],
      ["matildevilla", "Coach's decision", false],
      ["brionnajones", "Left leg", true],
    ],
  );
});

test("a player listed as anything but out, or on a team the app doesn't know, isn't out", () => {
  const report = {
    injuries: [
      {
        id: "9",
        injuries: [
          { status: "Day-To-Day", athlete: { firstName: "Breanna", lastName: "Stewart" } },
          { status: "Out", athlete: { firstName: "Satou", lastName: "Sabally" } },
        ],
      },
      { id: "999", injuries: [{ status: "Out", athlete: { firstName: "No", lastName: "One" } }] },
    ],
  };
  assert.deepEqual(listOutPlayers(report), {
    NYL: [
      { name: "satousabally", reason: null, isForSeason: false, sentence: null, updated: null },
    ],
  });
  assert.deepEqual(listOutPlayers(null), {});
});
