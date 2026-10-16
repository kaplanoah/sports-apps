import { test } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, string>} */
const stored = new Map();
globalThis.localStorage = /** @type {any} */ ({
  getItem: (/** @type {string} */ key) => stored.get(key) ?? null,
  setItem: (/** @type {string} */ key, /** @type {string} */ value) => stored.set(key, value),
  removeItem: (/** @type {string} */ key) => stored.delete(key),
});
globalThis.document = /** @type {any} */ ({ addEventListener: () => {} });

const { errorLog } = await import("../shared/page/error-log.js");
const { watchNews } = await import("../shared/page/news.js");

test("a store that can't send the news says so in the error log, and leaves the news as it was", () => {
  errorLog.watchSteps(
    () => true,
    () => {},
  );
  /** @type {{ onNext: (snapshot: any) => void, onError: (error: unknown) => void }[]} */
  const watches = [];
  const db = {
    doc: () => ({
      onSnapshot: (
        /** @type {(snapshot: any) => void} */ onNext,
        /** @type {(error: unknown) => void} */ onError,
      ) => watches.push({ onNext, onError }),
    }),
  };
  /** @type {unknown[]} */
  const shown = [];

  watchNews(db, (news) => shown.push(news));
  watches[0].onError(new Error("store answered 503"));

  assert.deepEqual(shown, []);
  assert.deepEqual(
    errorLog.readLines().map((line) => line.text),
    ["the news failed to load: store answered 503"],
  );
});
