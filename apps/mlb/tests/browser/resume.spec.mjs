import {
  NEXT_RELEASE,
  retryReleaseCheck,
  serveReleases,
} from "../../../../tests/browser/serve-releases.mjs";
import {
  test,
  expect,
  openApp,
  openSettings,
  EVENING_FIXTURE,
  ON_A_PHONE,
  matchPath,
} from "./harness.mjs";

const MINUTE_MS = 60 * 1000;

// A reload clears whatever the test left on the window.
/** @param {import("@playwright/test").Page} page */
const markPage = (page) => page.evaluate(() => Object.assign(window, { isSameLoad: true }));
/** @param {import("@playwright/test").Page} page */
const isSameLoad = (page) => page.evaluate(() => "isSameLoad" in window);

/**
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<unknown>} action
 */
async function expectReload(page, action) {
  const reloaded = page.waitForEvent("load");
  await action();
  await reloaded;
  expect(await isSameLoad(page)).toBe(false);
}

/** @param {import("@playwright/test").Page} page */
const comeBack = (page) => page.evaluate(() => dispatchEvent(new Event("focus")));

/**
 * The phone suspends the page without saying so, and it wakes up this much later.
 * @param {import("@playwright/test").Page} page
 * @param {number} minutes
 */
async function sleepUnannounced(page, minutes) {
  await page.clock.setSystemTime(Date.parse(EVENING_FIXTURE.now) + minutes * MINUTE_MS);
  await page.clock.runFor(15 * 1000);
}

test("a page coming back stays as it is when nothing was deployed", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  await comeBack(page);

  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);
});

test("a page whose first release check failed still reloads for a later deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.failures = 1;
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await expect.poll(() => retryReleaseCheck(page, served)).toBeGreaterThanOrEqual(3);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});

const BRACKET_SET = "The official bracket is set";

/**
 * Saves an update the page's socket never hears of.
 * @param {Awaited<ReturnType<typeof openApp>>} app
 */
async function lockBracketWhileAway(app) {
  await app.updateFromWorker();
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  await app.lockBracketWhileAway();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {boolean} hidden
 */
const setHidden = (page, hidden) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

/** @param {import("@playwright/test").Page} page */
async function hideAndShow(page) {
  await setHidden(page, true);
  await setHidden(page, false);
}

test("a page whose first load failed loads its season once the store answers", async ({ page }) => {
  await openApp(page);
  await page.addInitScript(() => localStorage.removeItem("lastSeen"));
  // Unrouting by the handler too leaves the store's own route, which has the same pattern.
  const failStore = (route) => route.fulfill({ status: 503, body: "" });
  await page.route(matchPath("/store/"), failStore);
  await page.reload();
  await expect(page.locator("#stamp")).toContainText("Can't reach the page's server");
  await page.unroute(matchPath("/store/"), failStore);
  await markPage(page);

  await sleepUnannounced(page, 5);

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#stamp")).not.toContainText("Can't reach the page's server");
  expect(await isSameLoad(page)).toBe(true);
});

test("a reload shows what the page last showed while the store is still answering", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row")).toHaveCount(12);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  const release = await app.holdStore();

  await page.reload();

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#seasonGames .game-day.is-today .game-row")).toHaveCount(12);
  release();
});

test("a reload leaves out a season it last showed that it can no longer read", async ({ page }) => {
  const app = await openApp(page);
  await app.updateFromWorker();
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row")).toHaveCount(12);
  await page.addInitScript(() => {
    const lastSeen = JSON.parse(localStorage.getItem("lastSeen") ?? "null");
    if (!lastSeen?.season) return;
    lastSeen.season.version = 2;
    localStorage.setItem("lastSeen", JSON.stringify(lastSeen));
  });
  const release = await app.holdStore();

  await page.reload();

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#seasonGames .game-day.is-today .game-row")).toHaveCount(12);
  release();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row")).toHaveCount(12);
});

test("a page asleep a few minutes checks for a deploy instead of reloading", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  await sleepUnannounced(page, 5);

  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);
});

test("live scores the page can't read reload it once a newer release is out", async ({ page }) => {
  const served = await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  // The page plans its next read only once it has shown the last one's scores.
  await expect(page.locator("#stamp")).toContainText("Next first pitch");
  await markPage(page);

  served.release = NEXT_RELEASE;
  app.changeSnapshots((snapshot) => ({ ...snapshot, version: 2 }));

  await expectReload(page, () => app.updateFromWorker());
});

/**
 * Picks up the first ranking card and holds it partway down the list.
 * @param {import("@playwright/test").Page} page
 */
async function startDrag(page) {
  await openSettings(page);
  const box = await page.locator("#rankList .grip").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3, { steps: 5 });
}

test("a page that wakes mid-drag after half an hour keeps the drag and doesn't reload", async ({
  page,
}) => {
  await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await startDrag(page);
  await markPage(page);

  await sleepUnannounced(page, 31);
  await expect(page.locator("#rankList .dragging")).toHaveCount(1);
  await page.mouse.up();
  await page.clock.runFor(15 * 1000);

  expect(await isSameLoad(page)).toBe(true);
});

test("a deploy found mid-drag reloads the page once the drag ends", async ({ page }) => {
  const served = await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await expect.poll(() => served.requests).toBe(1);
  await startDrag(page);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);

  await expectReload(page, async () => {
    await page.mouse.up();
    await page.clock.runFor(15 * 1000);
  });
});

test("a page coming back says when its scores are from, first in the header, until the store answers", async ({
  page,
}) => {
  // The page may not have caught up yet when it sleeps, and then shows its last visit's time.
  await page.addInitScript(() => localStorage.setItem("syncedAt", String(Date.now() - 60 * 1000)));
  const app = await openApp(page);
  const stamp = page.locator("#stamp");
  await expect(stamp).toBeVisible();
  const release = await app.holdStore();

  await sleepUnannounced(page, 31);
  await page.clock.runFor(2000);

  const line = stamp.locator("> span").first();
  await expect(line).toHaveClass("catch-up-line");
  await expect(line).toContainText(/Scores as of .*\d/);
  release();
  await expect(stamp).not.toContainText("Scores as of");
});

test("a page coming back to nothing new lets a faded band pass through the header's lines", async ({
  page,
}) => {
  await openApp(page);
  const stamp = page.locator("#stamp");
  await expect(stamp).toBeVisible();
  await expect(stamp).not.toHaveClass(/caught-up/);

  await sleepUnannounced(page, 31);

  await expect(stamp).toHaveClass(/caught-up-band/);
  await expect(stamp).toHaveCSS("animation-duration", "3.2s");
  await expect(stamp).toHaveCSS("mask-image", /rgba\(0, 0, 0, 0\.75\)/);
});

test.describe("on a phone", () => {
  test.use(ON_A_PHONE);

  test("a page asleep half an hour reads what it missed when it wakes, without reloading", async ({
    page,
  }) => {
    await serveReleases(page);
    const app = await openApp(page);
    await lockBracketWhileAway(app);
    await markPage(page);

    await sleepUnannounced(page, 31);

    await expect(page.locator("#updates")).toContainText(BRACKET_SET);
    expect(await isSameLoad(page)).toBe(true);
  });

  test("a page hidden for a moment reads what it missed when it's shown again", async ({
    page,
  }) => {
    await serveReleases(page);
    const app = await openApp(page);
    await lockBracketWhileAway(app);
    await markPage(page);

    await hideAndShow(page);

    await expect(page.locator("#updates")).toContainText(BRACKET_SET);
    expect(await isSameLoad(page)).toBe(true);
  });
});
