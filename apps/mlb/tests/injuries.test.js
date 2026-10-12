import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexInjuredPlayers, listInjuredPlayers, nameInjuredKey } from "../worker/src/injuries.js";

// ESPN's MLB injury report on the evening of Oct 11, trimmed to what the sheets keep of it.
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);

test("ESPN's report names each club by its ESPN id, and every player on it, whatever his status, with why he's out", () => {
  const players = listInjuredPlayers(INJURIES.report);
  const clubs = new Set(players.map((player) => player.club));
  assert.equal(clubs.size, 30);
  assert.deepEqual(
    players.find((player) => player.name === "blaketreinen"),
    {
      club: "LAD",
      name: "blaketreinen",
      reason: "Right shoulder inflammation",
      sentence:
        "President of baseball operations Andrew Friedman said Saturday that Treinen (shoulder) hasn't been ruled out for a return in the postseason, Jon Paul Hoornstra of Newsweek.com reports.",
      updated: "2026-10-03T18:34:00.000Z",
    },
  );
});

test("a player is found by his club and his name's letters, as MLB spells it", () => {
  const index = indexInjuredPlayers([
    { club: "TOR", name: "josebaeza", reason: "Left hamstring", sentence: null, updated: null },
  ]);
  assert.equal(index.get(nameInjuredKey("TOR", "José Baeza"))?.reason, "Left hamstring");
  assert.equal(index.get(nameInjuredKey("NYY", "José Baeza")), undefined);
});
