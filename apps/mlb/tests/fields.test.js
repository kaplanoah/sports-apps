import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../page/js/snapshot.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
const EVENING = readFixture("2026-09-24-evening");
const SEASON_2025 = readFixture("2025-final");
const copy = (value) => JSON.parse(JSON.stringify(value));
const listGames = (schedule) => schedule.dates.flatMap((date) => date.games);
const listClubs = (standings) => standings.records.flatMap((division) => division.teamRecords);

test("every field the requests ask for has a rule", () => {
  const requests = [
    ...Object.values(MLBSnapshot.listMlbRequests(2026, Date.parse(EVENING.now))),
    MLBSnapshot.listPitcherRequest([1]),
  ];
  const requested = requests.flatMap((request) =>
    new URL(request, MLBSnapshot.MLB_API).searchParams.get("fields").split(","),
  );
  assert.deepEqual(
    requested.filter((field) => !MLBSnapshot.CHECKED_FIELDS.includes(field)),
    [],
  );
});

test("the recorded seasons have nothing missing", () => {
  for (const fixture of [EVENING, SEASON_2025]) {
    const snapshot = MLBSnapshot.buildSnapshot(fixture.responses, {
      season: fixture.season,
      now: Date.parse(fixture.now),
    });
    assert.deepEqual(snapshot.missing, []);
  }
});

test("a field MLB stops sending is named, once", () => {
  const responses = copy(EVENING.responses);
  for (const game of listGames(responses.schedule)) delete game.officialDate;
  for (const game of listGames(responses.postseason)) delete game.officialDate;
  for (const club of listClubs(responses.standings)) delete club.wildCardRank;
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), ["wildCardRank", "officialDate"]);
});

test("a field the code can do without on one game is missing only once it's gone from all", () => {
  const responses = copy(EVENING.responses);
  const finals = listGames(responses.schedule).filter((game) => game.status.codedGameState === "F");
  delete finals[0].gameInfo;
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), []);
  finals.forEach((game) => delete game.gameInfo);
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), [
    "gameInfo.firstPitch",
    "gameInfo.gameDurationMinutes",
  ]);
});

test("live games that stop giving their half inning or outs are flagged", () => {
  const responses = copy(EVENING.responses);
  const live = listGames(responses.schedule).filter(
    (game) => game.status.abstractGameState === "Live",
  );
  for (const game of live) {
    game.linescore.inningState = "Top of the inning";
    delete game.linescore.outs;
  }
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), [
    "linescore.inningState",
    "linescore.outs",
  ]);
});

test("a postseason series that stops naming its league is flagged", () => {
  const responses = copy(EVENING.responses);
  listGames(responses.postseason)[0].seriesDescription = "Wild Card Series";
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), ["seriesDescription"]);
});

test("no games or standings yet is fine; no dates or records at all is not", () => {
  const empty = {
    season: { seasons: [{ springStartDate: "2026-02-20", regularSeasonEndDate: "2026-09-27" }] },
    standings: { records: [] },
    postseason: { dates: [] },
    schedule: { dates: [] },
  };
  assert.deepEqual(MLBSnapshot.findMissingFields(empty), []);
  assert.deepEqual(
    MLBSnapshot.findMissingFields({ season: {}, standings: {}, postseason: {}, schedule: null }),
    ["seasons", "records", "dates"],
  );
});

test("a starter MLB describes without his name or arm is flagged, and a first name only once none has one", () => {
  const describe = (people) =>
    MLBSnapshot.findMissingFields({ ...EVENING.responses, pitchers: { people } });
  const complete = { id: 1, useName: "Michael", useLastName: "King", pitchHand: { code: "R" } };
  const rookie = { id: 2, useName: "Payton", useLastName: "Tolle", pitchHand: { code: "L" } };
  assert.deepEqual(describe([complete, rookie]), []);
  assert.deepEqual(describe([{ ...complete, useLastName: undefined }]), ["useLastName"]);
  assert.deepEqual(describe([{ ...complete, useName: undefined }, rookie]), []);
  assert.deepEqual(
    describe([
      { ...complete, useName: undefined },
      { ...rookie, useName: undefined },
    ]),
    ["useName"],
  );
  assert.deepEqual(describe([{ ...complete, pitchHand: {} }]), ["pitchHand.code"]);
});

test("the slate's starters are read without a season line, which no view shows", () => {
  const request = new URL(MLBSnapshot.listPitcherRequest([1]), MLBSnapshot.MLB_API);
  assert.equal(request.searchParams.get("hydrate"), null);
  assert.ok(!request.searchParams.get("fields").split(",").includes("era"));
});
