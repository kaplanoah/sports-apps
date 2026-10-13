import { buildReleaseServer, servePageFiles } from "../../../../tests/browser/release-worker.mjs";
import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { test, expect, openApp, matchPath } from "./harness.mjs";

const MINUTE_MS = 60 * 1000;
const LAST_RELEASE = { version: "1.4.0", commit: "abc1234", builtAt: "2026-10-01T22:00:00Z" };
const NEW_RELEASE = { version: "1.4.1", commit: "def5678", builtAt: "2026-10-01T23:00:00Z" };

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

/** @param {import("@playwright/test").Page} page */
const waitForTick = (page) => page.clock.runFor(15 * 1000);

/**
 * The phone suspends the page without saying so, and it wakes up this much later.
 * @param {import("@playwright/test").Page} page
 * @param {number} minutes
 */
async function sleepUnannounced(page, minutes) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + minutes * MINUTE_MS);
  await page.clock.runFor(15 * 1000);
}

/** @param {import("@playwright/test").Page} page */
const findFinalWinner = (page) => page.locator('[data-series="1-0"] .team-line.won');

/**
 * The page has its last read once it has caught up with the store, which it notes for its next
 * visit.
 * @param {import("@playwright/test").Page} page
 */
const waitForCatchUp = (page) =>
  expect.poll(() => page.evaluate(() => localStorage.getItem("syncedAt"))).not.toBeNull();

test("a reload shows the bracket the page last showed while the store is still answering", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  const release = await app.holdStore();

  await page.reload();

  await expect(findFinalWinner(page)).toContainText("Liberty");
  release();
});

test("a last-shown season the page can't draw is skipped", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("lastSeen", JSON.stringify({ year: 2026, season: { series: 5 } })),
  );

  await openApp(page);

  await expect(findFinalWinner(page)).toContainText("Liberty");
});

test("a page asleep half an hour reads what it missed when it wakes, without reloading", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  await expect(row).toBeVisible();
  await app.changeSeasonWhileAway((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });
  await markPage(page);

  await sleepUnannounced(page, 31);

  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  expect(await isSameLoad(page)).toBe(true);
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {boolean} hidden
 */
const setHidden = (page, hidden) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test("a page hidden a minute closes its socket, and opens another when it's shown", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect.poll(() => app.countOpenSockets()).toBe(1);

  await setHidden(page, true);
  await page.clock.runFor(60 * 1000);
  await expect.poll(() => app.countOpenSockets()).toBe(0);

  await setHidden(page, false);
  await expect.poll(() => app.countOpenSockets()).toBe(1);
});

// The phone can show the page again without a visibilitychange, and the hidden page's timers
// come due only once it's back.
/** @param {import("@playwright/test").Page} page */
const showUnannounced = (page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    dispatchEvent(new Event("focus"));
  });

test("a page shown again without saying so keeps the socket it opens", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  await expect(row).toBeVisible();
  await setHidden(page, true);
  await page.clock.runFor(30 * 1000);

  await showUnannounced(page);
  await page.clock.runFor(30 * 1000);
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });

  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
});

test("a page whose first load failed loads the last season once the store answers", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.moveSeasonTo(2025);
  await page.addInitScript(() => localStorage.removeItem("lastSeen"));
  // Unrouting by the handler too leaves the store's own route, which has the same pattern.
  const failStore = (route) => route.fulfill({ status: 503, body: "" });
  await page.route(matchPath("/store/"), failStore);
  await page.reload();
  await expect(page.locator("#stamp")).toContainText("Can't reach the page's server");
  await page.unroute(matchPath("/store/"), failStore);

  await sleepUnannounced(page, 5);

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#stamp")).not.toContainText("Can't reach the page's server");
});

/** @param {import("@playwright/test").Page} page */
const readReleaseReloads = (page) => page.evaluate(() => sessionStorage.getItem("releaseReloads"));

test("a page that asks a server still on the last release for one of its files reloads until they match", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  const loads = { page: 0, skewed: 0 };
  await servePageFiles(page, (url) => {
    if (url.pathname === "/") loads.page++;
    const isSkewed = url.pathname === `/release/${NEW_RELEASE.commit}/styles.css` && !loads.skewed;
    if (isSkewed) loads.skewed++;
    return (isSkewed ? serveRelease : serveNextRelease)(url);
  });
  await openApp(page);
  expect(loads).toEqual({ page: 1, skewed: 1 });

  await page.clock.runFor(2000);

  await expect.poll(() => loads.page).toBe(2);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator(".view.active")).toBeVisible();
  // The page forgets its reloads once every file has loaded, which can come after it draws.
  await expect.poll(() => readReleaseReloads(page)).toBe(null);
  await page.clock.runFor(2000);
  expect(loads.page).toBe(2);
});

test("a page from the last release reloads when it comes back, though the Worker already served the next one's version", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  await servePageFiles(page, (url) =>
    (url.pathname === "/version.json" ? serveNextRelease : serveRelease)(url),
  );
  await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  await markPage(page);

  const reloaded = page.waitForEvent("load");
  await sleepUnannounced(page, 5);
  await reloaded;

  expect(await isSameLoad(page)).toBe(false);
});

test("a page that never read its own release still reloads when it comes back after a deploy", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  const ownRelease = `/release/${LAST_RELEASE.commit}/version.json`;
  const deploy = { isDone: false };
  await servePageFiles(page, (url) => {
    if (deploy.isDone) return serveNextRelease(url);
    if (url.pathname === ownRelease) return Promise.resolve(new Response(null, { status: 503 }));
    return serveRelease(url);
  });
  await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  await markPage(page);

  deploy.isDone = true;
  await expectReload(page, () => comeBack(page));
});

test("a page that has reloaded as often as it may for a missing file stays as it is", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  await servePageFiles(page, (url) => {
    const isSkewed = url.pathname === `/release/${NEW_RELEASE.commit}/styles.css`;
    return (isSkewed ? serveRelease : serveNextRelease)(url);
  });
  await page.addInitScript(() => sessionStorage.setItem("releaseReloads", "15"));
  await openApp(page);
  await markPage(page);

  await page.clock.runFor(10_000);

  expect(await readReleaseReloads(page)).toBe("15");
  expect(await isSameLoad(page)).toBe(true);
  await expect(findFinalWinner(page)).toContainText("Liberty");
});

test("a file outside the release's folder that fails to load leaves the page as it is", async ({
  page,
}) => {
  await servePageFiles(page, buildReleaseServer("wnba", LAST_RELEASE));
  await openApp(page);
  await markPage(page);

  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const link = Object.assign(document.createElement("link"), {
          rel: "stylesheet",
          href: "missing.css",
          onerror: resolve,
        });
        document.head.append(link);
      }),
  );
  await page.clock.runFor(10_000);

  expect(await readReleaseReloads(page)).toBe(null);
  expect(await isSameLoad(page)).toBe(true);
});

test("a page coming back reloads itself once a deploy has replaced it", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});

test("a page coming back whose release check fails tries again until it finds the deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  served.failures = 2;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  await waitForTick(page);
  await expect.poll(() => served.requests).toBe(3);
  expect(await isSameLoad(page)).toBe(true);

  await expectReload(page, () => waitForTick(page));
});

test("a release check that never answers gives up, and the next tick tries again", async ({
  page,
}) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  served.isHanging = true;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  served.isHanging = false;

  await expectReload(page, () => page.clock.runFor(30 * 1000));
});

test("a page that comes back during a release check checks again once it ends, for a deploy the check read too early to see", async ({
  page,
}) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);
  const loadedRelease = served.release;
  let answerEarlyCheck = () => {};
  const isAnswered = new Promise((resolve) => {
    answerEarlyCheck = () => resolve(undefined);
  });
  await page.route(
    matchPath("/version.json"),
    async (route) => {
      await isAnswered;
      await route.fulfill({ json: loadedRelease });
    },
    { times: 1 },
  );
  const earlyCheck = page.waitForRequest(matchPath("/version.json"));
  await comeBack(page);
  await earlyCheck;

  served.release = NEXT_RELEASE;
  await comeBack(page);

  await expectReload(page, async () => answerEarlyCheck());
});

test("a page whose first release check failed still reloads for a later deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.failures = 1;
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await waitForTick(page);
  await expect.poll(() => served.requests).toBe(3);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
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
  await expect(line.locator(".catch-up-ring")).toHaveCSS("animation-duration", "0.75s");
  release();
  await expect(stamp).not.toContainText("Scores as of");
});

test("under reduced motion, the catching-up ring turns slower", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const app = await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  await app.holdStore();

  await sleepUnannounced(page, 31);
  await page.clock.runFor(2000);

  await expect(page.locator("#stamp .catch-up-ring")).toHaveCSS("animation-duration", "2.4s");
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
  await expect(stamp).toHaveCSS("mask-image", /rgba\(0, 0, 0, 0\.5\)/);
});

test("a page coming back to new scores sweeps the header's lines up to full strength", async ({
  page,
}) => {
  const app = await openApp(page);
  const stamp = page.locator("#stamp");
  await expect(stamp).toBeVisible();
  await expect(stamp).not.toHaveClass(/caught-up/);
  await waitForCatchUp(page);
  await app.changeSeasonWhileAway((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });

  await sleepUnannounced(page, 31);

  await expect(stamp).toContainText("NOW");
  await expect(stamp).toHaveClass(/caught-up-wipe/);
  await expect(stamp).toHaveCSS("animation-duration", "1.4s");
});
