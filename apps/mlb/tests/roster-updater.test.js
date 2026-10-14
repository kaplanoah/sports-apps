import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEasternDay } from "#shared/days.js";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { listClubs, readMlbTeamId } from "../page/js/snapshot.js";
import {
  describeHitters,
  listPeopleRequest,
  nameHittersKey,
  namePlayerKey,
} from "../worker/src/players.js";
import { nameInjuriesRequest } from "../worker/src/injuries.js";
import {
  createRosterJob,
  listTransactionsRequest,
  nameGameLogReadsKey,
} from "../worker/src/roster-updater.js";
import {
  describeRoster,
  indexSeasonStats,
  listRosterRequest,
  listSeasonStatsRequest,
  nameRosterKey,
} from "../worker/src/rosters.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

// What MLB answered early on Oct 8: the Guardians', Yankees', and Dodgers' 40-man rosters, their
// players' regular seasons, and the day's transactions.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-08-rosters.json`, "utf8"),
);
// ESPN's MLB injury report on the evening of Oct 11, trimmed to what the sheets keep of it.
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);
const MLB_API = "https://statsapi.mlb.com";
const SEASON = FIXTURE.season;
const NOW = Date.parse(FIXTURE.recordedAt);
const MINUTE_MS = 60 * 1000;
const TODAY = readEasternDay(NOW).date;
const HITTING = listSeasonStatsRequest(SEASON, "hitting");
const PITCHING = listSeasonStatsRequest(SEASON, "pitching");
const POSTSEASON_HITTING = listSeasonStatsRequest(SEASON, "hitting", { gameType: "P" });
const POSTSEASON_PITCHING = listSeasonStatsRequest(SEASON, "pitching", { gameType: "P" });
const QUALIFIED = listSeasonStatsRequest(SEASON, "hitting", { pool: "qualified" });
const PEOPLE = listPeopleRequest(SEASON);
const NUMBERS = [HITTING, PITCHING, POSTSEASON_HITTING, POSTSEASON_PITCHING, QUALIFIED];
const TRANSACTIONS = listTransactionsRequest(TODAY);
const RECORDED = { CLE: 114, NYY: 147, LAD: 119 };

/** @param {string} club */
const nameClubRequest = (club) =>
  listRosterRequest(/** @type {number} */ (readMlbTeamId(club)), SEASON);

/**
 * MLB's answers, by request, each a copy a test can change: a club the fixture didn't record
 * answers with an empty roster.
 */
function listAnswers() {
  const answers = structuredClone(FIXTURE.answers);
  for (const club of listClubs()) answers[nameClubRequest(club)] ??= { roster: [] };
  return answers;
}

/** @param {string} path */
const isGameLogRequest = (path) => path.startsWith("/api/v1/people?personIds=");

/**
 * The players a request for game logs names, by id.
 * @param {string} path
 */
const readGameLogIds = (path) =>
  (/personIds=([\d,]+)/.exec(path)?.[1] ?? "").split(",").map(Number);

/**
 * MLB's answer for some players' game logs, from the ones the fixture recorded.
 * @param {string} path
 */
const answerGameLogs = (path) => ({
  people: readGameLogIds(path)
    .map((id) => FIXTURE.gameLogs[id])
    .filter(Boolean),
});

/**
 * MLB's answers, by request, and ESPN's injury report, which a test can refuse or change.
 * @param {Record<string, any>} answers
 */
function createMlbFetch(answers) {
  /** @type {string[]} */
  const requests = [];
  const refused = new Set();
  const espn = { requests: 0, isRefused: false, report: structuredClone(INJURIES.report) };
  /** @param {string} url */
  const fetchImpl = async (url) => {
    if (url === nameInjuriesRequest()) {
      espn.requests += 1;
      if (espn.isRefused) return new Response("", { status: 503 });
      return new Response(JSON.stringify(espn.report));
    }
    const path = url.slice(MLB_API.length);
    requests.push(path);
    if (refused.has(path)) return new Response("", { status: 503 });
    if (isGameLogRequest(path)) return new Response(JSON.stringify(answerGameLogs(path)));
    if (!(path in answers)) return new Response("", { status: 503 });
    return new Response(JSON.stringify(answers[path]));
  };
  return { requests, refused, espn, fetchImpl };
}

/**
 * A slate with this many of today's games final, which the job counts as games end.
 * @param {number} finals
 */
const createSlate = (finals) => ({
  today: {
    date: TODAY,
    games: Array.from({ length: 4 }, (_, index) => ({ state: index < finals ? "final" : "pre" })),
  },
});

/** A store whose current season is 2026, and the job that keeps its rosters, run as it runs. */
function createRun() {
  const docs = createDocs({
    "live/current": { season: SEASON },
    [`seasons/${SEASON}`]: { year: SEASON, slate: createSlate(0) },
  });
  const answers = listAnswers();
  const mlb = createMlbFetch(answers);
  const clock = { now: NOW };
  const storage = createJobStorage();
  const job = createRosterJob();
  const runJob = () =>
    job.updateStore({
      docs,
      storage,
      loadSnapshot: async () => null,
      env: {},
      fetchImpl: mlb.fetchImpl,
      now: () => clock.now,
    });
  /** @param {number} minutes */
  const wait = (minutes) => {
    clock.now += minutes * MINUTE_MS;
  };
  /** Takes the requests made since the last take. */
  const takeRequests = () => mlb.requests.splice(0);
  /** @param {number} finals */
  const endGames = (finals) =>
    docs.write(`seasons/${SEASON}`, { year: SEASON, slate: createSlate(finals) });
  return {
    docs,
    storage,
    answers,
    refused: mlb.refused,
    espn: mlb.espn,
    runJob,
    wait,
    takeRequests,
    endGames,
  };
}

/** @param {string[]} requests */
const listRosterClubs = (requests) =>
  requests
    .map((path) => /\/teams\/(\d+)\/roster/.exec(path)?.[1])
    .filter(Boolean)
    .map((id) => listClubs().find((club) => readMlbTeamId(club) === Number(id)));

/** Runs the job until every club's roster is read, five minutes apart. */
/**
 * Runs the job until every club's roster is read, and every player's last games have settled,
 * five minutes apart.
 */
async function fillRosters(run) {
  for (let filled = 0; filled < 9; filled += 1) {
    await run.runJob();
    run.wait(5);
  }
  run.takeRequests();
  run.docs.writes.length = 0;
}

/** @param {string[]} requests */
const listLeagueRequests = (requests) =>
  requests.filter((path) => !path.includes("/roster") && !isGameLogRequest(path));

test("each club's roster has its active players and its injured list, each with his season so far", () => {
  const answers = FIXTURE.answers;
  const roster = describeRoster({
    club: "LAD",
    season: SEASON,
    roster: answers[listRosterRequest(RECORDED.LAD, SEASON)],
    hitting: indexSeasonStats(answers[HITTING]),
    pitching: indexSeasonStats(answers[PITCHING]),
  });

  assert.equal(roster.players.filter((player) => !player.injury).length, 26);
  assert.deepEqual(
    roster.players.filter((player) => player.injury).map((player) => player.injury),
    ["60-day IL", "15-day IL", "60-day IL", "60-day IL", "60-day IL", "60-day IL", "60-day IL"],
  );
  const ohtani = roster.players.find((player) => player.name === "Shohei Ohtani");
  assert.equal(ohtani?.position, "TWP");
  assert.ok(ohtani?.hitting?.plateAppearances > 0);
  assert.ok(ohtani?.pitching?.inningsPitched);
});

test("a player on the 40-man roster but not active or injured isn't on the club's", () => {
  const answer = FIXTURE.answers[listRosterRequest(RECORDED.CLE, SEASON)];
  const roster = describeRoster({
    club: "CLE",
    season: SEASON,
    roster: answer,
    hitting: new Map(),
    pitching: new Map(),
  });
  assert.equal(answer.roster.length, 40);
  assert.equal(roster.players.length, 26);
});

test("every club's roster fills six a run, after one read of every player's numbers and the day's transactions", async () => {
  const run = createRun();
  const runs = [];
  for (let index = 0; index < 6; index += 1) {
    await run.runJob();
    runs.push(run.takeRequests());
    run.wait(5);
  }

  assert.deepEqual(
    new Set(listLeagueRequests(runs[0])),
    new Set([TRANSACTIONS, ...NUMBERS, PEOPLE]),
  );
  assert.deepEqual(
    runs.map((requests) => listRosterClubs(requests).length),
    [6, 6, 6, 6, 6, 0],
  );
  assert.deepEqual(
    runs
      .slice(1)
      .flat()
      .filter((path) => !path.includes("/roster") && !isGameLogRequest(path)),
    [],
  );
  assert.deepEqual(new Set(listRosterClubs(runs.flat())), new Set(listClubs()));
  assert.equal(run.docs.writes.filter((key) => key.startsWith("rosters/")).length, 30);
  assert.equal(run.docs.stored.get(nameRosterKey("LAD")).players.length, 33);
  const rostered = ["CLE", "NYY", "LAD"].map(
    (club) => run.docs.stored.get(nameRosterKey(club)).players.length,
  );
  assert.equal(
    run.docs.writes.filter((key) => key.startsWith("players/")).length,
    rostered.reduce((total, count) => total + count, 0),
  );
  assert.deepEqual(
    run.docs.stored.get(nameHittersKey(SEASON)),
    describeHitters(FIXTURE.answers[QUALIFIED]),
  );
});

// Jung Hoo Lee, on the Giants' roster, as MLB lists him, whose first name is two words.
const LEE = { id: 808982, fullName: "Jung Hoo Lee", useName: "Jung Hoo", useLastName: "Lee" };

/** @param {ReturnType<typeof createRun>} run */
function addLee(run) {
  run.answers[nameClubRequest("SF")].roster.push({
    person: { id: LEE.id, fullName: LEE.fullName },
    jerseyNumber: "51",
    position: { abbreviation: "CF" },
    status: { description: "Active" },
  });
  run.answers[PEOPLE].people.push(LEE);
}

/**
 * A player in the season's list of players.
 * @param {ReturnType<typeof createRun>} run
 * @param {number} id
 */
const findIndexed = (run, id) =>
  run.docs.stored
    .get(namePlayerIndexKey(SEASON))
    .players.find((/** @type {any} */ player) => player.id === String(id));

test("once every club's roster is read, the season's list of players names each one on a roster, by MLB's own names, with his club and number", async () => {
  const run = createRun();
  addLee(run);
  await run.runJob();
  assert.equal(run.docs.stored.get(namePlayerIndexKey(SEASON)), undefined);

  await fillRosters(run);
  const rostered = [...Object.keys(RECORDED), "SF"].flatMap((club) =>
    run.docs.stored
      .get(nameRosterKey(club))
      .players.map((/** @type {any} */ player) => `${club}:${player.id}`),
  );
  assert.deepEqual(
    run.docs.stored
      .get(namePlayerIndexKey(SEASON))
      .players.map((/** @type {any} */ player) => `${player.team}:${player.id}`)
      .sort(),
    rostered.sort(),
  );
  assert.deepEqual(findIndexed(run, LEE.id), {
    id: "808982",
    team: "SF",
    number: "51",
    firstName: "Jung Hoo",
    lastName: "Lee",
  });
  assert.deepEqual(findIndexed(run, 665862), {
    id: "665862",
    team: "NYY",
    number: "13",
    firstName: "Jazz",
    lastName: "Chisholm Jr.",
  });
});

test("a player MLB's list of every player doesn't have yet is named by his full name, split at its first space", async () => {
  const run = createRun();
  addLee(run);
  run.answers[PEOPLE].people.pop();
  await fillRosters(run);
  const lee = findIndexed(run, LEE.id);
  assert.deepEqual([lee.firstName, lee.lastName], ["Jung", "Hoo Lee"]);
});

test("a transaction not seen before reads again only the rosters of the clubs it names", async () => {
  const run = createRun();
  await fillRosters(run);
  run.answers[TRANSACTIONS].transactions.push({
    id: 1,
    fromTeam: { id: 158 },
    toTeam: { id: 119 },
  });

  await run.runJob();
  assert.deepEqual(run.takeRequests(), [], "the transactions aren't old yet");
  run.wait(30);
  await run.runJob();

  const requests = run.takeRequests();
  assert.deepEqual(listLeagueRequests(requests), [TRANSACTIONS]);
  assert.deepEqual(listRosterClubs(requests).sort(), ["LAD", "MIL"]);
  run.wait(5);
  await run.runJob();
  assert.deepEqual(run.takeRequests(), [], "each read once");
});

test("a game's end reads every player's numbers again, and saves only the rosters and players that changed", async () => {
  const run = createRun();
  await fillRosters(run);
  const kwan = run.answers[HITTING].stats[0].splits.find(
    (/** @type {any} */ split) => split.player.id === 680757,
  );

  await run.endGames(1);
  kwan.stat.plateAppearances += 4;
  kwan.stat.gamesPlayed += 1;
  await run.runJob();

  const requests = run.takeRequests();
  assert.deepEqual(new Set(listLeagueRequests(requests)), new Set(NUMBERS));
  assert.deepEqual(requests.filter(isGameLogRequest).map(readGameLogIds), [[680757]]);
  assert.deepEqual(
    run.docs.writes.filter((key) => !key.startsWith("seasons/")),
    [nameRosterKey("CLE"), namePlayerKey(SEASON, 680757)],
  );
});

test("runs with nothing new read only the day's transactions, once they're old, and save nothing", async () => {
  const run = createRun();
  await fillRosters(run);
  for (let minutes = 0; minutes < 60; minutes += 5) {
    await run.runJob();
    run.wait(5);
  }
  assert.deepEqual(run.takeRequests(), [TRANSACTIONS, TRANSACTIONS]);
  assert.deepEqual(run.docs.writes, []);
});

test("each club's roster is read again once a day, six a run", async () => {
  const run = createRun();
  await fillRosters(run);
  run.wait(24 * 60 - 25);
  await run.runJob();
  const requests = run.takeRequests();
  assert.equal(listRosterClubs(requests).length, 6);
});

test("a roster MLB doesn't answer is read again on the next run", async () => {
  const run = createRun();
  run.refused.add(nameClubRequest("ARI"));
  await run.runJob();
  assert.ok(listRosterClubs(run.takeRequests()).includes("ARI"));
  run.refused.clear();
  run.wait(5);
  await run.runJob();
  assert.equal(listRosterClubs(run.takeRequests())[0], "ARI");
  assert.ok(run.docs.stored.has(nameRosterKey("ARI")));
});

test("a store with no current season reads nothing", async () => {
  const run = createRun();
  run.docs.stored.delete("live/current");
  await run.runJob();
  assert.deepEqual(run.takeRequests(), []);
});

test("rosters don't wait on every player's numbers, which save once MLB answers them", async () => {
  const run = createRun();
  run.refused.add(HITTING);
  await run.runJob();
  assert.equal(listRosterClubs(run.takeRequests()).length, 6);
  assert.deepEqual(run.docs.writes, []);
  run.refused.clear();
  run.wait(5);
  await run.runJob();
  assert.equal(
    run.docs.writes.filter((key) => key.startsWith("rosters/")).length,
    12,
    "the twelve read so far",
  );
  assert.ok(run.docs.writes.includes(namePlayerKey(SEASON, 680757)));
});

test("each rostered player's last games are read as his club's roster arrives, a few batches a run, and once more as they settle", async () => {
  const run = createRun();
  /** @type {number[][]} */
  const runs = [];
  for (let index = 0; index < 9; index += 1) {
    await run.runJob();
    runs.push(run.takeRequests().filter(isGameLogRequest).flatMap(readGameLogIds));
    run.wait(5);
  }
  for (let index = 0; index < 6; index += 1) {
    await run.runJob();
    assert.deepEqual(run.takeRequests().filter(isGameLogRequest), [], "settled");
    run.wait(5);
  }

  const rostered = Object.keys(FIXTURE.gameLogs).map(Number);
  const reads = runs.flat();
  for (const id of rostered)
    assert.equal(reads.filter((each) => each === id).length, 2, `${id} read twice`);
  assert.ok(runs.every((ids) => ids.length <= 4 * 30));
  const kwan = run.docs.stored.get(namePlayerKey(SEASON, 680757));
  assert.equal(kwan.lastGames.hitting.length, 5);
  assert.equal(kwan.lastGames.hitting[0].date, "2026-10-07");
});

test("last games read before they kept each game's pitches are read once more, and then have them", async () => {
  const run = createRun();
  await fillRosters(run);
  const settled = await run.storage.get(nameGameLogReadsKey(SEASON));
  await run.storage.delete(nameGameLogReadsKey(SEASON));
  await run.storage.put(`game-log-reads:${SEASON}`, settled);

  await run.runJob();
  const reread = run.takeRequests().filter(isGameLogRequest).flatMap(readGameLogIds);
  const rostered = Object.keys(FIXTURE.gameLogs).map(Number);
  assert.deepEqual(
    reread.sort((first, second) => first - second),
    rostered.sort((first, second) => first - second),
  );
  const bibee = run.docs.stored.get(namePlayerKey(SEASON, 676440));
  assert.equal(bibee.lastGames.pitching[0].numberOfPitches, 94);
});

test("a batch of last games MLB doesn't answer is read on the next run", async () => {
  const run = createRun();
  await run.runJob();
  const first = run.takeRequests().filter(isGameLogRequest);
  for (const path of first) run.refused.add(path);
  run.wait(5);
  await run.runJob();
  const retried = run.takeRequests().filter(isGameLogRequest);
  assert.deepEqual(retried.slice(0, first.length), first);
});

test("a run reads at most four batches of thirty players' last games", async () => {
  const run = createRun();
  const guardians = FIXTURE.answers[listRosterRequest(RECORDED.CLE, SEASON)];
  for (const [index, club] of listClubs().entries()) {
    if (club in RECORDED) continue;
    run.answers[nameClubRequest(club)] = {
      roster: guardians.roster.map((/** @type {any} */ entry) => ({
        ...entry,
        person: { ...entry.person, id: entry.person.id + (index + 1) * 10_000_000 },
      })),
    };
  }
  /** @type {number[]} */
  const batches = [];
  for (let index = 0; index < 12; index += 1) {
    await run.runJob();
    batches.push(run.takeRequests().filter(isGameLogRequest).length);
    run.wait(5);
  }
  assert.ok(Math.max(...batches) === 4, `at most four a run: ${batches}`);
});

const TREINEN = namePlayerKey(SEASON, 595014);
const FREEMAN = namePlayerKey(SEASON, 518692);

test("a player on the injured list keeps MLB's stay and why he's there, from ESPN's report: what's wrong, RotoWire's sentence, and when ESPN changed it", async () => {
  const run = createRun();
  await fillRosters(run);

  const treinen = run.docs.stored.get(TREINEN);
  assert.equal(treinen.injury, "15-day IL");
  assert.deepEqual(treinen.out, {
    reason: "Right shoulder inflammation",
    sentence:
      "President of baseball operations Andrew Friedman said Saturday that Treinen (shoulder) hasn't been ruled out for a return in the postseason, Jon Paul Hoornstra of Newsweek.com reports.",
    updated: "2026-10-03T18:34:00.000Z",
  });
  const freeman = run.docs.stored.get(FREEMAN);
  assert.equal(freeman.injury, null);
  assert.equal(freeman.out, null);
});

test("a player ESPN lists who isn't on MLB's injured list keeps nothing of it, since MLB's roster says who is on the list", async () => {
  const run = createRun();
  const dodgers = run.espn.report.injuries.find((/** @type {any} */ team) => team.id === "19");
  dodgers.injuries.push({
    status: "Day-To-Day",
    date: "2026-10-10T12:00Z",
    shortComment: "Freeman (ankle) is day-to-day.",
    athlete: { firstName: "Freddie", lastName: "Freeman" },
    details: { type: "Ankle", side: "Right" },
  });
  await fillRosters(run);
  assert.equal(run.docs.stored.get(FREEMAN).out, null);
});

test("ESPN's report is read once for the whole league each hour, and one that fails keeps the reasons the last one gave", async () => {
  const run = createRun();
  await fillRosters(run);
  assert.equal(run.espn.requests, 1);
  for (let minutes = 0; minutes < 60; minutes += 5) {
    await run.runJob();
    run.wait(5);
  }
  assert.equal(run.espn.requests, 2);

  run.espn.isRefused = true;
  run.wait(60);
  await run.runJob();
  assert.equal(run.espn.requests, 3);
  assert.equal(run.docs.stored.get(TREINEN).out?.reason, "Right shoulder inflammation");
  assert.deepEqual(
    run.docs.writes.filter((key) => key.startsWith("players/")),
    [],
    "nothing changed",
  );
});

test("a reason ESPN changes saves again only the player it's about", async () => {
  const run = createRun();
  await fillRosters(run);
  const dodgers = run.espn.report.injuries.find((/** @type {any} */ team) => team.id === "19");
  const treinen = dodgers.injuries.find(
    (/** @type {any} */ injury) => injury.athlete.lastName === "Treinen",
  );
  treinen.shortComment = "Treinen (shoulder) threw a bullpen session Sunday.";
  treinen.date = "2026-10-11T20:00Z";

  run.wait(60);
  await run.runJob();

  assert.equal(
    run.docs.stored.get(TREINEN).out?.sentence,
    "Treinen (shoulder) threw a bullpen session Sunday.",
  );
  assert.deepEqual(
    run.docs.writes.filter((key) => key.startsWith("players/")),
    [TREINEN],
  );
});
