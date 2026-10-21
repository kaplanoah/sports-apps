import { writeRelease } from "../../worker/page-files.mjs";
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

const PAGE = /^\w+:\/\/[^/]+\/(?:[?#]|$)/;

/**
 * Serves the page with the release a deploy writes into it, and version.json, each the latest
 * release, starting with `release`, and lets a test deploy a newer release, fail the next few
 * reads of version.json, or leave them unanswered.
 * @param {import("@playwright/test").Page} page
 * @param {Release} [release]
 */
export async function serveReleases(page, release = RELEASE) {
  const served = { release, requests: 0, failures: 0, isHanging: false };
  await page.route(PAGE, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: writeRelease(await response.text(), served.release) });
  });
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
