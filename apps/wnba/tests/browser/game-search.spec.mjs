import { test, expect, openApp, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listOffScaleText, measureFieldFace } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";

// The Games view's search, over the whole season, on a phone. Today is Wednesday, September 30.

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/** @param {import("@playwright/test").Page} page */
const findSearch = (page) => page.locator("#gameSearch");
/** @param {import("@playwright/test").Page} page */
const findInput = (page) => page.locator("#gameSearch .search-input");
/** @param {import("@playwright/test").Page} page */
const findLine = (page) => page.locator("#gameSearch .search-read");

/**
 * Opens the whole season on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGames(page) {
  const app = await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  return app;
}

/**
 * Taps the strip's Search where a finger would.
 * @param {import("@playwright/test").Page} page
 */
async function tapSearch(page) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await page.locator("#seasonGames .go-search").boundingBox()
  );
  const found = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.className ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(found).toBe("go-search");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Searches for words, as the keyboard's Search key sends them.
 * @param {import("@playwright/test").Page} page
 * @param {string} words
 */
async function sendSearch(page, words) {
  await findInput(page).fill(words);
  await findInput(page).press("Enter");
}

/**
 * The day at the top of the search's list, where a finger just under its top lands.
 * @param {import("@playwright/test").Page} page
 */
const readTopDay = (page) =>
  page.evaluate(() => {
    const list = /** @type {Element} */ (document.querySelector("#gameSearch .search-list"));
    const { top, left, width } = list.getBoundingClientRect();
    return (
      document
        .elementFromPoint(left + width / 2, top + 20)
        ?.closest(".listed-day")
        ?.getAttribute("data-day") ?? null
    );
  });

/** @param {import("@playwright/test").Page} page */
async function leaveForTwoMinutes(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(2 * 60_000);
}

test("the field sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the text at --size-read", async ({
  page,
}) => {
  await openSeasonGames(page);
  await expect(findInput(page)).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(findInput(page), "--size-read");
  expect(widths.field).toBeCloseTo(widths.step, 0);
});

test("Search beside Today opens an empty field ready to type, with the season's list hidden and examples under it", async ({
  page,
}) => {
  await openSeasonGames(page);

  await tapSearch(page);

  await expect(findSearch(page)).toBeVisible();
  await expect(page.locator("#seasonGames")).toBeHidden();
  await expect(findInput(page)).toBeFocused();
  await expect(findInput(page)).toHaveValue("");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .search-example")).toHaveText([
    "Dream at Valkyries",
    "Aces in New York",
    "Games this weekend",
    "Finals",
    "Liberty last game",
  ]);
});

test("the examples sit 4.5px under the field, their words 39.5px in, their lines from 39px in to 0.5px short of its right edge", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();

  const place = await page.evaluate(() => {
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    const row = /** @type {HTMLElement} */ (document.querySelector("#gameSearch .search-example"));
    const item = /** @type {Element} */ (row.parentElement);
    const line = getComputedStyle(item, "::after");
    const fieldBox = field.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const style = getComputedStyle(row);
    return {
      gap: itemBox.top - fieldBox.bottom,
      words: itemBox.left - fieldBox.left + Number.parseFloat(style.paddingLeft),
      lineLeft: itemBox.left - fieldBox.left + Number.parseFloat(line.left),
      lineRight: fieldBox.right - (itemBox.right - Number.parseFloat(line.right)),
      lift: (Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.paddingTop)) / 2,
    };
  });

  expect(place).toEqual({ gap: 4.5, words: 39.5, lineLeft: 39, lineRight: 0.5, lift: 1.5 });
});

test("an example tapped runs its search and puts the keyboard away", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await page.locator("#gameSearch .search-example", { hasText: "Dream at Valkyries" }).tap();

  await expect(findInput(page)).toHaveValue("Dream at Valkyries");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Dream @ Valkyries\u20222 games");
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(2);
});

test("while words are typed, suggestions sit over the games from today, a half-typed team reads as the team, and one tapped runs its search", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Lib");

  await expect(page.locator("#gameSearch .search-suggestion")).toHaveText([
    "Liberty",
    "Liberty next game",
    "Liberty playoffs",
    "Liberty at home",
  ]);
  await expect(page.locator("#gameSearch .search-suggestion .search-typed").first()).toHaveText(
    "Lib",
  );
  await expect(findLine(page)).toHaveText("Liberty\u202252 games");
  await expect(page.locator("#gameSearch .search-head")).toHaveText("Games");
  await expect(page.locator("#gameSearch .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-10-04",
  );

  await page.locator("#gameSearch .search-suggestion", { hasText: "Liberty next game" }).tap();

  await expect(findInput(page)).toHaveValue("Liberty next game");
  await expect(findInput(page)).not.toBeFocused();
  await expect(page.locator("#gameSearch .search-suggestion")).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Liberty\u2022Next game");
});

test("a sent search opens its list on its first game from today, and one whose games are all past rests at its end", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty");

  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Liberty\u202252 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  await expect(page.locator("#gameSearch .search-bar")).toHaveClass(/stuck/);

  await sendSearch(page, "Liberty Dream");

  await expect(findLine(page)).toHaveText("Liberty vs Dream\u20223 games");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-06-11"]')).toBeInViewport();
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-09-23"]')).toBeInViewport();
});

test("a search that finds nothing says so, and a word it can't use is named", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty in March");

  await expect(findLine(page)).toHaveText("Liberty\u2022March\u2022No games");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText("No Liberty games in March");

  await sendSearch(page, "Liberty fireworks");

  await expect(findLine(page)).toHaveText(
    "Liberty\u202252 games\u2022'fireworks' unrecognized, skipped",
  );
});

test("a found game's row opens its sheet wherever a finger lands on it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty Dream");
  const row = page.locator('#gameSearch .listed-day[data-day="2026-09-23"] .game-row');
  await expect(row).toBeInViewport();
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await row.boundingBox()
  );
  const landing = { x: box.x + 30, y: box.y + box.height / 2 };
  const found = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.className ?? null,
    landing,
  );
  expect(found).toBe("game-open");

  await page.touchscreen.tap(landing.x, landing.y);

  await expect(page.locator("#gameSheet")).toBeVisible();
});

test("Cancel closes the search, emptying it, and the Games list comes back on today; so does choosing the Games tab", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.locator('#seasonGames .day-cell[data-day="2026-09-20"]').click();
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await page.locator("#gameSearch .search-cancel").first().tap();

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-30",
  );
  await expect(page.locator('#seasonGames .listed-day[data-day="2026-09-30"]')).toBeInViewport();

  await tapSearch(page);
  await expect(findInput(page)).toHaveValue("");
  await sendSearch(page, "Dream");
  await page.getByRole("tab", { name: "Games" }).click();

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames")).toBeVisible();
});

test("the field's clear button empties it and brings the examples back, ready to type", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await page.locator("#gameSearch .search-clear").tap();

  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toBeFocused();
  await expect(page.locator("#gameSearch .search-clear")).toBeHidden();
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
});

test("two minutes away closes the search, and less leaves it as it was", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  const setHidden = (/** @type {boolean} */ hidden) =>
    page.evaluate((isHidden) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  await setHidden(true);
  await page.clock.runFor(60_000);
  await setHidden(false);
  await page.clock.runFor(100);
  await expect(findInput(page)).toHaveValue("Liberty");

  await setHidden(true);
  await page.clock.runFor(2 * 60_000);
  await setHidden(false);
  await page.clock.runFor(100);
  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-30",
  );
});

test("a reload shows the search as it was before the page's code arrives, and the season's list after two minutes away", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  let release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(findSearch(page)).toBeVisible();
  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findLine(page)).toHaveText("Liberty\u202252 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-10-04"]')).toBeInViewport();
  await leaveForTwoMinutes(page);
  release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames")).toBeVisible();
  release();
});

test("every search state keeps to the type scale and its periods, and every tap lands on a button", async ({
  page,
}) => {
  await openSeasonGames(page);
  const expectReadable = async () => {
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listTapsOffButtons(page)).toEqual([]);
  };
  await expectReadable();

  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await expectReadable();

  await findInput(page).pressSequentially("Dream in");
  await expect(page.locator("#gameSearch .search-suggestion").first()).toBeVisible();
  await expectReadable();

  await findInput(page).press("Enter");
  await expect(page.locator("#gameSearch .search-suggestion")).toHaveCount(0);
  await expectReadable();

  await sendSearch(page, "Liberty in March");
  await expect(page.locator("#gameSearch .empty-note")).toBeVisible();
  await expectReadable();
});
