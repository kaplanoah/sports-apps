import { test, expect, matchPath, openApp, EVENING_FIXTURE } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { THEMES, showTheme } from "../../../../tests/browser/theme-layout.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { readTagOffset } from "../../../../tests/browser/title-row.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { passTime, setHidden } from "../../../../tests/browser/visibility.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const FOUR_MINUTES_MS = 4 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BETA = {
  version: "2.33.0-beta",
  commit: "3f2a91c",
  builtAt: new Date(Date.parse(EVENING_FIXTURE.now) - FOUR_MINUTES_MS).toISOString(),
  label: "beta",
};

test("beta names its channel, its commit, and how long ago it went live beside the name, counting each minute", async ({
  page,
}) => {
  await serveReleases(page, BETA);
  await openApp(page);
  const tag = page.locator("header.top .title-row #channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  await page.clock.runFor(60 * 1000);

  await expect(tag).toHaveText("beta•3f2a91c•5 min ago");
});

test("coming back after an hour away, the tag says how long ago the release went live as it shows", async ({
  page,
}) => {
  await serveReleases(page, BETA);
  await openApp(page);
  const tag = page.locator("#channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  await setHidden(page, true);
  await passTime(page, HOUR_MS);
  await setHidden(page, false);

  await expect(tag).toHaveText("beta•3f2a91c•1 h ago");
});

test("a reload shows the whole tag as the page opens, before its code or the Worker's version has loaded", async ({
  page,
}) => {
  await serveReleases(page, BETA);
  await openApp(page);
  const tag = page.locator("#channelTag");
  await expect(tag).toHaveText("beta•3f2a91c•4 min ago");

  const releaseCode = await holdRequests(page, matchPath("/js/app.js"));
  const releaseVersion = await holdRequests(page, matchPath("/version.json"));
  await page.reload({ waitUntil: "commit" });

  await expect(tag).toHaveText(/^beta•3f2a91c•\d+ min ago$/);
  releaseCode();
  releaseVersion();
});

test("production has no tag", async ({ page }) => {
  await serveReleases(page, { ...BETA, version: "2.33.0", label: null });
  await openApp(page);
  await expect(page.locator("#versionNote")).not.toHaveAttribute("hidden");

  await expect(page.locator("#channelTag")).toBeHidden();
});

// Each machine places text on its own subpixel grid, so the tag holds to a quarter pixel.
test("the tag sits half a pixel above the middle of the name's capitals", async ({ page }) => {
  await serveReleases(page, BETA);
  await openApp(page);
  await expect(page.locator("#channelTag")).toBeVisible();

  expect(Math.abs((await readTagOffset(page)) + 0.5)).toBeLessThan(0.25);
});

test("the tag reads at its type role and clears contrast in both themes", async ({ page }) => {
  await serveReleases(page, BETA);
  await openApp(page);
  await expect(page.locator("#channelTag")).toBeVisible();

  for (const theme of THEMES) {
    await showTheme(page, theme);
    expect(await listTextOffRoles(page), theme).toEqual([]);
    expect(await listChipsOffCenter(page), theme).toEqual([]);
    expect(await listLowContrastText(page), theme).toEqual([]);
  }
});
