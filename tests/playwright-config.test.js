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

// A failed try's trace is where fixing a flaky test starts, and recording its screenshots slows
// every test.
test("each failed try of a browser test keeps its trace, without screenshots", async () => {
  assert.deepEqual((await loadConfig("true")).use?.trace, {
    mode: "retain-on-failure",
    screenshots: false,
  });
});

// Eased scrolls and springs only slow a test that isn't about them. A project's own
// contextOptions would replace the config's whole object and lose the default.
test("every browser test asks for reduced motion unless it opts out", async () => {
  const config = await loadConfig(undefined);
  assert.deepEqual(config.use?.contextOptions, { reducedMotion: "reduce" });
  for (const project of config.projects ?? []) {
    assert.equal(project.use?.contextOptions, undefined, project.name);
  }
});
