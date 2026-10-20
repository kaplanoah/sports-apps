import { test, expect, openApp, NOW, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const holdPageCode = (page) => holdRequests(page, matchPath("/js/app.js"));

// The markup after the views is read only once the page has started watching its load.
const waitForLoadWatch = (page) => expect(page.locator("#settingsDialog")).toBeAttached();

test("a page whose code is slow to arrive says so until it draws the season", async ({ page }) => {
  const release = await holdPageCode(page);
  const opened = openApp(page);
  const note = page.locator("#loadNote");
  await waitForLoadWatch(page);

  await page.clock.runFor(4000);

  await expect(note).toHaveText("Still loading. Your connection is slow.");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  release();
  await opened;
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await expect(note).toHaveCount(0);
});

test("a page whose styles took the whole wait says it's slow as soon as it shows", async ({
  page,
}) => {
  const release = await holdPageCode(page);
  const releaseStyles = await holdRequests(page, matchPath("/styles.css"));
  const styles = page.waitForRequest((request) => request.url().endsWith("/styles.css"));
  const opened = openApp(page);
  await styles;
  await page.clock.pauseAt(Date.parse(NOW) + 4000);

  releaseStyles();

  await expect(page.locator("#loadNote")).toHaveText("Still loading. Your connection is slow.");
  await page.clock.resume();
  release();
  await opened;
});

test("a page that loses its connection while it loads says it's offline", async ({ page }) => {
  const release = await holdPageCode(page);
  const opened = openApp(page);
  const note = page.locator("#loadNote");
  await waitForLoadWatch(page);
  // The note says the page is slow once it has waited, so the wait stops short of that.
  await page.clock.pauseAt(Date.parse(NOW) + 1000);

  await page.context().setOffline(true);
  await expect(note).toHaveText("You're offline. The page loads once you're back online.");
  await page.context().setOffline(false);

  await expect(note).toHaveText("Still loading. Your connection is slow.");
  await page.clock.resume();
  release();
  await opened;
  await expect(note).toHaveCount(0);
});

test("a page that loads quickly says nothing of a slow load", async ({ page }) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");

  await page.clock.runFor(4000);

  await expect(page.locator("#loadNote")).toHaveCount(0);
});

test("a reload that draws what the page last showed says nothing of a slow store", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  const release = await app.holdStore();
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");

  await page.clock.runFor(4000);

  await expect(page.locator("#loadNote")).toHaveCount(0);
  release();
});
