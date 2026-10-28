import { test } from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue } from "../shared/page/save-queue.js";

/** A queue whose saves each wait to be let go, recording what each read when it started. */
function createHeldQueue() {
  let choice = 0;
  let running = 0;
  /** @type {number[]} */
  const saved = [];
  /** @type {number[]} */
  const overlaps = [];
  /** @type {(() => void)[]} */
  const holds = [];
  const queue = createSaveQueue(async () => {
    running += 1;
    overlaps.push(running);
    saved.push(choice);
    await new Promise((resolve) => holds.push(() => resolve(undefined)));
    running -= 1;
  });
  /** @param {number} next */
  const choose = (next) => {
    choice = next;
    return queue.requestSave();
  };
  const letGo = async () => {
    holds.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { queue, choose, letGo, saved, overlaps };
}

test("saves run one at a time, and those asked for during one become one save of the newest choice", async () => {
  const { queue, choose, letGo, saved, overlaps } = createHeldQueue();

  const finished = choose(1);
  choose(2);
  choose(3);
  assert.deepEqual(saved, [1]);
  await letGo();
  assert.deepEqual(saved, [1, 3]);
  choose(4);
  await letGo();
  await letGo();
  await finished;

  assert.deepEqual(saved, [1, 3, 4]);
  assert.deepEqual(overlaps, [1, 1, 1]);
  assert.equal(queue.isSaving(), false);
});

test("a choice made after the saves finish starts a save of its own at once", async () => {
  const { queue, choose, letGo, saved } = createHeldQueue();

  choose(1);
  await letGo();
  assert.equal(queue.isSaving(), false);
  choose(2);

  assert.deepEqual(saved, [1, 2]);
  assert.equal(queue.isSaving(), true);
});
