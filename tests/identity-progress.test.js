import test from "node:test";
import assert from "node:assert/strict";
import { SeasonStore as MlbStore } from "../apps/mlb/worker/src/store.js";
import { SeasonStore as WnbaStore } from "../apps/wnba/worker/src/store.js";
import {
  createIdentityBackfill,
  IDENTITY_AUDIT_VERSION,
  IDENTITY_WORK_PER_DAY,
  IDENTITY_WORK_PER_RUN,
  IDENTITY_WORK_INTERVAL_MS,
} from "../shared/worker/identity-backfill.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { createGame, nameStoredGameId } from "./identity-fixtures.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function createStatusReader(harness, now) {
  return createIdentityBackfill(
    harness.ctx.storage,
    {
      lookup: null,
      policy: null,
      describeSource: async () => assert.fail("Status must not describe sources"),
      saveErrors: async () => assert.fail("Status must not write errors"),
      hasFailedSources: async () => assert.fail("Status must not scan failures"),
      forgetSource: async () => assert.fail("Status must not clear source metadata"),
      saveGameMatches: async () => assert.fail("Status must not publish matches"),
      registerObservations: async () => assert.fail("Status must not register identities"),
    },
    now,
  );
}

test("audit progress health uses three fixed reads without advancing work or exposing retained evidence", async () => {
  const harness = createDurableObjectContext();
  harness.stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    phase: "documents",
    cursor: "private-source-key",
    checkedDocuments: 366,
    coverageRevision: "private-revision",
    savedAt: 100,
    pending: {
      key: "private-source-key",
      stage: "candidates",
      offset: 19,
      groupOffset: 5,
      candidateCursor: "private-candidate-key",
      candidates: Array.from({ length: 10_000 }, () => ({ id: "private-player-id" })),
    },
    indexes: {
      game: { complete: true, cursor: "private-index-key" },
      player: { complete: true, cursor: "private-player-index" },
    },
  });
  harness.stored.set("identity:coverage-revision", "private-revision");
  harness.stored.set("identity:work", { day: 0, used: 40, nextAt: 60_000 });
  const before = structuredClone(harness.stored);
  const reads = [];
  const get = harness.ctx.storage.get;
  harness.ctx.storage.get = async (key) => {
    reads.push(key);
    return get(key);
  };
  harness.ctx.storage.list = async () => assert.fail("Status must not list storage");
  harness.ctx.storage.transaction = async () => assert.fail("Status must not start transactions");
  const reader = createStatusReader(harness, () => 1000);
  const first = await reader.readStatus(0);
  assert.deepEqual(reads, ["identity:backfill", "identity:coverage-revision", "identity:work"]);
  assert.deepEqual(first.backfill.checkpoint, {
    current: true,
    phase: "documents",
    stage: "candidates",
    offset: 19,
    candidateGroupOffset: 5,
    candidates: 10_000,
    gameIndexComplete: true,
    playerIndexComplete: true,
    savedAt: 100,
    retryAfter: null,
  });
  assert.equal(first.backfill.allowance.nextReservationAt, 60_000);
  assert.equal(first.backfill.allowance.lastReservedAt, 0);
  assert.equal(first.backfill.allowance.reserved, 40);
  assert.equal(first.backfill.checkedDocuments, 366);
  assert.equal(first.checks.verified, false);
  assert.doesNotMatch(JSON.stringify(first), /private-/);
  assert.deepEqual(await reader.readStatus(0), first);
  assert.deepEqual(harness.stored, before);
});

test("audit allowance health follows the real daily boundary and clock rollback without resetting storage", async () => {
  const harness = createDurableObjectContext();
  let now = DAY_MS - 10_000;
  const reader = createStatusReader(harness, () => now);
  harness.stored.set("identity:work", {
    day: 0,
    used: IDENTITY_WORK_PER_DAY,
    nextAt: now - 1,
  });
  const before = structuredClone(harness.stored);
  let allowance = (await reader.readStatus(0)).backfill.allowance;
  assert.equal(allowance.perRun, IDENTITY_WORK_PER_RUN);
  assert.equal(allowance.dailyLimit, IDENTITY_WORK_PER_DAY);
  assert.equal(allowance.minimumIntervalMs, IDENTITY_WORK_INTERVAL_MS);
  assert.equal(allowance.remaining, 0);
  assert.equal(allowance.nextReservationAt, DAY_MS);
  assert.equal(allowance.resetsAt, DAY_MS);
  for (const used of [IDENTITY_WORK_PER_RUN, IDENTITY_WORK_PER_DAY]) {
    harness.stored.set("identity:work", { day: 0, used, nextAt: DAY_MS + 50_000 });
    allowance = (await reader.readStatus(0)).backfill.allowance;
    assert.equal(allowance.nextReservationAt, DAY_MS);
  }
  harness.stored.clear();
  for (const [key, value] of before) harness.stored.set(key, structuredClone(value));
  now = DAY_MS;
  allowance = (await reader.readStatus(0)).backfill.allowance;
  assert.equal(allowance.reserved, 0);
  assert.equal(allowance.remaining, IDENTITY_WORK_PER_DAY);
  assert.equal(allowance.nextReservationAt, now);
  assert.equal(allowance.resetsAt, 2 * DAY_MS);
  assert.deepEqual(harness.stored, before);
  harness.stored.set("identity:work", {
    day: 2,
    used: IDENTITY_WORK_PER_DAY,
    nextAt: 2 * DAY_MS + 60_000,
  });
  allowance = (await reader.readStatus(0)).backfill.allowance;
  assert.equal(allowance.reserved, IDENTITY_WORK_PER_DAY);
  assert.equal(allowance.nextReservationAt, 3 * DAY_MS);
  assert.equal(allowance.resetsAt, 3 * DAY_MS);
});

test("legacy, obsolete and malformed checkpoints remain honestly unclassified", async () => {
  const harness = createDurableObjectContext();
  const reader = createStatusReader(harness, () => 123);
  const absent = (await reader.readStatus(0)).backfill;
  assert.equal(absent.checkpoint.current, false);
  assert.equal(absent.checkpoint.phase, null);
  assert.equal(absent.checkpoint.offset, null);
  assert.equal(absent.checkpoint.savedAt, null);
  assert.equal(absent.checkpoint.candidates, null);
  assert.equal(absent.allowance.lastReservedAt, null);
  harness.stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    complete: true,
    phase: "vendors",
    retryAfter: 456,
  });
  let status = await reader.readStatus(0);
  assert.equal(status.checks.verified, true);
  assert.equal(status.backfill.checkpoint.retryAfter, 456);
  assert.equal(status.backfill.checkpoint.savedAt, null);
  harness.stored.set("identity:coverage-revision", "changed-coverage");
  status = await reader.readStatus(0);
  assert.equal(status.checks.verified, false);
  assert.equal(status.backfill.checkpoint.current, false);
  assert.equal(status.backfill.checkpoint.retryAfter, null);
  harness.stored.delete("identity:coverage-revision");
  harness.stored.get("identity:backfill").version -= 1;
  assert.equal((await reader.readStatus(0)).backfill.checkpoint.current, false);
  harness.stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    phase: "private-phase",
    savedAt: "private-time",
    pending: { stage: "private-stage", offset: -1, groupOffset: "private-offset" },
  });
  status = await reader.readStatus(0);
  assert.equal(status.backfill.checkpoint.phase, null);
  assert.equal(status.backfill.checkpoint.stage, null);
  assert.equal(status.backfill.checkpoint.offset, null);
  assert.equal(status.backfill.checkpoint.candidateGroupOffset, null);
  assert.doesNotMatch(JSON.stringify(status), /private-/);
});

for (const [app, Store] of /** @type {const} */ ([
  ["mlb", MlbStore],
  ["wnba", WnbaStore],
])) {
  test(`${app}: flat document counts expose nested progress, allowance waits and resumed checkpoints`, async () => {
    const harness = createDurableObjectContext();
    let now = 100;
    const options = {
      now: () => now,
      fetchImpl: async () => assert.fail("Audit diagnostics must not fetch a vendor"),
    };
    harness.stored.set("seasons/2026", {
      year: 2026,
      games: Array.from({ length: 1000 }, (_, index) => createGame(nameStoredGameId(app, index))),
    });
    const first = new Store(harness.ctx, {}, options);
    await first.identities.backfillWhenDue(first.docs);
    const early = (await first.identities.readStatus()).backfill;
    const health = await (await first.readDoc("health/status")).json();
    assert.deepEqual(health.data.identity.backfill, early);
    assert.equal(early.checkedDocuments, 0);
    assert.equal(early.checkpoint.current, true);
    assert.equal(early.checkpoint.phase, "documents");
    assert.equal(early.checkpoint.stage, "native");
    if (app === "wnba") {
      const game = await first.identities.lookup.readEntry("game", nameStoredGameId(app, 0));
      assert.equal(game.facts.isCupFinal, false);
    }
    assert.ok(early.checkpoint.offset > 0);
    assert.equal(early.checkpoint.savedAt, now);
    assert.equal(early.allowance.reserved, IDENTITY_WORK_PER_RUN);
    now += IDENTITY_WORK_INTERVAL_MS;
    const second = new Store(harness.ctx, {}, options);
    await second.identities.backfillWhenDue(second.docs);
    const later = (await second.identities.readStatus()).backfill;
    assert.equal(later.checkedDocuments, early.checkedDocuments);
    assert.ok(later.checkpoint.offset > early.checkpoint.offset);
    assert.ok(later.checkpoint.savedAt > early.checkpoint.savedAt);
    assert.equal(later.allowance.reserved, 2 * IDENTITY_WORK_PER_RUN);
    harness.stored.get("identity:work").used = IDENTITY_WORK_PER_DAY;
    now += IDENTITY_WORK_INTERVAL_MS;
    await second.identities.backfillWhenDue(second.docs);
    const capped = (await second.identities.readStatus()).backfill;
    assert.deepEqual(capped.checkpoint, later.checkpoint);
    assert.equal(capped.allowance.remaining, 0);
    assert.equal(capped.allowance.nextReservationAt, DAY_MS);
    now = DAY_MS;
    await second.identities.backfillWhenDue(second.docs);
    const resumed = (await second.identities.readStatus()).backfill;
    assert.ok(resumed.checkpoint.offset > capped.checkpoint.offset);
    assert.equal(resumed.checkpoint.savedAt, now);
    assert.equal(resumed.allowance.reserved, IDENTITY_WORK_PER_RUN);
    assert.equal(resumed.complete, false);
    assert.equal((await second.identities.readStatus()).checks.verified, false);
  });
}
