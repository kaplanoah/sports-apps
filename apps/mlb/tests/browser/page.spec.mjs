import {
  test,
  expect,
  openApp,
  openSettings,
  buildSnapshotWithStarters,
  matchPath,
  PITCHER_SIDES,
  PLAYER_DOCS,
  RECORDED_HIGHLIGHTS,
  ROSTER_DOCS,
  readColor,
} from "./harness.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";
import { listFontsNotPreloaded } from "../../../../tests/browser/font-loads.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";
import {
  listTapFlashes,
  listTapsOffButtons,
  listTouchHoverRules,
} from "../../../../tests/browser/tap-states.mjs";
import { PHONE } from "./screen-sizes.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("the page's fonts come from its own server, each in every weight from one file", async ({
  page,
}) => {
  const fontRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(new URL(request.url()).pathname);
  });
  await openApp(page);

  const loadedWeights = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((font) => font.status === "loaded")
      .map((font) => `${font.family.replaceAll('"', "")} ${font.weight}`);
  });
  expect(loadedWeights).toContain("Libre Franklin 100 900");
  expect(loadedWeights).toContain("Chivo Mono 100 900");
  expect(fontRequests).toEqual([
    "/fonts/libre-franklin-latin.woff2",
    "/fonts/chivo-mono-latin.woff2",
  ]);
});

test("on a phone, the tabs float at the bottom and stay there while the page scrolls", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bar = page.locator("#tabBar");
  const resting = await bar.boundingBox();
  const gapBelow = PHONE.height - (resting.y + resting.height);
  expect(gapBelow).toBeGreaterThanOrEqual(16);
  expect(gapBelow).toBeLessThan(32);

  await openSeasonPart(page, "Standings");
  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#standingsWrap")).toBeVisible();

  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => bar.boundingBox().then((box) => Math.round(box.y)))
    .toBe(Math.round(resting.y));
});

test("on a phone, a screen reader's bare click still switches tabs", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);

  await page.getByRole("tab", { name: "Games" }).dispatchEvent("click", { detail: 1 });

  await expect(page.getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-games")).toBeVisible();
});

test("on a phone, even a page shorter than the screen can scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#view-bracket-standings")).toBeVisible();

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
});

test("on a phone, tapping the tab that's showing scrolls back to the top, and then takes it back to the part it's named for", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(findSeasonTab(page)).toHaveAccessibleName("Standings");
  await openSeasonPart(page, "Bracket");
  await expect(page.locator("#bracketWrap")).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await findSeasonTab(page).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#bracketWrap")).toBeVisible();

  await findSeasonTab(page).click();

  await expect(page.locator("#standingsWrap")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("on a phone, each tab comes back where it was left, and a tab not shown yet opens at its top", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  const left = await page.evaluate(() => scrollY);

  await page.getByRole("tab", { name: "News" }).click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("tab", { name: "Games" }).click();
  await findSeasonTab(page).click();

  expect(await page.evaluate(() => scrollY)).toBe(left);
  await expect(page.locator("#standingsWrap")).toBeVisible();
});

test("on a phone, a tap slides the tab bar's pill to its tab, and then nothing animates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  const pill = page.locator(".tab-pill");
  // A loaded machine can see the slide end before it looks, so the pill notes each transition.
  await pill.evaluate((element) => {
    const transitions = /** @type {string[]} */ ([]);
    for (const type of ["transitionrun", "transitionend", "transitioncancel"]) {
      element.addEventListener(type, (event) =>
        transitions.push(`${type} ${/** @type {TransitionEvent} */ (event).propertyName}`),
      );
    }
    Object.assign(window, { pillTransitions: transitions });
  });
  const readPillTransitions = () =>
    page.evaluate(() => /** @type {any} */ (window).pillTransitions);

  await page.getByRole("tab", { name: "Games" }).click();

  await expect
    .poll(readPillTransitions)
    .toEqual(["transitionrun transform", "transitionend transform"]);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  const pillBox = await pill.boundingBox();
  const tabBox = await page.getByRole("tab", { name: "Games" }).boundingBox();
  expect(pillBox.x + pillBox.width / 2).toBeCloseTo(tabBox.x + tabBox.width / 2, 0);
  expect(pillBox.height).toBeCloseTo(tabBox.height, 0);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await findSeasonTab(page).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on, showing the part of it last chosen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSeasonPart(page, "Bracket");

  await page.reload();

  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(findSeasonPill(page).getByRole("tab", { name: "Bracket" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#bracketWrap")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("the page shows the tab it was last on before its modules have loaded", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await page.route(matchPath("/js/app.js"), (route) => route.abort());

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Games" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-games")).toHaveCSS("display", "flex");
  await expect(page.locator("#view-bracket-standings")).toHaveCSS("display", "none");
});

test("on a wide screen, the tabs are one segmented control, each as tall as a pill's names in a track of the divider's color just around them, the open one raised in the card's color, and every name centered on its capitals", async ({
  page,
}) => {
  await openApp(page);
  const track = page.locator("nav.tabs");
  const pillName = findSeasonPill(page).getByRole("tab").first();
  await page.evaluate(() => document.fonts.ready);
  const pillHeight = /** @type {{ height: number }} */ (await pillName.boundingBox()).height;
  expect(pillHeight).toBe(36);
  expect(/** @type {{ height: number }} */ (await track.boundingBox()).height).toBe(pillHeight + 4);
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect(track).toHaveCSS("background-color", await readColor(page, "--divider"));
    const chosen = page.locator("nav.tabs [role=tab][aria-selected=true]");
    await expect(chosen).toHaveCSS("background-color", await readColor(page, "--card"));
    await expect(chosen).toHaveCSS(
      "box-shadow",
      `${await readColor(page, "--card-border")} 0px 0px 0px 1px inset`,
    );
    for (const other of await page.locator("nav.tabs [role=tab][aria-selected=false]").all()) {
      await expect(other).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(other).toHaveCSS("color", await readColor(page, "--ink"));
    }
  }
  for (const name of [...(await track.getByRole("tab").all()), pillName]) {
    const box = /** @type {{ y: number, height: number }} */ (await name.boundingBox());
    expect(box.height).toBe(pillHeight);
    expect((await readCapitals(name)).middle - (box.y + box.height / 2)).toBeCloseTo(0, 0);
  }
});

test("a tap shows only the page's own states: no gray flash, and no hover left behind", async ({
  page,
}) => {
  await openApp(page);
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

// Yesterday, today, and tomorrow, whose games show a past day's, today's, and a coming day's rows.
const SHOWN_DAYS = ["2026-09-23", "2026-09-24", "2026-09-25"];

/**
 * Brings a day to the top of the Games list, as a tap on it in the strip does.
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
async function showDay(page, day) {
  await page.locator(`#seasonGames .day-cell[data-day="${day}"]`).click();
  await expect(
    page.locator(`#seasonGames .listed-day[data-day="${day}"] .game-row`).first(),
  ).toBeInViewport();
}

/**
 * Each state of Search, shown in turn: its examples, its suggestions and pages as a club's name is
 * typed, and a club's pages and games.
 * @param {import("@playwright/test").Page} page
 */
const listSearchStates = (page) => [
  async () => {
    await page.locator("#tab-search").click();
    await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  },
  async () => {
    await page.locator("#gameSearch .search-input").pressSequentially("Met");
    await expect(page.locator("#gameSearch .search-suggestion").first()).toBeVisible();
  },
  async () => {
    await page.locator("#gameSearch .search-input").press("Enter");
    await expect(page.locator("#gameSearch .game-row").first()).toBeVisible();
  },
];

/**
 * Opens a game's sheet from today's games, and returns a step that shows each of its sections in
 * turn, then a final's Highlights, the last closing the sheet once it has been checked.
 * @param {import("@playwright/test").Page} page
 */
async function showGameSections(page) {
  await showDay(page, "2026-09-24");
  const sheet = page.locator("#gameSheet");
  const showSection = async (name) => {
    await sheet.getByRole("tab", { name }).click();
    await expect(sheet.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  };
  return [
    async () => {
      await page
        .getByRole("button", { name: "Game details: Astros at Athletics, Thu, Sep 24" })
        .click();
      await expect(sheet.locator(".starters-open")).toBeVisible();
    },
    async () => {
      await showSection("Matchup");
      await expect(sheet.locator("#matchupBody .faceoff")).toBeVisible();
    },
    async () => {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await showDay(page, "2026-09-23");
      await page
        .getByRole("button", { name: /^Game details: Brewers at Phillies, Wed, Sep 23/ })
        .click();
      await showSection("Highlights");
      await expect(sheet.locator("#highlightsBody .clip-row").first()).toBeVisible();
    },
    async () => {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    },
  ];
}

// Highlights for a final on the evening's slate, Brewers at Phillies, as MLB cut them for another.
const SEP_23_HIGHLIGHTS = {
  823410: { ...RECORDED_HIGHLIGHTS["849826"], id: "823410" },
};

/** @param {Record<string, any>} fields */
const createNewsStory = (fields) => ({
  url: `https://example.com/${fields.id}`,
  title: `A story about the ${fields.id}`,
  summary: "What happened, in a sentence.",
  author: "A Writer",
  outlet: "ESPN",
  source: "espn",
  publishedAt: "2026-09-24T14:00:00.000Z",
  photo: null,
  teams: ["NYM"],
  ...fields,
});

// A card with a story under its lead, which the News view shows.
const NEWS_DOCS = {
  "news/cards": {
    cards: [
      {
        lead: createNewsStory({ id: "mets", teamFeed: "NYM" }),
        more: [createNewsStory({ id: "league", outlet: "The Athletic", source: "athletic" })],
      },
    ],
  },
};

/**
 * Leaves the club's sheet for the sheet of Blake Treinen, on the Dodgers' injured list, from their
 * roster.
 * @param {import("@playwright/test").Page} page
 */
async function openInjuredPlayer(page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("#teamSheet")).toBeHidden();
  await page.locator('.div-grid tr[data-team="LAD"] .team-open').click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
  await page.locator("#rosterBody").getByRole("button", { name: "Blake Treinen" }).click();
  await expect(page.locator("#playerBody .out-sentence")).toBeVisible();
}

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text keeps to its type role, in every view", async ({ page }) => {
      await openApp(page, {
        snapshots: { 2026: buildSnapshotWithStarters() },
        store: { ...ROSTER_DOCS, ...PLAYER_DOCS, ...NEWS_DOCS },
        pitchers: PITCHER_SIDES,
        highlights: SEP_23_HIGHLIGHTS,
      });
      await openSeasonPart(page, "Bracket");
      await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      await page.getByRole("tab", { name: "Games" }).click();
      for (const day of SHOWN_DAYS) {
        await showDay(page, day);
        expect(await listTextOffRoles(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
        expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      }
      for (const state of listSearchStates(page)) {
        await state();
        expect(await listTextOffRoles(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
        expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      }
      await page.locator("#gameSearch button.search-cancel").click();
      for (const section of await showGameSections(page)) {
        await section();
        expect(await listTextOffRoles(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
        expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      }
      await openSeasonPart(page, "Standings");
      await expect(page.locator("table.st tbody tr").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
      await expect(page.locator("#teamSheet .leader-stat").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      await expect(page.locator("#rosterBody .box-table").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      for (const player of ["Steven Kwan", "Tanner Bibee"]) {
        await page.locator("#rosterBody").getByRole("button", { name: player }).click();
        await expect(page.locator("#playerBody .sheet-part").first()).toBeVisible();
        expect(await listTextOffRoles(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
        expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
        await page.locator("#playerSheet").getByRole("button", { name: "Back" }).click();
        await expect(page.locator("#playerSheet")).toBeHidden();
      }
      await openInjuredPlayer(page);
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#teamSheet")).toBeHidden();
      await page.getByRole("tab", { name: "News" }).click();
      await expect(page.locator(".news-more-title")).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
      await openSettings(page);
      await expect(page.locator("#settingsDialog")).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
    });

    test("every spot that looks tappable lands on a button, in every view", async ({ page }) => {
      await openApp(page, {
        snapshots: { 2026: buildSnapshotWithStarters() },
        store: { ...ROSTER_DOCS, ...PLAYER_DOCS, ...NEWS_DOCS },
        pitchers: PITCHER_SIDES,
        highlights: SEP_23_HIGHLIGHTS,
      });
      await openSeasonPart(page, "Bracket");
      await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.getByRole("tab", { name: "Games" }).click();
      for (const day of SHOWN_DAYS) {
        await showDay(page, day);
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      for (const state of listSearchStates(page)) {
        await state();
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      await page.locator("#gameSearch button.search-cancel").click();
      for (const section of await showGameSections(page)) {
        await section();
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      await openSeasonPart(page, "Standings");
      await expect(page.locator("table.st tbody tr").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
      await expect(page.locator("#teamSheet .leader-stat").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      await expect(page.locator("#rosterBody .box-table").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      for (const player of ["Steven Kwan", "Tanner Bibee"]) {
        await page.locator("#rosterBody").getByRole("button", { name: player }).click();
        await expect(page.locator("#playerBody .sheet-part").first()).toBeVisible();
        expect(await listTapsOffButtons(page)).toEqual([]);
        await page.locator("#playerSheet").getByRole("button", { name: "Back" }).click();
        await expect(page.locator("#playerSheet")).toBeHidden();
      }
      await openInjuredPlayer(page);
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#teamSheet")).toBeHidden();
      await page.getByRole("tab", { name: "News" }).click();
      await expect(page.locator(".news-more-title")).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await openSettings(page);
      await expect(page.locator("#settingsDialog")).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
    });
  });
}

test("every font the page's views draw with is preloaded", async ({ page }) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await openSeasonPart(page, "Bracket");
  await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
  await page.getByRole("tab", { name: "Games" }).click();
  for (const day of SHOWN_DAYS) await showDay(page, day);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("table.st tbody tr").first()).toBeVisible();
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");

  expect(await listFontsNotPreloaded(page)).toEqual([]);
});

test("the header's words are in Libre Franklin and its times in Chivo Mono, both at the detail's size, on whole-pixel lines", async ({
  page,
}) => {
  await openApp(page);
  const stamp = page.locator("#stamp");
  await expect(stamp).toBeVisible();
  const detail = `${(await readRole(page, "detail")).size}px`;
  await expect(stamp).toHaveCSS("font-family", /^"Libre Franklin"/);
  await expect(stamp).toHaveCSS("font-size", detail);
  await expect(stamp).toHaveCSS("line-height", "18px");
  await expect(stamp.locator("b:not(.now)").first()).toHaveCSS("font-family", /^"Chivo Mono"/);
  await expect(stamp.locator("b:not(.now)").first()).toHaveCSS("font-size", detail);
});
