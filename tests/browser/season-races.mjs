import { expect } from "@playwright/test";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { openSettings } from "./settings.mjs";
import { waitForLoadToSettle } from "./at-rest.mjs";

/** @param {import("@playwright/test").Page} page */
const reloadShownSeason = (page) =>
  page.evaluate(async () => {
    const { loadSeason } = await import(new URL("js/season-data.js", location.href).href);
    await loadSeason();
  });

/**
 * Marks the held read's settlement in the page, so releasing it cannot race the next step.
 * @param {import("@playwright/test").Page} page
 */
const observePickedRead = (page) =>
  page.evaluate(async () => {
    const { session } = await import(new URL("js/session.js", location.href).href);
    const openDocument = session.db.doc.bind(session.db);
    Reflect.set(window, "pickedReadSettled", false);
    session.db.doc = (path) => {
      const document = openDocument(path);
      if (path !== "seasons/2025") return document;
      const read = document.get.bind(document);
      document.get = async () => {
        try {
          return await read();
        } finally {
          Reflect.set(window, "pickedReadSettled", true);
        }
      };
      return document;
    };
  });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} year
 */
async function expectPickedSeason(page, year) {
  await expect(page.locator("#seasonPicker")).toHaveValue(year);
  await expect(page.locator("#seasonPicker option[selected]")).toHaveAttribute("value", year);
  if (year === "2026") await expect(page.locator("#titleYear")).toBeHidden();
  else await expect(page.locator("#titleYear")).toHaveText(year);
}

/** @param {import("@playwright/test").Page} page */
async function checkPickDuringReload(page) {
  await waitForLoadToSettle(page);
  await observePickedRead(page);
  await openSettings(page);
  const releasePick = await holdRequests(page, matchPath("/store/seasons/2025"), { times: 1 });
  const picking = page.waitForRequest(matchPath("/store/seasons/2025"));
  await page.locator("#seasonPicker").selectOption("2025");
  await picking;
  const releaseReload = await holdRequests(page, matchPath("/store/seasons/2026"), { times: 1 });
  const loading = page.waitForRequest(matchPath("/store/seasons/2026"));
  const reloaded = reloadShownSeason(page);
  await loading;
  releasePick();
  await page.waitForFunction(() => Reflect.get(window, "pickedReadSettled"));
  await expect(page.locator("#seasonPicker")).toHaveValue("2026");
  releaseReload();
  await reloaded;
  await waitForLoadToSettle(page);
  await expectPickedSeason(page, "2026");
}

/** @param {import("@playwright/test").Page} page */
async function checkNewestPickDraws(page) {
  await waitForLoadToSettle(page);
  await openSettings(page);
  const release = await holdRequests(page, matchPath("/store/seasons/2025"), { times: 1 });
  const picking = page.waitForRequest(matchPath("/store/seasons/2025"));
  await page.locator("#seasonPicker").selectOption("2025");
  await picking;
  await page.locator("#seasonPicker").selectOption("2024");
  await expectPickedSeason(page, "2024");
  release();
  await waitForLoadToSettle(page);
  await expectPickedSeason(page, "2024");
}

/** @param {import("@playwright/test").Page} page */
async function checkFailedPickAfterReload(page) {
  await waitForLoadToSettle(page);
  await observePickedRead(page);
  await openSettings(page);
  let failPick = () => {};
  const held = new Promise((resolve) => {
    failPick = () => resolve(undefined);
  });
  await page.route(
    matchPath("/store/seasons/2025"),
    async (route) => {
      await held;
      await route.abort();
    },
    { times: 1 },
  );
  const picking = page.waitForRequest(matchPath("/store/seasons/2025"));
  await page.locator("#seasonPicker").selectOption("2025");
  await picking;
  await reloadShownSeason(page);
  await expectPickedSeason(page, "2026");
  await page.evaluate(() => {
    const stamp = document.querySelector("#stamp");
    const errors = [];
    Object.assign(window, { seasonErrors: errors });
    new MutationObserver(() => {
      if (stamp.textContent.includes("Can't reach")) errors.push(stamp.textContent);
    }).observe(stamp, { subtree: true, childList: true, characterData: true });
  });
  failPick();
  await page.waitForFunction(() => Reflect.get(window, "pickedReadSettled"));
  await waitForLoadToSettle(page);
  await expectPickedSeason(page, "2026");
  await expect(page.locator("#stamp")).not.toContainText("Can't reach");
  expect(await page.evaluate(() => Reflect.get(window, "seasonErrors"))).toEqual([]);
}

export const SEASON_RACES = /** @type {const} */ ([
  [
    "a pick settling during the app's reload leaves the picker on the reloaded season",
    checkPickDuringReload,
  ],
  ["the newest pick draws before an older stuck read finishes", checkNewestPickDraws],
  ["a failed pick never flashes an error after a successful reload", checkFailedPickAfterReload],
]);
