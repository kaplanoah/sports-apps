import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGameAdapter, createStandingsAdapter } from "../worker/src/adapters/games.js";
import {
  createGameSourceReader,
  createGameHistory,
  createStoredGameReader,
} from "../worker/src/game-source.js";
import { findTeamCodeByEspnId, findTeamCodeByNbaId } from "../worker/src/teams.js";
import { createIdentityLookup } from "../../../shared/worker/identity.js";
import { identityPolicy } from "../worker/src/identity-policy.js";
import { createPostseasonReader } from "../worker/src/postseason.js";
import { createSeasonStore } from "../../../shared/worker/season-store.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { createRequestBudget } from "../../../shared/worker/request-budget.js";
import { FAILED_FEED_WAIT_MS } from "../../../shared/worker/feed-keeper.js";
import { readEasternDay } from "#shared/days.js";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/espn-games.json", import.meta.url), "utf8"),
);
const standings = JSON.parse(
  readFileSync(new URL("./fixtures/espn-standings.json", import.meta.url), "utf8"),
);
const readDay = (event) => readEasternDay(Date.parse(event.date)).date;
const january = new Map();
for (const event of fixtures.january.events) {
  const day = readDay(event);
  if (!january.has(day)) january.set(day, []);
  january.get(day).push(event);
}

function createHarness() {
  const context = createDurableObjectContext();
  const clock = { now: Date.parse("2026-11-03T15:00:00Z") };
  const Store = createSeasonStore({
    createLoadSnapshot: () => async () => ({ season: 2024 }),
    loadCurrentSnapshot: (load) => load(2024),
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60_000,
    listNotifications: () => [],
  });
  const store = new Store(context.ctx, {}, { now: () => clock.now });
  const identities = createIdentityLookup(context.ctx.storage, "nba");
  const state = { reads: [], mode: "valid", wait: Promise.resolve() };
  const fetchImpl = async (input) => {
    const url = new URL(input);
    state.reads.push(url);
    await state.wait;
    if (state.mode === "failed") return new Response("Unavailable", { status: 503 });
    const date = url.searchParams.get("dates");
    const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    let answer = structuredClone(
      day.startsWith("2025-01")
        ? { ...fixtures.january, events: january.get(day) ?? [] }
        : fixtures.finals,
    );
    if (state.mode === "wrong-season") answer.events[0].season.year = 2026;
    return Response.json(answer);
  };
  const createReader = (fetchWith = fetchImpl, identityLookup = identities) =>
    createGameSourceReader({
      storage: context.ctx.storage,
      docs: store.docs,
      identityLookup,
      fetchImpl: fetchWith,
      now: () => clock.now,
    });
  return {
    ...context,
    store,
    clock,
    identities,
    state,
    fetchImpl,
    createReader,
    historyStorage: store.createJobStorage("nbaHistory"),
  };
}

test("NBA team normalization uses scoped vendor IDs rather than differing abbreviations", () => {
  assert.equal(findTeamCodeByEspnId("18"), "NYK");
  assert.equal(findTeamCodeByNbaId(1610612752), "NYK");
  assert.equal(findTeamCodeByEspnId("9"), "GSW");
  assert.equal(findTeamCodeByEspnId("26"), "UTA");
  assert.equal(findTeamCodeByEspnId("NY"), null);
  assert.equal(findTeamCodeByEspnId("1610612752"), null);
});

test("recorded standings preserve all conferences, season and team record totals", async () => {
  let request;
  const read = createStandingsAdapter(async (input) => {
    request = new URL(input);
    return Response.json(standings);
  });
  const result = await read(2024);
  assert.equal(result.season, 2024);
  assert.equal(result.teams.length, 30);
  assert.equal(result.teams.filter((team) => team.conference === "East").length, 15);
  assert.equal(
    result.teams.reduce((sum, team) => sum + team.wins, 0),
    1230,
  );
  assert.equal(
    result.teams.reduce((sum, team) => sum + team.losses, 0),
    1230,
  );
  assert.equal(request.searchParams.get("season"), "2025");
});

for (const [name, corrupt] of /** @type {[string, (answer: any) => void][]} */ ([
  [
    "wrong season",
    (answer) => {
      answer.children[0].standings.season = 2026;
    },
  ],
  [
    "missing team",
    (answer) => {
      answer.children[0].standings.entries.pop();
    },
  ],
  [
    "missing wins",
    (answer) => {
      answer.children[0].standings.entries[0].stats =
        answer.children[0].standings.entries[0].stats.filter((stat) => stat.name !== "wins");
    },
  ],
  [
    "duplicate team",
    (answer) => {
      answer.children[0].standings.entries[1].team = answer.children[0].standings.entries[0].team;
    },
  ],
]))
  test(`incomplete standings with ${name} fail before persistence`, async () => {
    const answer = structuredClone(standings);
    corrupt(answer);
    const read = createStandingsAdapter(async () => Response.json(answer));
    await assert.rejects(read(2024));
  });

test("recorded Finals use event-scoped postseason and season starting year across midnight UTC", async () => {
  let request;
  const read = createGameAdapter(async (input, init) => {
    request = { url: new URL(input), headers: new Headers(init.headers) };
    return Response.json(fixtures.finals);
  });
  const [game] = await read(2024, "2025-06-22");
  assert.equal(game.season, 2024);
  assert.equal(game.day, "2025-06-22");
  assert.equal(game.start, "2025-06-23T00:00Z");
  assert.equal(game.competition, "playoffs");
  assert.equal(game.round, 4);
  assert.equal(game.number, 7);
  assert.equal(game.home.score, 103);
  assert.equal(game.away.score, 91);
  assert.equal(request.url.hostname, "site.api.espn.com");
  assert.equal(request.url.searchParams.get("limit"), "1000");
  assert.deepEqual([...request.headers], [["accept", "application/json"]]);
});

test("Cup finals and Play-In retain explicit classification without changing regular season metadata", async () => {
  const readCup = createGameAdapter(async () => Response.json(fixtures.cup));
  const [cup] = await readCup(2024, "2024-12-17");
  assert.equal(cup.isCupFinal, true);
  assert.equal(cup.competition, "cup-final");
  const readPlayIn = createGameAdapter(async () => Response.json(fixtures.playIn));
  const games = await readPlayIn(2024, "2025-04-15");
  assert.equal(games.length, 2);
  assert.ok(
    games.every((game) => game.competition === "play-in" && game.round === 0 && !game.isCupFinal),
  );
});

test("scheduled games have no invented score or active period", async () => {
  const read = createGameAdapter(async () => Response.json(fixtures.scheduled));
  const games = await read(2026, "2026-10-31");
  assert.equal(games.length, 7);
  assert.ok(
    games.every(
      (game) =>
        game.state === "pre" &&
        game.away.score === null &&
        game.home.score === null &&
        game.period === null &&
        game.clock === null,
    ),
  );
});

for (const [name, corrupt] of /** @type {[string, (answer: any) => void][]} */ ([
  [
    "wrong league",
    (answer) => {
      answer.leagues[0].id = "59";
    },
  ],
  [
    "wrong event season",
    (answer) => {
      answer.events[0].season.year = 2026;
    },
  ],
  [
    "unknown team",
    (answer) => {
      answer.events[0].competitions[0].competitors[0].id = "unknown";
    },
  ],
  [
    "duplicate event",
    (answer) => {
      answer.events.push(answer.events[0]);
    },
  ],
  [
    "negative score",
    (answer) => {
      answer.events[0].competitions[0].competitors[0].score = "-1";
    },
  ],
  [
    "missing final score",
    (answer) => {
      delete answer.events[0].competitions[0].competitors[0].score;
    },
  ],
  [
    "unknown state",
    (answer) => {
      answer.events[0].competitions[0].status.type.state = "unknown";
    },
  ],
  [
    "incomplete final",
    (answer) => {
      answer.events[0].competitions[0].status.type.completed = false;
    },
  ],
]))
  test(`malformed ${name} is rejected before game persistence`, async () => {
    const answer = structuredClone(fixtures.finals);
    corrupt(answer);
    const read = createGameAdapter(async () => Response.json(answer));
    await assert.rejects(read(2024, "2025-06-22"));
  });

test("a correct game returned for another requested league day is rejected", async () => {
  const read = createGameAdapter(async () => Response.json(fixtures.finals));
  await assert.rejects(read(2024, "2025-06-23"));
});

test("actual writer shares concurrent reads, keeps opaque IDs and serves details without vendor reads", async () => {
  const harness = createHarness();
  const reader = harness.createReader();
  const [first, second] = await Promise.all([
    reader.read(2024, "2025-06-22"),
    reader.read(2024, "2025-06-22"),
  ]);
  assert.deepEqual(first, second);
  assert.equal(harness.state.reads.length, 1);
  const game = first.games[0];
  assert.match(game.id, /^g_[a-z0-9]{12}$/);
  assert.notEqual(game.id, "401766128");
  const entry = await harness.identities.readEntry("game", game.id);
  assert.equal(entry.vendors.espn, "401766128");
  assert.equal(entry.facts.away, "IND");
  assert.equal(entry.facts.home, "OKC");
  const readStored = createStoredGameReader({
    docs: harness.store.docs,
    identityLookup: harness.identities,
  });
  assert.deepEqual(await readStored(game.id), game);
  assert.equal(await readStored("401766128"), null);
  assert.equal(harness.state.reads.length, 1);
});

test("daily writes to the same month do not lose concurrent days", async () => {
  const harness = createHarness();
  await Promise.all([
    harness.createReader().read(2024, "2025-01-01"),
    harness.createReader().read(2024, "2025-01-02"),
  ]);
  assert.deepEqual(Object.keys(harness.stored.get("nbaMonths/2024-2025-01").days).sort(), [
    "2025-01-01",
    "2025-01-02",
  ]);
});

for (const mode of ["failed", "wrong-season"])
  test(`usable monthly documents survive ${mode} reads, restart, retry deadline and recovery`, async () => {
    const harness = createHarness();
    const first = await harness.createReader().read(2024, "2025-06-22");
    harness.clock.now += 61_000;
    harness.state.mode = mode;
    const failed = await harness.createReader().read(2024, "2025-06-22");
    assert.deepEqual(failed.games, first.games);
    assert.ok(failed.failure);
    assert.equal(failed.nextReadAt, harness.clock.now + FAILED_FEED_WAIT_MS);
    const count = harness.state.reads.length;
    harness.clock.now += 6000;
    await harness.createReader().read(2024, "2025-06-22");
    assert.equal(harness.state.reads.length, count);
    harness.clock.now = failed.nextReadAt;
    harness.state.mode = "valid";
    const recovered = await harness.createReader().read(2024, "2025-06-22");
    assert.equal(recovered.failure, "");
    assert.deepEqual(recovered.games, first.games);
  });

test("bounded history resumes through all 232 January games without a monthly 200-row cap", async () => {
  const harness = createHarness();
  const days = Array.from({ length: 31 }, (_, index) => ({
    season: 2024,
    day: `2025-01-${String(index + 1).padStart(2, "0")}`,
  }));
  const history = createGameHistory({ days, createReader: harness.createReader });
  const context = (budget) => ({
    storage: harness.historyStorage,
    identityLookup: harness.identities,
    docs: harness.store.docs,
    fetchImpl: budget.fetchImpl,
    remainingRequests: budget.remaining,
    now: () => harness.clock.now,
    env: {},
    createLoadSnapshot: () => async () => ({ season: 2024 }),
  });
  for (let run = 0; run < 8; run += 1) {
    const budget = createRequestBudget(harness.fetchImpl, 4);
    const before = harness.state.reads.length;
    await history(context(budget));
    assert.ok(harness.state.reads.length - before <= 4);
  }
  assert.equal(harness.state.reads.length, 31);
  assert.equal(harness.state.reads[0].searchParams.get("dates"), "20250131");
  const month = harness.stored.get("nbaMonths/2024-2025-01");
  assert.equal(Object.keys(month.days).length, 31);
  const games = Object.values(month.days).flat();
  assert.equal(games.length, 232);
  assert.equal(new Set(games.map((game) => game.id)).size, 232);
  assert.equal(games.filter((game) => game.state === "final").length, 227);
  const postponed = games.filter((game) => game.state === "off");
  assert.equal(postponed.length, 5);
  assert.ok(
    postponed.every(
      (game) =>
        game.home.score === null &&
        game.away.score === null &&
        game.period === null &&
        !game.isTimeSet,
    ),
  );
  assert.equal((await harness.identities.readStatus()).games, 232);
  assert.equal((await harness.historyStorage.get("nba-game-history")).index, 31);
});

test("failed history waits across restarts without advancing its cursor or spending another request", async () => {
  const harness = createHarness();
  harness.state.mode = "failed";
  const days = [{ season: 2024, day: "2025-06-22" }];
  const createHistory = () => createGameHistory({ days, createReader: harness.createReader });
  const context = () => {
    const budget = createRequestBudget(harness.fetchImpl, 4);
    return {
      storage: harness.historyStorage,
      identityLookup: harness.identities,
      docs: harness.store.docs,
      fetchImpl: budget.fetchImpl,
      remainingRequests: budget.remaining,
      now: () => harness.clock.now,
      env: {},
      createLoadSnapshot: () => async () => ({ season: 2024 }),
    };
  };
  await createHistory()(context());
  const progress = await harness.historyStorage.get("nba-game-history");
  assert.equal(progress.index, 0);
  assert.equal(progress.retryAt, harness.clock.now + FAILED_FEED_WAIT_MS);
  await createHistory()(context());
  assert.equal(harness.state.reads.length, 1);
  harness.clock.now = progress.retryAt;
  harness.state.mode = "valid";
  await createHistory()(context());
  assert.equal((await harness.historyStorage.get("nba-game-history")).index, 1);
  assert.equal(harness.state.reads.length, 2);
});

test("an exhausted historical request budget causes no read or persisted progress", async () => {
  const harness = createHarness();
  const history = createGameHistory({
    days: [{ season: 2024, day: "2025-06-22" }],
    createReader: harness.createReader,
  });
  const budget = createRequestBudget(harness.fetchImpl, 0);
  await history({
    storage: harness.historyStorage,
    identityLookup: harness.identities,
    docs: harness.store.docs,
    fetchImpl: budget.fetchImpl,
    remainingRequests: budget.remaining,
    now: () => harness.clock.now,
    env: {},
    createLoadSnapshot: () => async () => ({ season: 2024 }),
  });
  assert.equal(harness.state.reads.length, 0);
  assert.equal(await harness.historyStorage.get("nba-game-history"), undefined);
});

for (const mode of ["failed", "wrong-season"])
  test(`cold ${mode} source reads create no game identities or empty month documents`, async () => {
    const harness = createHarness();
    harness.state.mode = mode;
    const result = await harness.createReader().read(2024, "2025-06-22");
    assert.equal(result.games, null);
    assert.ok(result.failure);
    assert.equal(harness.stored.has("nbaMonths/2024-2025-06"), false);
    assert.equal((await harness.identities.readStatus()).games, 0);
  });

test("a failed monthly storage write remains retryable without changing established game identities", async () => {
  const harness = createHarness();
  const first = await harness.createReader().read(2024, "2025-06-22");
  const before = structuredClone(harness.stored.get("nbaMonths/2024-2025-06"));
  const update = harness.store.docs.update;
  harness.store.docs.update = async () => {
    throw new Error("Storage unavailable");
  };
  harness.clock.now += 61_000;
  await assert.rejects(harness.createReader().read(2024, "2025-06-22"), /Storage/);
  assert.deepEqual(harness.stored.get("nbaMonths/2024-2025-06"), before);
  harness.store.docs.update = update;
  const recovered = await harness.createReader().read(2024, "2025-06-22");
  assert.deepEqual(recovered.games, first.games);
  assert.equal((await harness.identities.readStatus()).games, 1);
});

test("a malformed retained answer cannot replace a usable monthly document", async () => {
  const harness = createHarness();
  const first = await harness.createReader().read(2024, "2025-06-22");
  const entry = [...harness.stored.values()].find((value) => Array.isArray(value?.answer?.data));
  entry.answer.data[0].season = 2030;
  harness.clock.now += 6000;
  const result = await harness.createReader().read(2024, "2025-06-22");
  assert.deepEqual(result.games, first.games);
  assert.ok(result.failure);
  assert.equal(harness.state.reads.length, 1);
  assert.deepEqual(harness.stored.get("nbaMonths/2024-2025-06").days["2025-06-22"], first.games);
});

test("a changed date reuses the same opaque ID and detail lookup follows its explicit day", async () => {
  const harness = createHarness();
  const first = await harness.createReader().read(2024, "2025-06-22");
  const moved = structuredClone(fixtures.finals);
  moved.events[0].date = "2025-06-24T00:00Z";
  moved.events[0].competitions[0].date = moved.events[0].date;
  const next = await harness
    .createReader(async () => Response.json(moved))
    .read(2024, "2025-06-23");
  assert.equal(next.games[0].id, first.games[0].id);
  assert.equal((await harness.identities.readStatus()).games, 1);
  const stored = await createStoredGameReader({
    docs: harness.store.docs,
    identityLookup: harness.identities,
  })(first.games[0].id);
  assert.equal(stored.day, "2025-06-23");
});

test("simulated corrected game state replaces the source's state coherently without reminting its ID", async () => {
  const harness = createHarness();
  const first = await harness.createReader().read(2024, "2025-06-22");
  harness.clock.now += 61_000;
  const corrected = structuredClone(fixtures.finals);
  const competition = corrected.events[0].competitions[0];
  competition.status = {
    clock: 13.2,
    displayClock: "0:13.2",
    period: 4,
    type: {
      state: "in",
      name: "STATUS_IN_PROGRESS",
      completed: false,
      shortDetail: "0:13.2 - 4th",
    },
  };
  competition.competitors.find((entry) => entry.homeAway === "home").score = "101";
  const next = await harness
    .createReader(async () => Response.json(corrected))
    .read(2024, "2025-06-22");
  const game = next.games[0];
  assert.equal(game.id, first.games[0].id);
  assert.equal(game.state, "live");
  assert.equal(game.period, 4);
  assert.equal(game.clock, "0:13.2");
  assert.equal(game.home.score, 101);
  assert.equal(game.away.score, 91);
});

test("history caps a run at four days even when more request budget remains", async () => {
  const harness = createHarness();
  const days = Array.from({ length: 10 }, (_, index) => ({
    season: 2024,
    day: `2025-01-${String(index + 1).padStart(2, "0")}`,
  }));
  const history = createGameHistory({ days, createReader: harness.createReader });
  const budget = createRequestBudget(harness.fetchImpl, 10);
  await history({
    storage: harness.historyStorage,
    identityLookup: harness.identities,
    docs: harness.store.docs,
    fetchImpl: budget.fetchImpl,
    remainingRequests: budget.remaining,
    now: () => harness.clock.now,
    env: {},
    createLoadSnapshot: () => async () => ({ season: 2024 }),
  });
  assert.equal(harness.state.reads.length, 4);
  assert.equal(budget.remaining(), 6);
  assert.equal((await harness.historyStorage.get("nba-game-history")).index, 4);
});

test("disputed associations hold the usable source record instead of publishing another game's identity", async () => {
  const harness = createHarness();
  const first = await harness.createReader().read(2024, "2025-06-22");
  const id = first.games[0].id;
  await harness.identities.save([
    {
      type: "game",
      vendor: "espn",
      vendorId: "401766128",
      internalId: id,
      evidence: { method: "existing-id" },
      disputed: true,
    },
  ]);
  harness.clock.now += 61_000;
  const held = await harness.createReader().read(2024, "2025-06-22");
  assert.match(held.failure, /disputed/);
  assert.deepEqual(held.games, first.games);
  assert.equal((await harness.identities.readStatus()).disputed, 1);
});

test("NBA source and detail preparation fail closed without the agreed identity context", async () => {
  const harness = createHarness();
  const options = {
    docs: harness.store.docs,
    storage: harness.ctx.storage,
    fetchImpl: harness.fetchImpl,
    now: () => harness.clock.now,
    identityLookup: null,
  };
  assert.throws(() => createGameSourceReader(options), /identity lookup is not configured/);
  assert.throws(() => createPostseasonReader(options), /identity lookup is not configured/);
  assert.throws(() => createStoredGameReader(options), /identity lookup is not configured/);
  assert.equal(harness.state.reads.length, 0);
  assert.equal(harness.stored.size, 0);
});

test("history cannot use another lookup or fetch when its proposed JobContext lookup is missing", async () => {
  const harness = createHarness();
  let created = false;
  const history = createGameHistory({
    days: [{ season: 2024, day: "2025-06-22" }],
    createReader: () => {
      created = true;
      return harness.createReader();
    },
  });
  const budget = createRequestBudget(harness.fetchImpl, 4);
  await assert.rejects(
    history({
      storage: harness.historyStorage,
      docs: harness.store.docs,
      fetchImpl: budget.fetchImpl,
      remainingRequests: budget.remaining,
      now: () => harness.clock.now,
      env: {},
      createLoadSnapshot: () => async () => ({ season: 2024 }),
      identityLookup: null,
    }),
    /identity lookup is not configured/,
  );
  assert.equal(created, false);
  assert.equal(harness.state.reads.length, 0);
  assert.equal(await harness.historyStorage.get("nba-game-history"), undefined);
});

test("history forwards the exact league-scoped lookup from its proposed JobContext", async () => {
  const harness = createHarness();
  let received;
  const history = createGameHistory({
    days: [{ season: 2024, day: "2025-06-22" }],
    createReader: (fetchImpl, lookup) => {
      received = lookup;
      return harness.createReader(fetchImpl, lookup);
    },
  });
  const budget = createRequestBudget(harness.fetchImpl, 4);
  await history({
    storage: harness.historyStorage,
    docs: harness.store.docs,
    fetchImpl: budget.fetchImpl,
    remainingRequests: budget.remaining,
    now: () => harness.clock.now,
    env: {},
    createLoadSnapshot: () => async () => ({ season: 2024 }),
    identityLookup: harness.identities,
  });
  assert.equal(received, harness.identities);
  assert.equal((await harness.identities.readStatus()).games, 1);
});

test("detail lookup uses read methods without discovering identities or rewriting their evidence", async () => {
  const harness = createHarness();
  const result = await harness.createReader().read(2024, "2025-06-22");
  const id = result.games[0].id;
  const before = await harness.identities.readEntry("game", id);
  const readonly = {
    ...harness.identities,
    discover: async () => {
      throw new Error("Unexpected discovery");
    },
    save: async () => {
      throw new Error("Unexpected identity write");
    },
  };
  const read = createStoredGameReader({ docs: harness.store.docs, identityLookup: readonly });
  assert.deepEqual(await read(id), result.games[0]);
  assert.deepEqual(await harness.identities.readEntry("game", id), before);
});

test("the prepared internal-ID policy reads explicit facts without decoding any ID", () => {
  const game = {
    get id() {
      throw new Error("ID decoding is forbidden");
    },
    season: 2024,
    competition: "play-in",
    isCupFinal: false,
    round: 0,
    gameNumber: 1,
    day: "2025-04-15",
  };
  assert.equal(identityPolicy.nativeIdMode, "internal");
  assert.deepEqual(identityPolicy.readGameFacts(game, 2026), {
    season: 2024,
    competition: "play-in",
    isCupFinal: false,
    round: 0,
    gameNumber: 1,
    day: "2025-04-15",
  });
  assert.deepEqual(identityPolicy.readSeriesFacts(), {});
  assert.equal(identityPolicy.readGameFacts({}, null).season, null);
});
