import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonDocFollower, readPlayerIndex } from "../shared/page/season-doc-follower.js";

/** A store whose documents a test delivers, with each key's latest listener and the keys unwatched. */
function createStore() {
  /** @type {Map<string, (snapshot: any) => void>} */
  const listeners = new Map();
  const unwatched = [];
  return {
    unwatched,
    listeners,
    doc: (/** @type {string} */ key) => ({
      onSnapshot: (/** @type {(snapshot: any) => void} */ listen) => {
        listeners.set(key, listen);
        return () => unwatched.push(key);
      },
    }),
    /** @param {string} key @param {any} data */
    deliver: (key, data) => listeners.get(key)?.({ exists: data !== null, data: () => data }),
  };
}

function createFollower() {
  const kept = [];
  const follow = createSeasonDocFollower({
    nameKey: (year) => `player-index/${year}`,
    read: readPlayerIndex,
    keep: (index) => kept.push(index),
  });
  return { kept, follow };
}

const INDEX = { season: 2026, players: [{ id: "1", lastName: "Lindor" }] };

test("a season's document is kept as the page reads it, and each change redraws", () => {
  const store = createStore();
  const { kept, follow } = createFollower();
  let redraws = 0;
  follow(store, 2026, () => redraws++);
  assert.deepEqual(kept, [null]);

  store.deliver("player-index/2026", { players: "none" });
  assert.equal(redraws, 0, "nothing the page can read yet, so nothing to redraw");

  store.deliver("player-index/2026", INDEX);
  store.deliver("player-index/2026", null);
  assert.deepEqual(kept, [null, INDEX, null]);
  assert.equal(redraws, 2);
});

test("following another season stops following the one before, and its late answers are left out", () => {
  const store = createStore();
  const { kept, follow } = createFollower();
  follow(store, 2026, () => {});
  const lateAnswer = store.listeners.get("player-index/2026");
  follow(store, 2026, () => {});
  assert.deepEqual(store.unwatched, []);

  follow(store, 2027, () => {});
  assert.deepEqual(store.unwatched, ["player-index/2026"]);
  lateAnswer?.({ exists: true, data: () => INDEX });
  assert.deepEqual(kept, [null, null]);
});
