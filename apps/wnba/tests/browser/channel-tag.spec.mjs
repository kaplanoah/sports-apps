import { test, expect, matchPath, openApp, NOW } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { showTheme } from "../../../../tests/browser/theme-layout.mjs";
import { readTagOffset } from "../../../../tests/browser/title-row.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { passTime, setHidden } from "../../../../tests/browser/visibility.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const FOUR_MINUTES_MS = 4 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BETA = {
  version: "2.33.0-beta",
  commit: "3f2a91c",
  builtAt: new Date(Date.parse(NOW) - FOUR_MINUTES_MS).toISOString(),
  label: "beta",
};

/**
 * @param {import("@playwright/test").Page} page
 * @param {object} release
 */
const serveRelease = (page, release) =>
  page.route(matchPath("/version.json"), (route) => route.fulfill({ json: release }));

test("beta names its channel, its commit, and how long ago it went live beside the name, counting each minute", async ({
  page,
}) => {
  await serveRelease(page, BETA);
  await openApp(page);
  const tag = page.locator("header.top .title-row #channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  await page.clock.runFor(60 * 1000);

  await expect(tag).toHaveText("beta•3f2a91c•5 min ago");
});

test("coming back after an hour away, the tag says how long ago the release went live as it shows", async ({
  page,
}) => {
  await serveRelease(page, BETA);
  await openApp(page);
  const tag = page.locator("#channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  await setHidden(page, true);
  await passTime(page, HOUR_MS);
  await setHidden(page, false);

  await expect(tag).toHaveText("beta•3f2a91c•1 h ago");
});

test("a reload shows no tag until it has read its release, rather than the age it last showed", async ({
  page,
}) => {
  await serveRelease(page, BETA);
  await openApp(page);
  const tag = page.locator("#channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  const releaseRead = await holdRequests(page, matchPath("/version.json"));
  await page.reload();
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(tag).toBeHidden();

  releaseRead();
  await expect(tag).toHaveText(/^beta•3f2a91c•\d+ min ago$/);
});

test("production has no tag", async ({ page }) => {
  await serveRelease(page, { ...BETA, version: "2.33.0", label: null });
  await openApp(page);
  await expect(page.locator("#versionNote")).not.toHaveAttribute("hidden");

  await expect(page.locator("#channelTag")).toBeHidden();
});

// Each machine places text on its own subpixel grid, so the tag holds to a quarter pixel.
test("the tag sits with its middle on the middle of the name's capitals", async ({ page }) => {
  await serveRelease(page, BETA);
  await openApp(page);
  await expect(page.locator("#channelTag")).toBeVisible();

  expect(Math.abs(await readTagOffset(page))).toBeLessThan(0.25);
});

test("the tag reads at its type role and clears contrast in both themes", async ({ page }) => {
  await serveRelease(page, BETA);
  await openApp(page);
  await expect(page.locator("#channelTag")).toBeVisible();

  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await showTheme(page, theme);
    expect(await listTextOffRoles(page), theme).toEqual([]);
    expect(await listLowContrastText(page), theme).toEqual([]);
  }
});
