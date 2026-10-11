import {
  test,
  expect,
  expectDayAtTop,
  keepHighlights,
  openApp,
  openGameSheet,
  matchPath,
} from "./harness.mjs";
import { listFontsNotPreloaded } from "../../../../tests/browser/font-loads.mjs";
import {
  listTapFlashes,
  listTapsOffButtons,
  listTouchHoverRules,
} from "../../../../tests/browser/tap-states.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText, measureFieldFace } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import {
  listFillFades,
  noteNameFades,
  readFilledNames,
} from "../../../../tests/browser/pill-names.mjs";
import { drag, swipeScrollerTo } from "../../../../tests/browser/touch.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The least room between one standings row's team name and the next row's.
const STANDINGS_NAME_GAP_PX = 20;
// The least room between a standings group's name, like Playoffs, and its columns' names under it.
const STANDINGS_HEADING_GAP_PX = 6;

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
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tr.playoff-line + tr")).toContainText("Fire");
  await expect(page.locator("nav.tabs").getByRole("tab")).toHaveText([
    "Bracket",
    "Games",
    "Standings",
    "News",
  ]);
});

test("every font the page's views draw with is preloaded", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tr").nth(2)).toBeVisible();

  expect(await listFontsNotPreloaded(page)).toEqual([]);
});

test("a losing score is dimmed, without the winner's glow", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  const loser = page.locator("#seasonGames .scoreboard.lost");
  const winner = page.locator("#seasonGames .scoreboard:not(.lost)");
  await expect(loser.locator("path.on").first()).toHaveCSS("opacity", "0.72");
  await expect(loser.locator("svg").first()).toHaveCSS("filter", "none");
  await expect(winner.locator("path.on").first()).toHaveCSS("opacity", "1");
  await expect(winner.locator("svg").first()).not.toHaveCSS("filter", "none");
});

test("a score's glow is on its digits' svgs, since Safari draws no filter on an svg's shapes", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard path.on").first()).toBeVisible();
  const shapeFilters = await page
    .locator(".scoreboard path")
    .evaluateAll((shapes) => [...new Set(shapes.map((shape) => getComputedStyle(shape).filter))]);
  expect(shapeFilters).toEqual(["none"]);
});

test("every piece of text keeps to the type scale, in every view", async ({ page }) => {
  await openApp(page);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tr").nth(2)).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();
  await expect(page.locator("#teamSheet table.players")).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#teamSheet")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a score the Worker saves shows up without a reload", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    Object.assign(game.away, { score: 30 });
    Object.assign(game.home, { score: 27, isInBonus: true });
    return season;
  });
  const row = page.locator('[data-game="1042600132"]');
  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  await expect(row.locator(".game-headline .score")).toHaveText(/30\s*27/);
  await expect(row.locator(".game-extra.home .bonus")).toHaveText("Bonus");
  await expect(row.locator(".game-extra.away")).toBeEmpty();
  await expect(page.locator("#stamp > span").first()).toHaveText(
    /^NOW\s*Dream @ Mystics 30-27 with 5:10 in Q2$/,
  );
  await expect(page.locator("#stamp b.now")).toHaveCSS("font-size", "13px");
  await expect(page.locator("#stamp")).toHaveCSS("font-size", "14px");
});

test.describe("on a phone, the standings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swipe sideways from the league to a conference, and the pill follows", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const pages = page.locator("#standings-pages");
    await expect(page.locator("#standings-league")).toContainText("Lynx");

    await swipeScrollerTo(pages, 1);

    await expect(page.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#standings-east")).toBeInViewport();
    const box = await pages.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  });

  test("come back from another tab held for where the page is now, not where it was when they left", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standings-league")).toContainText("Lynx");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    const bar = page.locator("#standings-bar");
    await expect(bar).toHaveClass(/stuck/);
    await expect(page.locator("#standings-east")).not.toHaveCSS("transform", "none");

    await page.getByRole("tab", { name: "Bracket" }).click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("tab", { name: "Standings" }).click();

    await expect(bar).not.toHaveClass(/stuck/);
    await expect(bar).toHaveCSS("background-image", "none");
    await expect(page.locator("#standings-east")).toHaveCSS("transform", "none");
  });
});

test("the standings leave room between each team's name and the next one's", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const names = page.locator("#standings-league tbody td.team");
  await expect(names.first()).toBeVisible();
  const gaps = await names.evaluateAll((cells) =>
    cells.slice(1, 4).map((cell, index) => {
      const above = cells[index].querySelector(".team-name") ?? cells[index];
      const below = cell.querySelector(".team-name") ?? cell;
      return below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
    }),
  );
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(STANDINGS_NAME_GAP_PX);
});

test("the standings leave room between each group's name and its columns' names", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const heads = page.locator("#standings-league thead");
  await expect(heads.locator("tr.groups th.recent-start")).toHaveText("Playoffs");
  await expect(heads.locator("th.recent-start").last()).toHaveText("Rd 1");
  const gap = await heads.evaluate((head) => {
    const measureText = (cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getBoundingClientRect();
    };
    const [group, column] = [...head.querySelectorAll("th.recent-start")].map(measureText);
    return column.top - group.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(STANDINGS_HEADING_GAP_PX);
});

test("a standings conference tag's letter is trimmed to its capital, with even room around it", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const tag = page.locator("#standings-league .conference-tag").first();
  await expect(tag).toHaveText(/^[EW]$/);
  const room = await tag.evaluate((element) => {
    const style = getComputedStyle(element);
    const content =
      element.getBoundingClientRect().height -
      ["borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom"]
        .map((side) => parseFloat(style[side]))
        .reduce((sum, value) => sum + value);
    return {
      content,
      fontSize: parseFloat(style.fontSize),
      above: style.paddingTop,
      below: style.paddingBottom,
    };
  });
  expect(room.content).toBeLessThan(room.fontSize * 0.8);
  expect(room.above).toBe(room.below);
});

test("a team stays put as Bonus comes and goes, level with the score", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  const findCenter = async (locator) => {
    const box = await locator.boundingBox();
    return box.y + box.height / 2;
  };
  const readTeamCenters = () =>
    Promise.all(
      [".game-side.away", ".game-side.home"].map((side) => findCenter(row.locator(side))),
    );
  const goLive = (isInBonus) =>
    app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27, isInBonus });
      return season;
    });

  const before = await readTeamCenters();
  await goLive(true);
  await expect(row.locator(".bonus")).toHaveText("Bonus");
  expect(await readTeamCenters()).toEqual(before);
  await goLive(false);
  await expect(row.locator(".bonus")).toHaveCount(0);
  expect(await readTeamCenters()).toEqual(before);
  expect(Math.abs(before[0] - (await findCenter(row.locator(".score"))))).toBeLessThan(1);
});

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const MAPLE = "rgb(234, 213, 178)";
const WALNUT = "rgb(29, 21, 17)";

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectTheme(page, theme) {
  const isDark = theme === "dark";
  await expect.poll(() => readBackground(page)).toBe(isDark ? WALNUT : MAPLE);
  await expect(page.locator("#homeScreenIcon")).toHaveAttribute(
    "href",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator("#tabIcon")).toHaveAttribute(
    "href",
    isDark ? "icon.svg" : "icon-light.svg",
  );
  await expect(page.locator("#themeColor")).toHaveAttribute(
    "content",
    isDark ? "#1d1511" : "#ead5b2",
  );
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
async function chooseAppearance(page, choice) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: choice })
    .check();
  await page.keyboard.press("Escape");
}

test("the Season picker sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the text at --size-glance", async ({
  page,
}) => {
  await openApp(page);
  const picker = page.locator("#seasonPicker");
  await expect(picker).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(picker, "--size-glance");
  expect(widths.field).toBeCloseTo(widths.step, 0);
});

test("settings list Notifications, the News switches, and Appearance, with lines only between the three", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registration = { pushManager: { getSubscription: async () => null } };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => registration, addEventListener() {} },
    });
    Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const rows = page.locator("#settingsDialog .settings-controls .control-row");
  await expect(rows.locator(".control-label > span:first-child")).toHaveText([
    "Notifications",
    "Include dedicated Liberty sources",
    "Include content from The Athletic",
    "Appearance",
  ]);
  await expect(page.locator("#notifyNote")).toHaveText("Post-season game final scores");
  const groups = page.locator("#settingsDialog .settings-controls > *");
  const readBorders = () =>
    Promise.all([
      groups.evaluateAll((each) => each.map((group) => getComputedStyle(group).borderTopStyle)),
      rows.evaluateAll((each) => each.map((row) => getComputedStyle(row).borderTopStyle)),
      page
        .locator("#settingsDialog .settings-controls")
        .evaluate((controls) => getComputedStyle(controls).borderBottomStyle),
    ]);
  // The Season row stays hidden while the store keeps only the current season.
  expect(await readBorders()).toEqual([
    ["none", "none", "solid", "solid"],
    ["none", "none", "none", "none", "solid"],
    "none",
  ]);

  await page.locator("#notifyRow").evaluate((row) => row.setAttribute("hidden", ""));
  expect((await readBorders())[0]).toEqual(["none", "none", "none", "solid"]);
});

test("on System, the page and its icons follow the phone's dark or light setting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator('input[name="appearance"][value="auto"]')).toBeChecked();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
});

test("choosing Walnut or Maple overrides the phone, and the choice stays after a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await chooseAppearance(page, "Walnut");
  await expectTheme(page, "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await chooseAppearance(page, "Maple");
  await expectTheme(page, "light");
  await chooseAppearance(page, "System");
  await expectTheme(page, "dark");
});

test("a look this device kept by its plain name on an earlier visit still shows", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("appearance", "dark"));
  await openApp(page);

  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Walnut" })).toBeChecked();
});

test("a look chosen in another tab shows in this one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await expectTheme(page, "light");

  await keepInOtherTab(page, "appearance", "dark");

  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Walnut" })).toBeChecked();
});

test("changing the appearance says how to match the home-screen icon", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const note = page.locator("#appearanceNote");
  await expect(note).toBeHidden();
  await page.getByRole("radio", { name: "Walnut" }).check();
  await expect(note).toBeVisible();
  await expect(note).toHaveText(/Apple sets a home-screen icon only when the page is added/);
});

test("settings end with the release, NBA.com's credit for the data, and the copyright", async ({
  page,
}) => {
  await serveReleases(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const footer = page.locator("#settingsDialog .settings-footer");
  await expect(footer.locator(".settings-version")).toHaveText([
    /^v\d/,
    "Includes data from NBA.com",
    "\u00a9 2026 Noah Kaplan",
  ]);
  await expect(page.locator("#settingsDialog .sheet-top")).not.toContainText("NBA.com");
});

/**
 * Opens settings with the release named at their foot, and waits for the sheet to settle.
 * @param {import("@playwright/test").Page} page
 */
async function openSettingsWithRelease(page) {
  await serveReleases(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#versionNote")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/** @param {import("@playwright/test").Page} page */
const readSettingsBoxes = (page) =>
  page.locator("#settingsDialog").evaluate((dialog) => {
    const readBox = (selector) => dialog.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sheet: dialog.getBoundingClientRect().toJSON(),
      body: readBox(".settings-body"),
      top: readBox(".sheet-top"),
      head: readBox(".sheet-head"),
      title: readBox("h2"),
      close: readBox(".sheet-close"),
      controls: readBox(".settings-controls"),
      footer: readBox(".settings-footer"),
    };
  });

test.describe("on a phone, settings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("rise from the bottom to fill the screen, like every sheet", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openSettingsWithRelease(page);
    const { sheet } = await readSettingsBoxes(page);
    expect([sheet.top, sheet.height]).toEqual([0, 844]);
  });

  test("set their title level with their close button and 32px over the first setting, and end 17px over the bottom", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { sheet, top, head, title, close, controls, footer } = await readSettingsBoxes(page);
    const findMiddle = (box) => box.top + box.height / 2;
    expect(Math.abs(findMiddle(title) - findMiddle(close))).toBeLessThan(1);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
    expect(Math.round(controls.top - title.bottom)).toBe(32);
    expect(Math.round(sheet.bottom - footer.bottom)).toBe(17);
  });
});

test.describe("on a wide screen, settings", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("open nearly the screen's height, like every sheet, in the middle of the screen", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { sheet } = await readSettingsBoxes(page);
    expect(Math.round(sheet.height)).toBe(900 - 48);
    expect(Math.abs(sheet.top + sheet.height / 2 - 450)).toBeLessThan(1);
  });

  test("set their title level with their close button, inside the header", async ({ page }) => {
    await openSettingsWithRelease(page);
    const { top, head, title, close } = await readSettingsBoxes(page);
    const findMiddle = (box) => box.top + box.height / 2;
    expect(Math.abs(findMiddle(title) - findMiddle(close))).toBeLessThan(1);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
  });
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

test("the Games lists' days, series labels, and statuses are in Barlow, apart from the team names", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const readFirstFont = (locator) =>
    locator
      .first()
      .evaluate((element) =>
        getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
      );
  expect(await readFirstFont(page.locator("#seasonGames .day-month"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#seasonGames .day-name"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#seasonGames .series-label"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#seasonGames .game-status"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#seasonGames .game-side .club"))).toBe(
    "Barlow Condensed",
  );
});

test("a Games list's day reads its month, date, and weekday at their sizes, weights, and spacing, 3px and then 4.5px apart", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const day = page.locator("#seasonGames .game-day.is-today .day-label");
  await expect(day).toBeVisible();
  const parts = await day.evaluate((label) =>
    [".day-month", ".day-number", ".day-name"].map((selector) => {
      const part = /** @type {Element} */ (label.querySelector(selector));
      const { top, bottom } = part.getBoundingClientRect();
      const { fontSize, fontWeight, letterSpacing } = getComputedStyle(part);
      return { top, bottom, fontSize, fontWeight, letterSpacing };
    }),
  );
  const [month, date, weekday] = parts;
  expect(
    parts.map(({ fontSize, fontWeight, letterSpacing }) => [fontSize, fontWeight, letterSpacing]),
  ).toEqual([
    ["13px", "600", "0.91px"],
    ["24px", "600", "normal"],
    ["13px", "600", "0.78px"],
  ]);
  expect(date.top - month.bottom).toBeCloseTo(3, 1);
  expect(weekday.top - date.bottom).toBeCloseTo(4.5, 1);
});

test("a game's dots, names, and time center on their capitals, level with each other, the seed on the right half a pixel lower", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page
    .locator("#seasonGames .game-row")
    .filter({ has: page.locator(".time") })
    .first();
  await expect(row).toBeVisible();
  const pieces = await row.evaluate((element) =>
    Object.fromEntries(
      [
        ".game-side.away .dot",
        ".game-side.away .seed",
        ".game-side.away .team-name",
        ".game-side.home .seed",
        ".game-side.home .team-name",
        ".time",
      ].map((selector) => {
        const piece = /** @type {Element} */ (element.querySelector(selector));
        const { top, height } = piece.getBoundingClientRect();
        const fontSize = parseFloat(getComputedStyle(piece).fontSize);
        return [selector, { middle: top + height / 2, height, fontSize }];
      }),
    ),
  );
  const { ".game-side.away .dot": dot, ...letters } = pieces;
  for (const [selector, { middle, height, fontSize }] of Object.entries(letters)) {
    const nudge = selector === ".game-side.home .seed" ? 0.5 : 0;
    expect(height, selector).toBeLessThan(fontSize * 0.8);
    expect(middle - dot.middle, selector).toBeCloseTo(nudge, 1);
  }
});

test("a game that may never happen says If needed in a status's dim ink, a weight lighter than Final", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const ifNeeded = page.locator("#seasonGames .if-needed").first();
  await expect(ifNeeded).toHaveText("If needed");
  const final = page.locator("#seasonGames .game-status", { hasText: "Final" }).first();
  const readStyle = (/** @type {import("@playwright/test").Locator} */ locator) =>
    locator.evaluate((element) => {
      const { color, fontWeight } = getComputedStyle(element);
      return { color, weight: Number(fontWeight) };
    });

  const [ifNeededStyle, finalStyle] = [await readStyle(ifNeeded), await readStyle(final)];
  expect(ifNeededStyle.color).toBe(finalStyle.color);
  expect(ifNeededStyle.weight).toBeLessThan(finalStyle.weight);
});

const TODAYS_GAMES = ["1042600132", "1042600112"];
/** @param {any[]} games */
const leaveOutToday = (games) =>
  games.filter((/** @type {any} */ game) => !TODAYS_GAMES.includes(game.id));

/**
 * Leaves today's games out of the season and its list of every game, as on a day without games.
 * @param {Awaited<ReturnType<typeof openApp>>} app
 */
async function dropTodaysGames(app) {
  await app.changeDocument("schedules/2026", (schedule) => ({
    ...schedule,
    games: leaveOutToday(schedule.games),
  }));
  await app.changeSeason((season) => ({
    ...season,
    games: leaveOutToday(season.games),
    nearestGames: leaveOutToday(season.nearestGames),
  }));
}

test("on a day without games, the Games list has a day saying so at today's place, and opens on it", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await dropTodaysGames(app);
  const today = page.locator('#seasonGames .listed-day[data-day="2026-09-30"]');
  await expect(today.locator(".empty-note")).toHaveText("No games today");
  await expect(today.locator(".day-number")).toHaveText("30");
  await expect(page.locator("#seasonGames .no-games")).toHaveCount(1);
  const days = await page
    .locator("#seasonGames .listed-day")
    .evaluateAll((listed) => listed.map((day) => day.getAttribute("data-day")));
  expect(days.indexOf("2026-09-30")).toBe(days.indexOf("2026-09-29") + 1);
  await expect(page.locator('#seasonGames .day-cell[data-day="2026-09-30"]')).toBeEnabled();

  await page.reload();
  await expect(today).toBeInViewport();
  await expectDayAtTop(page, "2026-09-30");
});

test("No games today is 15.5px, centered beside today's date, its capitals a touch above the middle of the date's number", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await dropTodaysGames(app);
  const note = page.locator("#seasonGames .no-games .empty-note");
  await expect(note).toHaveText("No games today");
  await expect(note).toHaveCSS("font-size", "15.5px");
  // A zero-height box set inline after a text has its top on the text's baseline, and the
  // capitals' middle sits half a capital above it. Chromium's builds set a baseline up to a pixel
  // apart, so the note's lead over the number is checked loosely.
  const readCapitalsMiddle = (selector) =>
    page.evaluate((target) => {
      const text = /** @type {HTMLElement} */ (document.querySelector(target));
      const style = getComputedStyle(text);
      const context = document.createElement("canvas").getContext("2d");
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const capitalHeight = context.measureText("H").actualBoundingBoxAscent;
      const probe = document.createElement("span");
      probe.style.cssText = "display: inline-block; width: 0; height: 0";
      text.append(probe);
      const baseline = probe.getBoundingClientRect().top;
      probe.remove();
      return baseline - capitalHeight / 2;
    }, selector);

  const noteMiddle = await readCapitalsMiddle("#seasonGames .no-games .empty-note");
  const numberMiddle = await readCapitalsMiddle("#seasonGames .no-games .day-number");
  expect(numberMiddle - noteMiddle).toBeGreaterThan(2.4);
  expect(numberMiddle - noteMiddle).toBeLessThan(5);
  const [textMiddle, columnMiddle] = await note.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const column = element.getBoundingClientRect();
    return [text.left + text.width / 2, column.left + column.width / 2];
  });
  expect(Math.abs(textMiddle - columnMiddle)).toBeLessThanOrEqual(1);
});

test("a game's series label is on the type scale's small step, and it and If needed read lighter than Final", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").isIfNeeded = true;
    return season;
  });
  const ifNeeded = page.locator('[data-game="1042600132"] .game-status');
  await expect(ifNeeded).toHaveText("If needed");
  await expect(ifNeeded.locator(".if-needed")).toHaveCSS("font-weight", "500");
  const final = page.locator("#seasonGames .game-status", { hasText: "Final" }).first();
  await expect(final).toHaveCSS("font-weight", "600");
  await expect(page.locator("#seasonGames .series-label").first()).toHaveCSS("font-weight", "500");
  await expect(page.locator("#seasonGames .series-label").first()).toHaveCSS("font-size", "13px");
});

test("a break between periods reads in the status's capitals, in the live game's orange", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Half", period: 2, clock: "0.0" });
    Object.assign(game.away, { score: 48 });
    Object.assign(game.home, { score: 54 });
    return season;
  });
  const word = page.locator('[data-game="1042600132"] .game-status .break');
  await expect(word).toHaveText("Half");
  const style = await word.evaluate((element) => {
    const orange = document.createElement("span");
    orange.style.color = "var(--orange)";
    document.body.append(orange);
    const { fontFamily, textTransform, color } = getComputedStyle(element);
    const style = {
      font: fontFamily.split(",")[0].replaceAll('"', ""),
      textTransform,
      isOrange: color === getComputedStyle(orange).color,
    };
    orange.remove();
    return style;
  });
  expect(style).toEqual({ font: "Barlow", textTransform: "uppercase", isOrange: true });
});

test("every score panel is one size, a game past 100 like any other", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
  const sizes = await page.locator("#seasonGames .scoreboard").evaluateAll((panels) =>
    panels.map((panel) => {
      const box = panel.getBoundingClientRect();
      return `${Math.round(box.width * 10) / 10}x${Math.round(box.height * 10) / 10}`;
    }),
  );
  expect(sizes.length).toBeGreaterThan(4);
  expect(new Set(sizes).size).toBe(1);
  const texts = await page.locator("#seasonGames .scoreboard-text").allTextContents();
  expect(texts.some((text) => Number(text) >= 100)).toBe(true);
});

test("a seed sits a little lighter than its team's name, centered on its row like the name", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const club = page.locator("#seasonGames .game-side .club").first();
  const { nameWeight, seedWeight, offset } = await club.evaluate((element) => {
    const seed = /** @type {Element} */ (element.querySelector(".seed"));
    const name = /** @type {Element} */ (element.querySelector(".team-name"));
    const middle = (box) => box.top + box.height / 2;
    return {
      nameWeight: getComputedStyle(name).fontWeight,
      seedWeight: getComputedStyle(seed).fontWeight,
      offset: middle(seed.getBoundingClientRect()) - middle(element.getBoundingClientRect()),
    };
  });
  expect([seedWeight, nameWeight]).toEqual(["400", "600"]);
  expect(offset).toBeCloseTo(0, 1);
  const isLoaded = await page.evaluate(() => document.fonts.check('400 12px "Barlow Condensed"'));
  expect(isLoaded).toBe(true);
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

test("the title and the round names are in Barlow Condensed, and each card's note in Barlow's italic", async ({
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
  for (const selector of ["header.top h1", ".round-name"])
    expect(await readFirstFont(selector)).toBe("Barlow Condensed");
  expect(await readFirstFont(".card-note")).toBe("Barlow");
  await expect(page.locator(".card-note").first()).toHaveCSS("font-style", "italic");
  await expect(page.locator(".card-note").first()).toHaveCSS("font-size", "14px");
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
  await page.getByRole("tab", { name: "Standings" }).click();
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

test("hovering the settings button shades a square with a button's corners around its icon", async ({
  page,
}) => {
  await openApp(page);
  const button = page.locator("#settingsBtn");
  await button.hover();
  // The square sits inside the button's 4px of padding, which trims its corners to a button's 3px.
  await expect(button).toHaveCSS("border-radius", "7px");
  await expect(button).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test.describe("on a phone, the text", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("keeps to the type scale in the header, the Updates box, the games, the standings, a team's sheet, and settings", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    await expect(page.locator("#updates .what").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);

    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#seasonGames .game-day.is-today .game-row").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
    await expect(page.locator("#seasonGames .scoreboard").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);

    await page.getByRole("tab", { name: "Standings" }).click();
    const standings = page.locator("#standings-league");
    await expect(standings.locator("tbody tr").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);

    await standings.locator('tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator(".team-game")).toHaveCount(3);
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#settingsDialog")).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
  });

  test("of the Updates box reads at 16px with its team names at Condensed's 16.5px, its days at 14px, and its count at 13px, and a series' standing stays on one line", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");
    await expect(updates.locator(".what").first()).toBeVisible();
    await expect(updates.locator(".what").first()).toHaveCSS("font-size", "16px");
    await expect(updates.locator(".what b").first()).toHaveCSS("font-size", "16.5px");
    await expect(updates.locator(".when").first()).toHaveCSS("font-size", "14px");
    await expect(updates.locator(".updates-count")).toHaveCSS("font-size", "13px");
    const lineCounts = await updates
      .locator(".series-score")
      .evaluateAll((scores) => scores.map((score) => score.getClientRects().length));
    expect(lineCounts.length).toBeGreaterThan(0);
    expect(lineCounts.every((count) => count === 1)).toBe(true);
  });
});

test.describe("on a phone, a team's sheet", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("sets its name like every team's at 20px, its numbers in Barlow Condensed like a game preview's, its text in medium but None yet a step lighter, and its title on the sheet's own color with no line under it, like a game's, with the titles of its nearest games 11.5px under it and its first part 16px under their cards", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("table.players")).toBeVisible();

    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-weight", "600");
    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-size", "20px");
    await expect(sheet.locator("#teamNote")).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".tape-value").first()).toHaveCSS(
      "font-family",
      /^"Barlow Condensed"/,
    );
    await expect(sheet.locator(".team-titles")).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".team-titles")).toHaveText("None yet");
    await expect(sheet.locator(".team-titles-none")).toHaveCSS("font-weight", "400");
    await expect(sheet.locator(".team-game").first()).toHaveCSS("font-weight", "500");

    const colors = await sheet.evaluate((dialog) => {
      const readColor = (selector) => getComputedStyle(dialog.querySelector(selector)).color;
      return {
        title: readColor("#teamTitle"),
        titles: readColor(".team-titles"),
      };
    });
    expect(colors.titles).toBe(colors.title);

    const backgrounds = await page.evaluate(() =>
      ["#teamSheet .sheet-top", "#gameSheet .sheet-top", "#teamSheet"].map(
        (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor,
      ),
    );
    const [teamTop, gameTop, sheetColor] = backgrounds;
    const floor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(teamTop).toBe(gameTop);
    expect(teamTop).toBe(floor);
    expect(sheetColor).not.toBe(floor);
    const top = await sheet.locator(".sheet-top").boundingBox();
    const cardTitle = await sheet.locator(".game-card .sheet-part-head").first().boundingBox();
    const cards = await sheet.locator(".game-cards").boundingBox();
    const firstPart = await sheet
      .locator(".team-sheet-body > .sheet-part .sheet-part-head")
      .first()
      .boundingBox();
    expect(cardTitle.y - (top.y + top.height)).toBeCloseTo(11.5, 0);
    expect(firstPart.y - (cards.y + cards.height)).toBeCloseTo(16, 0);
    await expect(sheet.locator(".sheet-top")).toHaveCSS("border-bottom-width", "0px");
    await expect(sheet.locator(".sheet-top")).not.toHaveCSS("box-shadow", "none");
  });
});

test.describe("a team's sheet in each theme", () => {
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    test(`sets the button for the rest of a long list of titles in the orange of a tap, not the teal of its part's title, in ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await openApp(page);
      await page.getByRole("tab", { name: "Standings" }).click();
      await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
      const titles = page.locator("#teamSheet .team-titles");
      await expect(titles).toHaveText("None yet");

      // No team has won enough titles yet to show the button, so it stands in one like the sheet's.
      const colors = await titles.evaluate((line) => {
        const button = document.createElement("button");
        button.className = "team-titles-more";
        button.textContent = "and 4 more";
        line.append(button);
        const part = /** @type {HTMLElement} */ (line.closest(".sheet-part"));
        const readColor = (element) => getComputedStyle(element).color;
        const accent = document.createElement("span");
        accent.style.color = "var(--accent)";
        part.append(accent);
        return {
          button: readColor(button),
          head: readColor(/** @type {HTMLElement} */ (part.querySelector("h3"))),
          accent: readColor(accent),
        };
      });
      expect(colors.button).toBe(colors.accent);
      expect(colors.button).not.toBe(colors.head);
    });
  }
});

test.describe("a team's sheet", () => {
  test("a team in the standings opens its sheet, which follows the season as it changes, and its close button closes it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="LVA"] .team-open').click();
    const sheet = page.locator("#teamSheet");

    await expect(sheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expect(sheet.locator("#teamNote")).toHaveText("West\u20223 seed\u202231-13");
    await expect(sheet).toContainText("Leading scorers");
    await app.changeSeason((season) => {
      season.standings.find((row) => row.team === "LVA").lastTen = "9-1";
      return season;
    });
    await expect(sheet.locator(".team-form")).toContainText(/Last 10\s*9-1/);

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a team's sheet names the sides over its numbers at 16px, and sets Last 10 and Streak like its measures", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("table.players")).toBeVisible();

    const styles = await sheet.evaluate((dialog) => {
      const read = (selector) => {
        const style = getComputedStyle(dialog.querySelector(selector));
        return {
          color: style.color,
          font: `${style.fontFamily} ${style.fontSize} ${style.fontWeight} ${style.letterSpacing} ${style.textTransform}`,
        };
      };
      return {
        measure: read(".team-ranks .player-rank-label"),
        formName: read(".team-form dt"),
        number: read(".team-ranks .player-rank-value"),
        formNumber: read(".team-form dd"),
      };
    });
    expect(styles.formName).toEqual(styles.measure);
    expect(styles.formNumber).toEqual(styles.number);
    await expect(sheet.locator(".team-numbers .tape-teams .club").first()).toHaveCSS(
      "font-size",
      "16px",
    );
  });

  test("a team's next game is marked with a 14px caret, orange on the day it's played like its time", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
    const next = page.locator("#teamSheet .team-game.next");
    const icon = next.locator(".next-game-icon");

    await expect(icon).toHaveCSS("width", "14px");
    await expect(icon).toHaveCSS("height", "14px");
    const when = await next
      .locator(".team-when")
      .evaluate((element) => getComputedStyle(element).color);
    await expect(icon).toHaveCSS("color", when);
  });

  test("a team's playoff games sit 25px apart, a final's score or not, with the team and field names 13px under them and 10px over their first measure", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    const rows = await sheet
      .locator(".team-game")
      .evaluateAll((games) => games.map((game) => game.getBoundingClientRect().toJSON()));
    const names = await sheet.locator(".team-playoffs + .team-numbers .tape-teams").boundingBox();
    const firstMeasure = await sheet
      .locator(".team-playoffs + .team-numbers .player-rank-row")
      .first()
      .boundingBox();

    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row, index) => Math.round(row.top - rows[index].top))).toEqual([
      25, 25,
    ]);
    expect(Math.round(names.y - rows[2].bottom)).toBe(13);
    expect(Math.round(firstMeasure.y - (names.y + names.height))).toBe(10);
  });

  test("a team's record sits 5px after its name over its numbers, 1px below the middle of the name, in the dim small type of the game sheet's records", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const club = page.locator("#teamSheet .team-numbers .tape-teams .club").first();
    const record = club.locator(".team-record");
    await expect(record).toHaveText("2-0");

    const [nameBox, recordBox] = await club.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(/** @type {Node} */ (element.firstChild));
      return [
        range.getBoundingClientRect().toJSON(),
        element.lastElementChild?.getBoundingClientRect().toJSON(),
      ];
    });
    expect(Math.round(recordBox.left - nameBox.right)).toBe(5);
    expect(
      Math.round(recordBox.top + recordBox.height / 2 - (nameBox.top + nameBox.height / 2)),
    ).toBe(1);
    await expect(record).toHaveCSS("font-size", "14px");
    await expect(record).toHaveCSS("font-weight", "500");
  });

  test("Last 10 sits 20px under the regular season's ranks, and Streak 14px under Last 10", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    const numbers = await sheet.locator(".team-ranks").last().boundingBox();
    const form = await sheet.locator(".team-form").boundingBox();
    const [lastTen, streak] = await sheet
      .locator(".team-form dd")
      .evaluateAll((values) => values.map((value) => value.getBoundingClientRect().toJSON()));

    expect(Math.round(form.y - (numbers.y + numbers.height))).toBe(20);
    expect(Math.round(streak.top - lastTen.bottom)).toBe(14);
  });

  test("a team's playoff lines and regular-season curves start and end together, 7.5px past their column, with every dot 7.5px, one at a line's end half a pixel past it, and the field's numbers 33px into theirs", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator(".team-ranks .player-curve svg").first()).toBeVisible();

    const layout = await sheet.evaluate((dialog) => {
      const edges = (selector) =>
        [...dialog.querySelectorAll(selector)].map((element) => {
          const box = element.getBoundingClientRect();
          const next = /** @type {Element} */ (element.nextElementSibling).getBoundingClientRect();
          return { left: box.left, right: box.right, pastColumn: box.right - (next.left - 10) };
        });
      const others = [...dialog.querySelectorAll(".placed-other")].map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().left - element.getBoundingClientRect().left;
      });
      const dots = [...dialog.querySelectorAll(".placed-line i")].map((dot) => {
        const box = dot.getBoundingClientRect();
        return [box.width, box.height];
      });
      const lineEnd = dialog.querySelector(".placed-line").getBoundingClientRect().right;
      const endDots = [...dialog.querySelectorAll('.placed-line i[style="left: 100%"]')].map(
        (dot) => dot.getBoundingClientRect().right - lineEnd,
      );
      return {
        lines: edges(".placed-line"),
        curves: edges(".team-ranks .player-curve"),
        others,
        dots,
        endDots,
      };
    });
    const ends = [...layout.lines, ...layout.curves];
    expect(ends).toHaveLength(10);
    expect(new Set(ends.map((end) => end.left.toFixed(1))).size).toBe(1);
    expect(new Set(ends.map((end) => end.right.toFixed(1))).size).toBe(1);
    for (const end of ends) expect(end.pastColumn).toBeCloseTo(7.5, 1);
    for (const inset of layout.others) expect(inset).toBeCloseTo(33, 1);
    for (const dot of layout.dots) expect(dot).toEqual([7.5, 7.5]);
    expect(layout.endDots).toHaveLength(4);
    for (const past of layout.endDots) expect(past).toBeCloseTo(0.5, 1);
  });

  test("a team's sheet is titled with its name, set like every other team's", async ({ page }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const title = page.locator("#teamSheet #teamTitle");

    await expect(title).toHaveText("New York Liberty");
    await expect(title).toHaveCSS("font-family", /^"Barlow Condensed"/);
    await expect(title).toHaveCSS("font-weight", "600");
    await expect(title).toHaveCSS("text-transform", "none");
    await expect(title).toHaveCSS("font-size", "20px");
  });

  test("a team's name under the pointer shifts its color a little toward the accent, with no underline", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const name = page
      .locator('#standings-league tr[data-team="LVA"] .team-open')
      .locator(".team-name");
    const readColor = () => name.evaluate((element) => getComputedStyle(element).color);
    const before = await readColor();
    await name.hover();

    await expect.poll(readColor).not.toBe(before);
    await expect(name).toHaveCSS("text-decoration-line", "none");
  });

  test("an opponent's name in a team's sheet opens that team's sheet in its place", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("#teamTitle")).toHaveText("New York Liberty");
    const opponent = sheet.locator(".team-matchup").first().getByRole("button");
    const label = await opponent.getAttribute("aria-label");

    await opponent.click();
    await expect(sheet.locator("#teamTitle")).toHaveText(label.replace("Team details: ", ""));
    await expect(sheet.locator("#teamTitle")).not.toHaveText("New York Liberty");
  });

  test("a team's name in the standings opens its sheet from the keyboard", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const fever = page.locator("#standings-league").getByRole("button", {
      name: "Team details: Indiana Fever",
    });
    await fever.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#teamSheet #teamTitle")).toHaveText("Indiana Fever");
  });

  test("redrawing the standings each minute keeps keyboard focus on the team it was on", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const aces = page.locator("#standings-league").getByRole("button", {
      name: "Team details: Las Vegas Aces",
    });
    await aces.focus();

    await page.clock.runFor(60 * 1000);
    await expect(aces).toBeFocused();
  });
});

test("a team's leading scorers set their shooting and minutes a step back, a smaller step in Walnut", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
  const quiet = page
    .locator("#teamSheet table.players tbody tr:not(.players-head)")
    .first()
    .locator("td.quiet-stat");
  await expect(quiet).toHaveText(["46.2", "32.6"]);
  const minutes = quiet.last();
  await expect(page.locator("#teamSheet table.players .first-name").first()).toHaveCSS(
    "margin-right",
    "1px",
  );
  const readColors = () =>
    minutes.evaluate((cell) => {
      const probe = document.createElement("span");
      cell.closest("dialog")?.append(probe);
      /** @param {string} token */
      const readToken = (token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const colors = {
        minutes: getComputedStyle(cell).color,
        dim: readToken("--ink-dim"),
        mid: readToken("--ink-mid"),
      };
      probe.remove();
      return colors;
    });

  for (const [theme, token] of /** @type {const} */ ([
    ["light", "dim"],
    ["dark", "mid"],
  ])) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const colors = await readColors();
    expect(colors.minutes, theme).toBe(colors[token]);
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("a team's leading scorers keep their names on one line, and its numbers fit their sides", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const sheet = page.locator("#teamSheet");
    for (const code of ["LVA", "LAS", "CON", "CHI"]) {
      await page.locator(`#standings-league tr[data-team="${code}"] .team-open`).click();
      const names = sheet.locator('table.players th[scope="row"]');
      await expect(names).toHaveCount(5);
      const lineCounts = await names.evaluateAll((cells) =>
        cells.map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom))).size;
        }),
      );
      expect(lineCounts, code).toEqual([1, 1, 1, 1, 1]);
      const overflowing = await sheet
        .locator(".tape-side")
        .evaluateAll((sides) =>
          sides
            .filter((side) => side.scrollWidth > side.clientWidth)
            .map((side) => side.textContent),
        );
      expect(overflowing, code).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  });
});

test("redrawing the games each minute keeps keyboard focus on the game it was on", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const game = page.locator('[data-game="1042600132"] .game-open');
  await game.focus();

  await page.clock.runFor(60 * 1000);
  await expect(game).toBeFocused();
});

test("each day's games sit in a box of their own, apart from the next day's", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const [first, second] = await page
    .locator("#seasonGames .game-day")
    .evaluateAll((days) => days.map((day) => day.getBoundingClientRect()));
  expect(second.top - first.bottom).toBe(8);
  const box = await page
    .locator("#seasonGames .game-day .game-list")
    .first()
    .evaluate((list) => getComputedStyle(list).borderTopStyle);
  expect(box).toBe("solid");
});

test("each day's date sits to the left of its games, level with the first", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const day = page.locator("#seasonGames .game-day.is-today");
  const date = await day.locator(".day-label").boundingBox();
  const list = await day.locator(".game-list").boundingBox();
  const firstGame = await day.locator(".game-row").first().boundingBox();
  expect(date.x + date.width).toBeLessThan(list.x);
  expect(
    Math.abs(date.y + date.height / 2 - (firstGame.y + firstGame.height / 2)),
  ).toBeLessThanOrEqual(1);
});

test("a game's series line, score, and status each have room in its row", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  const row = page.locator("#seasonGames .game-row:has(.score)").first();
  const [box, label, score, status] = await Promise.all(
    [
      row,
      ...[".game-label", ".game-headline", ".game-status"].map((part) => row.locator(part)),
    ].map((part) => part.evaluate((element) => element.getBoundingClientRect().toJSON())),
  );
  expect(label.top - box.top).toBeGreaterThanOrEqual(6);
  expect(score.top - label.bottom).toBeGreaterThanOrEqual(5);
  expect(status.top - score.bottom).toBeGreaterThanOrEqual(4);
  expect(box.bottom - status.bottom).toBeGreaterThanOrEqual(4);
  const corners = await row
    .locator(".scoreboard")
    .first()
    .evaluate((panel) => getComputedStyle(panel).borderRadius);
  expect(corners).toBe("2px");
});

const DAY_ROOM_BY_WIDTH = [
  { width: 402, edge: 10, gap: 10, inset: 14 },
  { width: 390, edge: 8, gap: 10, inset: 10 },
];

for (const { width, edge, gap, inset } of DAY_ROOM_BY_WIDTH) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("each day's date has room on both sides, and its card's games room inside it", async ({
      page,
    }) => {
      await openApp(page);
      await page.getByRole("tab", { name: "Games" }).click();
      const day = page.locator("#seasonGames .game-day.is-today");
      const date = await day.locator(".day-label").boundingBox();
      const list = await day.locator(".game-list").boundingBox();
      const firstDot = await day.locator(".game-side.away .dot").first().boundingBox();
      expect(date.x).toBeGreaterThanOrEqual(edge);
      expect(list.x - (date.x + date.width)).toBeGreaterThanOrEqual(gap);
      expect(firstDot.x - list.x).toBeGreaterThanOrEqual(inset);
    });
  });
}

for (const width of [440, 430, 402, 390, 375, 360]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every team's whole name fits in its game row", async ({ page }) => {
      await openApp(page);
      await page.getByRole("tab", { name: "Games" }).click();
      await expect(page.locator("#seasonGames .game-side .team-name").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const cutNames = await page
        .locator("#seasonGames .game-side .team-name")
        .evaluateAll((names) =>
          names
            .filter((name) => name.scrollWidth > name.getBoundingClientRect().width + 0.5)
            .map((name) => name.textContent),
        );
      expect(cutNames).toEqual([]);
    });
  });
}

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
 * The color a page token resolves to.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
const readTokenColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

test("on a wide screen, the tabs that aren't open are darker than the dim text and outlines", async ({
  page,
}) => {
  await openApp(page);
  const [text, outline] = await page
    .getByRole("tab", { name: "Games" })
    .evaluate((button) => [
      getComputedStyle(button).color,
      getComputedStyle(button).borderTopColor,
    ]);
  expect(sumChannels(text)).toBeLessThan(sumChannels(await readTokenColor(page, "--ink-dim")));
  expect(sumChannels(outline)).toBeLessThan(
    sumChannels(await readTokenColor(page, "--card-border")),
  );
});

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

test("on a wide screen, the Games and Standings lists keep to one phone's width, in the middle of the page", async ({
  page,
}) => {
  await openApp(page);
  const pageMiddle = page.viewportSize().width / 2;
  for (const { tab, pill, list } of [
    { tab: "Games", pill: "#seasonGames .day-bar-head", list: "#seasonGames .game-day.is-today" },
    {
      tab: "Standings",
      pill: "#standingsPager .pager-tabs",
      list: "#standings-league table.standings",
    },
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    for (const selector of [pill, list].filter(Boolean)) {
      const box = await page.locator(selector).first().boundingBox();
      expect(Math.abs(box.x + box.width / 2 - pageMiddle), selector).toBeLessThanOrEqual(1);
    }
    const listBox = await page.locator(list).first().boundingBox();
    expect(listBox.width, tab).toBe(560);
  }
});

test("the Standings pill switches between the league and each conference, through the season's updates and back from another tab", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const pill = page.getByRole("tablist", { name: "Standings" });
  const shownFirstTeam = page.locator(".pager-page:not([inert]) tbody tr").first();
  await expect(page.getByRole("table", { name: "League standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Lynx");

  await pill.getByRole("tab", { name: "East" }).click();

  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Dream");
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");

  await app.changeSeason((season) => {
    season.standings.find((row) => row.team === "ATL").wins += 1;
    return season;
  });
  await expect(shownFirstTeam).toContainText("31-14");
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
});

test("the standings' recent form reads a step below the season, in the mid ink", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const lynx = page.locator('#standings-league tr[data-team="MIN"]');
  await expect(lynx).toBeVisible();
  const readType = (cell) =>
    cell.evaluate((element) => {
      const { fontSize, fontWeight, color } = getComputedStyle(element);
      return { size: parseFloat(fontSize), weight: fontWeight, color };
    });
  const season = await readType(lynx.locator("td.season").first());
  const recent = await readType(lynx.locator("td.recent").first());
  const middle = await readTokenColor(page, "--ink-mid");

  expect(recent.size).toBeLessThan(season.size);
  expect(recent.size).toBeGreaterThanOrEqual(12.8);
  expect([recent.weight, recent.color]).toEqual(["500", middle]);
});

test("the playoff line is one dashed strip across the whole table", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = await page.locator("#standings-league table.standings").boundingBox();
  const line = await page.locator("#standings-league tr.playoff-line td").boundingBox();
  expect(line.x).toBeCloseTo(table.x, 0);
  expect(line.width).toBeCloseTo(table.width, 0);
});

test("the standings' teams sit on one raised card inside its edge, with their column names on the page and lines only between rows", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const [raised, edge, divider] = await Promise.all(
    ["--raised", "--edge", "--divider"].map((token) => readTokenColor(page, token)),
  );

  const readCells = (selector) =>
    table.locator(selector).evaluateAll((cells) =>
      cells.map((cell) => {
        const style = getComputedStyle(cell);
        return {
          background: style.backgroundColor,
          top: style.borderTopStyle === "none" ? null : style.borderTopColor,
          bottom: style.borderBottomStyle === "none" ? null : style.borderBottomColor,
          left: style.borderLeftStyle === "none" ? null : style.borderLeftColor,
          right: style.borderRightStyle === "none" ? null : style.borderRightColor,
        };
      }),
    );
  const heads = await readCells("thead th");
  expect(new Set(heads.map((head) => head.background))).toEqual(new Set(["rgba(0, 0, 0, 0)"]));

  const rows = await table.locator("tbody tr[data-team]").count();
  const first = await readCells("tbody tr[data-team]:first-child td");
  const inside = await readCells("tbody tr[data-team]:nth-child(3) td");
  const last = await readCells("tbody tr[data-team]:last-child td");
  for (const cells of [first, inside, last]) {
    expect(new Set(cells.map((cell) => cell.background))).toEqual(new Set([raised]));
    expect([cells[0].left, cells.at(-1).right]).toEqual([edge, edge]);
  }
  expect(new Set(first.map((cell) => cell.top))).toEqual(new Set([edge]));
  expect(new Set(inside.map((cell) => cell.top))).toEqual(new Set([divider]));
  expect(new Set(inside.map((cell) => cell.bottom))).toEqual(new Set([null]));
  expect(new Set(last.map((cell) => cell.bottom))).toEqual(new Set([edge]));
  expect(rows).toBeGreaterThan(3);
});

test("the standings' widest value in the last column ends 10px in from the card's right edge", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const rooms = await table.locator("tbody td:last-child").evaluateAll((cells) =>
    cells.map((cell) => {
      const text = document.createRange();
      text.selectNodeContents(cell);
      const edge =
        cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).borderRightWidth);
      return edge - text.getBoundingClientRect().right;
    }),
  );

  expect(Math.min(...rooms)).toBeCloseTo(10, 0);
});

test("the standings' ranks sit 10px in from the card's edge and 6px before the names, which all start in one place", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const [one, ten] = await Promise.all(
    ["1", "10"].map((place) =>
      table
        .locator("tbody tr", {
          has: page.locator("td.place", { hasText: new RegExp(`^${place}$`) }),
        })
        .evaluate((row) => {
          const place = /** @type {HTMLElement} */ (row.querySelector("td.place"));
          const card = place.getBoundingClientRect().left;
          const number = document.createRange();
          number.selectNodeContents(place);
          const shown = number.getBoundingClientRect();
          const name = row.querySelector(".club").getBoundingClientRect().left;
          return {
            numberIn: shown.left - card,
            numberToName: name - shown.right,
            nameIn: name - card,
          };
        }),
    ),
  );
  expect(ten.numberIn).toBeCloseTo(11, 0);
  expect(ten.numberToName).toBeCloseTo(6, 0);
  expect(one.numberIn).toBeCloseTo(11, 0);
  expect(one.nameIn).toBeCloseTo(ten.nameIn, 0);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tbody tr").first()).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Standings" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("a page last left on a tab it no longer has, like Teams, opens on the bracket", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "teams"));
  await openApp(page);

  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the tab bar floats at the bottom, each view starts just under the header, and the page neither scrolls sideways nor shows a scrollbar", async ({
    page,
  }) => {
    // The tab bar's pill would ease to each tab, which this test doesn't need to wait out.
    await openApp(page);
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y + bar.height).toBeGreaterThan(844 - 40);
    const headerBottom = await page
      .locator("header.top")
      .evaluate((header) => header.getBoundingClientRect().bottom);
    for (const tab of ["Bracket", "Games", "Standings"]) {
      await page.getByRole("tab", { name: tab }).click();
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

  test("settings set a setting's name a step over a sentence, and its note and the appearance names a step over a fact, with bigger icons", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const readSize = (locator) => locator.evaluate((element) => getComputedStyle(element).fontSize);

    expect(await readSize(page.getByText("Include content from The Athletic"))).toBe("17px");
    expect(await readSize(page.getByText("Most stories need a subscription"))).toBe("15px");
    expect(await readSize(page.locator(".appearance-choice").first())).toBe("15px");
    const icon = await page.locator(".appearance-icon").first().boundingBox();
    expect(icon.width).toBe(60);
  });

  test("a switch's knob is Walnut's cream in each theme, on or off", async ({ page }) => {
    await openApp(page);
    for (const appearance of ["Maple", "Walnut"]) {
      await chooseAppearance(page, appearance);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const knobs = await page
        .locator("#settingsDialog .switch:visible")
        .evaluateAll((switches) =>
          switches.map((element) => [
            element.getAttribute("aria-checked"),
            getComputedStyle(element.querySelector(".switch-knob")).backgroundColor,
          ]),
        );
      expect(new Set(knobs.map(([checked]) => checked)), appearance).toEqual(
        new Set(["true", "false"]),
      );
      for (const [checked, color] of knobs)
        expect(color, `${appearance}, ${checked}`).toBe("rgb(241, 233, 223)");
      await page.keyboard.press("Escape");
    }
  });

  const readStandingsPosition = (page) =>
    page.locator("#standings-pages").evaluate((pages) => pages.scrollLeft / pages.clientWidth);

  /**
   * Starts noting where the standings' lists were each time the pill changed its chosen name.
   * @param {import("@playwright/test").Page} page
   * @returns {Promise<() => Promise<{ name: string, position: number }[]>>}
   */
  async function noteNameChoices(page) {
    await page.evaluate(() => {
      const choices = /** @type {object[]} */ ([]);
      const pages = /** @type {HTMLElement} */ (document.getElementById("standings-pages"));
      new MutationObserver((records) => {
        for (const record of records) {
          const tab = /** @type {HTMLElement} */ (record.target);
          if (tab.getAttribute("aria-selected") !== "true") continue;
          choices.push({
            name: (tab.textContent ?? "").trim(),
            position: pages.scrollLeft / pages.clientWidth,
          });
        }
      }).observe(/** @type {Node} */ (document.querySelector("#standings-bar [role=tablist]")), {
        attributes: true,
        attributeFilter: ["aria-selected"],
        subtree: true,
      });
      Object.assign(window, { nameChoices: choices });
    });
    return () => page.evaluate(() => /** @type {any} */ (window).nameChoices);
  }

  test("a tap on a name two over hands the pill's fill straight there, the old name's fading out as the new one's fades in, eased alike, the new name's letters a beat behind, and the name between never filling", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.getByRole("tab", { name: "League" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    await page.getByRole("tab", { name: "West" }).click();

    await expect.poll(() => readStandingsPosition(page)).toBe(2);
    const [choice, ...later] = await readChoices();
    expect(choice).toEqual({ name: "West", position: 0 });
    expect(later).toEqual([]);
    const fades = await readFades();
    expect(listFillFades(fades)).toEqual([
      "League 0.18s 0s ease-in-out",
      "West 0.18s 0s ease-in-out",
    ]);
    const fillStarts = fades
      .filter(({ property }) => property === "background-color")
      .map(({ at }) => at);
    expect(Math.abs(fillStarts[0] - fillStarts[1])).toBeLessThan(5);
    const letterFades = fades
      .filter(({ property }) => property === "color")
      .map(({ name, duration, delay }) => `${name} ${duration} ${delay}`)
      .sort();
    expect(letterFades).toEqual(["League 0.18s 0s", "West 0.2s 0.025s"]);
    expect(await readFilledNames(tabList)).toEqual(["West"]);
  });

  test("with reduced motion, a tap moves the pill's fill at once, fading nothing", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readFades = await noteNameFades(tabList);

    await page.getByRole("tab", { name: "West" }).click();

    await expect.poll(() => readStandingsPosition(page)).toBe(2);
    expect(await readFilledNames(tabList)).toEqual(["West"]);
    expect(await readFades()).toEqual([]);
  });

  test("a finger swiping the standings past halfway leaves the pill as it is while it moves them, and once it lifts, the pill hands off to the list they snap to as they set off", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    const release = await drag(page, { x: 330, y: 500 }, { x: -250 }, { durationMs: 1000 });
    const liftPosition = await readStandingsPosition(page);
    expect(liftPosition).toBeGreaterThan(0.5);
    expect(liftPosition).toBeLessThan(0.9);
    expect(await readChoices()).toEqual([]);
    expect(await readFilledNames(tabList)).toEqual(["League"]);
    await release();

    await expect(page.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => readStandingsPosition(page)).toBe(1);
    const [choice, ...later] = await readChoices();
    expect(choice.name).toBe("East");
    expect(choice.position).toBeGreaterThan(liftPosition);
    expect(choice.position).toBeLessThan(0.98);
    expect(later).toEqual([]);
    expect(listFillFades(await readFades())).toEqual([
      "East 0.18s 0s ease-in-out",
      "League 0.18s 0s ease-in-out",
    ]);
  });

  test("a finger swiping the standings short of halfway leaves the pill as it is, and once it lifts, the lists spring back with the pill never changing", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    const release = await drag(page, { x: 330, y: 500 }, { x: -120 }, { durationMs: 1000 });
    expect(await readStandingsPosition(page)).toBeGreaterThan(0.2);
    await release();

    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    expect(await readChoices()).toEqual([]);
    expect(await readFades()).toEqual([]);
    expect(await readFilledNames(tabList)).toEqual(["League"]);
  });

  test("the standings show every column, in the playoffs and before them, with a winning streak below the line paler than one above it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const table = page.getByRole("table", { name: "League standings" });
    for (const heading of ["W-L", "GB", "Rd 1", "Now"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    await app.changeSeason((season) => ({ ...season, series: [] }));
    for (const heading of ["W-L", "GB", "L10", "Strk"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const readStreakColor = (team) =>
      page
        .locator("#standings-league tbody tr", { hasText: team })
        .locator(".streak-won")
        .evaluate((streak) => getComputedStyle(streak).color);
    expect(await readStreakColor("Fire")).not.toBe(await readStreakColor("Lynx"));
  });

  test("a tap anywhere on a team's row in the standings, beside its name or on its numbers, lands on the team's button and opens its sheet", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const row = page.locator('#standings-league tr[data-team="ATL"]');
    await expect(row).toBeVisible();
    const cells = await row.locator("td").evaluateAll((all) =>
      all.map((cell) => {
        const box = cell.getBoundingClientRect();
        return { x: box.right - 2, y: box.top + box.height / 2 };
      }),
    );
    for (const spot of cells) {
      const target = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.team,
        spot,
      );
      expect(target).toBe("ATL");
    }

    await page.touchscreen.tap(cells[2].x, cells[2].y);
    await expect(page.locator("#teamSheet #teamTitle")).toHaveText("Atlanta Dream");
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

    await page.getByRole("tab", { name: "Standings" }).click();
    for (const list of ["League", "East", "West"]) {
      await page.getByRole("tab", { name: list }).click();
      await expect(
        page.locator(`#standings-${list.toLowerCase()} tbody tr`).first(),
      ).toBeInViewport();
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
  await page.addInitScript(() => localStorage.setItem("lastTab", "standings"));
  await page.route(matchPath("/js/app.js"), (route) => route.abort());

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Standings" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("on a wide screen, Walnut's selected tab reads heavier, Maple's doesn't, and the tabs keep Maple's size and place", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  const tabs = page.locator("nav.tabs").getByRole("tab");
  const readBoxes = () =>
    tabs.evaluateAll((each) =>
      each.map((tab) => {
        const box = tab.getBoundingClientRect();
        const label = /** @type {Element} */ (
          tab.querySelector(".tab-label")
        ).getBoundingClientRect();
        return [box.width, box.height, label.top - box.top];
      }),
    );
  const games = page.getByRole("tab", { name: "Games" });
  // A weight's face that arrives between the readings would widen only the later one.
  await page.evaluate(() => document.fonts.ready);
  const mapleBoxes = await readBoxes();

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await readBoxes()).toEqual(mapleBoxes);
  await games.click();
  await expect(games).toHaveCSS("font-weight", "500");
  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveCSS("font-weight", "400");
  expect(await readBoxes()).toEqual(mapleBoxes);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(games).toHaveCSS("font-weight", "400");
});
