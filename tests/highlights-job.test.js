import test from "node:test";
import assert from "node:assert/strict";
import { createHighlightsJob } from "../shared/worker/highlights-job.js";
import { createDocs, createJobStorage } from "./job-context.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NOW = Date.parse("2026-10-07T04:00:00Z");

const GAME_LENGTH_MS = 3 * HOUR_MS;

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
 * unless `isFinished(id)` says not, and reads them as of its edition, which a test can raise
 * between runs.
 * @param {any[]} games
 * @param {{ answer?: (id: string) => any, isFinished?: (id: string) => boolean }} [options]
 */
function createRun(games, { answer = (id) => ({ id, plays: [] }), isFinished = () => true } = {}) {
  const docs = createDocs();
  const storage = createJobStorage();
  const clock = { now: NOW };
  const league = { edition: /** @type {number | undefined} */ (undefined) };
  /** @type {string[]} */
  const reads = [];
  const createJob = () =>
    createHighlightsJob({
      listFinals: async () => ({ season: 2026, games }),
      gameLengthMs: GAME_LENGTH_MS,
      readHighlights: async (_context, game) => {
        reads.push(game.id);
        return { highlights: answer(game.id), isFinished: isFinished(game.id) };
      },
      nameKey: (id) => `highlights/${id}`,
      edition: league.edition,
    });
  const context = /** @type {any} */ ({ docs, storage, env: {}, now: () => clock.now });
  return {
    docs,
    runJob: () => createJob().updateStore(context),
    raiseEdition: (/** @type {number} */ edition) => {
      league.edition = edition;
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
  assert.deepEqual(docs.writes.splice(0), ["highlights/1"]);

  wait(60);
  await runJob();
  assert.deepEqual(docs.writes.splice(0), []);

  answers.plays = ["first", "second"];
  wait(120);
  await runJob();
  assert.deepEqual(docs.writes.splice(0), ["highlights/1"]);
});

test("a game the league has no such game for saves nothing", async () => {
  const { docs, runJob, takeReads } = createRun([endGame("1", 30)], { answer: () => null });

  await runJob();
  assert.deepEqual(takeReads(), ["1"]);
  assert.deepEqual(docs.writes, []);
});

test("a league that raises its edition reads each final it kept once more, newest first, and then never", async () => {
  const games = ["5", "4", "3", "2", "1"].map((id, index) => endGame(id, 20 + index));
  const { runJob, wait, takeReads, raiseEdition } = createRun(games);
  await runJob();
  wait(2);
  await runJob();
  takeReads();

  raiseEdition(1);
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

test("a read as of a raised edition that fails is tried again ten minutes later", async () => {
  const outage = { isDown: false };
  const { runJob, wait, takeReads, raiseEdition } = createRun([endGame("1", 30)], {
    answer: (id) => {
      if (outage.isDown) throw new Error("MLB is down");
      return { id, plays: [] };
    },
  });
  await runJob();
  takeReads();

  raiseEdition(1);
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
