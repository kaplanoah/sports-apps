import { test, expect, keepHighlights, openApp, openGameSheet, matchPath } from "./harness.mjs";
import { listFontsNotPreloaded } from "../../../../tests/browser/font-loads.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";
import {
  listTapFlashes,
  listTapsOffButtons,
  listTouchHoverRules,
} from "../../../../tests/browser/tap-states.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";
import { chooseAppearance, readColor, readTokenColor } from "./theme.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Waits for the page to draw the season the store sent, which names the season's tab Bracket and
 * adds the header's lines over the tabs, moving them.
 * @param {import("@playwright/test").Page} page
 */
async function expectFirstDrawing(page) {
  await expect(page.locator("#bracketFace")).toBeVisible();
  await expect(page.locator("#stamp")).toBeVisible();
}

test("the page opens on the bracket the Worker saved, and each tab shows its view", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await expect(page.locator("header.top .title-row")).toHaveText("WNBA");
  const stampLines = page.locator("#stamp > span");
  await expect(stampLines.nth(0)).toHaveText(
    "Last game Liberty 87 Lynx 71 final yesterday \u2014 Liberty won series 2-0",
  );
  await expect(stampLines.nth(1)).toHaveText(/^Next tip-off 7:00\s?PM \u2014 Dream @ Mystics$/);
  const [last, next] = [
    await stampLines.nth(0).boundingBox(),
    await stampLines.nth(1).boundingBox(),
  ];
  expect(next.y - (last.y + last.height)).toBeGreaterThanOrEqual(3);
  const stampColors = await page.locator("#stamp").evaluate((stamp) => {
    const time = stamp.querySelector("b");
    return { line: getComputedStyle(stamp).color, time: getComputedStyle(time).color };
  });
  expect(stampColors.time).not.toBe(stampColors.line);

  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toContainText(
    "7:00",
  );
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league tr.playoff-line + tr")).toContainText("Fire");
  const tabs = page.locator("nav.tabs").getByRole("tab");
  await expect(tabs).toHaveCount(4);
  for (const [index, name] of ["Bracket", "Games", "News", "Search"].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name);
});

test("every font the page's views draw with is preloaded", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league tr").nth(2)).toBeVisible();

  expect(await listFontsNotPreloaded(page)).toEqual([]);
});

test("every piece of text keeps to its type role, in every view", async ({ page }) => {
  await openApp(page);
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league tr").nth(2)).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();
  await expect(page.locator("#teamSheet table.players")).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#teamSheet")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
});

test("the page uses its own fonts, served with it", async ({ page }) => {
  await openApp(page);
  // The bracket's wins are the first text in Barlow Condensed, so its font loads once they show.
  await expect(page.locator('[data-series="1-0"] .wins').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
  );
  expect(new Set(loaded)).toEqual(new Set(["Barlow Condensed", "Barlow"]));
  const italics = await page.evaluate(() =>
    [...document.fonts]
      .filter((font) => font.status === "loaded" && font.style === "italic")
      .map((font) => font.family),
  );
  expect(italics).toEqual(["Barlow"]);
});

test("every team name is in Barlow Condensed", async ({ page }) => {
  await openApp(page);
  const readFonts = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) =>
          getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
        ),
      );
  await expect(page.locator(".team-line .club").first()).toBeVisible();
  expect(new Set(await readFonts(".club"))).toEqual(new Set(["Barlow Condensed"]));
});

test("the title is in Barlow Condensed, and the round names and each card's note in Barlow, the note italic", async ({
  page,
}) => {
  await openApp(page);
  const readFirstFont = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) =>
        getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
      );
  await expect(page.locator(".card-note").first()).toBeVisible();
  expect(await readFirstFont("header.top h1")).toBe("Barlow Condensed");
  expect(await readFirstFont(".round-name")).toBe("Barlow");
  expect(await readFirstFont(".card-note")).toBe("Barlow");
  await expect(page.locator(".card-note").first()).toHaveCSS("font-style", "italic");
  await expect(page.locator(".card-note").first()).toHaveCSS(
    "font-size",
    `${(await readRole(page, "detail")).size}px`,
  );
});

test("the sliders icon keeps the same room from the stamp as MLB's", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  const stamp = await page.locator("#stamp").boundingBox();
  const icon = await page.locator("#settingsBtn svg").boundingBox();
  const gap = icon.x - (stamp.x + stamp.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(18);
});

test("a tap shows only the page's own states: no gray flash, and no hover left behind", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

test("hovering the settings button gives its icon the hover color, with no square behind it", async ({
  page,
}) => {
  await openApp(page);
  const button = page.locator("#settingsBtn");
  await button.hover();
  await expect(button).toHaveCSS("color", await readTokenColor(page, "--ink-hover"));
  await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test.describe("on a phone, the text", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("keeps to its type roles in the header, the Updates box, the games, the standings, a team's sheet, and settings", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    await expect(page.locator("#updates .what").first()).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);

    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
    await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
    await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);

    await openSeasonPart(page, "Standings");
    const standings = page.locator("#standings-league");
    await expect(standings.locator("tbody tr").first()).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);

    await standings.locator('tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator(".team-game")).toHaveCount(3);
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#settingsDialog")).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  });

  test("of the Updates box reads as sentences, its days as details, and its count as a label, and a series' standing stays on one line", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");
    await expect(updates.locator(".what").first()).toBeVisible();
    const [body, detail, label] = await Promise.all(
      ["body", "detail", "label"].map(async (role) => `${(await readRole(page, role)).size}px`),
    );
    await expect(updates.locator(".what").first()).toHaveCSS("font-size", body);
    await expect(updates.locator(".what b").first()).toHaveCSS("font-size", body);
    await expect(updates.locator(".when").first()).toHaveCSS("font-size", detail);
    await expect(updates.locator(".updates-count")).toHaveCSS("font-size", label);
    const lineCounts = await updates
      .locator(".series-score")
      .evaluateAll((scores) => scores.map((score) => score.getClientRects().length));
    expect(lineCounts.length).toBeGreaterThan(0);
    expect(lineCounts.every((count) => count === 1)).toBe(true);
  });
});

/**
 * How light a computed color is, as the sum of its red, green, and blue.
 * @param {string} color
 */
const sumChannels = (color) =>
  color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .reduce((sum, channel) => sum + channel);

/**
 * The sum of a CSS color's red, green, and blue, whatever space the browser gives it in.
 * @param {import("@playwright/test").Page} page
 * @param {string} color
 */
const readBrightness = (page, color) =>
  page.evaluate((css) => {
    const context = document.createElement("canvas").getContext("2d");
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return red + green + blue;
  }, color);

for (const theme of ["Maple", "Walnut"])
  test(`in ${theme}, the bracket's and the games' cards sit most of the way from the floor to the card color`, async ({
    page,
  }) => {
    await openApp(page);
    await page.evaluate((name) => {
      document.documentElement.dataset.theme = name === "Walnut" ? "dark" : "light";
    }, theme);
    const series = page.locator('.series[data-series="1-0"]');
    await expect(series).toBeVisible();
    const face = await series.evaluate((card) => getComputedStyle(card).backgroundColor);
    const floor = await readBrightness(page, await readTokenColor(page, "--bg"));
    const brightest = await readBrightness(page, await readTokenColor(page, "--card"));
    const card = await readBrightness(page, face);
    expect(Math.abs(card - floor)).toBeGreaterThan(Math.abs(brightest - floor) * 0.6);
    expect(Math.abs(card - floor)).toBeLessThan(Math.abs(brightest - floor) * 0.9);
    await page.getByRole("tab", { name: "Games" }).click();
    const day = page.locator("#seasonGames .game-day.is-today .game-list");
    expect(await day.evaluate((card) => getComputedStyle(card).backgroundColor)).toBe(face);
  });

test("a day of games and a series in the bracket share one thin outline, lighter than the bracket's lines", async ({
  page,
}) => {
  await openApp(page);
  const readOutline = (locator) =>
    locator
      .first()
      .evaluate((card) => [
        getComputedStyle(card).borderTopWidth,
        getComputedStyle(card).borderTopColor,
      ]);
  const seriesCard = page.locator('[data-series="1-0"]');
  await expect.poll(async () => (await readOutline(seriesCard))[0]).toBe("1px");
  const series = await readOutline(seriesCard);
  expect(sumChannels(series[1])).toBeGreaterThan(sumChannels(await readTokenColor(page, "--line")));
  await page.getByRole("tab", { name: "Games" }).click();
  expect(await readOutline(page.locator("#seasonGames .game-day.is-today .game-list"))).toEqual(
    series,
  );
});

test("on a wide screen, the Games list keeps to one phone's width, in the middle of the page", async ({
  page,
}) => {
  await openApp(page);
  const pageMiddle = page.viewportSize().width / 2;
  await page.getByRole("tab", { name: "Games" }).click();
  for (const selector of ["#seasonGames .day-bar-head", "#seasonGames .game-day.is-today"]) {
    const box = await page.locator(selector).first().boundingBox();
    expect(Math.abs(box.x + box.width / 2 - pageMiddle), selector).toBeLessThanOrEqual(1);
  }
  const listBox = await page.locator("#seasonGames .game-day.is-today").first().boundingBox();
  expect(listBox.width).toBe(560);
});

test("on a wide screen, the standings keep to one phone's width, under the pill's left edge", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const pill = await findSeasonPill(page).boundingBox();
  for (const list of ["league", "east", "west"]) {
    const table = await page.locator(`#standings-${list} table.standings`).boundingBox();
    expect(table.width, list).toBe(560);
    expect(Math.abs(table.x - pill.x), list).toBeLessThanOrEqual(1);
  }
});

test("clicking the tab that's showing scrolls back to the top, and then takes it back to the part it's named for", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league tbody tr").first()).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await findSeasonTab(page).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#standings-league")).toBeVisible();

  await findSeasonTab(page).dispatchEvent("click");

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("on a phone, each tab comes back where it was left, and a tab not shown yet opens at its top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league tbody tr").first()).toBeVisible();
  const left = await page.evaluate(() => {
    scrollTo({ top: 400, behavior: "instant" });
    return scrollY;
  });
  expect(left).toBe(400);

  await page.getByRole("tab", { name: "News" }).click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("tab", { name: "Games" }).click();
  await findSeasonTab(page).click();

  expect(await page.evaluate(() => scrollY)).toBe(left);
  await expect(page.locator("#standings-league")).toBeVisible();
});

test("the page reopens on the tab it was last on, showing the part of it last shown", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-games")).toBeVisible();
  await expect(page.locator("#view-bracket-standings")).toHaveCSS("display", "none");

  await openSeasonPart(page, "Standings");
  await page.reload();

  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(findSeasonPill(page).getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#standingsWrap")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();
});

test("a page last left on a tab it no longer has, like Teams, opens on the bracket", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "teams"));
  await openApp(page);

  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#bracketWrap")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the tab bar floats at the bottom, each view starts just under the header, and the page neither scrolls sideways nor shows a scrollbar", async ({
    page,
  }) => {
    // The tab bar's pill would ease to each tab, which this test doesn't need to wait out.
    await openApp(page);
    await expectFirstDrawing(page);
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y + bar.height).toBeGreaterThan(844 - 40);
    const headerBottom = await page
      .locator("header.top")
      .evaluate((header) => header.getBoundingClientRect().bottom);
    for (const { tab, show } of [
      { tab: "Bracket", show: () => openSeasonPart(page, "Bracket") },
      { tab: "Games", show: () => page.getByRole("tab", { name: "Games" }).click() },
      { tab: "Standings", show: () => openSeasonPart(page, "Standings") },
    ]) {
      await show();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, tab).toBeLessThanOrEqual(390);
      const view = await page.locator(".view.active").boundingBox();
      expect(view.y - headerBottom, tab).toBeLessThanOrEqual(14);
    }
    const scrollbars = await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll("body *")]
        .filter((element) => getComputedStyle(element).scrollbarWidth !== "none")
        .map((element) => element.id || element.className),
    );
    expect(scrollbars).toEqual([]);
  });

  test("the tab bar is filled with each theme's raised wood, inside its edge", async ({ page }) => {
    await openApp(page);
    const readBacking = () =>
      page.locator(".tab-backing").evaluate((backing) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--raised)";
        probe.style.color = "var(--edge)";
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const shown = getComputedStyle(backing);
        const result = {
          tint: shown.backgroundColor === expected.backgroundColor,
          edge: shown.boxShadow.includes(expected.color),
        };
        probe.remove();
        return result;
      });
    for (const appearance of ["Maple", "Walnut"]) {
      await chooseAppearance(page, appearance);
      expect(await readBacking(), appearance).toEqual({ tint: true, edge: true });
    }
  });

  test("the tab bar's pill is the wood of its edge in each theme", async ({ page }) => {
    await openApp(page);
    const isWood = () =>
      page.locator(".tab-pill").evaluate((pill) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--edge)";
        document.body.append(probe);
        const isSame =
          getComputedStyle(pill).backgroundColor === getComputedStyle(probe).backgroundColor;
        probe.remove();
        return isSame;
      });
    for (const appearance of ["Maple", "Walnut"]) {
      await chooseAppearance(page, appearance);
      expect(await isWood(), appearance).toBe(true);
    }
  });

  test("every spot that looks tappable lands on a button, in every view", async ({ page }) => {
    const app = await openApp(page);
    await expect(page.locator('[data-series="1-0"] .team-line').first()).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);

    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);
    await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
    await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);

    await openSeasonPart(page, "Standings");
    for (const list of ["league", "east", "west"]) {
      await page.locator(`#standings-${list}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#standings-${list} tbody tr`).first()).toBeInViewport();
      expect(await listTapsOffButtons(page)).toEqual([]);
    }

    await page.locator('#standings-west tr[data-team="LVA"] .team-open').click();
    await expect(page.locator("#teamSheet .team-game")).toHaveCount(3);
    expect(await listTapsOffButtons(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#teamSheet")).toBeHidden();

    await keepHighlights(page, app, "Game details: Aces at Fever, First Round Game 2");
    const gameSheet = await openGameSheet(page, "Game details: Aces at Fever, First Round Game 2");
    await expect(gameSheet.locator(".line-score")).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);
    await gameSheet.getByRole("tab", { name: "Highlights" }).click();
    await expect(gameSheet.locator("#highlightsBody .clip-row").first()).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(gameSheet).toBeHidden();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#settingsDialog")).toBeVisible();
    expect(await listTapsOffButtons(page)).toEqual([]);
  });
});

test("the page shows the tab it was last on before its modules have loaded", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await page.route(matchPath("/js/app.js"), (route) => route.abort());

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Games" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-games")).toBeVisible();
  await expect(page.locator("#view-bracket-standings")).toHaveCSS("display", "none");
});

test("on a wide screen, the tabs are one segmented control, each as tall as a pill's names in a track of the divider's color faded into the floor just around them, the open one filled orange and the rest in ink, and neither a theme nor a tap moves them", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await expectFirstDrawing(page);
  const track = page.locator("nav.tabs");
  const tabs = track.getByRole("tab");
  const readBoxes = () =>
    tabs.evaluateAll((each) =>
      each.map((tab) => {
        const box = tab.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height];
      }),
    );
  // A face that arrives between the readings would widen only the later one.
  await page.evaluate(() => document.fonts.ready);
  const mapleBoxes = await readBoxes();
  const pillHeight = /** @type {{ height: number }} */ (
    await page.locator("#bracketStandingsPill .pager-tabs button").first().boundingBox()
  ).height;
  expect(mapleBoxes.map(([, , , height]) => height)).toEqual(mapleBoxes.map(() => pillHeight));
  expect(/** @type {{ height: number }} */ (await track.boundingBox()).height).toBe(pillHeight + 4);

  const games = page.getByRole("tab", { name: "Games" });
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect(track).toHaveCSS(
      "background-color",
      await readColor(page, "color-mix(in oklab, var(--divider) 45%, var(--bg))"),
    );
    const chosen = page.locator("nav.tabs [role=tab][aria-selected=true]");
    await expect(chosen).toHaveCSS("background-color", await readTokenColor(page, "--orange"));
    await expect(chosen).toHaveCSS("color", await readTokenColor(page, "--orange-ink"));
    const others = page.locator("nav.tabs [role=tab][aria-selected=false]");
    for (const other of await others.all()) {
      await expect(other).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(other).toHaveCSS("color", await readTokenColor(page, "--ink"));
    }
    expect(await readBoxes()).toEqual(mapleBoxes);
  }
  await games.click();
  await expect(games).toHaveAttribute("aria-selected", "true");
  expect(await readBoxes()).toEqual(mapleBoxes);
  for (const tab of await tabs.all()) {
    const box = /** @type {{ y: number, height: number }} */ (await tab.boundingBox());
    expect((await readCapitals(tab)).middle - (box.y + box.height / 2)).toBeCloseTo(0, 0);
  }
});
