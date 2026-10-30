import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot as buildBasketball } from "../apps/wnba/worker/src/adapters/wnba.js";
import { buildSnapshot as buildBaseball } from "../apps/mlb/worker/src/adapters/mlb.js";
import { SeasonStore as BasketballStore } from "../apps/wnba/worker/src/store.js";
import { SeasonStore as BaseballStore } from "../apps/mlb/worker/src/store.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { FAILED_FEED_WAIT_MS, createMemoryStorage } from "../shared/worker/feed-keeper.js";
import {
  SLOW_FEEDS as BASKETBALL_FEEDS,
  createSnapshotLoader as createBasketballLoader,
} from "../apps/wnba/worker/src/snapshot.js";
import {
  SLOW_FEEDS as BASEBALL_FEEDS,
  createSnapshotLoader as createBaseballLoader,
} from "../apps/mlb/worker/src/snapshot.js";
import { REQUESTS } from "../apps/wnba/worker/src/adapters/wnba.js";
import { MLB_API, listMlbRequests } from "../apps/mlb/worker/src/adapters/mlb.js";
import { describeEspnBoxScore } from "../apps/wnba/worker/src/espn-box-score.js";

const LEAGUES = [
  {
    app: "wnba",
    fixture: "2026-09-30-afternoon",
    buildSnapshot: buildBasketball,
    Store: BasketballStore,
  },
  { app: "mlb", fixture: "2026-09-24-evening", buildSnapshot: buildBaseball, Store: BaseballStore },
];

/** @param {any} responses */
function corruptScores(responses) {
  for (const game of responses.scoreboard?.scoreboard?.games ?? [])
    game.homeTeam.score = "malformed";
  for (const name of ["schedule", "postseason", "seasonGames"])
    for (const day of responses[name]?.dates ?? [])
      for (const game of day.games) game.teams.home.score = "malformed";
}

/** @param {string} app @param {any} response */
function corruptStandings(app, response) {
  if (app === "wnba") {
    const table = response.resultSets[0];
    table.rowSet[0][table.headers.indexOf("WINS")] = "bad";
  } else response.records[0].teamRecords[0].wins = "bad";
}

for (const { app, fixture: name } of LEAGUES) {
  for (const feed of app === "wnba"
    ? ["standings", "schedule", "bracket"]
    : ["standings", "seasonGames", "postseason"]) {
    for (const isWarm of [false, true]) {
      test(`${app}: a malformed ${feed} feed never replaces its ${isWarm ? "good" : "empty"} cache and retries after correction`, async () => {
        const fixture = JSON.parse(
          readFileSync(
            new URL(`../apps/${app}/tests/fixtures/${name}.json`, import.meta.url),
            "utf8",
          ),
        );
        if (app === "mlb")
          fixture.responses.seasonGames = JSON.parse(
            readFileSync(
              new URL("../apps/mlb/tests/fixtures/2026-10-09-season.json", import.meta.url),
              "utf8",
            ),
          ).responses.seasonGames;
        const field = {
          standings: "standings",
          schedule: "schedule",
          bracket: "series",
          seasonGames: "schedule",
          postseason: "series",
        }[feed];
        const feedPolicy = app === "wnba" ? BASKETBALL_FEEDS : BASEBALL_FEEDS;
        let now = Date.parse(fixture.now);
        let isMalformed = !isWarm;
        let feedReads = 0;
        let first;
        const fetchImpl = async (url) => {
          const requests =
            app === "wnba"
              ? {
                  scoreboard: REQUESTS.scoreboard,
                  schedule: REQUESTS.schedule,
                  bracket: REQUESTS.bracket(fixture.season),
                  standings: REQUESTS.standings(fixture.season),
                }
              : Object.fromEntries(
                  Object.entries(
                    listMlbRequests(
                      fixture.season,
                      now,
                      fixture.responses.season.seasons[0].regularSeasonEndDate,
                    ),
                  ).map(([key, path]) => [key, MLB_API + path]),
                );
          const requestedFeed = Object.keys(requests).find((key) => requests[key] === url);
          const answer = structuredClone(fixture.responses[requestedFeed]);
          if (!answer) return new Response("", { status: 404 });
          if (requestedFeed === feed) {
            feedReads++;
            if (isMalformed) {
              if (feed === "standings") corruptStandings(app, answer);
              if (app === "mlb" && feed !== "standings") {
                const game = answer.dates.flatMap((day) => day.games)[0];
                game.linescore = { ...game.linescore, currentInning: "invalid" };
              }
              if (feed === "schedule")
                answer.leagueSchedule.gameDates[0].games[0].homeTeam.score = "bad";
              if (feed === "bracket")
                answer.bracket.playoffBracketSeries[0].highSeedSeriesWins = "bad";
            }
          }
          return new Response(JSON.stringify(answer));
        };
        const createLoader = app === "wnba" ? createBasketballLoader : createBaseballLoader;
        const storage = createMemoryStorage();
        const options = { fetchImpl, now: () => now, storage };
        let loader = createLoader(options);
        if (isWarm) {
          first = await loader.loadSnapshot(fixture.season);
          now += feedPolicy[feed].maxAgeMs + 1;
          isMalformed = true;
        }
        if (app === "mlb" && feed === "postseason" && !isWarm) {
          await assert.rejects(
            () => loader.loadSnapshot(fixture.season),
            /Invalid sports data at inning/,
          );
        } else {
          const failed = await loader.loadSnapshot(fixture.season);
          assert.match(failed.failures[feed], /Invalid sports data/);
          if (isWarm) {
            assert.ok(first[field]);
            assert.deepEqual(failed[field], first[field]);
          }
        }
        assert.equal(feedReads, isWarm ? 2 : 1);
        isMalformed = false;
        if (feed === "seasonGames")
          fixture.responses.seasonGames.dates[0].games[0].venue = {
            name: "Corrected ballpark",
            location: { city: "Example" },
          };
        now += FAILED_FEED_WAIT_MS + 1;
        loader = createLoader(options);
        const recovered = await loader.loadSnapshot(fixture.season);
        assert.equal(recovered.failures[feed], undefined);
        assert.ok(recovered[field]);
        const expected = app === "wnba" ? buildBasketball : buildBaseball;
        assert.deepEqual(
          recovered[field],
          expected(fixture.responses, { season: fixture.season, now })[field],
        );
        if (feed === "seasonGames")
          assert.equal(
            Object.values(recovered.schedule)
              .flat()
              .find(
                (game) =>
                  game.id === String(fixture.responses.seasonGames.dates[0].games[0].gamePk),
              ).ballpark.name,
            "Corrected ballpark",
          );
        assert.equal(feedReads, isWarm ? 3 : 2);
      });
    }
  }
}

test("a partial historical MLB read cannot save invalid postseason log scores", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../apps/mlb/tests/fixtures/2025-final.json", import.meta.url), "utf8"),
  );
  const responses = structuredClone(fixture.responses);
  responses.schedule = null;
  responses.seasonGames = null;
  responses.postseason.dates[0].games[0].teams.home.score = "bad";
  assert.throws(
    () => buildBaseball(responses, { season: fixture.season, now: Date.parse(fixture.now) }),
    /Invalid sports data at log/,
  );
});

test("recorded ESPN box scores reject malformed team counts and shooting before persistence", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../apps/wnba/tests/fixtures/2026-10-29-espn-box-scores.json", import.meta.url),
      "utf8",
    ),
  );
  const [id, game] = Object.entries(fixture.games)[0];
  for (const key of ["assists", "fieldGoalsMade-fieldGoalsAttempted"]) {
    const summary = structuredClone(game.summary);
    summary.boxscore.teams[0].statistics.find((stat) => stat.name === key).displayValue = "bad";
    assert.throws(
      () => describeEspnBoxScore(summary, id, null),
      /Invalid sports data at (away|home).stats/,
    );
  }
});

for (const { app, fixture: name, buildSnapshot, Store } of LEAGUES) {
  test(`${app}: malformed adapter output preserves the last season and reaches feed health, then recovers`, async () => {
    const fixture = JSON.parse(
      readFileSync(new URL(`../apps/${app}/tests/fixtures/${name}.json`, import.meta.url), "utf8"),
    );
    const now = Date.parse(fixture.now);
    let responses = fixture.responses;
    const { ctx } = createDurableObjectContext();
    /** @returns {Promise<any>} */
    const loadSnapshot = async () => buildSnapshot(responses, { season: fixture.season, now });
    const store = new Store(
      ctx,
      {},
      {
        now: () => now,
        createLoadSnapshot: () => loadSnapshot,
      },
    );
    await store.updateSeason();
    const key = `seasons/${fixture.season}`;
    const saved = await store.docs.read(key);
    assert.ok(saved);
    responses = structuredClone(fixture.responses);
    corruptScores(responses);
    await store.updateSeason();
    assert.deepEqual(await store.docs.read(key), saved);
    assert.match((await store.docs.read("live/status")).detail, /Invalid sports data/);
    const failing = (await store.docs.read("live/feeds")).failing;
    assert.match(JSON.stringify(failing), /Invalid sports data/);
    assert.doesNotMatch(JSON.stringify(failing), /malformed/);
    responses = fixture.responses;
    await store.updateSeason();
    assert.deepEqual(await store.docs.read(key), saved);
    assert.deepEqual((await store.docs.read("live/feeds")).failing, {});
  });
}
