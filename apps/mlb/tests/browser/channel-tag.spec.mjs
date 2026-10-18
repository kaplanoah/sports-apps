import { test, expect, matchPath, openApp, EVENING_FIXTURE } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { showTheme } from "../../../../tests/browser/theme-layout.mjs";
import { readTagOffset } from "../../../../tests/browser/title-row.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const FOUR_MINUTES_MS = 4 * 60 * 1000;
const BETA = {
  version: "2.33.0-beta",
  commit: "3f2a91c",
  builtAt: new Date(Date.parse(EVENING_FIXTURE.now) - FOUR_MINUTES_MS).toISOString(),
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

test("production has no tag", async ({ page }) => {
  await serveRelease(page, { ...BETA, version: "2.33.0", label: null });
  await openApp(page);
  await expect(page.locator("#versionNote")).not.toHaveAttribute("hidden");

  await expect(page.locator("#channelTag")).toBeHidden();
});

test("the tag sits half a pixel above the middle of the name's capitals", async ({ page }) => {
  await serveRelease(page, BETA);
  await openApp(page);
  await expect(page.locator("#channelTag")).toBeVisible();

  expect(await readTagOffset(page)).toBeCloseTo(-0.5, 1);
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
