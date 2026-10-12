import test from "node:test";
import assert from "node:assert/strict";

/**
 * The config reads CI's environment as it loads, so each load names its own copy.
 * @param {string | undefined} ci
 */
const loadConfig = async (ci) => {
  const saved = process.env.CI;
  if (ci === undefined) delete process.env.CI;
  else process.env.CI = ci;
  try {
    return (await import(`../playwright.config.mjs?ci=${ci}`)).default;
  } finally {
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  }
};

test("CI stops a run of the browser tests once five have failed", async () => {
  assert.equal((await loadConfig("true")).maxFailures, 5);
});

test("off CI, a run of the browser tests never stops early", async () => {
  assert.equal((await loadConfig(undefined)).maxFailures, 0);
});
