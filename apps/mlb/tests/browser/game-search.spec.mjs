import { test, expect, openApp, matchPath, ON_A_PHONE } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listOffScaleText, measureFieldFace } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";

// The Games view's search, over MLB's whole 2026 season, on a phone. Today is Thursday, September
// 24, the last week of the regular season.

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

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
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .go-search")).toBeVisible();
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
  await expect(page.locator("#gameSearch .search-example")).toHaveText([
    "Mets next game",
    "Mets at Phillies",
    "Yankees in Boston",
    "Games this weekend",
    "World Series",
  ]);
});

test("the examples sit where the WNBA's do: 4.5px under the field, their words 39.5px in, their lines from 39px in to 0.5px short of its right edge", async ({
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

test("the field takes MLB's card fill and edge, and Cancel its gold", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  const look = await page.evaluate(() => {
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    const cancel = /** @type {Element} */ (
      document.querySelector("#gameSearch button.search-cancel")
    );
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.append(probe);
    const resolve = (/** @type {string} */ token) => {
      probe.style.color = root.getPropertyValue(token);
      return getComputedStyle(probe).color;
    };
    const colors = {
      fill: getComputedStyle(field).backgroundColor === resolve("--card"),
      edge: getComputedStyle(field).boxShadow.includes(resolve("--card-border")),
      cancel: getComputedStyle(cancel).color === resolve("--gold"),
      corners: getComputedStyle(field).borderRadius,
    };
    probe.remove();
    return colors;
  });

  expect(look).toEqual({ fill: true, edge: true, cancel: true, corners: "6px" });
});

test("an example tapped runs its search and puts the keyboard away", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await page.locator("#gameSearch .search-example", { hasText: "Mets at Phillies" }).tap();

  await expect(findInput(page)).toHaveValue("Mets at Phillies");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Mets @ Phillies\u20226 games");
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(6);
});

test("while words are typed, suggestions sit over the games from today, and one tapped runs its search", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Met");

  await expect(page.locator("#gameSearch .search-suggestion")).toHaveText([
    "Mets",
    "Mets next game",
    "Mets at home",
    "Mets vs Nationals",
  ]);
  await expect(findLine(page)).toHaveText("Mets\u2022162 games");
  await expect(page.locator("#gameSearch .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );

  await page.locator("#gameSearch .search-suggestion", { hasText: "Mets next game" }).tap();

  await expect(findInput(page)).toHaveValue("Mets next game");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Mets\u2022Next game");
});

test("a sent search opens its list on its first game from today, and a name two clubs share finds both", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Mets");

  await expect(findLine(page)).toHaveText("Mets\u2022162 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-09-24");

  await sendSearch(page, "Sox");

  await expect(findLine(page)).toHaveText("Red Sox or White Sox\u2022318 games");
});

test("a search that finds nothing says so", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Mets in December");

  await expect(findLine(page)).toHaveText("Mets\u2022December\u2022No games");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText("No Mets games in December");
});

test("a found game's row opens its sheet wherever a finger lands on it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets next game");
  const row = page.locator("#gameSearch .game-row").first();
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

test("Cancel closes the search and the Games list comes back on today; so does choosing the Games tab", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");

  await page.locator("#gameSearch button.search-cancel").tap();

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );

  await tapSearch(page);
  await expect(findInput(page)).toHaveValue("");
  await sendSearch(page, "Yankees");
  await page.getByRole("tab", { name: "Games" }).click();

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames")).toBeVisible();
});

test("two minutes away closes the search", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");

  await leaveForTwoMinutes(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(100);

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#seasonGames")).toBeVisible();
});

test("a reload shows the search as it was before the page's code arrives", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");
  await expect.poll(() => readTopDay(page)).toBe("2026-09-24");
  const release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(findSearch(page)).toBeVisible();
  await expect(findInput(page)).toHaveValue("Mets");
  await expect(findLine(page)).toHaveText("Mets\u2022162 games");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-09-24"]')).toBeInViewport();
});

test("every search state keeps to the type scale, its periods, and AA contrast, and every tap lands on a button", async ({
  page,
}) => {
  await openSeasonGames(page);
  const expectReadable = async () => {
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listTapsOffButtons(page)).toEqual([]);
  };

  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await expectReadable();

  await findInput(page).pressSequentially("Mets in");
  await expect(page.locator("#gameSearch .search-suggestion").first()).toBeVisible();
  await expectReadable();

  await findInput(page).press("Enter");
  await expect(page.locator("#gameSearch .search-suggestion")).toHaveCount(0);
  await expectReadable();

  await sendSearch(page, "Mets in December");
  await expect(page.locator("#gameSearch .empty-note")).toBeVisible();
  await expectReadable();
});
