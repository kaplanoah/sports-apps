import test from "node:test";
import assert from "node:assert/strict";
import { createHighlightsJob } from "../shared/worker/highlights-job.js";
import { createDocs, createJobStorage } from "./job-context.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NOW = Date.parse("2026-10-07T04:00:00Z");

const GAME_LENGTH_MS = 3 * HOUR_MS;
const STATUS_KEY = "highlights/status";

/**
 * Takes the highlights the job saved since the last take, apart from its status.
 * @param {{ writes: string[] }} docs
 */
const takeHighlightWrites = (docs) => docs.writes.splice(0).filter((key) => key !== STATUS_KEY);

/** @param {number} hoursAgo */
const stampHoursAgo = (hoursAgo) => new Date(NOW - hoursAgo * HOUR_MS).toISOString();

/**
 * A final that ended `hoursAgo` before the run's start.
 * @param {string} id
 * @param {number} hoursAgo
 */
const endGame = (id, hoursAgo) => ({
  id,
  start: stampHoursAgo(hoursAgo + 3),
  end: stampHoursAgo(hoursAgo),
});

/**
 * The job over `games`, newest first, whose league answers each read with `answer(id)`, finished
 * unless `isFinished(id)` says not, and whole unless `hasMisses(id)` says not, and reads them as of
 * its version, which a test can raise between runs.
 * @param {any[]} games
 * @param {{ answer?: (id: string) => any, isFinished?: (id: string) => boolean, hasMisses?: (id: string) => boolean }} [options]
 */
function createRun(
  games,
  { answer = (id) => ({ id, plays: [] }), isFinished = () => true, hasMisses = () => false } = {},
) {
  const docs = createDocs();
  const storage = createJobStorage();
  const clock = { now: NOW };
  const league = { version: /** @type {number | undefined} */ (undefined) };
  /** @type {string[]} */
  const reads = [];
  const createJob = () =>
    createHighlightsJob({
      listFinals: async () => ({ season: 2026, games }),
      gameLengthMs: GAME_LENGTH_MS,
      readHighlights: async (_context, game) => {
        reads.push(game.id);
        return {
          highlights: answer(game.id),
          isFinished: isFinished(game.id),
          hasMisses: hasMisses(game.id),
        };
      },
      nameKey: (id) => `highlights/${id}`,
      version: league.version,
    });
  const context = /** @type {any} */ ({ docs, storage, env: {}, now: () => clock.now });
  return {
    docs,
    storage,
    runJob: () => createJob().updateStore(context),
    raiseVersion: (/** @type {number} */ version) => {
      league.version = version;
    },
    wait: (/** @type {number} */ minutes) => {
      clock.now += minutes * MINUTE_MS;
    },
    takeReads: () => reads.splice(0),
  };
}

test("a run reads four finals, newest first, and the next run reads the rest", async () => {
  const games = ["6", "5", "4", "3", "2", "1"].map((id, index) => endGame(id, 20 + index));
  const { runJob, wait, takeReads } = createRun(games);

  await runJob();
  assert.deepEqual(takeReads(), ["6", "5", "4", "3"]);
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), ["2", "1"]);
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), []);
});

test("a game that just ended is read again an hour, three hours, and twelve hours after its end, and then never", async () => {
  const { runJob, wait, takeReads } = createRun([endGame("1", 0)]);

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  const readsByHour = [];
  for (let minutes = 2; minutes <= 24 * 60; minutes += 2) {
    wait(2);
    await runJob();
    if (takeReads().length) readsByHour.push(minutes / 60);
  }
  assert.deepEqual(readsByHour, [1, 3, 12]);
});

test("a game the store didn't see end is read as if it ended the league's game length after its start", async () => {
  const { runJob, wait, takeReads } = createRun([{ id: "1", start: stampHoursAgo(1) }]);

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  const readsByHour = [];
  for (let minutes = 2; minutes <= 24 * 60; minutes += 2) {
    wait(2);
    await runJob();
    if (takeReads().length) readsByHour.push(minutes / 60);
  }
  assert.deepEqual(readsByHour, [2, 3, 5, 14]);
});

test("a game found final long after it ended is read once", async () => {
  const { runJob, wait, takeReads } = createRun([endGame("1", 30)]);

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  wait(24 * 60);
  await runJob();
  assert.deepEqual(takeReads(), []);
});

test("a read with misses saves what it brought and is tried again ten minutes later, even long after the game ended", async () => {
  const misses = { count: 2 };
  const { docs, runJob, wait, takeReads } = createRun([endGame("1", 30)], {
    answer: (id) => ({ id, misses: misses.count }),
    hasMisses: () => misses.count > 0,
  });

  await runJob();
  assert.deepEqual(docs.stored.get("highlights/1"), { id: "1", misses: 2 });
  assert.deepEqual(takeReads(), ["1"]);
  wait(8);
  await runJob();
  assert.deepEqual(takeReads(), []);
  misses.count = 0;
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(docs.stored.get("highlights/1"), { id: "1", misses: 0 });
  wait(24 * 60);
  await runJob();
  assert.deepEqual(takeReads(), []);
});

test("games whose reads keep missing wait longer each try, so every final gets its turn", async () => {
  const games = Array.from({ length: 24 }, (_, index) => endGame(String(24 - index), 20 + index));
  const { runJob, wait, takeReads } = createRun(games, { hasMisses: () => true });

  const read = new Set();
  for (let minutes = 0; minutes <= 2 * 60; minutes += 2) {
    await runJob();
    for (const id of takeReads()) read.add(id);
    wait(2);
  }

  assert.deepEqual([...read].sort(), games.map((game) => game.id).sort());
});

test("a game whose reads keep missing waits twice as long each try, up to six hours", async () => {
  const { runJob, wait, takeReads } = createRun([endGame("1", 30)], { hasMisses: () => true });

  const triesByMinute = [];
  for (let minutes = 0; minutes <= 24 * 60; minutes += 2) {
    await runJob();
    if (takeReads().length) triesByMinute.push(minutes);
    wait(2);
  }

  assert.deepEqual(triesByMinute.slice(0, 7), [0, 10, 30, 70, 150, 310, 630]);
  assert.equal(triesByMinute[7] - triesByMinute[6], 6 * 60);
});

test("each run saves its status, with a read that failed", async (t) => {
  t.mock.method(console, "error", () => {});
  const { docs, runJob } = createRun([endGame("1", 0)], {
    answer: () => {
      throw new Error("MLB is down");
    },
  });

  await runJob();

  const status = docs.stored.get(STATUS_KEY);
  assert.equal(status.ranAt, new Date(NOW).toISOString());
  assert.equal(status.lastFailure.message, "Reading game 1's highlights failed: MLB is down");
});

test("a read that fails keeps what was saved and is tried again ten minutes later", async () => {
  const outage = { isDown: false };
  const { docs, runJob, wait, takeReads } = createRun([endGame("1", 0)], {
    answer: (id) => {
      if (outage.isDown) throw new Error("MLB is down");
      return { id, plays: ["first"] };
    },
  });
  await runJob();
  takeReads();

  wait(60);
  outage.isDown = true;
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(await docs.read("highlights/1"), { id: "1", plays: ["first"] });

  wait(2);
  outage.isDown = false;
  await runJob();
  assert.deepEqual(takeReads(), []);
  wait(8);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
});

test("a read that brings nothing new saves nothing, and one with more saves it", async () => {
  const answers = { plays: ["first"] };
  const { docs, runJob, wait } = createRun([endGame("1", 0)], {
    answer: (id) => ({ id, plays: answers.plays }),
  });
  await runJob();
  assert.deepEqual(takeHighlightWrites(docs), ["highlights/1"]);

  wait(60);
  await runJob();
  assert.deepEqual(takeHighlightWrites(docs), []);

  answers.plays = ["first", "second"];
  wait(120);
  await runJob();
  assert.deepEqual(takeHighlightWrites(docs), ["highlights/1"]);
});

test("a game the league has no such game for saves nothing", async () => {
  const { docs, runJob, takeReads } = createRun([endGame("1", 30)], { answer: () => null });

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(takeHighlightWrites(docs), []);
});

test("a league that raises its version reads each final it kept once more, newest first, and then never", async () => {
  const games = ["5", "4", "3", "2", "1"].map((id, index) => endGame(id, 20 + index));
  const { runJob, wait, takeReads, raiseVersion } = createRun(games);
  await runJob();
  wait(2);
  await runJob();
  takeReads();

  raiseVersion(1);
  wait(60);
  await runJob();
  assert.deepEqual(takeReads(), ["5", "4", "3", "2"]);
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  wait(24 * 60);
  await runJob();
  assert.deepEqual(takeReads(), []);
});

test("reads kept with their version named edition are renamed once and aren't read again", async () => {
  const games = ["2", "1"].map((id, index) => endGame(id, 20 + index));
  const { storage, runJob, takeReads, raiseVersion } = createRun(games);
  raiseVersion(1);
  const read = { readAt: NOW - HOUR_MS, triedAt: NOW - HOUR_MS };
  storage.stored.set("highlight-reads:2026", {
    2: { ...read, edition: 1 },
    1: { ...read, edition: 1 },
  });

  await runJob();

  assert.deepEqual(takeReads(), []);
  assert.deepEqual(storage.stored.get("highlight-reads:2026"), {
    2: { ...read, version: 1 },
    1: { ...read, version: 1 },
  });
});

test("a read as of a raised version that fails is tried again ten minutes later", async () => {
  const outage = { isDown: false };
  const { runJob, wait, takeReads, raiseVersion } = createRun([endGame("1", 30)], {
    answer: (id) => {
      if (outage.isDown) throw new Error("MLB is down");
      return { id, plays: [] };
    },
  });
  await runJob();
  takeReads();

  raiseVersion(1);
  outage.isDown = true;
  wait(60);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  outage.isDown = false;
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), []);
  wait(8);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  wait(24 * 60);
  await runJob();
  assert.deepEqual(takeReads(), []);
});

test("a read the league couldn't finish saves what it has and is read again next run, then on its schedule once it is", async () => {
  const left = { count: 2 };
  const { docs, runJob, wait, takeReads } = createRun([endGame("1", 0)], {
    answer: (id) => ({ id, plays: ["first"], left: left.count }),
    isFinished: () => left.count === 0,
  });

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(await docs.read("highlights/1"), { id: "1", plays: ["first"], left: 2 });
  left.count = 1;
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(await docs.read("highlights/1"), { id: "1", plays: ["first"], left: 1 });
  left.count = 0;
  wait(2);
  await runJob();
  assert.deepEqual(takeReads(), ["1"]);

  const readsByHour = [];
  for (let minutes = 2; minutes <= 24 * 60; minutes += 2) {
    wait(2);
    await runJob();
    if (takeReads().length) readsByHour.push((minutes + 4) / 60);
  }
  assert.deepEqual(readsByHour, [1, 3, 12]);
});
