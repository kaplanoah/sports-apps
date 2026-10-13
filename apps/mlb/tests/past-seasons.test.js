import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEDULE_EDITION, buildSnapshot } from "../page/js/snapshot.js";
import { createPastSeasonsJob } from "../worker/src/past-seasons.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

const FINAL_2025 = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
);
const SNAPSHOT_2025 = {
  ...buildSnapshot(FINAL_2025.responses, {
    season: FINAL_2025.season,
    now: Date.parse(FINAL_2025.now),
  }),
  // The 2025 recording predates the season's whole schedule, so it stands in with one game.
  schedule: {
    "2025-11": [
      {
        date: "2025-11-01",
        id: "813024",
        away: "LAD",
        home: "TOR",
        state: "final",
        start: "2025-11-02T00:00:00Z",
        score: [5, 4],
        postseason: true,
        series: "WS",
        number: 7,
        innings: 11,
      },
    ],
  },
};
const SCHEDULE_2025 = {
  version: SNAPSHOT_2025.version,
  edition: SCHEDULE_EDITION,
  year: 2025,
  month: "2025-11",
  games: SNAPSHOT_2025.schedule["2025-11"],
  updatedAt: SNAPSHOT_2025.asOf,
};

// A past season as the store kept it while it was current: its field and updates, no standings.
const FOLLOWED_2025 = {
  year: 2025,
  teams: SNAPSHOT_2025.teams,
  series: SNAPSHOT_2025.series,
  log: [],
};

/**
 * @param {Record<string, any>} stored
 * @param {any} [snapshot] what MLB answers for 2025, or for each season
 */
async function runJob(stored, snapshot = SNAPSHOT_2025) {
  const docs = createDocs(stored);
  const loads = [];
  const answer = typeof snapshot === "function" ? snapshot : () => snapshot;
  const loadSnapshot = async (season) => {
    loads.push(season);
    return structuredClone(answer(season));
  };
  await createPastSeasonsJob().updateStore({
    docs,
    loadSnapshot,
    storage: createJobStorage(),
    env: {},
    fetchImpl: () => assert.fail("The job reads MLB only through loadSnapshot."),
    now: () => Date.parse("2026-10-05T12:00:00Z"),
  });
  return { documents: docs.stored, loads };
}

test("a past season saved without its standings is read from MLB and saved whole", async () => {
  const { documents, loads } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2025": FOLLOWED_2025,
    "seasons/2026": { year: 2026 },
  });

  assert.deepEqual(loads, [2025]);
  assert.deepEqual(documents.get("schedules-2025/2025-11"), SCHEDULE_2025);
  const record = documents.get("seasons/2025");
  assert.deepEqual(record.standings, SNAPSHOT_2025.standings);
  assert.deepEqual(record.series, SNAPSHOT_2025.series);
  assert.equal(record.updatedAt, SNAPSHOT_2025.asOf);
});

test("a whole past season, and the current one, aren't read again", async () => {
  const whole = { ...FOLLOWED_2025, standings: SNAPSHOT_2025.standings };
  const { documents, loads } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2025": whole,
    "schedules-2025/2025-11": SCHEDULE_2025,
    "seasons/2026": { year: 2026 },
  });

  assert.deepEqual(loads, []);
  assert.deepEqual(documents.get("seasons/2025"), whole);
});

test("a past season MLB answers only in part is left for the next run", async () => {
  const { documents } = await runJob(
    { "live/current": { season: 2026 }, "seasons/2025": FOLLOWED_2025 },
    { ...SNAPSHOT_2025, missing: ["standings"] },
  );

  assert.deepEqual(documents.get("seasons/2025"), FOLLOWED_2025);
});

test("until the store names the current season, no season counts as past", async () => {
  const { loads } = await runJob({ "seasons/2025": FOLLOWED_2025 });

  assert.deepEqual(loads, []);
});

test("a past season saved before the store kept its games is read again for its games", async () => {
  const whole = { ...FOLLOWED_2025, standings: SNAPSHOT_2025.standings };
  const { documents, loads } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2025": whole,
  });

  assert.deepEqual(loads, [2025]);
  assert.deepEqual(documents.get("schedules-2025/2025-11"), SCHEDULE_2025);
});

test("a past season saved before its games held what they hold now is read once more for them", async () => {
  const whole = { ...FOLLOWED_2025, standings: SNAPSHOT_2025.standings };
  const { edition, ...earlier } = SCHEDULE_2025;
  const { documents, loads } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2025": whole,
    "schedules-2025/2025-11": earlier,
  });

  assert.deepEqual(loads, [2025]);
  assert.deepEqual(documents.get("schedules-2025/2025-11"), SCHEDULE_2025);

  const again = await runJob(Object.fromEntries(documents));
  assert.deepEqual(again.loads, []);
});

test("past seasons are filled one a run, newest first", async () => {
  const { loads } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2024": { ...FOLLOWED_2025, year: 2024 },
    "seasons/2025": FOLLOWED_2025,
  });

  assert.deepEqual(loads, [2025]);
});

test("a past season MLB answers only in part, or without its games, leaves the run to go on to the next", async () => {
  const docs = {
    "live/current": { season: 2026 },
    "seasons/2024": { ...FOLLOWED_2025, year: 2024 },
    "seasons/2025": FOLLOWED_2025,
  };
  for (const answer of [{ missing: ["standings"] }, { schedule: null }]) {
    const { documents, loads } = await runJob(docs, (season) =>
      season === 2025 ? { ...SNAPSHOT_2025, ...answer } : { ...SNAPSHOT_2025, season: 2024 },
    );
    assert.deepEqual(loads, [2025, 2024]);
    assert.equal(documents.get("seasons/2025"), FOLLOWED_2025);
    assert.ok(documents.get("seasons/2024").standings);
  }
});
