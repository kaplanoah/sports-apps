import { test, expect, openApp, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listOffScaleText, measureFieldFace } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";

// Search, the round button beside the tab bar, over the whole season and its players, on a phone.
// Today is Wednesday, September 30.

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

const PLAYER_INDEX = {
  season: 2026,
  players: [
    { id: "1627668", team: "NYL", number: "30", firstName: "Breanna", lastName: "Stewart" },
    { id: "1628932", team: "LVA", number: "22", firstName: "A'ja", lastName: "Wilson" },
  ],
};

/** @param {import("@playwright/test").Page} page */
const findSearch = (page) => page.locator("#gameSearch");
/** @param {import("@playwright/test").Page} page */
const findInput = (page) => page.locator("#gameSearch .search-input");
/** @param {import("@playwright/test").Page} page */
const findLine = (page) => page.locator("#gameSearch .search-read");
/** @param {import("@playwright/test").Page} page */
const findRows = (page) => page.locator("#gameSearch .search-suggestion");
/** @param {import("@playwright/test").Page} page */
const findGamesLine = (page) => page.locator("#gameSearch .search-games-line");

/**
 * Opens the whole season, with its list of players, on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGames(page) {
  const app = await openApp(page, { isWholeSeason: true });
  await app.writeDocument("player-index/2026", PLAYER_INDEX);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  return app;
}

/**
 * Taps Search beside the tab bar where a finger would.
 * @param {import("@playwright/test").Page} page
 */
async function tapSearch(page) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await page.locator("#tab-search").boundingBox()
  );
  const found = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.id ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(found).toBe("tab-search");
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
async function leaveForTwoMinutes(page) {
  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
}

/**
 * Whether Search's icon takes the app's accent, and what its circle draws inside it.
 * @param {import("@playwright/test").Page} page
 */
const readSearchTabLook = (page) =>
  page.locator("#tab-search").evaluate((tab) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      isAccent: getComputedStyle(tab).color === accent,
      inside: getComputedStyle(tab, "::before").content,
    };
  });

test("the field sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the text at --size-read", async ({
  page,
}) => {
  await openSeasonGames(page);
  await expect(findInput(page)).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(findInput(page), "--size-read");
  expect(widths.field).toBeCloseTo(widths.step, 0);
});

test("Search beside the tab bar opens its own view, an empty field ready to type with examples under it, its icon in the accent, and hides the bar's pill", async ({
  page,
}) => {
  await openSeasonGames(page);

  await tapSearch(page);

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(page.locator("#view-games")).toBeHidden();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tabBar")).toHaveClass(/is-unselected/);
  await expect(page.locator("#tabBar .tab-pill")).toBeHidden();
  expect(await readSearchTabLook(page)).toEqual({ isAccent: true, inside: "none" });
  await expect(findInput(page)).toBeFocused();
  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toHaveAttribute("placeholder", "Teams, players, and games");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .search-example")).toHaveText([
    "Dream at Valkyries",
    "Aces in New York",
    "Games this weekend",
    "Stewart",
    "Aces roster",
  ]);

  await page.getByRole("tab", { name: "Standings" }).click();

  await expect(page.locator("#tabBar")).not.toHaveClass(/is-unselected/);
  await expect(page.locator("#tabBar .tab-pill")).toBeVisible();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "false");
  expect((await readSearchTabLook(page)).isAccent).toBe(false);
});

test("the Games tab has no Search of its own", async ({ page }) => {
  await openSeasonGames(page);
  await expect(page.locator("#view-games .go-search")).toHaveCount(0);
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

test("a row's words sit 1.25px over its middle, as the examples' are raised", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  const words = findRows(page).first().locator(".search-words");

  await expect(words).toHaveCSS("padding-bottom", "2.5px");
  await expect(words).toHaveCSS("padding-top", "0px");
});

test("the field sits 10.5px under the header's line", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(findInput(page)).toBeFocused();

  const space = await page.evaluate(() => {
    const header = /** @type {Element} */ (document.querySelector("header.top"));
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    return field.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });

  expect(space).toBeCloseTo(10.5, 1);
});

test("an example tapped runs its search and puts the keyboard away", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await page.locator("#gameSearch .search-example", { hasText: "Dream at Valkyries" }).tap();

  await expect(findInput(page)).toHaveValue("Dream at Valkyries");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Dream @ Valkyries•2 games");
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(2);
});

test("while words are typed, two whole searches, then the team's pages in place of its name, then its games line sit over its games from today, and a suggestion tapped runs its search", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Lib");

  await expect(findRows(page)).toHaveText([
    "Liberty next game",
    "Liberty playoffs",
    "New York Liberty",
    "RosterNew York Liberty",
  ]);
  await expect(findRows(page).first().locator(".search-typed")).toHaveText("Lib");
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-10-04",
  );

  await page.locator("#gameSearch .search-suggestion", { hasText: "Liberty next game" }).tap();

  await expect(findInput(page)).toHaveValue("Liberty next game");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Liberty•Next game");
});

test("a sent team shows its pages over its games line, which opens its games alone on the first from today, and a tap on the field brings back what typing showed", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty");

  await expect(findInput(page)).not.toBeFocused();
  await expect(findRows(page)).toHaveText(["New York Liberty", "RosterNew York Liberty"]);
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");

  await findGamesLine(page).tap();

  await expect(findRows(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  await expect(page.locator("#gameSearch .search-bar")).toHaveClass(/stuck/);

  await findInput(page).tap();

  await expect(findRows(page).first()).toHaveText("Liberty next game");
  await expect(findRows(page).filter({ hasText: "New York Liberty" })).toHaveCount(2);
  await expect(findGamesLine(page)).toBeVisible();
});

test("the games line, as tall as a row, opens the games it read with its words in the field, a half-typed team's finished", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await findInput(page).pressSequentially("Lib");
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");

  const [line, row] = await Promise.all([
    findGamesLine(page).boundingBox(),
    findRows(page).first().boundingBox(),
  ]);
  expect(line?.height).toBe(row?.height);

  await findGamesLine(page).tap();

  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
});

test("words that ask only for games go straight to them, and one whose games are all past rests at its end", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty Dream");

  await expect(findRows(page)).toHaveCount(0);
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Liberty vs Dream•3 games");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-06-11"]')).toBeInViewport();
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-09-23"]')).toBeInViewport();
});

test("a place a team is named for offers its games there as another reading", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "New York");

  await expect(findRows(page)).toHaveText([
    "New York Liberty",
    "RosterNew York Liberty",
    "Games in New York26 games",
  ]);
  await expect(findRows(page).last().locator(".search-caret")).toHaveCount(0);

  await findRows(page).last().tap();

  await expect(findInput(page)).toHaveValue("Games in New York");
  await expect(findLine(page)).toHaveText("In New York•26 games");
});

test("a search that finds nothing says so, and a word it can't use is named", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty in March");

  await expect(findLine(page)).toHaveText("Liberty•March•No games");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText("No Liberty games in March");

  await sendSearch(page, "Liberty fireworks");

  await expect(findLine(page)).toHaveText("Liberty•52 games•'fireworks' unrecognized, skipped");
});

test("a team's row opens its sheet, and its Roster row the sheet on its Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await findSearch(page).getByRole("button", { name: "New York Liberty", exact: true }).tap();

  await expect(page.locator("#teamTitle")).toHaveText("New York Liberty");
  await expectShown(page.locator("#teamSection"));
  await page.keyboard.press("Escape");

  await findRows(page).filter({ hasText: "Roster" }).tap();

  await expect(page.locator("#teamTitle")).toHaveText("New York Liberty");
  await expectShown(page.locator("#rosterSection"));
});

test("a half-typed name finds the player, with her number and team and no games, and her row opens her sheet over her team's Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Stew");

  await expect(findRows(page)).toHaveText(["Breanna Stewart30•Liberty"]);
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);

  await findRows(page).tap();

  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await sheet.getByRole("button", { name: "Back to Team" }).click();
  await expectShown(page.locator("#rosterSection"));
});

test("a standings list's words find it, and its row opens Standings on that list", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "standings");

  await expect(findRows(page)).toHaveText(["Standings•League", "Standings•East", "Standings•West"]);

  await findRows(page).filter({ hasText: "East" }).tap();

  await expect(page.locator("#view-standings")).toBeVisible();
  await expect(page.locator("#view-standings").getByRole("tab", { name: "East" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("highlights with a team finds its latest final, and its row opens that game's sheet on its Highlights", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty highlights");

  await expect(findRows(page)).toHaveText(["HighlightsLynx at Liberty\u2022Yesterday"]);
  await expect(findGamesLine(page)).toHaveCount(0);

  await findRows(page).tap();

  await expect(page.locator("#gameSheet")).toBeVisible();
  await expect(page.locator("#gameTabHighlights")).toHaveAttribute("aria-selected", "true");
});

test("the Bracket tab's words find it, and its row opens it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "bracket");

  await expect(findRows(page)).toHaveText(["Bracket"]);

  await findRows(page).tap();

  await expect(page.locator("#view-bracket")).toBeVisible();
  await expect(page.locator("#tab-bracket")).toHaveAttribute("aria-selected", "true");
});

test("a setting's words find it, and its row opens settings with the setting in sight", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "dark mode");

  await expect(findRows(page)).toHaveText(["Settings•Appearance"]);

  await findRows(page).tap();

  await expect(page.locator("#settingsDialog")).toBeVisible();
  await expect(page.locator("#appearanceTitle")).toBeInViewport();
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

test("Cancel empties the search and goes back to the tab before it; another tab leaves the search as it was", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await page.getByRole("tab", { name: "Games" }).click();
  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("Liberty");

  await page.locator("#gameSearch .search-cancel").first().tap();

  await expect(page.locator("#view-games")).toBeVisible();
  await tapSearch(page);
  await expect(findInput(page)).toHaveValue("");
});

test("Search tapped again while it shows brings the keyboard back up", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await expect(findInput(page)).not.toBeFocused();

  await tapSearch(page);

  await expect(findInput(page)).toBeFocused();
  await expect(findInput(page)).toHaveValue("Liberty");
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

test("two minutes away closes the search and goes back to the tab before it, and less leaves it as it was", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await setHidden(page, true);
  await page.clock.runFor(60_000);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await expect(findInput(page)).toHaveValue("Liberty");

  await leaveForTwoMinutes(page);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await expect(page.locator("#view-games")).toBeVisible();
  await expect(findSearch(page)).toBeHidden();
});

test("a reload shows the search as it was before the page's code arrives, and the tab before it after two minutes away", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await findGamesLine(page).tap();
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  let release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-10-04"]')).toBeInViewport();
  await leaveForTwoMinutes(page);
  release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#view-games")).toBeVisible();
  await expect(page.locator("#view-search")).toBeHidden();
  await expect(page.locator("#tabBar")).not.toHaveClass(/is-unselected/);
  release();
});

test("a search put back from an earlier release names its field as this one does", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await findInput(page).evaluate((input) => {
    input.setAttribute("placeholder", "Search games");
    input.setAttribute("aria-label", "Search games");
  });
  await setHidden(page, true);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await expect(findInput(page)).toHaveAttribute("placeholder", "Teams, players, and games");
  await expect(findInput(page)).toHaveAttribute("aria-label", "Teams, players, and games");
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
  await expect(findRows(page).first()).toBeVisible();
  await expectReadable();

  await sendSearch(page, "New York");
  await expect(findGamesLine(page)).toBeVisible();
  await expectReadable();

  await findGamesLine(page).tap();
  await expect(findGamesLine(page)).toHaveCount(0);
  await expectReadable();

  await sendSearch(page, "Stewart");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "settings");
  await expect(findRows(page).first()).toBeVisible();
  await expectReadable();

  await sendSearch(page, "highlights");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "Liberty in March");
  await expect(page.locator("#gameSearch .empty-note")).toBeVisible();
  await expectReadable();
});

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test("Search is a tab beside the others, named in words", async ({ page }) => {
    await openSeasonGames(page);
    const search = page.getByRole("tab", { name: "Search" });
    await expect(search).toBeVisible();
    await expect(search).toHaveText("Search");

    await search.click();

    await expect(search).toHaveAttribute("aria-selected", "true");
    await expect(findInput(page)).toBeFocused();
  });
});
