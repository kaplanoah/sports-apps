import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import config from "../playwright.config.mjs";
import { waitForNoteHeight } from "./browser/re-add-note.mjs";
import { ASSERTION_TIMEOUT_MS } from "./browser/limits.mjs";

function createHeightPage({ height = 64, beforeSample = false, isClosed = false } = {}) {
  const failure = new Error("controlled height wait failure");
  const budgets = [];
  const sampled = [];
  const window = {};
  const document = {
    querySelector: (selector) => {
      assert.equal(selector, "#appearanceNote");
      sampled.push(height);
      return { getBoundingClientRect: () => ({ height }) };
    },
  };
  const evaluate = (callback, argument) =>
    runInNewContext(`(${callback})(argument)`, { window, document, argument });
  const stub = {
    waitForFunction: async (callback, argument, options) => {
      budgets.push(options.timeout);
      if (!beforeSample && evaluate(callback, argument)) return;
      throw failure;
    },
    evaluate: async (callback, argument) => {
      if (isClosed) throw new Error("page closed");
      return evaluate(callback, argument);
    },
  };
  return {
    page: /** @type {import("@playwright/test").Page} */ (/** @type {unknown} */ (stub)),
    failure,
    budgets,
    sampled,
  };
}

test("the DOM height poll and Playwright assertions use the same canonical limit", async () => {
  const { page, budgets, sampled } = createHeightPage();
  await waitForNoteHeight(page, 64, "before app code");
  assert.deepEqual(sampled, [64]);
  assert.deepEqual(budgets, [config.expect.timeout]);
  assert.equal(config.expect.timeout, ASSERTION_TIMEOUT_MS);
});

test("a height mismatch keeps numeric units, baseline, elapsed time and the original failure", async () => {
  const { page, failure } = createHeightPage({ height: 64.5 });
  await assert.rejects(waitForNoteHeight(page, 64, "after app code"), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, failure);
    assert.match(
      error.message,
      /^Icon note height after app code: baseline=64px, last=64\.5px, elapsed=\d+ms$/,
    );
    return true;
  });
});

for (const isClosed of [false, true]) {
  test(`unavailable height diagnostics have no pixel unit when the page is ${isClosed ? "closed" : "unsampled"}`, async () => {
    const { page, failure } = createHeightPage({ beforeSample: true, isClosed });
    await assert.rejects(waitForNoteHeight(page, 64, "before app code"), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.cause, failure);
      const reason = isClosed ? "page closed" : "no sample";
      assert.match(error.message, new RegExp(`last=unavailable \\(${reason}\\), elapsed=\\d+ms$`));
      return true;
    });
  });
}
