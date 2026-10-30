import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { createBoxScoreServer } from "../worker/src/box-score.js";
import { describeBoxScore, nameBoxScoreRequest } from "../worker/src/adapters/box-score.js";
import { REQUESTS } from "../worker/src/adapters/wnba.js";
import { nameScoreboardRequest, nameSummaryRequest } from "../worker/src/adapters/lead.js";
import { createPreviewServer } from "../worker/src/preview.js";
import {
  describePreview,
  listUpcomingMeetings,
  nameMeetingsKey,
} from "../worker/src/adapters/preview.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";
import { readPlayerIndex } from "./player-fixtures.js";

const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const NOW = Date.parse(GAMES.now);
// What ESPN answered for the same finals.
const ESPN = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-29-espn-box-scores.json`, "utf8"),
);
// Aces at Fever, Game 2, and Valkyries at Wings, Game 2, which went to overtime.
const ACES_AT_FEVER = "1042600122";
const VALKYRIES_AT_WINGS = "1042600112";
// Aces at Fever, Game 3, which hadn't started.
const NEXT_ACES_AT_FEVER = "1042600123";
/** @type {Record<string, { away: string, home: string, start: string }>} */
const TEAMS = {
  [ACES_AT_FEVER]: { away: "LVA", home: "IND", start: "2026-09-29T22:30:00Z" },
  [VALKYRIES_AT_WINGS]: { away: "GSV", home: "DAL", start: "2026-10-01T01:00:00Z" },
  [NEXT_ACES_AT_FEVER]: { away: "IND", home: "LVA", start: "2026-10-03T00:00:00Z" },
};

/**
 * The query a game sheet reads a game's box score with.
 * @param {string} id
 */
const nameGameQuery = (id) => new URLSearchParams({ id, ...TEAMS[id] });

/**
 * ESPN's scoreboards and summaries of the finals, with each summary as `changeSummary` leaves it.
 * @param {(summary: any) => any} [changeSummary]
 * @returns {[string, any][]}
 */
const listEspnAnswers = (changeSummary = (summary) => summary) =>
  Object.values(ESPN.games).flatMap(({ game, eventId, scoreboard, summary }) => [
    [nameScoreboardRequest(game.start), scoreboard],
    [nameSummaryRequest(eventId), changeSummary(structuredClone(summary))],
  ]);

/**
 * Answers the league's feeds from the fixture, and ESPN's with any answers given, recording each
 * read, with any feed refused.
 * @param {{ refuse?: Record<string, number | "page" | "empty">, espn?: [string, any][] }} [options] a refused feed's status, by URL
 */
function createLeague({ refuse = {}, espn = [] } = {}) {
  const answers = new Map([
    ...Object.entries(GAMES.boxScores).map(
      ([id, box]) => /** @type {[string, any]} */ ([nameBoxScoreRequest(id), box]),
    ),
    [REQUESTS.schedule, GAMES.preview.schedule],
    ...espn,
  ]);
  const reads = [];
  const fetchImpl = async (url, init) => {
    reads.push({ url, init });
    if (refuse[url] === "page") return new Response("<!DOCTYPE html><html></html>");
    if (refuse[url] === "empty") return new Response(JSON.stringify({ meta: { code: 200 } }));
    if (refuse[url]) return new Response("<Error/>", { status: refuse[url] });
    if (!answers.has(url)) return new Response("<Error/>", { status: 403 });
    return new Response(JSON.stringify(answers.get(url)));
  };
  return { reads, fetchImpl };
}

const askBoxScore = (server, query) =>
  server.serveBoxScore(new URL(`https://app.example/k3y/box-score?${query}`));
const askPreview = (server, query) =>
  server.servePreview(new URL(`https://app.example/k3y/preview?${query}`));

test("a box score gives each team's points by quarter, its stats, and the players who got in", () => {
  const box = describeBoxScore(GAMES.boxScores[ACES_AT_FEVER]);

  assert.equal(box.state, "final");
  assert.deepEqual(
    [box.away.team, box.away.score, box.home.team, box.home.score],
    ["LVA", 89, "IND", 99],
  );
  assert.deepEqual(box.home.periods, [18, 30, 24, 27]);
  assert.deepEqual(box.home.stats.fieldGoals, [37, 71]);
  assert.deepEqual(box.home.stats.threePointers, [8, 21]);
  assert.equal(box.home.stats.paintPoints, 58);
  const roster = GAMES.boxScores[ACES_AT_FEVER].game.homeTeam.players;
  const played = roster.filter((player) => player.played === "1");
  assert.ok(played.length < roster.length);
  assert.equal(box.home.players.length, played.length);
  const hull = box.home.players.find((player) => player.lastName === "Hull");
  assert.deepEqual(hull, {
    id: 1631086,
    firstName: "Lexie",
    lastName: "Hull",
    minutes: 26,
    points: 4,
    rebounds: 7,
    assists: 1,
    fouls: 3,
  });
});

test("a box score keeps a fifth period for overtime", () => {
  const box = describeBoxScore(GAMES.boxScores[VALKYRIES_AT_WINGS]);
  assert.deepEqual(box.away.periods, [26, 19, 29, 19, 7]);
  assert.equal(box.period, 5);
});

test("the box score route reads the league's CDN as its own site would, briefly cached", async () => {
  const league = createLeague();
  const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });

  const response = await askBoxScore(server, nameGameQuery(ACES_AT_FEVER));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).home.team, "IND");
  const [{ url, init }] = league.reads;
  assert.equal(url, nameBoxScoreRequest(ACES_AT_FEVER));
  assert.equal(init.headers.referer, "https://www.wnba.com/");
  assert.equal(init.cf.cacheTtl, 5);
});

/**
 * A store that keeps one game's details.
 * @param {string} id
 * @param {any} details
 */
const keepDetails = (id, details) => async (/** @type {string} */ key) =>
  key === `games/${id}` ? details : null;

test("a finished game's box score comes from the store, and from the league while the store keeps none or the game isn't over", async () => {
  const league = createLeague();
  const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });
  const fromLeague = await (await askBoxScore(server, nameGameQuery(ACES_AT_FEVER))).json();
  const askWithKept = async (/** @type {any} */ boxScore) =>
    (
      await server.serveBoxScore(
        new URL(`https://app.example/k3y/box-score?${nameGameQuery(ACES_AT_FEVER)}`),
        keepDetails(ACES_AT_FEVER, { boxScore, lead: null }),
      )
    ).json();
  league.reads.length = 0;

  assert.deepEqual(await askWithKept(fromLeague), fromLeague);
  assert.equal(league.reads.length, 0);

  assert.deepEqual(await askWithKept({ ...fromLeague, state: "live" }), fromLeague);
  assert.deepEqual(await askWithKept(null), fromLeague);
  assert.equal(league.reads.length, 2);
});

test("a live game's box score is read from the league every time", async () => {
  const live = structuredClone(GAMES.boxScores[VALKYRIES_AT_WINGS]);
  live.game.gameStatus = 2;
  let liveReads = 0;
  const liveServer = createBoxScoreServer({
    fetchImpl: async () => {
      liveReads += 1;
      return new Response(JSON.stringify(live));
    },
  });
  await askBoxScore(liveServer, nameGameQuery(VALKYRIES_AT_WINGS));
  await askBoxScore(liveServer, nameGameQuery(VALKYRIES_AT_WINGS));
  assert.equal(liveReads, 2);
});

test("a store that can't be read stops before reading the league", async () => {
  const server = createBoxScoreServer({ fetchImpl: createLeague().fetchImpl });
  const response = await server.serveBoxScore(
    new URL(`https://app.example/k3y/box-score?${nameGameQuery(ACES_AT_FEVER)}`),
    async () => {
      throw new Error("The store answered 500");
    },
  );
  assert.equal(response.status, 502);
});

/**
 * A store that keeps the season's list of players.
 * @param {string} key
 */
const keepPlayerIndex = async (key) =>
  key === namePlayerIndexKey(2026) ? readPlayerIndex() : null;

test("while the league refuses a game's box score, it comes from ESPN's, with the league's ids for each player the store's list names", async () => {
  const url = nameBoxScoreRequest(VALKYRIES_AT_WINGS);
  const fromLeague = describeBoxScore(GAMES.boxScores[VALKYRIES_AT_WINGS]);
  const leagueIds = [...fromLeague.away.players, ...fromLeague.home.players]
    .map((player) => player.id)
    .sort();
  for (const refusal of /** @type {(number | "page" | "empty")[]} */ ([
    403,
    503,
    "page",
    "empty",
  ])) {
    const league = createLeague({ refuse: { [url]: refusal }, espn: listEspnAnswers() });
    const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });

    const response = await server.serveBoxScore(
      new URL(`https://app.example/k3y/box-score?${nameGameQuery(VALKYRIES_AT_WINGS)}`),
      keepPlayerIndex,
    );

    assert.equal(response.status, 200, String(refusal));
    const box = await response.json();
    assert.deepEqual(
      [box.id, box.state, box.away.score, box.home.score, box.away.periods],
      [
        VALKYRIES_AT_WINGS,
        "final",
        fromLeague.away.score,
        fromLeague.home.score,
        fromLeague.away.periods,
      ],
    );
    const ids = [...box.away.players, ...box.home.players].map((player) => player.id).sort();
    assert.deepEqual(ids, leagueIds);
  }
});

test("while the league refuses a game's box score, one ESPN hasn't started is a 404", async () => {
  const league = createLeague({
    refuse: { [nameBoxScoreRequest(ACES_AT_FEVER)]: 403 },
    espn: listEspnAnswers((summary) => {
      summary.header.competitions[0].status.type = { state: "pre", completed: false };
      return summary;
    }),
  });
  const response = await askBoxScore(
    createBoxScoreServer({ fetchImpl: league.fetchImpl }),
    nameGameQuery(ACES_AT_FEVER),
  );
  await assertErrorAnswer(response, 404, "not_found");
});

test("a game without a box score yet is a 404, and a league that fails without ESPN's is a 502", async () => {
  const notStarted = await askBoxScore(
    createBoxScoreServer({ fetchImpl: createLeague().fetchImpl }),
    nameGameQuery(NEXT_ACES_AT_FEVER),
  );
  assert.match(
    await assertErrorAnswer(notStarted, 404, "not_found"),
    /^Neither the WNBA nor ESPN has a box score for that game yet$/,
  );

  const url = nameBoxScoreRequest(ACES_AT_FEVER);
  for (const refusal of /** @type {(number | "page" | "empty")[]} */ ([503, "page", "empty"])) {
    const league = createLeague({ refuse: { [url]: refusal } });
    const response = await askBoxScore(
      createBoxScoreServer({ fetchImpl: league.fetchImpl }),
      nameGameQuery(ACES_AT_FEVER),
    );
    assert.match(
      await assertErrorAnswer(response, 502, "upstream_error"),
      /^Couldn't read the WNBA or ESPN: /,
    );
  }
});

test("a box score read that doesn't name a game by its id, teams, and start is refused before reading the league", async () => {
  const league = createLeague();
  const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });
  const game = Object.fromEntries(nameGameQuery(ACES_AT_FEVER));
  const queries = [
    {},
    ...["12", "../../x", "1042600122x"].map((id) => ({ ...game, id })),
    ...["away", "home", "start"].map((field) => ({ ...game, [field]: "" })),
    { ...game, away: "XYZ" },
    { ...game, home: game.away },
    { ...game, start: "tonight" },
  ];
  for (const query of queries) {
    const response = await askBoxScore(server, new URLSearchParams(query));
    await assertErrorAnswer(response, 400, "invalid_argument");
  }
  assert.equal(league.reads.length, 0);
});

test("a preview lists the teams' finished regular-season meetings, as the schedule lists them, without the playoffs", () => {
  const preview = describePreview(GAMES.preview.schedule, {
    season: 2026,
    away: "IND",
    home: "LVA",
  });

  assert.deepEqual(
    preview.meetings.map(({ id, away, home }) => [
      id.slice(0, 3),
      `${away.team} ${away.score}`,
      `${home.team} ${home.score}`,
    ]),
    [
      ["102", "IND 84", "LVA 68"],
      ["102", "IND 109", "LVA 75"],
      ["102", "LVA 86", "IND 84"],
    ],
  );
  const games = GAMES.preview.schedule.leagueSchedule.gameDates.flatMap((day) => day.games);
  const playedInPlayoffs = (game) =>
    game.gameId.startsWith("104") &&
    game.gameStatus === 3 &&
    [game.awayTeam.teamTricode, game.homeTeam.teamTricode].sort().join() === "IND,LVA";
  assert.equal(games.filter(playedInPlayoffs).length, 2);
});

test("a preview leaves out the preseason, games not yet played, and another season's schedule", () => {
  const schedule = structuredClone(GAMES.preview.schedule);
  const games = schedule.leagueSchedule.gameDates.flatMap((day) => day.games);
  const meetings = describePreview(schedule, {
    season: 2026,
    away: "DAL",
    home: "GSV",
  }).meetings;
  assert.ok(meetings.every((meeting) => !meeting.id.startsWith("101")));
  assert.ok(!meetings.some((meeting) => meeting.id === "1042600113"));
  assert.ok(games.some((game) => game.gameId === "1042600113" && game.gameStatus === 1));

  schedule.leagueSchedule.seasonYear = "2025";
  const lastSeason = describePreview(schedule, { season: 2026, away: "DAL", home: "GSV" });
  assert.equal(lastSeason.meetings, null);
});

test("the preview route reads only the schedule, outside Cloudflare's edge, for the two teams", async () => {
  const league = createLeague();
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const response = await askPreview(server, "season=2026&away=IND&home=LVA");

  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual([preview.season, preview.away, preview.home], [2026, "IND", "LVA"]);
  assert.equal(preview.meetings.length, 3);
  assert.deepEqual(
    league.reads.map((read) => read.url),
    [REQUESTS.schedule],
  );
  assert.equal(league.reads[0].init.cf, undefined);
  assert.equal(league.reads[0].init.headers["accept-encoding"], "gzip");
});

test("the preview route keeps the schedule it checked for an hour, and never a refusal", async () => {
  let time = NOW;
  const refuse = { [REQUESTS.schedule]: /** @type {"page"} */ ("page") };
  const league = createLeague({ refuse });
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => time });
  const countReads = () => league.reads.filter((read) => read.url === REQUESTS.schedule).length;

  assert.equal((await askPreview(server, "season=2026&away=IND&home=LVA")).status, 502);
  delete refuse[REQUESTS.schedule];
  await askPreview(server, "season=2026&away=IND&home=LVA");
  assert.equal(countReads(), 2);

  time += 59 * 60 * 1000;
  await askPreview(server, "season=2026&away=ATL&home=NYL");
  assert.equal(countReads(), 2);
  time += 2 * 60 * 1000;
  await askPreview(server, "season=2026&away=IND&home=LVA");
  assert.equal(countReads(), 3);
});

test("a preview whose schedule didn't answer is a 502", async () => {
  const server = createPreviewServer({
    fetchImpl: createLeague({ refuse: { [REQUESTS.schedule]: 503 } }).fetchImpl,
    now: () => NOW,
  });
  const response = await askPreview(server, "season=2026&away=IND&home=LVA");
  assert.match(
    await assertErrorAnswer(response, 502, "upstream_error"),
    /^Couldn't read the WNBA: /,
  );
});

test("a preview needs two different teams and a season, and is refused before reading otherwise", async () => {
  const league = createLeague();
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });
  for (const query of [
    "away=IND",
    "away=IND&home=IND",
    "away=IND&home=XYZ",
    "away=IND&home=LVA&season=x",
  ]) {
    await assertErrorAnswer(await askPreview(server, query), 400, "invalid_argument");
  }
  assert.equal(league.reads.length, 0);
});

/**
 * @param {string} id
 * @param {string} state
 * @param {string | null} away
 * @param {string | null} home
 */
const createGame = (id, state, away, home) => ({
  id,
  state,
  away: { team: away },
  home: { team: home },
});

test("each upcoming game's meetings are kept once for its two teams, whichever is home", () => {
  const games = [
    createGame("1042600123", "pre", "IND", "LVA"),
    createGame("1042600124", "pre", "LVA", "IND"),
    createGame("1042600201", "pre", "NYL", null),
    createGame("1042600131", "final", "WAS", "ATL"),
  ];

  const pairs = listUpcomingMeetings(GAMES.preview.schedule, { season: 2026, games });

  assert.deepEqual(pairs, [
    {
      season: 2026,
      teams: ["IND", "LVA"],
      meetings: describePreview(GAMES.preview.schedule, { season: 2026, away: "IND", home: "LVA" })
        .meetings,
    },
  ]);
  assert.equal(nameMeetingsKey(2026, ["LVA", "IND"]), "meetings/2026-IND-LVA");
  assert.deepEqual(listUpcomingMeetings(null, { season: 2026, games }), []);
  assert.deepEqual(listUpcomingMeetings(GAMES.preview.schedule, { season: 2025, games }), []);
});

test("a preview from the store is the one the schedule makes, either team at home, read without the league", async () => {
  const [pair] = listUpcomingMeetings(GAMES.preview.schedule, {
    season: 2026,
    games: [createGame("1042600123", "pre", "IND", "LVA")],
  });
  const readDoc = async (/** @type {string} */ key) =>
    key === nameMeetingsKey(2026, pair.teams) ? pair : null;

  for (const query of ["season=2026&away=IND&home=LVA", "season=2026&away=LVA&home=IND"]) {
    const league = createLeague();
    const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });
    const fromStore = await server.servePreview(
      new URL(`https://app.example/k3y/preview?${query}`),
      readDoc,
    );
    assert.equal(league.reads.length, 0);
    const fromLeague = await askPreview(server, query);
    assert.deepEqual(await fromStore.json(), await fromLeague.json());
  }
});

test("a missing preview is read through the adapter, and failed storage stops the read", async () => {
  const league = createLeague();
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });
  const url = new URL("https://app.example/k3y/preview?season=2026&away=IND&home=LVA");
  const response = await server.servePreview(url, async () => null);
  assert.equal((await response.json()).meetings.length, 3);
  assert.deepEqual(
    league.reads.map((read) => read.url),
    [REQUESTS.schedule],
  );
  await assert.rejects(
    server.servePreview(url, async () => {
      throw new Error("Storage unavailable");
    }),
    /Storage unavailable/,
  );
  assert.equal(league.reads.length, 1);
});
