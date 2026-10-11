import { test, expect, openApp, EVENING_FIXTURE, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { measureStoredBytes, SAVED_COPY_BYTES } from "../../../../tests/browser/saved-copy.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
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
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  release();
  await opened;
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
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
  await page.clock.pauseAt(Date.parse(EVENING_FIXTURE.now) + 4000);

  releaseStyles();

  await expect(page.locator("#loadNote")).toHaveText("Still loading. Your connection is slow.");
  await page.clock.resume();
  release();
  await opened;
});

test("a page that loads quickly says nothing of a slow load", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);

  await page.clock.runFor(4000);

  await expect(page.locator("#loadNote")).toHaveCount(0);
});

test("a reload that draws what the page last showed says nothing of a slow store", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  const release = await app.holdStore();
  await page.reload();
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);

  await page.clock.runFor(4000);

  await expect(page.locator("#loadNote")).toHaveCount(0);
  release();
});

test("a reload shows the bracket the page last drew before its code arrives", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await page.clock.runFor(4000);
  await expect(page.locator("#loadNote")).toHaveCount(0);
  release();
});

test("the copy a reload draws of a whole season fits in Safari's storage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await openApp(page, { isWholeSeason: true });
  await expect(page.locator("#seasonGames .listed-day").first()).toBeAttached();

  await page.reload();

  await expect(page.locator("#seasonGames .listed-day").first()).toBeAttached();
  expect(await measureStoredBytes(page)).toBeLessThan(SAVED_COPY_BYTES);
});
