import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { test, expect, openApp } from "./harness.mjs";

test.use({ serviceWorkers: "allow", contextOptions: { reducedMotion: "reduce" } });

// The service worker keeps its copy of the page behind the page's own load.
const waitForCopy = (page) =>
  expect
    .poll(() =>
      page.evaluate(async () => !!(await caches.match(location.href, { cacheName: "page" }))),
    )
    .toBe(true);

// A reload clears whatever the test left on the window.
/** @param {import("@playwright/test").Page} page */
const markPage = (page) => page.evaluate(() => Object.assign(window, { isSameLoad: true }));
/** @param {import("@playwright/test").Page} page */
const isSameLoad = (page) => page.evaluate(() => "isSameLoad" in window);

/** @param {import("@playwright/test").Page} page */
const comeBack = (page) => page.evaluate(() => dispatchEvent(new Event("focus")));

// What the service worker answers a page asking it to read the page again. A page asking while
// another's read is under way shares it, so this answer comes once that one's has.
/** @param {import("@playwright/test").Page} page */
const askForFreshCopy = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => resolve(data);
        navigator.serviceWorker.controller.postMessage({ type: "refreshPageCopy" }, [
          channel.port2,
        ]);
      }),
  );

/** @param {import("@playwright/test").Page} page */
async function openKeptApp(page) {
  const served = await serveReleases(page);
  await openApp(page);
  await waitForCopy(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);
  return served;
}

test("a page opened offline opens from its copy and shows what it last showed", async ({
  page,
}) => {
  // A browser without push, like Safari outside the Home Screen, keeps the copy all the same.
  await page.addInitScript(() => delete window.PushManager);
  await openApp(page);
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await waitForCopy(page);
  await page.context().setOffline(true);

  await page.reload();

  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await expect(page.locator("#loadNote")).toHaveCount(0);
});

test("a page a deploy replaced reloads once its copy holds the newer page", async ({ page }) => {
  const served = await openKeptApp(page);
  served.release = NEXT_RELEASE;
  const reloaded = page.waitForEvent("load");

  await comeBack(page);

  await reloaded;
  expect(await isSameLoad(page)).toBe(false);
});

test("a page a deploy replaced waits to reload until its copy can hold the newer page", async ({
  page,
}) => {
  const served = await openKeptApp(page);
  await page.context().setOffline(true);
  served.release = NEXT_RELEASE;

  await comeBack(page);

  await expect.poll(() => served.requests).toBe(2);
  expect(await askForFreshCopy(page)).toBe(false);
  expect(await isSameLoad(page)).toBe(true);
  await page.context().setOffline(false);
  const reloaded = page.waitForEvent("load");
  await page.clock.runFor(15 * 1000);
  await reloaded;
  expect(await isSameLoad(page)).toBe(false);
});

test("Diagnostics show the steps the service worker kept: its start, install, and activation, and each page it opened", async ({
  page,
}) => {
  await openKeptApp(page);
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await page.getByRole("switch", { name: "Diagnostics" }).click();

  const steps = page.locator("#diagnostics .diagnostics-record", { hasText: "Service worker" });
  await expect(steps).toHaveCount(1);
  const lines = await steps.locator("li").allTextContents();
  expect(lines.toReversed().map((line) => line.replace(/^\s*\S+\s[AP]M\s*/, "").trim())).toEqual([
    "Started",
    "Installed",
    "Activated",
    "Opened the page from the copy",
  ]);
});
