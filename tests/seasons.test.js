import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonParam } from "../shared/worker/seasons.js";

const NOW = Date.parse("2026-09-30T20:00:00Z");

const SEASON_PARAM = createSeasonParam({
  firstSeason: 1997,
  readCurrentSeason: (now) => new Date(now).getUTCFullYear(),
});

const readSeason = (query) => SEASON_PARAM.readSeason(new URLSearchParams(query), NOW);

test("a request's season is the one it names, or the current one when it names none", () => {
  assert.equal(readSeason("season=2024"), 2024);
  assert.equal(readSeason("season=1997"), 1997);
  assert.equal(readSeason("season=2100"), 2100);
  assert.equal(readSeason(""), 2026);
});

test("a season outside the league's years, or not a whole year, isn't one", () => {
  for (const query of ["season=1996", "season=2101", "season=2025.5", "season=next", "season="])
    assert.equal(readSeason(query), null, query);
  assert.equal(SEASON_PARAM.rule, "season must be a whole year between 1997 and 2100");
});
