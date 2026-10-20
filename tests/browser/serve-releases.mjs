import { matchPath } from "./harness.mjs";

/** @typedef {import("../../shared/page/release.js").Release} Release */

/** @type {Release} */
const RELEASE = {
  version: "2.13.0",
  commit: "abc1234",
  builtAt: "2026-09-28T00:10:41Z",
  label: null,
};
/** @type {Release} */
export const NEXT_RELEASE = {
  version: "2.13.1",
  commit: "def5678",
  builtAt: "2026-09-28T02:00:00Z",
  label: null,
};

/**
 * Serves version.json, starting with `release`, and lets a test deploy a newer release, fail the
 * next few reads, or leave reads unanswered.
 * @param {import("@playwright/test").Page} page
 * @param {Release} [release]
 */
export async function serveReleases(page, release = RELEASE) {
  const served = { release, requests: 0, failures: 0, isHanging: false };
  await page.route(matchPath("/version.json"), (route) => {
    served.requests++;
    if (served.isHanging) return undefined;
    if (served.failures > 0) {
      served.failures--;
      return route.fulfill({ status: 503, body: "" });
    }
    return route.fulfill({ json: served.release });
  });
  return served;
}

/**
 * Moves the page a tick on and returns how many release reads it has made, for a poll that waits
 * for a failed check to be tried again. A check that starts before the page has taken in a failed
 * read shares that read and fails with it, so only a tick after the failure reads both releases
 * again.
 * @param {import("@playwright/test").Page} page
 * @param {{ requests: number }} served
 */
export async function retryReleaseCheck(page, served) {
  await page.clock.runFor(15 * 1000);
  return served.requests;
}
