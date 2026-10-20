// A page coming back as the store runs the update its return brought forward draws once, with the
// update, never the copy the store held while it was away (shared/page/worker-store.js).

import { expect } from "@playwright/test";
import { trackTextChanges } from "./text-changes.mjs";

const MINUTE_MS = 60 * 1000;

/**
 * @typedef {object} WakingApp
 * @property {(change: (season: any) => any) => Promise<unknown>} changeSeasonWhileAway
 * @property {(ms: number) => void} passTimeAtWorker
 * @property {() => number} countWatchersHeard
 * @property {() => Promise<unknown>} updateFromWorker
 */

/**
 * Counts the page's reads of the store from now on still waiting for an answer.
 * @param {import("@playwright/test").Page} page
 */
function trackStoreReads(page) {
  let out = 0;
  /** @param {import("@playwright/test").Request} request */
  const isStoreRead = (request) => new URL(request.url()).pathname.includes("/store/");
  page.on("request", (request) => isStoreRead(request) && out++);
  /** @param {import("@playwright/test").Request} request */
  const settle = (request) => isStoreRead(request) && out--;
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  return () => out;
}

/**
 * Leaves the page asleep half an hour while the store holds a copy of the season the page's
 * socket never heard of, `changeWhileAway`, which the store's next update puts back, and wakes it,
 * letting every read the page makes as it comes back answer before the store runs that update.
 * Returns each text the Games list and the header showed since.
 * @param {import("@playwright/test").Page} page
 * @param {WakingApp} app
 * @param {{ changeWhileAway: (season: any) => any, onWake?: () => Promise<unknown> }} options
 *   `onWake` is what changes as the phone wakes, like its network coming back
 */
export async function wakeAsStoreUpdates(page, app, { changeWhileAway, onWake = async () => {} }) {
  await app.changeSeasonWhileAway(changeWhileAway);
  app.passTimeAtWorker(31 * MINUTE_MS);
  const readGamesTexts = await trackTextChanges(page, "seasonGames");
  const readStampTexts = await trackTextChanges(page, "stamp");
  const watchers = app.countWatchersHeard();
  const syncedAt = await page.evaluate(() => localStorage.getItem("syncedAt"));

  // The page's clock holds still, and then moves on without running its timers, as a phone that
  // suspends it does, so its wait for the store's update outlasts however long the store takes
  // to run it on a slow machine.
  const readsOut = trackStoreReads(page);
  const asleepAt = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(asleepAt + 1000);
  await page.clock.setSystemTime(asleepAt + 31 * MINUTE_MS);
  // A read the page started while asleep has its answer before the phone wakes.
  await expect.poll(readsOut).toBeLessThan(1);
  const statusRead = page.waitForResponse(
    (response) => response.url().endsWith("/store/live/status") && response.ok(),
  );
  await onWake();
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect.poll(() => app.countWatchersHeard()).toBeGreaterThan(watchers);
  await statusRead;
  await expect.poll(readsOut).toBeLessThan(1);
  await app.updateFromWorker();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("syncedAt"))).not.toBe(syncedAt);
  return [...(await readGamesTexts()), ...(await readStampTexts())];
}
