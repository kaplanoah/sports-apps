import test from "node:test";
import assert from "node:assert/strict";
import {
  createFeedKeeper,
  createMemoryStorage,
  findSettledTime,
  isPlayerReadDue,
} from "../shared/worker/feed-keeper.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function createKeeper() {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: {
      standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true },
      season: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
    },
    leagueName: "The league",
    now: () => clock.now,
  });
  const reads = { standings: 0, season: 0 };
  /** @param {"standings" | "season"} name */
  const read = (name) =>
    keeper.readFeed(name, `/${name}`, async () => {
      reads[name] += 1;
      return { name, read: reads[name] };
    });
  return { clock, keeper, reads, read };
}

test("a feed's answer is kept until it's older than the feed's limit", async () => {
  const { clock, reads, read } = createKeeper();
  await read("standings");
  clock.now = 23 * HOUR_MS;
  await read("standings");
  assert.equal(reads.standings, 1);

  clock.now = 24 * HOUR_MS;
  assert.deepEqual(await read("standings"), { name: "standings", read: 2 });
});

test("a game's end has a feed that changes with games read at once, and again ten minutes on", async () => {
  const { clock, keeper, reads, read } = createKeeper();
  keeper.noteFinalCount(3);
  await Promise.all([read("standings"), read("season")]);

  clock.now = MINUTE_MS;
  keeper.noteFinalCount(4);
  await Promise.all([read("standings"), read("season")]);
  assert.deepEqual(reads, { standings: 2, season: 1 });

  clock.now = 9 * MINUTE_MS;
  await read("standings");
  assert.equal(reads.standings, 2);

  clock.now = 11 * MINUTE_MS;
  await read("standings");
  clock.now = 30 * MINUTE_MS;
  await read("standings");
  assert.deepEqual(reads, { standings: 3, season: 1 });
});

test("an answer another feed shows is behind is read again every five minutes until it catches up", async () => {
  const { clock, keeper } = createKeeper();
  let reads = 0;
  let isCaughtUp = false;
  const read = () =>
    keeper.readFeed(
      "season",
      "/season",
      async () => {
        reads += 1;
        return { isCaughtUp };
      },
      { isBehind: (data) => !data.isCaughtUp },
    );
  await read();

  clock.now = 4 * MINUTE_MS;
  await read();
  assert.equal(reads, 1);

  clock.now = 5 * MINUTE_MS;
  await read();
  assert.equal(reads, 2);

  isCaughtUp = true;
  clock.now = 10 * MINUTE_MS;
  await read();
  clock.now = 60 * MINUTE_MS;
  await read();
  assert.equal(reads, 3);
});

test("a count that couldn't be read, or the first one, isn't a game ending", async () => {
  const { clock, keeper, reads, read } = createKeeper();
  keeper.noteFinalCount(null);
  keeper.noteFinalCount(3);
  await read("standings");

  clock.now = MINUTE_MS;
  keeper.noteFinalCount(null);
  keeper.noteFinalCount(3);
  await read("standings");
  assert.equal(reads.standings, 1);
});

test("a feed that fails stands in with its last answer, and waits five minutes to be asked again", async () => {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: { standings: { maxAgeMs: MINUTE_MS, changesWithGames: true } },
    leagueName: "The league",
    now: () => clock.now,
  });
  let attempts = 0;
  const fail = async () => {
    attempts += 1;
    throw new Error("503");
  };
  await assert.rejects(keeper.readFeed("standings", "/standings", fail), /503/);
  await assert.rejects(
    keeper.readFeed("standings", "/standings", fail),
    /The league didn't answer standings a moment ago/,
  );
  assert.equal(attempts, 1);

  clock.now = 5 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", async () => "answer"), "answer");
  clock.now = 6 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", fail), "answer");
});

test("what a keeper kept outlasts it, as a Durable Object's storage outlasts its memory", async () => {
  const storage = createMemoryStorage();
  const clock = { now: 0 };
  let reads = 0;
  const createKeeperOnStorage = () =>
    createFeedKeeper({
      feeds: { standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true } },
      leagueName: "The league",
      now: () => clock.now,
      storage,
    });
  const read = (keeper) =>
    keeper.readFeed("standings", "/standings", async () => {
      reads += 1;
      return reads;
    });

  const first = createKeeperOnStorage();
  await first.noteFinalCount(3);
  await read(first);
  clock.now = MINUTE_MS;
  assert.equal(await read(createKeeperOnStorage()), 1);

  const afterFinal = createKeeperOnStorage();
  await afterFinal.noteFinalCount(4);
  await read(afterFinal);
  clock.now = 2 * MINUTE_MS;
  await read(createKeeperOnStorage());
  assert.equal(reads, 2);
});

test("a game's reads settle ten minutes after its end, and at once for a game the store never saw end", () => {
  const end = "2026-10-07T04:00:00.000Z";
  assert.equal(findSettledTime({ end }), Date.parse(end) + 10 * MINUTE_MS);
  assert.equal(findSettledTime({ end: null }), -Infinity);
});

test("a player's read is due when his games change, and once more ten minutes after one made as he played", () => {
  const settled = { games: 3, at: 0, isSettled: true };
  const asHePlayed = { games: 3, at: 0, isSettled: false };

  assert.equal(isPlayerReadDue(undefined, 3, 0), true);
  assert.equal(isPlayerReadDue(settled, 4, MINUTE_MS), true);
  assert.equal(isPlayerReadDue(settled, 3, HOUR_MS), false);
  assert.equal(isPlayerReadDue(asHePlayed, 3, 9 * MINUTE_MS), false);
  assert.equal(isPlayerReadDue(asHePlayed, 3, 10 * MINUTE_MS), true);
});
