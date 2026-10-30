import test from "node:test";
import assert from "node:assert/strict";
import {
  createFeedKeeper,
  createMemoryStorage,
  findSettledTime,
  FAILED_FEED_WAIT_MS,
  isPlayerReadDue,
} from "../shared/worker/feed-keeper.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

test("successful feeds publish absolute age, behind and final-settle deadlines across restarts", async () => {
  const storage = createMemoryStorage();
  const clock = { now: 0 };
  const restart = () =>
    createFeedKeeper({
      feeds: { standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true } },
      storage,
      now: () => clock.now,
    });
  let keeper = restart();
  let nextAt;
  let reads = 0;
  let behind = false;
  const read = () =>
    keeper.readFeed(
      "standings",
      "/standings",
      async () => {
        reads += 1;
        return { behind };
      },
      {
        isBehind: (answer) => answer.behind,
        onNextRead: (at) => {
          nextAt = at;
        },
      },
    );
  await keeper.noteFinalCount(0);
  await read();
  assert.equal(nextAt, 24 * HOUR_MS);
  clock.now = MINUTE_MS;
  await keeper.noteFinalCount(1);
  behind = true;
  await read();
  assert.equal(nextAt, 6 * MINUTE_MS);
  keeper = restart();
  clock.now = nextAt - 1;
  await read();
  assert.equal(reads, 2);
  assert.equal(nextAt, 6 * MINUTE_MS);
  clock.now += 1;
  behind = false;
  await read();
  assert.equal(nextAt, 11 * MINUTE_MS);
  clock.now = nextAt;
  await read();
  assert.equal(reads, 4);
  assert.equal(nextAt, clock.now + 24 * HOUR_MS);
});

test("failure callbacks report the keeper's absolute retry deadline across restarts", async () => {
  const storage = createMemoryStorage();
  const clock = { now: 0 };
  const restart = () =>
    createFeedKeeper({
      feeds: { standings: { maxAgeMs: MINUTE_MS, changesWithGames: false } },
      now: () => clock.now,
      storage,
    });
  const deadlines = [];
  const onFailure = (reason, retryAt) => deadlines.push({ reason, retryAt });
  let keeper = restart();
  await keeper.readFeed("standings", "/standings", async () => "saved");
  clock.now = MINUTE_MS;
  assert.equal(
    await keeper.readFeed(
      "standings",
      "/standings",
      async () => {
        throw new Error("down");
      },
      { onFailure },
    ),
    "saved",
  );
  const retryAt = clock.now + FAILED_FEED_WAIT_MS;
  keeper = restart();
  clock.now = retryAt - 1;
  let reads = 0;
  const load = async () => {
    reads += 1;
    return "recovered";
  };
  assert.equal(await keeper.readFeed("standings", "/standings", load, { onFailure }), "saved");
  assert.deepEqual(deadlines, [
    { reason: "down", retryAt },
    { reason: "down", retryAt },
  ]);
  assert.equal(reads, 0);
  clock.now = retryAt;
  assert.equal(await keeper.readFeed("standings", "/standings", load, { onFailure }), "recovered");
  assert.equal(reads, 1);
  assert.equal(deadlines.length, 2);
});

function createKeeper() {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: {
      standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true },
      season: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
    },
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
  await keeper.noteFinalCount(3);
  await Promise.all([read("standings"), read("season")]);

  clock.now = MINUTE_MS;
  await keeper.noteFinalCount(4);
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
  await keeper.noteFinalCount(null);
  await keeper.noteFinalCount(3);
  await read("standings");

  clock.now = MINUTE_MS;
  await keeper.noteFinalCount(null);
  await keeper.noteFinalCount(3);
  await read("standings");
  assert.equal(reads.standings, 1);
});

test("a feed that fails stands in with its last answer, and waits five minutes to be asked again, failing meanwhile as it last did", async () => {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: { standings: { maxAgeMs: MINUTE_MS, changesWithGames: true } },
    now: () => clock.now,
  });
  let attempts = 0;
  const fail = async () => {
    attempts += 1;
    throw new Error(`The league answered 503 on try ${attempts}`);
  };
  const failure = { message: "The league answered 503 on try 1" };
  await assert.rejects(keeper.readFeed("standings", "/standings", fail), failure);
  clock.now = 4 * MINUTE_MS;
  await assert.rejects(keeper.readFeed("standings", "/standings", fail), failure);
  assert.equal(attempts, 1);

  clock.now = 5 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", async () => "answer"), "answer");
  clock.now = 6 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", fail), "answer");
});

test("a feed whose kept answer stands in says why its read failed, until a read answers again", async () => {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: { standings: { maxAgeMs: MINUTE_MS, changesWithGames: true } },
    now: () => clock.now,
  });
  /** @type {string[]} */
  const reasons = [];
  /** @param {() => Promise<string>} load */
  const read = (load) =>
    keeper.readFeed("standings", "/standings", load, {
      onFailure: (reason) => reasons.push(reason),
    });
  const fail = async () => {
    throw new Error("The league answered 503");
  };
  await read(async () => "answer");
  clock.now = MINUTE_MS;
  assert.equal(await read(fail), "answer");
  clock.now = 2 * MINUTE_MS;
  assert.equal(await read(fail), "answer");
  assert.deepEqual(reasons, ["The league answered 503", "The league answered 503"]);

  clock.now = 6 * MINUTE_MS;
  await read(async () => "answer again");
  clock.now = 6.5 * MINUTE_MS;
  assert.equal(await read(fail), "answer again");
  assert.equal(reasons.length, 2);
});

test("a feed that failed is asked again five minutes on, however young its kept answer", async () => {
  const { clock, keeper, reads, read } = createKeeper();
  /** @type {string[]} */
  const reasons = [];
  const readNotingFailure = () =>
    keeper.readFeed(
      "standings",
      "/standings",
      async () => {
        reads.standings += 1;
        return { name: "standings", read: reads.standings };
      },
      { onFailure: (reason) => reasons.push(reason) },
    );
  await read("standings");
  await keeper.readFeed(
    "standings",
    "/standings",
    async () => {
      throw new Error("The league answered 503");
    },
    { readAgain: true },
  );

  clock.now = 4 * MINUTE_MS;
  await readNotingFailure();
  assert.equal(reads.standings, 1);
  assert.deepEqual(reasons, ["The league answered 503"]);

  clock.now = 5 * MINUTE_MS;
  assert.deepEqual(await readNotingFailure(), { name: "standings", read: 2 });
  clock.now = 6 * MINUTE_MS;
  await readNotingFailure();
  assert.equal(reads.standings, 2);
  assert.deepEqual(reasons, ["The league answered 503"]);
});

test("what a keeper kept outlasts it, as a Durable Object's storage outlasts its memory", async () => {
  const storage = createMemoryStorage();
  const clock = { now: 0 };
  let reads = 0;
  const createKeeperOnStorage = () =>
    createFeedKeeper({
      feeds: { standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true } },
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

test("a read again replaces a young kept answer, which still stands in when it fails", async () => {
  const { keeper, read } = createKeeper();
  await read("standings");
  const fresh = { name: "standings", read: 2 };
  assert.deepEqual(
    await keeper.readFeed("standings", "/standings", async () => fresh, { readAgain: true }),
    fresh,
  );
  assert.deepEqual(await read("standings"), fresh);
  /** @type {string[]} */
  const reasons = [];
  assert.deepEqual(
    await keeper.readFeed(
      "standings",
      "/standings",
      async () => {
        throw new Error("Source down");
      },
      { readAgain: true, onFailure: (reason) => reasons.push(reason) },
    ),
    fresh,
  );
  assert.deepEqual(reasons, ["Source down"]);
});

test("a read again with no kept answer fails as its read did", async () => {
  const { keeper } = createKeeper();
  await assert.rejects(
    keeper.readFeed(
      "standings",
      "/standings",
      async () => {
        throw new Error("Source down");
      },
      { readAgain: true },
    ),
    /Source down/,
  );
});
