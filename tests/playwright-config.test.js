import test from "node:test";
import assert from "node:assert/strict";

/** @param {Record<string, string | undefined>} values an undefined value unsets its variable */
const setEnvironment = (values) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

/**
 * The config reads the environment as it loads, so each load sets it and names its own copy.
 * @param {Record<string, string | undefined>} environment
 */
const loadConfig = async (environment) => {
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  setEnvironment(environment);
  try {
    const copy = Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return (await import(`../playwright.config.mjs?${copy}`)).default;
  } finally {
    setEnvironment(saved);
  }
};

test("CI stops a run of the browser tests once five have failed", async () => {
  assert.equal((await loadConfig({ CI: "true" })).maxFailures, 5);
});

test("off CI, a run of the browser tests never stops early", async () => {
  assert.equal((await loadConfig({ CI: undefined })).maxFailures, 0);
});

// A failed try's trace is where fixing a flaky test starts, and recording its screenshots slows
// every test.
test("each failed try of a browser test keeps its trace, with the page at each step but no screenshots", async () => {
  assert.deepEqual((await loadConfig({ CI: "true", TRACE_SNAPSHOTS: undefined })).use?.trace, {
    mode: "retain-on-failure",
    screenshots: false,
    snapshots: true,
  });
});

test("a run that asks for traces without the page at each step leaves the snapshots out", async () => {
  const config = await loadConfig({ CI: "true", TRACE_SNAPSHOTS: "off" });
  assert.equal(config.use?.trace?.snapshots, false);
});
