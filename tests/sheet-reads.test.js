import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createSheetReads, isReadFresh, keepAnswer } from "../shared/page/sheet-reads.js";

const MINUTE_MS = 60 * 1000;

test("a read is fresh while under way, for ten minutes once it found something, and one when it found nothing", () => {
  const at = 0;
  assert.equal(isReadFresh({ at, isLoading: true }, false, 60 * MINUTE_MS), true);
  assert.equal(isReadFresh({ at, isLoading: false }, true, 10 * MINUTE_MS - 1), true);
  assert.equal(isReadFresh({ at, isLoading: false }, true, 10 * MINUTE_MS), false);
  assert.equal(isReadFresh({ at, isLoading: false }, false, MINUTE_MS - 1), true);
  assert.equal(isReadFresh({ at, isLoading: false }, false, MINUTE_MS), false);
});

test("an answer keeps what the read before found of anything it found nothing of", () => {
  const read = { at: 0, isLoading: true, failure: null, roster: "before", averages: ["before"] };
  assert.deepEqual(keepAnswer(read, { found: { roster: null, averages: ["after"] } }), {
    at: 0,
    isLoading: false,
    failure: null,
    roster: "before",
    averages: ["after"],
  });
  assert.deepEqual(keepAnswer(read, { found: {}, failure: "offline" }), {
    ...read,
    isLoading: false,
    failure: "offline",
  });
});

/**
 * A read that answers once `answer` is called, as a Worker's read does.
 * @returns {{ load: () => Promise<any>, answer: (value: any) => void, fail: (error: Error) => void }}
 */
function holdRead() {
  /** @type {(value: any) => void} */
  let answer = () => {};
  /** @type {(error: Error) => void} */
  let fail = () => {};
  const load = () =>
    new Promise((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  return { load, answer: (value) => answer(value), fail: (error) => fail(error) };
}

test("a sheet's reads start once, read again once old, keep what they found through a failure, and draw again as each answers", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const shown = mock.fn();
  const reads = createSheetReads({
    empty: { player: /** @type {string | null} */ (null) },
    hasFound: (read) => !!read.player,
    show: shown,
  });
  const first = holdRead();
  assert.deepEqual(reads.read("a", first.load), {
    player: null,
    at: 0,
    isLoading: true,
    failure: null,
  });
  assert.equal(reads.read("a", holdRead().load).isLoading, true);
  first.answer({ found: { player: "Caitlin" } });
  await new Promise(setImmediate);
  assert.deepEqual(
    shown.mock.calls.map((call) => call.arguments),
    [["a"]],
  );
  assert.equal(reads.read("a", holdRead().load).player, "Caitlin");

  context.mock.timers.tick(10 * MINUTE_MS);
  const second = holdRead();
  assert.deepEqual(reads.read("a", second.load), {
    player: "Caitlin",
    at: 10 * MINUTE_MS,
    isLoading: true,
    failure: null,
  });
  second.fail(new Error("unreachable"));
  await new Promise(setImmediate);
  assert.equal(reads.find("a")?.player, "Caitlin");
  assert.equal(reads.find("a")?.isLoading, false);
  assert.ok(reads.find("a")?.failure);
});

test("a read overtaken by a newer one is dropped as it answers", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const shown = mock.fn();
  const reads = createSheetReads({
    empty: { player: /** @type {string | null} */ (null) },
    hasFound: (read) => !!read.player,
    show: shown,
  });
  const stale = holdRead();
  reads.read("a", stale.load);
  stale.fail(new Error("offline"));
  await new Promise(setImmediate);
  context.mock.timers.tick(MINUTE_MS);
  const late = holdRead();
  reads.read("a", late.load);
  stale.answer({ found: { player: "Old" } });
  late.answer({ found: { player: "New" } });
  await new Promise(setImmediate);
  assert.equal(reads.find("a")?.player, "New");
});

test("Try again drops only a read that found nothing and is done, and a reload's sheet shows until a read", async () => {
  const reads = createSheetReads({
    empty: { player: /** @type {string | null} */ (null) },
    hasFound: (read) => !!read.player,
    show: () => {},
  });
  const failed = holdRead();
  reads.read("a", failed.load);
  assert.equal(reads.drop("a"), false);
  failed.fail(new Error("offline"));
  await new Promise(setImmediate);
  assert.equal(reads.drop("a"), true);
  assert.equal(reads.find("a"), null);

  reads.keepShown("b", { player: "Saved" });
  assert.deepEqual(reads.find("b"), { player: "Saved", at: 0, isLoading: false, failure: null });
  assert.equal(reads.drop("b"), false);
  reads.keepShown("b", { player: "Older" });
  assert.equal(reads.find("b")?.player, "Saved");
});
