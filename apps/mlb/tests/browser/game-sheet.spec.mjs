import {
  test,
  expect,
  openApp,
  MATCHUP_STARTERS,
  BROADCASTS_FIXTURE,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  LIVE_BOX_SCORE,
  swipeSheetDown,
} from "./harness.mjs";
import {
  NEXT_DAY_GAMES,
  ASTROS_AT_ATHLETICS,
  BLUBAUGH_VS_SPRINGS,
  showGames,
  openGame,
  showSection,
  openMatchup,
} from "./open-game-sheet.mjs";
import {
  recordSheetMotions,
  waitForTimedMotions,
} from "../../../../tests/browser/sheet-motions.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("tapping a game opens its sheet on Game: its row, then its starters on one line", async ({
  page,
}) => {
  const sheet = await openGame(page);
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Astros @ Athletics");
  await expect(sheet.locator("#gameWhen")).toHaveText("Today");
  await expect(sheet.getByRole("tab", { name: "Game" })).toHaveAttribute("aria-selected", "true");
  const row = sheet.locator("#gameBody .game-row");
  await expect(row.locator(".game-side")).toHaveText(["Astros78-800.5 GB", "Athletics63-95"]);
  await expect(row.locator(".game-headline")).toHaveText("9:40 PM");
  await expect(row.locator(".game-extra, .game-open")).toHaveCount(0);
  const starters = sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS });
  await expect(starters).toHaveText(/^\s*Blubaugh\s*R\s*vs\s*Springs\s*L\s*$/);
  await expect(starters.locator(".dot")).toHaveCount(2);
});

test("a game still to come shows where it's on between its row and its starters, each logo in its version for a dark sheet", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames .game-day.is-today")
    .getByRole("button", { name: /^Game details: Brewers at Padres/ })
    .click();
  const sheet = page.locator("#gameSheet");
  const line = sheet.getByRole("group", { name: "Where to watch" });
  await expect(line.getByRole("img", { name: "FS1" })).toBeVisible();
  await expect(line.locator(".for-dark")).toHaveAttribute("alt", "FOX One");
  await expect(line.locator(".for-dark")).toBeVisible();
  await expect(line.locator(".for-light")).toBeHidden();
  const [row, where, starters] = await Promise.all(
    [sheet.locator("#gameBody .game-row"), line, sheet.locator(".starters-open")].map((part) =>
      part.boundingBox(),
    ),
  );
  expect(where.y).toBeGreaterThanOrEqual(row.y + row.height);
  expect(starters.y).toBeGreaterThanOrEqual(where.y + where.height);
  const fs1 = await line.getByRole("img", { name: "FS1" }).boundingBox();
  expect(fs1.height).toBeCloseTo(13 * 1.12, 0);
});

test("in Ball, where a game is on shows each logo in its version for a light sheet", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames .game-day.is-today")
    .getByRole("button", { name: /^Game details: Brewers at Padres/ })
    .click();
  const line = page.locator("#gameSheet").getByRole("group", { name: "Where to watch" });
  await expect(line.locator(".for-light")).toHaveAttribute("alt", "FOX One");
  await expect(line.locator(".for-light")).toBeVisible();
  await expect(line.locator(".for-dark")).toBeHidden();
});

test("a game's sheet opens on Game each time, even after it was left on Matchup", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  await expect(sheet.getByRole("tab", { name: "Game" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.locator("#gameSection")).toBeInViewport();
});

test("a game with no starter named yet has no starters line", async ({ page }) => {
  await showGames(page);
  await page.locator(NEXT_DAY_GAMES).first().click();
  const sheet = page.locator("#gameSheet");
  await expect(sheet.locator("#gameBody .game-row")).toBeVisible();
  await expect(sheet.locator(".starters-open")).toHaveCount(0);
});

test("a tap on a club in the game's row opens its sheet over the game's, which a back arrow returns to", async ({
  page,
}) => {
  const sheet = await openGame(page);
  await sheet
    .locator("#gameBody .game-row")
    .getByRole("button", { name: "Team details: Athletics" })
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Athletics");
  const back = teamSheet.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await expect(teamSheet.locator(".sheet-back-label")).toHaveText("Game");
  await back.click();
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Astros @ Athletics");
  await expect(teamSheet).toBeHidden();
});

test("the game's row follows the score as the store updates it", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .getByRole("button", { name: "Game details: Brewers at Phillies, Thu, Sep 24" })
    .click();
  const row = page.locator("#gameBody .game-row");
  await expect(row.locator(".game-headline")).toHaveText("4-1");
  await expect(row.locator(".game-status")).toHaveText("Top 9th");

  const season = await app.readDocument("seasons/2026");
  const games = season.slate.today.games.map((game) =>
    game.away === "MIL" ? { ...game, state: "final", score: [4, 2] } : game,
  );
  await app.writeFromWorker("seasons/2026", {
    ...season,
    slate: { ...season.slate, today: { ...season.slate.today, games } },
  });

  await expect(row.locator(".game-headline")).toHaveText("4-2");
  await expect(row.locator(".game-status")).toHaveText("Final");
});

test("the sheet's title names it in capitals, at one size on a desktop and a phone", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const title = sheet.getByRole("heading", { level: 2 });
  await expect(title).toHaveCSS("text-transform", "uppercase");
  await expect(title).toHaveCSS("font-weight", "500");
  await expect(title).toHaveCSS("font-size", "16px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(title).toHaveCSS("font-size", "16px");
});

test("on a desktop, the title centers over the sheet, with its close button at its left edge, and 18px sides as on a phone", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  const { titleCenter, sheetCenter, closeLeft, sheetLeft } = await sheet.evaluate((matchup) => {
    const box = /** @type {Element} */ (matchup.closest("dialog")).getBoundingClientRect();
    const title = matchup.querySelector(".sheet-title").getBoundingClientRect();
    const close = matchup.querySelector(".sheet-close").getBoundingClientRect();
    return {
      titleCenter: title.left + title.width / 2,
      sheetCenter: box.left + box.width / 2,
      closeLeft: close.left,
      sheetLeft: box.left,
    };
  });
  expect(titleCenter).toBeCloseTo(sheetCenter, 0);
  expect(closeLeft - sheetLeft).toBeCloseTo(7, 0);
  const sides = await sheet.evaluate((matchup) => {
    const box = /** @type {Element} */ (matchup.closest("dialog")).getBoundingClientRect();
    const faceoff = matchup.querySelector(".faceoff").getBoundingClientRect();
    return [faceoff.left - box.left, box.right - faceoff.right];
  });
  expect(sides.map(Math.round)).toEqual([19, 19]);
});

test("while a sheet is open, the page behind it never springs past its ends, and springs again once it closes", async ({
  page,
}) => {
  const root = page.locator("html");
  await expect(root).toHaveCSS("overscroll-behavior-y", "auto");
  const sheet = await openGame(page);
  await expect(sheet).toBeVisible();
  await expect(root).toHaveCSS("overscroll-behavior-y", "none");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(root).toHaveCSS("overscroll-behavior-y", "auto");
});

test("the sheet's title and pills hold still, keeping their band's line, while a section scrolls under them, which never scrolls past its ends", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  const section = sheet.locator("#matchupSection");
  await expect(section).toHaveCSS("overscroll-behavior-y", "none");
  const top = sheet.locator(".sheet-top");
  const line = await top.evaluate((element) => getComputedStyle(element).boxShadow);

  await section.evaluate((scroller) => {
    scroller.scrollTop = 200;
  });
  await expect.poll(() => section.evaluate((scroller) => scroller.scrollTop)).toBeGreaterThan(0);
  await expect(top).toBeInViewport();
  await expect(top).toHaveCSS("box-shadow", line);
});

test("on a phone, the matchup rises to fill the screen, with its close button at its top left, and a swipe down closes it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await waitForTimedMotions(page);
  const close = await sheet.getByRole("button", { name: "Close" }).boundingBox();
  expect([Math.round(close.x), close.width]).toEqual([6, 44]);
  expect(await page.locator("#sheetDialog").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  });

  await swipeSheetDown(page, {
    target: "#gameSheet .sheet-top",
    distance: 200,
    steps: 10,
    stepMs: 30,
  });
  await expect(sheet).toBeHidden();
});

test("on a phone, the close button and Escape slide the matchup down", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const readMotions = await recordSheetMotions(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const closings = {
    "the close button": () => page.locator("#gameCloseBtn").dispatchEvent("click"),
    Escape: () => page.keyboard.press("Escape"),
  };
  await showGames(page);
  for (const [way, close] of Object.entries(closings)) {
    await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
    const sheet = page.locator("#gameSheet");
    await waitForTimedMotions(page);
    await readMotions();

    await close();
    await expect(sheet, way).toBeHidden();
    expect(await readMotions(), way).toEqual([
      { id: "sheetDialog", part: "sheet", to: { transform: "translateY(100%)" } },
    ]);
  }
});

test("on a phone, the matchup rises only when the viewer allows motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await openMatchup(page);
  const dialog = page.locator("#sheetDialog");
  await expect(dialog).toHaveCSS("animation-name", "none");

  await sheet.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  await expect(dialog).toHaveCSS("animation-name", "sheet-rise");
});

test("on a desktop, a game lights up under the pointer, past the row's sides, and goes back after", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const readHighlight = (row) =>
    row.evaluate((element) => {
      const { backgroundColor, boxShadow } = getComputedStyle(element);
      return { backgroundColor, boxShadow };
    });
  const [first, second] = [0, 1].map((index) =>
    page.locator("#seasonGames .game-day.is-today .game-row").nth(index),
  );
  const resting = await readHighlight(first);

  // The highlight's color fills the row and both 12px reaches beyond its sides.
  const isReachingPast = async () => {
    const { backgroundColor, boxShadow } = await readHighlight(first);
    const reach = `${backgroundColor} -12px 0px 0px 0px, ${backgroundColor} 12px 0px 0px 0px`;
    return backgroundColor !== resting.backgroundColor && boxShadow === reach;
  };

  await first.hover();
  await expect.poll(isReachingPast).toBe(true);
  await second.hover();
  await expect.poll(() => readHighlight(first)).toEqual(resting);
});

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text in a game's sheet keeps to the type scale, in both its sections", async ({
      page,
    }) => {
      const sheet = await openGame(page);
      await expect(sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS })).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await showSection(sheet, "Matchup");
      await expect(sheet.locator(".pitch-rows li")).toHaveCount(5);
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
    });
  });
}

test("a game still to come lists its clubs' meetings so far under its starters, under who leads the season series, each winner a way to his club's sheet", async ({
  page,
}) => {
  await openApp(page, {
    snapshots: { 2026: buildSnapshotWithStarters() },
    pitchers: MATCHUP_STARTERS,
    isWholeSeason: true,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  const series = sheet.locator(".sheet-part", {
    has: page.locator("h3", { hasText: "Season series" }),
  });

  await expect(series.locator(".sheet-part-head span")).toHaveText("Athletics lead 5-4");
  await expect(series.locator(".meetings li")).toHaveCount(9);
  const [starters, part] = await Promise.all(
    [sheet.locator(".starters-open"), series].map((each) => each.boundingBox()),
  );
  expect(part.y).toBeGreaterThan(starters.y + starters.height);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  const winner = series.locator(".meeting-result .team-open").first();
  const box = await winner.boundingBox();
  if (!box) throw new Error("The first meeting's winner isn't shown");
  const landsOn = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest(".team-open")?.getAttribute("data-team"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  const team = await winner.getAttribute("data-team");
  expect(landsOn).toBe(team);
  await winner.click();
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("a live game's Runs so far set each runner's name by his base on the field, 2nd's centered over it, and space the part as the design does", async ({
  page,
}) => {
  const raysAtYankees = "823493";
  const runners = [
    { base: "1B", name: "Betts", reached: "Single" },
    { base: "2B", name: "Freeman", reached: "Walk" },
    { base: "3B", name: "Ohtani", reached: "Double" },
  ];
  const boxScore = { ...LIVE_BOX_SCORE, id: raysAtYankees };
  await openApp(page, {
    snapshots: { 2026: buildSnapshotWithStarters() },
    boxScores: { [raysAtYankees]: { ...boxScore, bases: { ...boxScore.bases, runners } } },
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: /^Game details: Rays at Yankees, Thu, Sep 24/ }).click();
  const part = page.locator("#gameBody .sheet-part", { has: page.locator(".runs-club") });
  await expect(part.locator("h3")).toHaveText("Runs so far");
  await expect(part.locator(".runs-runner")).toHaveText([
    /Betts\s*singled/,
    /Freeman\s*walked/,
    /Ohtani\s*doubled/,
  ]);

  const layout = await part.evaluate((element) => {
    const measure = (/** @type {string} */ selector, /** @type {Element} */ scope = element) =>
      /** @type {Element} */ (scope.querySelector(selector)).getBoundingClientRect();
    const [first, second, third] = [...element.querySelectorAll(".runs-base.taken")].map((base) =>
      base.getBoundingClientRect(),
    );
    const innings = /** @type {Element} */ (element.nextElementSibling);
    const middle = (/** @type {DOMRect} */ box) => (box.left + box.right) / 2;
    const now = measure(".runs-now-head");
    const up = measure(".runs-up");
    return {
      baseSide: first.width / Math.SQRT2,
      secondOffCenter: middle(measure(".on-2B .runs-runner-name")) - middle(second),
      nowOffCenter: middle(now) - middle(measure(".runs-field")),
      firstGap: measure(".on-1B b").left - first.right,
      thirdGap: third.left - measure(".on-3B b").right,
      aboveNow: measure(".runs-now").top - measure(".runs-club:last-of-type").bottom,
      belowNow: measure(".on-2B .runs-runner-name").top - now.bottom,
      aboveUp: up.top - measure(".runs-home-dirt").bottom,
      aboveInnings: measure(".sheet-part-head", innings).top - up.bottom,
      belowInnings: measure(".box-wrap", innings).top - measure(".sheet-part-head", innings).bottom,
    };
  });
  const expected = {
    baseSide: 9.2,
    secondOffCenter: 0,
    nowOffCenter: 0,
    firstGap: 6,
    thirdGap: 6,
    aboveNow: 14,
    belowNow: 22,
    aboveUp: 8,
    aboveInnings: 20,
    belowInnings: 2,
  };
  for (const [name, value] of Object.entries(expected))
    expect(layout[name], name).toBeCloseTo(value, 0);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
});
