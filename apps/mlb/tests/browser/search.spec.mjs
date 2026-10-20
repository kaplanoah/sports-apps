import {
  test,
  expect,
  openApp,
  matchPath,
  ON_A_PHONE,
  PLAYER_DOCS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listTextOffRoles, measureFieldFace } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { findSeasonTab, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { readSeasonPartScroll } from "../../../../tests/browser/season-scroll.mjs";
import { setHidden } from "../../../../tests/browser/visibility.mjs";

// Search, the round button beside the tab bar, over MLB's whole 2026 season and its players, on a
// phone. Today is Thursday, September 24, the last week of the regular season.

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

const PLAYER_INDEX = {
  season: 2026,
  players: [
    { id: "808967", team: "LAD", number: "18", firstName: "Yoshinobu", lastName: "Yamamoto" },
    { id: "596019", team: "NYM", number: "12", firstName: "Francisco", lastName: "Lindor" },
    { id: "694973", team: "PIT", number: "30", firstName: "Paul", lastName: "Skenes" },
    { id: "605141", team: "LAD", number: "50", firstName: "Mookie", lastName: "Betts" },
    { id: "519317", team: "NYY", number: "27", firstName: "Giancarlo", lastName: "Stanton" },
    { id: "678662", team: "CLE", number: "1", firstName: "Angel", lastName: "Mart\u00ednez" },
  ],
};

// Phosphor's baseball at its Regular weight.
const BASEBALL =
  "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM72.09,195.91c.82-1,1.64-1.93,2.42-2.91A8,8,0,1,0,62,183l-1.34,1.62a87.82,87.82,0,0,1,0-113.24L62,73A8,8,0,1,0,74.51,63c-.78-1-1.6-2-2.42-2.91a87.84,87.84,0,0,1,111.82,0c-.82,1-1.64,1.92-2.42,2.91A8,8,0,1,0,194,73l1.34-1.62a87.82,87.82,0,0,1,0,113.24L194,183a8,8,0,1,0-12.48,10c.78,1,1.6,1.95,2.42,2.91a87.84,87.84,0,0,1-111.82,0Zm23.8-50.59a104.5,104.5,0,0,1-4.48,17.35,8,8,0,0,1-15.09-5.34,87.1,87.1,0,0,0,3.79-14.65,8,8,0,1,1,15.78,2.64Zm0-34.64a8,8,0,0,1-6.57,9.21A8.52,8.52,0,0,1,88,120a8,8,0,0,1-7.88-6.68,87.1,87.1,0,0,0-3.79-14.65,8,8,0,0,1,15.09-5.34A104.5,104.5,0,0,1,95.89,110.68Zm78.91,56.86a8,8,0,0,1-10.21-4.87,104.5,104.5,0,0,1-4.48-17.35,8,8,0,1,1,15.78-2.64,87.1,87.1,0,0,0,3.79,14.65A8,8,0,0,1,174.8,167.54Zm-14.69-56.86a104.5,104.5,0,0,1,4.48-17.35,8,8,0,0,1,15.09,5.34,87.1,87.1,0,0,0-3.79,14.65A8,8,0,0,1,168,120a8.52,8.52,0,0,1-1.33-.11A8,8,0,0,1,160.11,110.68Z";

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
 * Opens the whole season, with its list of players and the rosters and players the store keeps,
 * on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGames(page) {
  await openApp(page, {
    isWholeSeason: true,
    store: { "player-index/2026": PLAYER_INDEX, ...ROSTER_DOCS, ...PLAYER_DOCS },
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toBeVisible();
}

/**
 * The days the search's list shows, in its order.
 * @param {import("@playwright/test").Page} page
 */
const findListedDays = (page) => page.locator("#gameSearch .listed-day");

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

/** @param {import("@playwright/test").Page} page */
async function leaveForTwoMinutes(page) {
  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
}

test("the field sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the body role's text", async ({
  page,
}) => {
  await openSeasonGames(page);
  await expect(findInput(page)).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(findInput(page), "--type-body-size");
  expect(widths.field).toBeCloseTo(widths.role, 0);
});

test("Search beside the tab bar opens its own view, an empty field ready to type with examples under it, and hides the bar's pill", async ({
  page,
}) => {
  await openSeasonGames(page);

  await tapSearch(page);

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(page.locator("#view-games")).toBeHidden();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tabBar .tab-pill")).toBeHidden();
  await expect(findInput(page)).toBeFocused();
  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toHaveAttribute("placeholder", "Teams, players, and games");
  await expect(page.locator("#gameSearch .search-example")).toHaveText([
    "Mets next game",
    "Mets at Phillies",
    "Yankees in Boston",
    "Yamamoto",
    "Mets roster",
  ]);

  await openSeasonPart(page, "Standings");

  await expect(page.locator("#tabBar .tab-pill")).toBeVisible();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "false");
});

test("the Games tab has no Search of its own", async ({ page }) => {
  await openSeasonGames(page);
  await expect(page.locator("#view-games .go-search")).toHaveCount(0);
});

test("the examples sit where the WNBA's do: 4.5px under the field, their words 1.5px right of where its text starts, their lines from 2px right of it to 1px short of its right edge", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();

  const place = await page.evaluate(() => {
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    const input = /** @type {Element} */ (document.querySelector("#gameSearch .search-input"));
    const row = /** @type {HTMLElement} */ (document.querySelector("#gameSearch .search-example"));
    const item = /** @type {Element} */ (row.parentElement);
    const line = getComputedStyle(item, "::after");
    const fieldBox = field.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const textStart = input.getBoundingClientRect().left;
    const style = getComputedStyle(row);
    return {
      gap: itemBox.top - fieldBox.bottom,
      words: itemBox.left + Number.parseFloat(style.paddingLeft) - textStart,
      lineLeft: itemBox.left + Number.parseFloat(line.left) - textStart,
      lineRight: fieldBox.right - (itemBox.right - Number.parseFloat(line.right)),
      lift: (Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.paddingTop)) / 2,
    };
  });

  expect(place).toEqual({ gap: 4.5, words: 1.5, lineLeft: 2, lineRight: 1, lift: 1.5 });
});

test("the field sits 11px under the header's line", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(findInput(page)).toBeFocused();

  const space = await page.evaluate(() => {
    const header = /** @type {Element} */ (document.querySelector("header.top"));
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    return field.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });

  expect(space).toBeCloseTo(11, 1);
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
      cancel: getComputedStyle(cancel).color === resolve("--highlight"),
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

test("while words are typed, two whole searches, then the club's pages in place of its name, then its games line sit over its games from today, and a suggestion tapped runs its search", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Met");

  await expect(findRows(page)).toHaveText([
    "Mets next game",
    "Mets at home",
    "New York Mets73-86",
    "RosterNew York Mets",
  ]);
  await expect(findGamesLine(page)).toHaveText("Mets\u2022162 games");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );

  await findRows(page).filter({ hasText: "Mets next game" }).tap();

  await expect(findInput(page)).toHaveValue("Mets next game");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Mets\u2022Next game");
});

test("a sent club shows its pages over its games from today, soonest first, or, once all are past, the latest first, and its games line opens them alone on the first from today", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "New York in April");

  await expect(findRows(page)).toHaveText(["Yankees in April26 games", "Mets in April26 games"]);
  const pastDays = await findListedDays(page).evaluateAll((listed) =>
    listed.map((day) => /** @type {HTMLElement} */ (day).dataset.day ?? ""),
  );
  expect(pastDays.length).toBeGreaterThan(1);
  expect(pastDays).toEqual([...pastDays].sort().reverse());

  await sendSearch(page, "Mets");

  await expect(findRows(page)).toHaveText(["New York Mets73-86", "RosterNew York Mets"]);
  await expect(findGamesLine(page)).toHaveText("Mets\u2022162 games");
  await expect(findListedDays(page).first()).toHaveAttribute("data-day", "2026-09-24");

  await findGamesLine(page).tap();

  await expect(findRows(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Mets\u2022162 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-09-24");
});

test("words that ask only for games go straight to them, and a name two clubs share finds both", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Sox");

  await expect(findRows(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Red Sox or White Sox\u2022318 games");
});

test("a search that finds nothing says so", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Mets in December");

  await expect(findLine(page)).toHaveText("Mets\u2022December\u2022No games");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText("No Mets games in December");
});

test("a search of most of the season draws the days near the screen whole, and a stand-in as tall as its games for each other until it comes near", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "games");

  const days = page.locator("#gameSearch .listed-day");
  const first = days.first();
  await expect(days.last()).toBeAttached();
  expect(await page.locator("#gameSearch .is-stand-in").count()).toBeGreaterThan(
    (await days.count()) / 2,
  );
  await expect(first.locator(".is-stand-in")).toHaveCount(1);
  const top = await first.evaluate((day) => /** @type {HTMLElement} */ (day).offsetTop);

  await page.locator("#gameSearch .search-list").evaluate(
    (list) =>
      new Promise((resolve) => {
        list.addEventListener("scroll", resolve, { once: true });
        list.scrollTop = 0;
      }),
  );
  await page.clock.runFor(100);

  await expect(first.locator(".is-stand-in")).toHaveCount(0);
  await expect(first.locator(".game-list li").first()).toBeVisible();
  expect(await first.evaluate((day) => /** @type {HTMLElement} */ (day).offsetTop)).toBe(top);
});

test("a club's row opens its sheet, and its Roster row the sheet on its Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Dodgers");

  await findSearch(page)
    .getByRole("button", { name: "Los Angeles Dodgers 97-61", exact: true })
    .tap();

  await expect(page.locator("#teamTitle")).toContainText("Dodgers");
  await expectShown(page.locator("#teamSection"));
  await page.keyboard.press("Escape");

  await findRows(page).filter({ hasText: "Roster" }).tap();

  await expect(page.locator("#teamTitle")).toContainText("Dodgers");
  await expectShown(page.locator("#rosterSection"));
});

test("a half-typed name finds the player, with his number and club and no games, and his row opens his sheet over his club's Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Bett");

  await expect(findRows(page)).toHaveText(["Mookie Betts50\u2022Dodgers"]);
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);

  await findRows(page).tap();

  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator("#playerTitle")).toContainText("Betts");
  await sheet.getByRole("button", { name: "Back to Team" }).click();
  await expectShown(page.locator("#rosterSection"));
});

test("a starter's name, half typed, suggests his starts beside his sheet, and whole, finds his sheet and still finds his starts", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Yama");

  await expect(findRows(page)).toHaveText([
    "Yamamoto",
    "Yamamoto last start",
    "Yoshinobu Yamamoto18\u2022Dodgers",
  ]);

  await sendSearch(page, "Skenes");

  await expect(findRows(page)).toHaveText(["Paul Skenes30\u2022Pirates"]);
  await expect(findGamesLine(page)).toContainText("Skenes");
});

test("standings words find the playoff fields and each league's divisions, and a row opens the standings with its part just under the pill", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "standings");

  await expect(findRows(page)).toHaveText(["StandingsPlayoffs", "StandingsAL", "StandingsNL"]);

  await findRows(page).filter({ hasText: "AL" }).tap();

  await expect(page.locator("#standingsWrap")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const top = document.querySelector('[data-standings="AL"]')?.getBoundingClientRect().top;
        const pill = document.getElementById("bracketStandingsPill")?.getBoundingClientRect();
        return top === undefined || !pill ? null : top - pill.bottom;
      }),
    )
    .toBeCloseTo(0, 0);
  await expect(page.locator('[data-standings="AL"] .div-title').first()).toContainText("AL East");

  await tapSearch(page);
  await findRows(page).filter({ hasText: "Playoffs" }).tap();

  await expect(page.locator("#standingsWrap")).toBeVisible();
  await expect.poll(() => readSeasonPartScroll(page, "standings")).toBe(0);
});

test("a club's matchup finds its next game, marked with a baseball, and its row opens that game's sheet on its Matchup", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Mets matchup");

  await expect(findRows(page)).toHaveText(["MatchupMets at Nationals\u2022Tomorrow"]);
  await expect(findRows(page).locator(".search-mark path")).toHaveAttribute("d", BASEBALL);
  await expect(findGamesLine(page)).toHaveCount(0);

  await findRows(page).tap();

  await expect(page.locator("#gameSheet")).toBeVisible();
  await expect(page.locator("#gameTabMatchup")).toHaveAttribute("aria-selected", "true");
});

test("highlights with a club finds its latest final, and its row opens that game's sheet on its Highlights", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Mets highlights");

  await expect(findRows(page)).toHaveCount(1);
  await expect(findRows(page)).toContainText("Highlights");

  await findRows(page).tap();

  await expect(page.locator("#gameSheet")).toBeVisible();
  await expect(page.locator("#gameTabHighlights")).toHaveAttribute("aria-selected", "true");
});

test("the Bracket's words find it, and its row opens its tab on it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "bracket");

  await expect(findRows(page)).toHaveText(["Bracket"]);

  await findRows(page).tap();

  await expect(page.locator("#bracketWrap")).toBeVisible();
  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
});

test("every row is 44px under its line, with no room between the suggestions and the pages under them", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("athl");

  await expect(page.locator("#gameSearch .search-suggestions")).toHaveCount(2);
  const rows = await page.locator("#gameSearch .search-suggestions li").evaluateAll((items) =>
    items.map((item) => {
      const { top, bottom } = item.getBoundingClientRect();
      return { top, bottom };
    }),
  );
  for (const [index, { top, bottom }] of rows.entries()) {
    expect(bottom - top).toBe(45);
    if (index > 0) expect(top).toBe(rows[index - 1].bottom);
  }
});

test("a place's row names the place it's in dimmed, then a dim caret 4px from the words each side, centered on them", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "ranking");

  await expect(findRows(page)).toHaveAccessibleName("Settings, Ranking");
  const crumb = await findRows(page).evaluate((row) => {
    const box = (/** @type {Element} */ element) => element.getBoundingClientRect();
    const inkOf = (/** @type {string} */ selector) =>
      getComputedStyle(/** @type {Element} */ (row.querySelector(selector))).color;
    const placeIn = /** @type {Element} */ (row.querySelector(".search-place-in"));
    const caret = /** @type {Element} */ (row.querySelector(".search-crumb"));
    const range = document.createRange();
    range.selectNodeContents(/** @type {Node} */ (caret.nextSibling));
    return {
      dim: inkOf(".search-mark"),
      words: inkOf(".search-words"),
      placeIn: inkOf(".search-place-in"),
      caret: inkOf(".search-crumb"),
      width: box(caret).width,
      height: box(caret).height,
      before: box(caret).left - box(placeIn).right,
      after: range.getBoundingClientRect().left - box(caret).right,
      offCenter:
        box(caret).top + box(caret).height / 2 - (box(placeIn).top + box(placeIn).height / 2),
    };
  });
  expect(crumb.placeIn).toBe(crumb.dim);
  expect(crumb.caret).toBe(crumb.dim);
  expect(crumb.words).not.toBe(crumb.dim);
  expect(crumb).toMatchObject({ width: 12, height: 12 });
  expect(crumb.before).toBeCloseTo(4, 1);
  expect(crumb.after).toBeCloseTo(4, 1);
  expect(Math.abs(crumb.offCenter)).toBeLessThan(2);
});

test("a setting's words find it, and its row opens settings with the setting in sight", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "ranking");

  await expect(findRows(page)).toHaveText(["SettingsRanking"]);

  await findRows(page).tap();

  await expect(page.locator("#settingsDialog")).toBeVisible();
  await expect(page.locator("#rankingTitle")).toBeInViewport();
});

test("while typing, a place's half-typed word lists it first, beside a player it starts, a setting's word beside the club it's a letter off, and a city two clubs share both clubs' games, its half-typed words starting no player", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("stan");

  await expect(findRows(page)).toHaveText([
    "StandingsPlayoffs",
    "StandingsAL",
    "StandingsNL",
    "Giancarlo Stanton27\u2022Yankees",
  ]);

  const athletic = findRows(page).filter({ hasText: "The Athletic" });
  for (const words of ["athl", "athletic"]) {
    await findInput(page).fill("");
    await findInput(page).pressSequentially(words);

    await expect(athletic).toHaveText("SettingsInclude content from The Athletic");
    await expect(athletic).toBeInViewport();
  }
  await expect(findRows(page).filter({ hasText: /^\s*Athletics\s*63-95\s*$/ })).toHaveCount(1);

  await findInput(page).fill("");
  await findInput(page).pressSequentially("los");

  await expect(findRows(page).first()).toContainText("Los Angeles");
  await expect(findGamesLine(page)).toContainText("In Los Angeles");

  const angel = findRows(page).filter({ hasText: "Angel Mart\u00ednez" });
  await findInput(page).fill("");
  await findInput(page).pressSequentially("ange");
  await expect(angel).toHaveCount(1);

  await findInput(page).fill("");
  await findInput(page).pressSequentially("los ange");
  await expect(findGamesLine(page)).toContainText("In Los Angeles");
  await expect(angel).toHaveCount(0);
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

test("Cancel empties the search and goes back to the tab before it; another tab leaves the search as it was", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");

  await openSeasonPart(page, "Standings");
  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("Mets");

  await page.locator("#gameSearch button.search-cancel").tap();

  await expect(page.locator("#standingsWrap")).toBeVisible();
  await tapSearch(page);
  await expect(findInput(page)).toHaveValue("");
});

test("Search tapped again while it shows starts over: an empty field with its examples, ready to type", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");
  await expect(findInput(page)).not.toBeFocused();

  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toBeFocused();
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
});

test("two minutes away closes the search and goes back to the tab before it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");

  await leaveForTwoMinutes(page);
  await setHidden(page, false);
  await page.clock.runFor(100);

  await expect(findSearch(page)).toBeHidden();
  await expect(page.locator("#view-games")).toBeVisible();
});

test("a reload shows the search as it was before the page's code arrives", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Mets");
  await findGamesLine(page).tap();
  await expect.poll(() => readTopDay(page)).toBe("2026-09-24");
  const release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(findInput(page)).toHaveValue("Mets");
  await expect(findLine(page)).toHaveText("Mets\u2022162 games");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-09-24"]')).toBeInViewport();
});

test("every search state keeps to its type roles, its periods, and AA contrast, and every tap lands on a button", async ({
  page,
}) => {
  await openSeasonGames(page);
  const expectReadable = async () => {
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listChipsOffCenter(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listTapsOffButtons(page)).toEqual([]);
  };

  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await expectReadable();

  await findInput(page).pressSequentially("Mets in");
  await expect(findRows(page).first()).toBeVisible();
  await expectReadable();

  await sendSearch(page, "Mets");
  await expect(findGamesLine(page)).toBeVisible();
  await expectReadable();

  await sendSearch(page, "Yamamoto");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "standings");
  await expect(findRows(page)).toHaveCount(3);
  await expectReadable();

  await sendSearch(page, "Mets matchup");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "Mets in December");
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
