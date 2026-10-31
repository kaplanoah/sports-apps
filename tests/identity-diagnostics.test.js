import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SeasonStore as MlbStore } from "../apps/mlb/worker/src/store.js";
import { SeasonStore as WnbaStore } from "../apps/wnba/worker/src/store.js";
import { identityPolicy } from "../apps/wnba/worker/src/identity-policy.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { createAppWorker } from "../shared/worker/app-worker.js";
import { createHealthServer, HEALTH_REUSE_MS } from "../shared/worker/health.js";
import { readStoreHealth } from "../shared/worker/season-store.js";
import { IDENTITY_AUDIT_VERSION } from "../shared/worker/identity-backfill.js";
import { readIdentityDiagnosis } from "../shared/worker/identity-diagnostics.js";
import { buildSnapshot } from "../apps/wnba/worker/src/adapters/wnba.js";
import { readIdentityGames } from "../shared/worker/espn-adapter.js";

const nameProblem = (league, type, id, vendor = "espn") =>
  `identity:problem:identity:vendor:${encodeURIComponent(vendor)}:${league}:${type}:${encodeURIComponent(id)}`;
const createEvent = (id, { start = "2026-10-01T18:00:00Z", away = "20", home = "9" } = {}) => ({
  id,
  date: start,
  competitions: [
    {
      date: start,
      competitors: [
        { id: away, homeAway: "away" },
        { id: home, homeAway: "home" },
      ],
    },
  ],
});
const createMonth = (events) => ({ edition: 1, data: { events } });

function createHarness(app = "wnba") {
  const context = createDurableObjectContext();
  const { ctx } = context;
  const calls = {
    mutations: [],
    lists: [],
    reads: [],
    vendor: 0,
    store: 0,
    problemRows: 0,
    problemWindows: [],
  };
  const Store = app === "wnba" ? WnbaStore : MlbStore;
  const clock = { now: 0 };
  const store = new Store(
    ctx,
    {},
    {
      now: () => clock.now,
      fetchImpl: async () => {
        calls.vendor += 1;
        throw new Error("Unexpected vendor request");
      },
    },
  );
  // The normal alarm was initialized before this health read; diagnosis must not rearm it.
  store.hasAlarm = true;
  for (const method of ["put", "delete", "setAlarm", "transaction"])
    ctx.storage[method] = async () => {
      calls.mutations.push(method);
      throw new Error("Unexpected diagnostic mutation");
    };
  const get = ctx.storage.get;
  ctx.storage.get = async (key) => {
    calls.reads.push(key);
    return get(key);
  };
  const list = ctx.storage.list;
  ctx.storage.list = async (options) => {
    calls.lists.push(options);
    const entries = await list(options);
    if (options.prefix.startsWith("identity:problem:")) {
      calls.problemRows += entries.size;
      calls.problemWindows.push({ options, keys: [...entries.keys()] });
    }
    return entries;
  };
  const env = {
    STORE: {
      idFromName: () => "store",
      get: () => ({
        fetch: async (url) => {
          calls.store += 1;
          return store.fetch(new Request(url));
        },
      }),
    },
    ACCOUNTS: { readHealth: async () => ({ ok: true, release: "abc" }) },
    EMAIL: { readHealth: async () => ({ ok: true, release: "abc" }) },
  };
  const serve = createHealthServer({ readStoreHealth, release: "abc", now: () => clock.now });
  const worker = createAppWorker({
    name: app,
    pageFiles: {},
    forwardToStore: () => Response.error(),
    readStoreHealth,
  });
  return {
    ...context,
    store,
    calls,
    clock,
    read: async () => (await serve(env)).json(),
    request: () => worker.fetch(new Request("https://example.test/health?limit=99999"), env),
  };
}

function assertReadOnly(harness, before) {
  assert.deepEqual([...harness.stored], before);
  assert.deepEqual(harness.calls.mutations, []);
  assert.equal(harness.calls.vendor, 0);
  assert.ok(
    harness.calls.reads.every((key) => String(key).startsWith("identity:") || key === "live/feeds"),
  );
  assert.ok(
    harness.calls.lists.every(
      ({ prefix }) => prefix.startsWith("identity:") || prefix === "feed:networks:",
    ),
  );
}

for (const app of ["mlb", "wnba"]) {
  test(`${app}: public health diagnoses only aggregate fixed labels and leaves actual storage and vendor budgets untouched`, async () => {
    const harness = createHarness(app);
    const { stored } = harness;
    stored.set(nameProblem(app, "game", "private-event"), "unmatched");
    stored.set(nameProblem(app, "player", "private-player"), "unmatched");
    stored.set(nameProblem(app, "game", "private-dispute", app), "disputed");
    stored.set(nameProblem(app, "private-type", "private-id", "private-vendor"), "private-value");
    stored.set("identity:problem:identity:vendor:%ZZ", "private-malformed");
    stored.set(nameProblem("foreign", "game", "private-foreign"), "unmatched");
    stored.set(
      "feed:networks:202610",
      createMonth([createEvent("private-event", { away: "-1", home: "-2" })]),
    );
    stored.set("push:subscription:example", { private: "private-push-content" });
    stored.set("accounts/example", { private: "private-account-content" });
    const before = structuredClone([...stored]);
    const response = await harness.request();
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.services.accounts.ok, true);
    assert.equal(health.services.email.ok, true);
    const diagnosis = health.identity.diagnosis;
    assert.equal(diagnosis.available, true);
    assert.equal(diagnosis.sampled, 5);
    assert.equal(diagnosis.truncated, false);
    assert.ok(
      diagnosis.groups.some(
        (group) =>
          group.vendor === "espn" &&
          group.type === "game" &&
          group.reason === (app === "wnba" ? "missing_team_evidence" : "evidence_unavailable"),
      ),
    );
    assert.ok(
      diagnosis.groups.some(
        (group) => group.type === "player" && group.reason === "evidence_unavailable",
      ),
    );
    assert.ok(
      diagnosis.groups.some(
        (group) =>
          group.vendor === app &&
          group.problem === "disputed" &&
          group.reason === "disputed_association",
      ),
    );
    assert.ok(
      diagnosis.groups.some(
        (group) => group.vendor === "other" && group.type === "other" && group.problem === "other",
      ),
    );
    assert.ok(diagnosis.groups.some((group) => group.reason === "invalid_problem"));
    assert.ok(!JSON.stringify(health).includes("private-"));
    assertReadOnly(harness, before);
  });
}

test("the problem sample is capped with honest truncation and query parameters cannot raise its budget", async () => {
  const harness = createHarness();
  for (let number = 0; number < 61; number += 1)
    harness.stored.set(nameProblem("wnba", "player", String(number)), "unmatched");
  const before = structuredClone([...harness.stored]);
  const health = await (await harness.request()).json();
  assert.equal(health.identity.diagnosis.sampled, 50);
  assert.equal(health.identity.diagnosis.truncated, true);
  assert.equal(
    health.identity.diagnosis.groups.reduce((sum, group) => sum + group.count, 0),
    50,
  );
  assert.ok(
    harness.calls.lists.some(
      ({ prefix, limit }) => prefix === "identity:problem:identity:vendor:" && limit === 51,
    ),
  );
  assert.ok(!harness.calls.lists.some(({ prefix }) => prefix.startsWith("feed:")));
  assertReadOnly(harness, before);
});

test("diagnosis takes the native vendor label from its trusted league policy", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set(nameProblem("wnba", "player", "private-player", "native"), "unmatched");
  const diagnosis = await readIdentityDiagnosis(ctx.storage, {
    ...identityPolicy,
    vendor: "native",
  });
  assert.deepEqual(diagnosis.groups, [
    {
      vendor: "native",
      type: "player",
      problem: "unmatched",
      reason: "evidence_unavailable",
      count: 1,
    },
  ]);
});

test("a capped problem sample follows descending keys toward evidence retained for newer game IDs", async () => {
  const harness = createHarness();
  const events = [];
  for (let number = 1; number <= 60; number += 1) {
    const id = String(number).padStart(6, "0");
    harness.stored.set(nameProblem("wnba", "game", id), "unmatched");
    if (number > 10) events.push(createEvent(id, { away: "-1" }));
  }
  harness.stored.set("feed:networks:202610", createMonth(events));
  const before = structuredClone([...harness.stored]);
  const diagnosis = (await harness.read()).identity.diagnosis;
  assert.equal(diagnosis.sampled, 50);
  assert.equal(diagnosis.truncated, true);
  assert.equal(diagnosis.evidenceTruncated, false);
  assert.deepEqual(diagnosis.groups, [
    {
      vendor: "espn",
      type: "game",
      problem: "unmatched",
      reason: "missing_team_evidence",
      count: 50,
    },
  ]);
  assertReadOnly(harness, before);
});

test("bounded vendor and entity samples preserve games beside more than fifty player and native problems", async () => {
  const harness = createHarness();
  for (const [vendor, type] of [
    ["espn", "player"],
    ["wnba", "game"],
    ["wnba", "player"],
  ])
    for (let number = 0; number < 60; number += 1)
      harness.stored.set(nameProblem("wnba", type, String(number), vendor), "unmatched");
  for (const id of ["one", "two"]) harness.stored.set(nameProblem("wnba", "game", id), "unmatched");
  harness.stored.set(
    "feed:networks:202610",
    createMonth([createEvent("one", { away: "-1" }), createEvent("two", { home: "-2" })]),
  );
  const before = structuredClone([...harness.stored]);
  const diagnosis = (await harness.read()).identity.diagnosis;
  assert.equal(diagnosis.sampled, 50);
  assert.equal(diagnosis.truncated, true);
  assert.equal(diagnosis.groups.length, 4);
  assert.ok(
    diagnosis.groups.some(
      (group) =>
        group.vendor === "espn" &&
        group.type === "game" &&
        group.reason === "missing_team_evidence" &&
        group.count === 2,
    ),
  );
  const windows = harness.calls.lists.filter(({ prefix }) =>
    prefix.startsWith("identity:problem:"),
  );
  assert.equal(windows.length, 10);
  assert.equal(windows[0].limit, 1);
  assert.ok(windows.slice(1).every(({ limit, reverse }) => limit === 51 && reverse === true));
  assert.ok(harness.calls.problemRows <= 460);
  assertReadOnly(harness, before);
});

test("fallback ranges retain malformed and unknown problems when native categories exceed the sample", async () => {
  const harness = createHarness();
  for (let number = 0; number < 60; number += 1)
    harness.stored.set(nameProblem("wnba", "player", String(number), "wnba"), "unmatched");
  harness.stored.set("identity:problem:identity:vendor:%ZZ", "private-malformed");
  for (const vendor of ["aaa-private", "private-vendor", "zz-private"])
    harness.stored.set(nameProblem("wnba", "player", "private-player", vendor), "unmatched");
  for (const type of ["event", "game;", "other", "zz-type"])
    harness.stored.set(nameProblem("wnba", type, "private-type", "espn"), "unmatched");
  const before = structuredClone([...harness.stored]);
  const health = await harness.read();
  const diagnosis = health.identity.diagnosis;
  assert.equal(diagnosis.sampled, 50);
  assert.equal(diagnosis.truncated, true);
  assert.ok(
    diagnosis.groups.some((group) => group.reason === "invalid_problem" && group.count === 1),
  );
  assert.ok(
    diagnosis.groups.some(
      (group) => group.vendor === "other" && group.type === "player" && group.count === 3,
    ),
  );
  assert.ok(
    diagnosis.groups.some(
      (group) => group.vendor === "espn" && group.type === "other" && group.count === 4,
    ),
  );
  assert.ok(!JSON.stringify(health).includes("private-"));
  assert.ok(harness.calls.problemRows <= 460);
  const categoryPrefixes = harness.calls.problemWindows
    .filter(({ options }) => options.prefix !== "identity:problem:identity:vendor:")
    .map(({ options }) => options.prefix);
  for (const { options, keys } of harness.calls.problemWindows)
    if (options.start !== undefined)
      assert.ok(keys.every((key) => !categoryPrefixes.some((prefix) => key.startsWith(prefix))));
  assertReadOnly(harness, before);
});

test("storage range fixtures use inclusive starts and exclusive ends in either order", async () => {
  const { ctx, stored } = createDurableObjectContext();
  for (const key of ["a", "b", "c", "d"]) stored.set(key, key);
  assert.deepEqual(
    [...(await ctx.storage.list({ start: "b", end: "d" }))].map(([key]) => key),
    ["b", "c"],
  );
  assert.deepEqual(
    [...(await ctx.storage.list({ start: "b", end: "d", reverse: true }))].map(([key]) => key),
    ["c", "b"],
  );
});

test("unrecognized game-problem states retain evidence while their public state stays unknown", async () => {
  const harness = createHarness();
  harness.stored.set(nameProblem("wnba", "game", "private-event"), "private-state");
  harness.stored.set(
    "feed:networks:202610",
    createMonth([createEvent("private-event", { away: "-1" })]),
  );
  const before = structuredClone([...harness.stored]);
  const health = await harness.read();
  assert.deepEqual(health.identity.diagnosis.groups, [
    { vendor: "espn", type: "game", problem: "other", reason: "missing_team_evidence", count: 1 },
  ]);
  assert.ok(!JSON.stringify(health).includes("private-"));
  assertReadOnly(harness, before);
});

test("an empty problem window skips all category and retained-source reads", async () => {
  const harness = createHarness();
  const before = structuredClone([...harness.stored]);
  assert.deepEqual((await harness.read()).identity.diagnosis, {
    available: true,
    sampled: 0,
    truncated: false,
    evidenceTruncated: false,
    groups: [],
  });
  assert.equal(
    harness.calls.lists.filter(({ prefix }) => prefix.startsWith("identity:problem:")).length,
    1,
  );
  assert.ok(!harness.calls.lists.some(({ prefix }) => prefix.startsWith("feed:")));
  assertReadOnly(harness, before);
});

test("retained game evidence distinguishes missing teams, dates, conflicts, usable evidence and unavailable records", async () => {
  const harness = createHarness();
  for (const id of ["teams", "date", "usable", "conflict", "absent"])
    harness.stored.set(nameProblem("wnba", "game", id), "unmatched");
  harness.stored.set(
    "feed:networks:202610",
    createMonth([
      createEvent("teams", { away: "-1" }),
      createEvent("date", { start: null }),
      createEvent("usable"),
      createEvent("conflict"),
      createEvent("unrelated", { away: "-1" }),
    ]),
  );
  harness.stored.set(
    "feed:networks:202609",
    createMonth([createEvent("conflict", { start: "2026-09-30T18:00:00Z" })]),
  );
  const before = structuredClone([...harness.stored]);
  const health = await harness.read();
  assert.deepEqual(
    health.identity.diagnosis.groups.map((group) => group.reason).sort(),
    [
      "conflicting_retained_evidence",
      "evidence_unavailable",
      "missing_date_evidence",
      "missing_team_evidence",
      "unclassified",
    ].sort(),
  );
  assert.ok(health.identity.diagnosis.groups.every((group) => group.count === 1));
  assertReadOnly(harness, before);
});

test("later retained evidence changes diagnosis after the existing one-minute health reuse without changing associations", async () => {
  const harness = createHarness();
  const key = nameProblem("wnba", "game", "event");
  harness.stored.set(key, "unmatched");
  assert.equal((await harness.read()).identity.diagnosis.groups[0].reason, "evidence_unavailable");
  harness.stored.set("feed:networks:202610", createMonth([createEvent("event", { away: "-1" })]));
  const before = structuredClone([...harness.stored]);
  assert.equal((await harness.read()).identity.diagnosis.groups[0].reason, "evidence_unavailable");
  assert.equal(harness.calls.store, 1);
  harness.clock.now = HEALTH_REUSE_MS;
  assert.equal((await harness.read()).identity.diagnosis.groups[0].reason, "missing_team_evidence");
  assert.equal(harness.calls.store, 2);
  assert.equal(harness.stored.get(key), "unmatched");
  assertReadOnly(harness, before);
});

test("source selection uses the most recent twelve caches and reports a bounded scan as limited", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set(nameProblem("wnba", "game", "event"), "unmatched");
  for (let month = 1; month <= 13; month += 1)
    stored.set(
      "feed:networks:" + String(month).padStart(6, "0"),
      createMonth([createEvent(month === 13 ? "event" : "other", { away: "-1" })]),
    );
  const before = structuredClone([...stored]);
  const asked = [];
  const diagnosis = await readIdentityDiagnosis(ctx.storage, {
    ...identityPolicy,
    readSavedVendorGames: (key, value, limit) => {
      asked.push(key);
      return identityPolicy.readSavedVendorGames(key, value, limit);
    },
  });
  assert.equal(asked.length, 12);
  assert.equal(asked[0], "feed:networks:000013");
  assert.ok(!asked.includes("feed:networks:000001"));
  assert.equal(diagnosis.groups[0].reason, "missing_team_evidence");
  assert.equal(diagnosis.evidenceTruncated, true);
  assert.deepEqual([...stored], before);
});

test("the total event budget is shared across sources and counts rejected records too", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set(nameProblem("wnba", "game", "event"), "unmatched");
  stored.set(
    "feed:networks:202610",
    createMonth(Array.from({ length: 300 }, () => createEvent(""))),
  );
  stored.set(
    "feed:networks:202609",
    createMonth([
      ...Array.from({ length: 200 }, (_, index) => createEvent("other" + index)),
      createEvent("event"),
    ]),
  );
  const before = structuredClone([...stored]);
  const limits = [];
  let examined = 0;
  const diagnosis = await readIdentityDiagnosis(ctx.storage, {
    ...identityPolicy,
    readSavedVendorGames: (key, value, limit) => {
      limits.push(limit);
      const saved = identityPolicy.readSavedVendorGames(key, value, limit);
      examined += saved.records.length + saved.rejected;
      return saved;
    },
  });
  assert.deepEqual(limits, [500, 200]);
  assert.equal(examined, 500);
  assert.equal(diagnosis.groups[0].reason, "evidence_limited");
  assert.equal(diagnosis.evidenceTruncated, true);
  assert.deepEqual([...stored], before);
});

test("bounded and unbounded reads count malformed retained months consistently", () => {
  for (const [data, rejected] of [
    [null, 0],
    [{}, 0],
    [{ events: null }, 0],
    [{ events: "malformed" }, 1],
    [{ events: [null] }, 1],
  ]) {
    const full = identityPolicy.readSavedVendorGames("feed:networks:202610", { data });
    assert.deepEqual(full, { records: [], rejected });
    const { truncated, ...bounded } = identityPolicy.readSavedVendorGames(
      "feed:networks:202610",
      { data },
      500,
    );
    assert.deepEqual(bounded, full);
    assert.equal(truncated, false);
  }
});

test("the shared ESPN reader bounds examined events across answers and never parses beyond its limit", () => {
  const after = createEvent("after");
  Object.defineProperty(after, "id", {
    get: () => assert.fail("parsed an event beyond the limit"),
  });
  const answers = [
    { events: [createEvent(""), createEvent("one")] },
    { events: [createEvent("two"), after] },
  ];
  const result = readIdentityGames(answers, (id) => id, 3);
  assert.deepEqual(
    result.records.map(({ id }) => id),
    ["one", "two"],
  );
  assert.equal(result.rejected, 1);
  assert.equal(result.truncated, true);
  assert.deepEqual(
    readIdentityGames([{ events: [after] }], (id) => id, 0),
    {
      records: [],
      rejected: 0,
      truncated: true,
    },
  );
});

test("malformed retained answers remain unavailable evidence without failing sports health", async () => {
  for (const data of [
    null,
    { events: "private-malformed" },
    { events: [null, { id: "event", date: "bad-date" }] },
  ]) {
    const harness = createHarness();
    harness.stored.set(nameProblem("wnba", "game", "event"), "unmatched");
    harness.stored.set("feed:networks:202610", { data });
    const before = structuredClone([...harness.stored]);
    const health = await harness.read();
    assert.equal(health.ok, true);
    assert.equal(health.identity.diagnosis.available, true);
    assert.equal(health.identity.diagnosis.groups[0].reason, "evidence_unavailable");
    assert.ok(!JSON.stringify(health).includes("private-malformed"));
    assertReadOnly(harness, before);
  }
});

test("diagnostic storage failures expose no error payload and leave sports health and coverage unchanged", async () => {
  const harness = createHarness();
  harness.stored.set("identity:backfill", { version: IDENTITY_AUDIT_VERSION, complete: true });
  const list = harness.ctx.storage.list;
  harness.ctx.storage.list = async (options) => {
    if (options.prefix === "identity:problem:identity:vendor:")
      throw new Error("private-storage-message");
    return list(options);
  };
  const before = structuredClone([...harness.stored]);
  const health = await harness.read();
  assert.equal(health.ok, true);
  assert.equal(health.identity.checks.verified, true);
  assert.equal(health.identity.errors, 0);
  assert.deepEqual(health.identity.diagnosis, { available: false });
  assert.ok(!JSON.stringify(health).includes("private-storage-message"));
  assertReadOnly(harness, before);
});

test("a recorded whole WNBA schedule retains its unmatched observations while diagnosis describes only saved evidence", async () => {
  const readFixture = (file) =>
    JSON.parse(
      readFileSync(new URL(`../apps/wnba/tests/fixtures/${file}.json`, import.meta.url), "utf8"),
    );
  const fixture = readFixture("2026-09-30-afternoon");
  const schedule = readFixture("2026-10-01-games").preview.schedule;
  const answers = readFixture("2026-10-02-espn-scoreboard").answers;
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {}, { now: () => Date.parse(fixture.now) });
  await store.saveSeason(
    buildSnapshot(
      { ...fixture.responses, schedule },
      { season: fixture.season, now: Date.parse(fixture.now) },
    ),
  );
  for (const [url, answer] of Object.entries(answers))
    stored.set(`feed:networks:${new URL(url).searchParams.get("dates")}`, { data: answer });
  for (let pass = 0; pass < 200 && !stored.get("identity:backfill")?.complete; pass += 1)
    await store.identities.backfill(store.docs);
  assert.equal(stored.get("identity:backfill").complete, true);
  const before = structuredClone([...stored]);
  for (const method of ["put", "delete", "transaction", "setAlarm"])
    ctx.storage[method] = async () => assert.fail("diagnosis changed storage");
  const status = await store.identities.readStatus();
  assert.equal(status.checks.verified, true);
  assert.equal(status.unmatched, 12);
  assert.deepEqual(status.diagnosis, {
    available: true,
    sampled: 12,
    truncated: false,
    evidenceTruncated: false,
    groups: [
      {
        vendor: "espn",
        type: "game",
        problem: "unmatched",
        reason: "missing_team_evidence",
        count: 12,
      },
    ],
  });
  assert.deepEqual([...stored], before);
});
