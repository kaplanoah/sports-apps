import {
  test,
  expect,
  openApp,
  BOX_SCORES,
  PLAYER_DOCS,
  MATCHUP_STARTERS,
  BROADCASTS_FIXTURE,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  swipeSheetDown,
  matchPath,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import {
  recordSheetMotions,
  waitForTimedMotions,
} from "../../../../tests/browser/sheet-motions.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";

// The games of the first day after today, which the Games view lists under today's.
const NEXT_DAY_GAMES = "#seasonGames .listed-day:has(.is-today) + .listed-day .game-open";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ASTROS_AT_ATHLETICS = "Game details: Astros at Athletics, Thu, Sep 24";
const BLUBAUGH_VS_SPRINGS = "Pitching matchup: Blubaugh vs Springs";

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
async function showGames(
  page,
  pitchers = MATCHUP_STARTERS,
  snapshot = buildSnapshotWithStarters(),
) {
  await openApp(page, { snapshots: { 2026: snapshot }, pitchers });
  await page.getByRole("tab", { name: "Games" }).click();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
async function openGame(page, pitchers = MATCHUP_STARTERS, snapshot = buildSnapshotWithStarters()) {
  await showGames(page, pitchers, snapshot);
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  return page.locator("#gameSheet");
}

/**
 * @param {import("@playwright/test").Locator} sheet
 * @param {string} name
 */
async function showSection(sheet, name) {
  await sheet.getByRole("tab", { name }).click();
  await expect(sheet.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
async function openMatchup(
  page,
  pitchers = MATCHUP_STARTERS,
  snapshot = buildSnapshotWithStarters(),
) {
  const sheet = await openGame(page, pitchers, snapshot);
  await showSection(sheet, "Matchup");
  return sheet;
}

/** @param {import("@playwright/test").Page} page */
const holdPitchers = (page) => holdRequests(page, matchPath("/pitcher"));

/** @param {import("@playwright/test").Page} page */
function countPitcherReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/pitcher") reads.count += 1;
  });
  return reads;
}

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

test("a tap on the starters slides to Matchup, with them face to face, and the close button closes it", async ({
  page,
}) => {
  const sheet = await openGame(page);
  await sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.locator("#matchupSection")).toBeInViewport();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-bio .arm")).toHaveText(["R", "L"]);
  await expect(sheet.locator(".pitcher-bio .arm").first()).toHaveAttribute(
    "title",
    "Throws right-handed",
  );
  await expect(sheet.locator(".pitcher-bio")).toHaveText(["RAge 27", "LAge 27"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".recent-starts").first()).toContainText(
    "Sep 19vs Mariners5 2/3 IP, 2 R, 6 K",
  );

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
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

test("a starter named after the sheet opened shows on its starters line and in its matchup", async ({
  page,
}) => {
  const named = buildSnapshotWithStarters();
  const isAstrosGame = (game) => game.away === "HOU" && game.home === "ATH";
  const [blubaugh, springs] = named.slate.today.games.find(isAstrosGame).starters;
  /** @param {any} season @param {object[]} starters */
  const setStarters = (season, starters) => ({
    ...season,
    slate: {
      ...season.slate,
      today: {
        ...season.slate.today,
        games: season.slate.today.games.map((game) =>
          isAstrosGame(game) ? { ...game, starters } : game,
        ),
      },
    },
  });
  const app = await openApp(page, {
    snapshots: { 2026: setStarters(named, [blubaugh, { id: springs.id }]) },
    pitchers: MATCHUP_STARTERS,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  await expect(
    sheet.getByRole("button", { name: "Pitching matchup: Blubaugh vs TBD" }),
  ).toBeVisible();

  const season = await app.readDocument("seasons/2026");
  await app.writeFromWorker("seasons/2026", setStarters(season, [blubaugh, springs]));

  await expect(sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS })).toBeVisible();
  await showSection(sheet, "Matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
});

test("a reload shows the open matchup before the page's code arrives, and the code reads its starters again", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  const release = await holdRequests(page, matchPath("/js/app.js"));
  const reads = countPitcherReads(page);

  await page.reload({ waitUntil: "commit" });

  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  release();
  await expect.poll(() => reads.count).toBe(2);
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.locator("#matchupSection")).toBeInViewport();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
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

test("the sheet's parts and lists leave room between their rows", async ({ page }) => {
  const sheet = await openMatchup(page);
  const blubaugh = sheet.locator(".scout").first();
  await expect(blubaugh.locator(".pitch-name")).toHaveCount(3);
  const readGaps = (list) =>
    list.evaluateAll((items) =>
      items.slice(1).map((item, index) => {
        const above = items[index].getBoundingClientRect();
        return Math.round(item.getBoundingClientRect().top - above.bottom);
      }),
    );
  expect(await readGaps(blubaugh.locator(".pitch-name"))).toEqual([10, 10]);
  expect(await readGaps(blubaugh.locator(".recent-starts li"))).toEqual([8]);
  const rowsToLastStarts = await blubaugh.evaluate((scout) => {
    const rows = scout.querySelector(".pitch-rows").getBoundingClientRect();
    return scout.querySelector("h4").getBoundingClientRect().top - rows.bottom;
  });
  expect(Math.round(rowsToLastStarts)).toBe(20);
  const tapeToScout = await sheet.locator(".matchup-body").evaluate((body) => {
    const tape = body.querySelector(".tape").getBoundingClientRect();
    return body.querySelector(".scout").getBoundingClientRect().top - tape.bottom;
  });
  expect(Math.round(tapeToScout)).toBe(22);
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

/**
 * Where a finger on the middle of `target` lands.
 * @param {import("@playwright/test").Locator} target
 */
const isTapOnTarget = (target) =>
  target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const landed = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(landed);
  });

test("a starter the Worker can't describe says so under his club, beside the other's numbers, and Try again shows his placeholders as it reads him again", async ({
  page,
}) => {
  /** @type {Record<number, object>} */
  const pitchers = { 1: MATCHUP_STARTERS[1] };
  const sheet = await openMatchup(page, pitchers);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(1);
  const retry = sheet.locator(".pitcher-id.home .retry-side");
  await expect(retry.locator(".retry-message")).toHaveText("Couldn't load");
  await expect(sheet.locator(".scout")).toHaveCount(1);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  pitchers[2] = MATCHUP_STARTERS[2];
  const release = await holdPitchers(page);
  const button = retry.getByRole("button", { name: "Try again" });
  expect(await isTapOnTarget(button)).toBe(true);
  await button.click();
  await expect(
    sheet.locator("#matchupBody .scout").nth(1).locator(".placeholder").first(),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
  release();
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
});

test("a starter's Couldn't load sits 11px under his club and a pixel right of the button's center, 3.5px over it, and the button 14px over the stats", async ({
  page,
}) => {
  const sheet = await openMatchup(page, { 1: MATCHUP_STARTERS[1] });
  const gaps = await sheet.locator("#matchupBody").evaluate((body) => {
    const box = (selector) =>
      /** @type {Element} */ (body.querySelector(selector)).getBoundingClientRect();
    const club = box(".pitcher-id.home .club");
    const message = box(".retry-side .retry-message");
    const button = box(".retry-side .retry-button");
    const stats = box(".tape");
    return {
      above: message.top - club.bottom,
      between: button.top - message.bottom,
      below: stats.top - button.bottom,
      right: Math.round(message.left + message.width / 2 - (button.left + button.width / 2)),
    };
  });
  expect(gaps).toEqual({ above: 11, between: 3.5, below: 14, right: 1 });
});

test("with neither starter's numbers loaded, the Matchup says why once, and reads them again as the phone comes back online", async ({
  page,
}) => {
  /** @type {Record<number, object>} */
  const pitchers = {};
  const sheet = await openMatchup(page, pitchers);
  const block = sheet.locator("#matchupBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load starters' numbers");
  await expect(sheet.locator(".retry-side")).toHaveCount(0);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  Object.assign(pitchers, MATCHUP_STARTERS);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(block).toHaveCount(0);
});

test("a game on a later day without its starters says to check back for them, under its clubs", async ({
  page,
}) => {
  const reads = countPitcherReads(page);
  await showGames(page);
  await page.locator(NEXT_DAY_GAMES).first().click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Still TBD", "Still TBD"]);
  await expect(sheet.locator(".pitcher-id .club")).toHaveCount(2);
  await expect(sheet.locator(".check-back")).toHaveText("Check back for pitchers");
  await expect(sheet.locator(".tape, .scout")).toHaveCount(0);
  expect(reads.count).toBe(0);
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

// What the Worker answers for the last starters of the Angels, who play at Seattle tonight.
const ANGELS_ROTATION = {
  club: "LAA",
  date: "2026-09-24",
  starters: [
    {
      id: 11,
      name: "Kochanowicz",
      hand: "R",
      start: { date: "2026-09-23", ip: "6.1", pitches: 98 },
      rest: 0,
    },
    {
      id: 12,
      name: "Soriano",
      hand: "R",
      start: { date: "2026-09-19", ip: "5.0", pitches: 101 },
      rest: 4,
    },
  ],
};

async function openStillTbd(page, rotations) {
  await openApp(page, { rotations });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page
    .locator("#seasonGames .game-day.is-today .game-row")
    .filter({ hasText: "Angels" });
  await expect(row.locator(".starter.pending")).toHaveText(["Still TBD", "Still TBD"]);
  await row.locator(".game-open").click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  return sheet;
}

test("a game later today without a starter says Still TBD, and opens to who started lately and how rested each is", async ({
  page,
}) => {
  const sheet = await openStillTbd(page, { LAA: ANGELS_ROTATION });
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Still TBD", "Still TBD"]);
  const angels = sheet.locator(".scout").first();
  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".scout-note")).toHaveText(
    "No starter named yet. Each recent starter's last start, and the rest he'd have on Sep 24.",
  );
  const starters = angels.locator(".rotation li");
  await expect(starters.first()).toHaveText(
    /Kochanowicz\s*R\s*6 1\/3 IP, 98 pitches\s*0 days' rest/,
  );
  await expect(starters.nth(1)).toHaveText(/Soriano\s*R\s*5 IP, 101 pitches\s*4 days' rest/);
  await expect(starters.nth(1)).toHaveClass("rested");
  await expect(starters.first()).not.toHaveClass("rested");
  const rotationGap = await angels.locator(".rotation").evaluate((list) => {
    const [above, below] = [...list.children].map((item) => item.getBoundingClientRect());
    return below.top - above.bottom;
  });
  expect(Math.round(rotationGap)).toBe(5);
  await expect(sheet.locator(".scout").nth(1).locator(".retry-message")).toHaveText(
    "Couldn't load who started lately",
  );
});

test("a club whose last starters didn't load reads them again on a tap on Try again", async ({
  page,
}) => {
  /** @type {Record<string, object>} */
  const rotations = { LAA: ANGELS_ROTATION };
  const sheet = await openStillTbd(page, rotations);
  const mariners = sheet.locator(".scout").nth(1);
  await expect(mariners.locator(".retry-message")).toHaveText("Couldn't load who started lately");
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  rotations.SEA = { ...ANGELS_ROTATION, club: "SEA" };
  const release = await holdRequests(page, matchPath("/rotation"));
  await mariners.getByRole("button", { name: "Try again" }).click();
  await expect(mariners.locator(".placeholder").first()).toBeVisible();
  release();
  await expect(mariners.locator(".rotation li")).toHaveCount(2);
});

/**
 * The ERA row's numbers, as the sheet colors them: each one's text color and weight, whether its
 * dot is dimmed from its club's color, and the ink a number is in unless it ranks lower.
 * @param {import("@playwright/test").Locator} sheet
 */
const readEraColors = (sheet) =>
  sheet
    .locator(".tape-measure")
    .first()
    .evaluate((measure) => {
      /** @param {string} color */
      const paint = (color) => {
        const probe = document.createElement("span");
        probe.style.color = color;
        measure.append(probe);
        const painted = getComputedStyle(probe).color;
        probe.remove();
        return painted;
      };
      /** @param {"away" | "home"} side */
      const readSide = (side) => {
        const number = /** @type {HTMLElement} */ (measure.querySelector(`.tape-number.${side}`));
        const dot = /** @type {HTMLElement} */ (number.querySelector(".tape-dot"));
        const club = paint(getComputedStyle(number).getPropertyValue("--side"));
        return {
          color: getComputedStyle(number).color,
          weight: getComputedStyle(number).fontWeight,
          isDotDimmed: paint(getComputedStyle(dot).backgroundColor) !== club,
        };
      };
      return { away: readSide("away"), home: readSide("home"), ink: paint("var(--ink)") };
    });

test("a starter's number is white and bolder when it ranks above the other's, and dim, with its dot, when it ranks below", async ({
  page,
}) => {
  const era = await readEraColors(await openMatchup(page));
  expect(era.away).toEqual({ color: era.ink, weight: "550", isDotDimmed: false });
  expect(era.home.color).not.toBe(era.ink);
  expect(era.home.isDotDimmed).toBe(true);
});

test("beside a starter who isn't ranked, both numbers are white, and only the unranked starter's dot dims", async ({
  page,
}) => {
  const era = await readEraColors(
    await openMatchup(page, { ...MATCHUP_STARTERS, 2: { ...MATCHUP_STARTERS[2], ranks: null } }),
  );
  expect(era.away).toEqual({ color: era.ink, weight: "400", isDotDimmed: false });
  expect(era.home).toEqual({ color: era.ink, weight: "400", isDotDimmed: true });
});

/** @param {import("@playwright/test").Locator} sheet */
const readNumberLineMiddles = (sheet) =>
  sheet.locator(".tape-measure").evaluateAll((measures) =>
    measures.map((measure) => {
      /** @param {string} selector */
      const readMiddle = (selector) => {
        const box = /** @type {HTMLElement} */ (
          measure.querySelector(selector)
        ).getBoundingClientRect();
        return Math.round(box.top + box.height / 2);
      };
      return {
        away: readMiddle(".tape-number.away .tape-number-line"),
        label: readMiddle(".tape-label"),
        home: readMiddle(".tape-number.home .tape-number-line"),
      };
    }),
  );

test("where an unranked starter near the innings would rank is a hairline one screen pixel wide in his club's color through each curve, 4px above it and 3.5px past its foot, with no dot", async ({
  page,
}) => {
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  const lines = sheet.locator(".tape .player-curve i.home.provisional");
  await expect(lines).toHaveCount(4);
  await expect(sheet.locator(".tape-number.home .tape-rank").first()).toHaveText(
    /^would be \d+(st|nd|rd|th)$/,
  );
  const rankLines = await sheet.locator(".tape-number.home .tape-rank").evaluateAll((ranks) =>
    ranks.map((rank) => {
      const range = document.createRange();
      range.selectNodeContents(rank);
      return new Set([...range.getClientRects()].map((line) => Math.round(line.bottom))).size;
    }),
  );
  expect(rankLines).toEqual([1, 1, 1, 1]);

  const shape = await lines.first().evaluate((element) => {
    const curve = /** @type {HTMLElement} */ (element.parentElement);
    const box = element.getBoundingClientRect();
    const curveBox = curve.getBoundingClientRect();
    const place = (parseFloat(element.style.top) / 100) * curveBox.height + curveBox.top;
    const left = (parseFloat(element.style.left) / 100) * curveBox.width + curveBox.left;
    return {
      width: box.width,
      pixel: 1 / window.devicePixelRatio,
      above: place - box.top,
      past: box.bottom - curveBox.bottom,
      middle: box.left + box.width / 2 - left,
      color: getComputedStyle(element).borderLeftColor,
      side: getComputedStyle(element).getPropertyValue("--side").trim(),
      dots: curve.querySelectorAll("b.home").length,
    };
  });
  expect(shape.width).toBe(shape.pixel);
  expect(shape.above).toBeCloseTo(4, 1);
  expect(shape.past).toBeCloseTo(3.5, 1);
  expect(Math.abs(shape.middle)).toBeLessThanOrEqual(shape.pixel / 2);
  expect(shape.dots).toBe(0);
  const paint = await sheet.evaluate((_, color) => {
    const probe = document.createElement("span");
    probe.style.color = color;
    document.body.append(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, shape.side);
  expect(shape.color).toBe(paint);
});

test("an unranked starter's numbers sit level with the label and the ranked starter's", async ({
  page,
}) => {
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  for (const middles of await readNumberLineMiddles(sheet)) {
    expect(middles.home).toBe(middles.away);
    expect(Math.abs(middles.label - middles.away)).toBeLessThanOrEqual(1);
  }
});

test("an unranked starter's note sets his innings against his club's games, a step apart from the curves", async ({
  page,
}) => {
  const athletics = Object.values(buildSnapshotWithStarters().standings.divisions)
    .flat()
    .find((/** @type {any} */ row) => row.id === "ATH");
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  const notes = sheet.locator(".tape-note");

  await expect(notes).toHaveText([
    "Rank among qualified starters",
    `Springs has pitched 128 2/3 of the ${athletics.w + athletics.l} innings needed to qualify`,
  ]);
  const space = await sheet.locator(".tape").evaluate((tape) => {
    const curves = tape.querySelectorAll(".player-curve");
    const lastCurve = curves[curves.length - 1].getBoundingClientRect();
    const firstNote = /** @type {Element} */ (
      tape.querySelector(".tape-note")
    ).getBoundingClientRect();
    return firstNote.top - lastCurve.bottom;
  });
  expect(space).toBeCloseTo(19.5, 1);
});

test("the Matchup's stat names are a half step over the sheet's capital labels, at 13.5px", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const sizes = await sheet
    .locator(".tape-label")
    .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).fontSize));
  expect(sizes).toEqual(["13.5px", "13.5px", "13.5px", "13.5px"]);
});

test("while the starters' numbers load, the matchup holds their shape, then fills it in", async ({
  page,
}) => {
  await showGames(page);
  const release = await holdPitchers(page);
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  await sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  const body = sheet.locator("#matchupBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-first .placeholder")).toHaveCount(2);
  await expect(sheet.locator(".tape-label")).toHaveText(["ERA", "K/9", "BB/9", "Fastball mph"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(sheet.locator(".recent-starts li")).toHaveCount(6);

  release();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while a club's last starters load, its side holds a list's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page, { rotations: { LAA: ANGELS_ROTATION } });
  await page.getByRole("tab", { name: "Games" }).click();
  const release = await holdRequests(page, matchPath("/rotation"));
  const row = page
    .locator("#seasonGames .game-day.is-today .game-row")
    .filter({ hasText: "Angels" });
  await row.locator(".game-open").click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  const angels = sheet.locator(".scout").first();

  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".rotation li")).toHaveCount(5);
  await expect(angels.locator(".placeholder").first()).toBeVisible();

  release();
  await expect(angels.locator(".rotation li")).toHaveCount(2);
  await expect(angels.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its starters' numbers", async ({ page }) => {
  await showGames(page);
  const reads = countPitcherReads(page);
  const button = page.getByRole("button", { name: ASTROS_AT_ATHLETICS });

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(2);

  await button.click();
  await expect(page.locator("#gameSheet").locator(".pitch-mix")).toHaveCount(2);
  expect(reads.count).toBe(2);
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

/** @param {import("@playwright/test").Locator} chart */
function measurePitchMix(chart) {
  return chart.evaluate((element) => {
    const readNumber = (selector, attribute) =>
      Number(element.querySelector(selector).getAttribute(attribute));
    const lineBox = element.querySelector(".speed-line").getBoundingClientRect();
    const [, , viewWidth] = element.querySelector(".speed-line").getAttribute("viewBox").split(" ");
    const scale = lineBox.width / Number(viewWidth);
    const usage = element.querySelector(".pitch-usage").getBoundingClientRect();
    return {
      lineStart: lineBox.left + readNumber(".speed-axis", "x1") * scale,
      lineEnd: lineBox.left + readNumber(".speed-axis", "x2") * scale,
      usageStart: usage.left,
      usageEnd: usage.right,
      lineDot:
        (2 * readNumber(".pitch-dot", "r") - readNumber(".pitch-dot", "stroke-width")) * scale,
      rowDots: [...element.querySelectorAll(".pitch-key")].map((key) => {
        const box = key.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
      slices: [...element.querySelectorAll(".pitch-usage i")].map(
        (slice) => slice.getBoundingClientRect().width,
      ),
    };
  });
}

test("the bar over the line ends where the line does, split by how often he throws each", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const chart = sheet.locator(".pitch-mix").first();
  await expect(chart.locator(".pitch-usage i")).toHaveCount(3);
  const { lineStart, lineEnd, usageStart, usageEnd, slices } = await measurePitchMix(chart);
  expect(usageStart).toBeCloseTo(lineStart, 0);
  expect(usageEnd).toBeCloseTo(lineEnd, 0);
  const [slider, changeup, fourSeam] = slices;
  expect(fourSeam / slider).toBeCloseTo(0.52 / 0.3, 1);
  expect(changeup / slider).toBeCloseTo(0.17 / 0.3, 1);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 320, height: 640 },
]) {
  test(`at ${viewport.width}px wide, the speed labels stay 13px, each number on its speed, over the pitches`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const sheet = await openMatchup(page);
    const chart = sheet.locator(".pitch-mix").first();
    const labels = chart.locator(".speed-label");
    await expect(labels).toHaveText(["70 mph", "80", "90", "100"]);
    await expect(labels.first()).toHaveCSS("font-size", "13px");
    const { lineStart, lineEnd } = await measurePitchMix(chart);
    const readCenters = () =>
      labels.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return box.left + box.width / 2;
        }),
      );
    const centers = await readCenters();
    expect(centers[0]).toBeCloseTo(lineStart, 0);
    expect(centers.at(-1)).toBeCloseTo(lineEnd, 0);
    const labelsToRows = await chart.evaluate((element) => {
      const scale = element.querySelector(".speed-labels").getBoundingClientRect();
      return element.querySelector(".pitch-rows").getBoundingClientRect().top - scale.bottom;
    });
    expect(Math.round(labelsToRows)).toBe(12);
  });
}

for (const { screen, viewport, smallest } of [
  { screen: "a phone", viewport: { width: 390, height: 844 }, smallest: false },
  { screen: "the narrowest phone", viewport: { width: 320, height: 640 }, smallest: true },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("each row's dot is the speed line's dot, and never under 10px", async ({ page }) => {
      const sheet = await openMatchup(page);
      const chart = sheet.locator(".pitch-mix").first();
      await expect(chart.locator(".pitch-key")).toHaveCount(3);
      const { lineDot, rowDots } = await measurePitchMix(chart);
      const expected = Math.max(10, lineDot);
      expect(lineDot < 10).toBe(smallest);
      for (const { width, height } of rowDots) {
        expect(width).toBeCloseTo(expected, 1);
        expect(height).toBeCloseTo(expected, 1);
      }
    });
  });
}

/**
 * Opens the evening of Oct 7 at one of its games, from the day it's on in the Games view.
 * @param {import("@playwright/test").Page} page
 * @param {string} game the start of its button's name
 * @param {{ boxScores?: Record<string, object>, store?: Record<string, object> }} [options]
 */
async function openOctoberGame(page, game, { boxScores = BOX_SCORES, store = {} } = {}) {
  const app = await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
    boxScores,
    store,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: new RegExp(`^Game details: ${game}`) })
    .click();
  return { app, sheet: page.locator("#gameSheet") };
}

test("a final's Game section shows its innings, then each club's batters and pitchers, below its row", async ({
  page,
}) => {
  const { sheet } = await openOctoberGame(page, "Brewers at Padres, Tue, Oct 6");
  const parts = sheet.locator("#gameBody .sheet-part-head h3");
  await expect(parts).toHaveText(["Innings", "Brewers", "Padres"]);
  const innings = sheet.locator(".line-score tbody tr");
  await expect(innings.nth(1).locator("td")).toHaveText([
    "SD",
    "0",
    "0",
    "2",
    "0",
    "1",
    "1",
    "0",
    "0",
    "x",
    "4",
    "6",
    "0",
  ]);
  await expect(sheet.locator(".box-table").first().locator("tbody tr").first()).toContainText(
    "Chourio",
  );
  const [row, firstPart] = await Promise.all(
    [sheet.locator("#gameBody .game-row"), sheet.locator("#gameBody .sheet-part").first()].map(
      (part) => part.boundingBox(),
    ),
  );
  expect(firstPart.y).toBeGreaterThanOrEqual(row.y + row.height);
  // Each player's button reaches over his whole row, so a name is whole when what follows it ends
  // before the row's first number, and no table scrolls sideways.
  const squeezed = await sheet
    .locator(".box-table tbody tr, .line-score tbody tr")
    .evaluateAll((rows) =>
      rows
        .filter((row) => {
          const cell = row.querySelector("td.team");
          const name = cell?.lastElementChild ?? cell;
          const nameEnd = name?.getBoundingClientRect().right ?? 0;
          const number = row.querySelector("td.tabular")?.getBoundingClientRect().left ?? Infinity;
          return nameEnd > number;
        })
        .map((row) => row.textContent),
    );
  expect(squeezed).toEqual([]);
  const wideTables = await sheet
    .locator(".box-wrap")
    .evaluateAll((wraps) => wraps.filter((wrap) => wrap.scrollWidth > wrap.clientWidth).length);
  expect(wideTables).toBe(0);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("today's game still to start shows each club's lineup once it's posted, and a later day's shows none", async ({
  page,
}) => {
  const { sheet } = await openOctoberGame(page, "Rays at Yankees, Wed, Oct 7");
  await expect(sheet.locator("#gameBody .sheet-part-head h3")).toHaveText(["Rays", "Yankees"]);
  await expect(sheet.locator("#gameBody .sheet-part-head > span")).toHaveText(["Lineup", "Lineup"]);
  await expect(sheet.locator(".box-table").first().locator("thead th")).toHaveText([
    "Batters",
    "AVG",
    "HR",
    "RBI",
  ]);
  await expect(sheet.locator(".box-table").first().locator("tbody tr")).toHaveCount(9);

  await page.keyboard.press("Escape");
  /** @type {string[]} */
  const reads = [];
  page.on("request", (request) => {
    if (request.url().includes("/box-score")) reads.push(request.url());
  });
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: /^Game details: Guardians at White Sox, Thu, Oct 8/ })
    .click();
  await expect(sheet.getByRole("button", { name: /^Pitching matchup/ })).toBeVisible();
  await expect(sheet.locator("#gameBody .sheet-part")).toHaveCount(0);
  expect(reads).toEqual([]);
});

const readNameOffset = (sheet) =>
  sheet.locator(".network-name").evaluate((name) => {
    const readMiddle = (element) => {
      const box = element.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    return readMiddle(name) - readMiddle(name.parentElement);
  });

test("in a sheet, a channel without a logo sits half a pixel below the logos' middle", async ({
  page,
}) => {
  const { sheet } = await openOctoberGame(page, "Guardians at White Sox, Wed, Oct 7");
  await expect(sheet.locator(".network-name")).toHaveText("TruTV");

  expect(await readNameOffset(sheet)).toBe(0.5);
});

test("a live game's box score follows each one the store pushes, and passes over one from before it", async ({
  page,
}) => {
  const { app, sheet } = await openOctoberGame(page, "Guardians at White Sox, Wed, Oct 7");
  const lastInning = sheet.locator(".line-score tbody tr").nth(1).locator("td").nth(8);
  await expect(lastInning).toHaveText("");
  const live = BOX_SCORES["849833"];

  const later = structuredClone(live);
  later.innings[7].home = 2;
  later.totals.home.runs = 5;
  later.home.batters[0].atBats += 1;
  await app.writeFromWorker("games/849833", later);
  await expect(lastInning).toHaveText("2");

  const earlier = structuredClone(live);
  earlier.innings[7].home = 0;
  await app.writeFromWorker("games/849833", earlier);
  await expect(sheet.locator(".line-score .total").nth(2)).toHaveText("5");
  await expect(lastInning).toHaveText("2");
});

const MINUTE_MS = 60 * 1000;

/**
 * Moves the page's clock on by `ms` without running its timers, as a phone that suspends it does.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
const passTime = async (page, ms) =>
  page.clock.setSystemTime((await page.evaluate(() => Date.now())) + ms);

test("a live game's sheet stays open however long the page is away, until an hour after its final shows", async ({
  page,
}) => {
  const { app, sheet } = await openOctoberGame(page, "Guardians at White Sox, Wed, Oct 7");
  await expect(sheet.locator(".line-score")).toBeVisible();

  await setHidden(page, true);
  await passTime(page, 12 * 60 * MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(true);
  const season = /** @type {any} */ (await app.readDocument("seasons/2026"));
  const game = season.slate.today.games.find((/** @type {any} */ each) => each.id === "849833");
  Object.assign(game, { state: "final" });
  await app.writeFromWorker("seasons/2026", season);
  await expect(sheet.getByRole("tab", { name: "Highlights" })).toBeVisible();

  await setHidden(page, true);
  await passTime(page, 59 * MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(true);

  await setHidden(page, true);
  await passTime(page, MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(false);
});

test("a reload shows the open box score before the page's code arrives, and the code reads it again", async ({
  page,
}) => {
  const { sheet } = await openOctoberGame(page, "Brewers at Padres, Tue, Oct 6");
  await expect(sheet.locator(".line-score")).toBeVisible();
  const release = await holdRequests(page, matchPath("/js/app.js"));
  const heldBoxScore = await holdRequests(page, matchPath("/box-score"));

  await page.reload({ waitUntil: "commit" });

  await expect(sheet.locator("#gameBody .sheet-part-head h3")).toHaveText([
    "Innings",
    "Brewers",
    "Padres",
  ]);
  release();
  await expect(sheet.getByRole("tab", { name: "Game" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.locator("#gameBody .sheet-part-head h3")).toHaveText([
    "Innings",
    "Brewers",
    "Padres",
  ]);
  heldBoxScore();
  await expect(sheet.locator(".line-score")).toBeVisible();
});

test("a tap anywhere on a box score's row opens its player's sheet over the game's, which a back arrow returns to", async ({
  page,
}) => {
  const { sheet } = await openOctoberGame(page, "Dodgers at Braves, Tue, Oct 6", {
    store: PLAYER_DOCS,
  });
  const row = sheet.locator(".box-table tbody tr").filter({ hasText: "Betts" }).first();
  const atBats = await row.locator("td.tabular").first().boundingBox();
  if (!atBats) throw new Error("Betts's row isn't shown");
  const center = { x: atBats.x + atBats.width / 2, y: atBats.y + atBats.height / 2 };
  const landsOn = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.player ?? null,
    center,
  );
  expect(landsOn).toBe("605141");
  await page.mouse.click(center.x, center.y);

  const playerSheet = page.locator("#playerSheet");
  await expect(playerSheet.locator("#playerTitle")).toHaveText("Mookie Betts");
  await playerSheet.getByRole("button", { name: "Back" }).click();
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Dodgers @ Braves");
  await expect(playerSheet).toBeHidden();

  await sheet.locator(".box-table").getByRole("button", { name: "Sale" }).click();
  await expect(playerSheet.locator("#playerBody")).toHaveText(
    "His numbers show while he's on a club's roster",
  );
});

test("a starter's name in the matchup opens his sheet", async ({ page }) => {
  const { sheet } = await openOctoberGame(page, "Guardians at White Sox, Wed, Oct 7", {
    store: PLAYER_DOCS,
  });
  await sheet.getByRole("tab", { name: "Matchup" }).click();
  const starter = sheet.locator("#matchupBody .pitcher-id.away .player-open");
  await expect(starter).toBeVisible();
  const name = await starter.getAttribute("data-player-name");
  await starter.click();
  await expect(page.locator("#playerSheet #playerTitle")).toContainText(
    (name ?? "").split(" ").at(-1) ?? "",
  );
});

/**
 * Opens a final of Oct 6 at its Highlights.
 * @param {import("@playwright/test").Page} page
 */
async function openHighlights(page) {
  const { app, sheet } = await openOctoberGame(page, "Brewers at Padres, Tue, Oct 6");
  await sheet.getByRole("tab", { name: "Highlights" }).click();
  const body = sheet.locator("#highlightsBody");
  await expect(body.locator(".clip-row")).toHaveCount(15);
  return { app, sheet, body };
}

test("a final's Highlights show MLB's recap video, MLB.com's story, and each play with its inning and the score after it", async ({
  page,
}) => {
  const { body } = await openHighlights(page);

  await expect(body.locator(".clip-feature .clip-title")).toHaveText(
    "Brewers vs. Padres Game 3 Highlights",
  );
  await expect(body.locator(".clip-feature .clip-length")).toHaveText("3:01");
  await expect(body.locator(".highlights-story-title")).toHaveText(
    "Led by King's all-in relief effort, Padres fight and force Game 4",
  );
  await expect(body.getByRole("link", { name: /^Read on MLB\.com/ })).toHaveAttribute(
    "href",
    "https://www.mlb.com/news/padres-win-nlds-game-3-2026",
  );
  const rows = body.locator(".clip-row");
  await expect(rows.first().locator(".clip-title")).toHaveText("Jackson Merrill's sliding catch");
  await expect(rows.first().locator(".clip-meta")).toHaveText("Top 1st");
  await expect(rows.nth(4).locator(".clip-meta")).toHaveText("Bot 3rd\u2022MIL 0, SD 1");
  await expect(rows.nth(4).locator(".clip-meta b")).toHaveText("SD 1");
  await expect(rows.nth(6).locator(".clip-meta b")).toHaveText("MIL 1");
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a final's plays sit 13px apart with no line between them, each still 128px wide with its length at 13px and its play button centered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { body } = await openHighlights(page);

  const rows = await body.locator(".clip-row").evaluateAll((elements) =>
    elements.slice(0, 3).map((row) => {
      const box = row.getBoundingClientRect();
      const style = getComputedStyle(row);
      const still = /** @type {Element} */ (row.querySelector(".clip-still"));
      const length = /** @type {Element} */ (row.querySelector(".clip-length"));
      const play = /** @type {Element} */ (row.querySelector(".clip-play"));
      const glyph = /** @type {Element} */ (row.querySelector(".clip-play svg"));
      const playBox = play.getBoundingClientRect();
      const glyphBox = glyph.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        line: style.boxShadow === "none" && style.borderBottomStyle === "none",
        stillWidth: still.getBoundingClientRect().width,
        lengthSize: getComputedStyle(length).fontSize,
        glyphOffset: glyphBox.left + glyphBox.width / 2 - (playBox.left + playBox.width / 2),
      };
    }),
  );
  for (const [index, row] of rows.entries()) {
    expect(row.line).toBe(true);
    expect(row.stillWidth).toBe(128);
    expect(row.lengthSize).toBe("13px");
    expect(row.glyphOffset).toBeCloseTo(-0.5, 1);
    if (index > 0) expect(row.top - rows[index - 1].bottom).toBeCloseTo(13, 0);
  }
});

test("a tap anywhere on a play's row plays its clip full screen in the browser's own player", async ({
  page,
}) => {
  const { body } = await openHighlights(page);
  await page.evaluate(() => {
    const played = /** @type {any} */ (window);
    played.clipsPlayed = [];
    HTMLElement.prototype.requestFullscreen = function () {
      this.dataset.askedFullscreen = "true";
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.play = function () {
      played.clipsPlayed.push({ src: this.src, isFullscreen: this.dataset.askedFullscreen });
      return Promise.resolve();
    };
  });
  const row = body.locator(".clip-row").nth(6);
  await row.scrollIntoViewIfNeeded();
  const video = await row.getAttribute("data-video");
  const title = await row.locator(".clip-title").boundingBox();
  if (!title) throw new Error("The row's title isn't shown");
  const center = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
  const landsOn = await page.evaluate(
    ({ x, y }) =>
      /** @type {HTMLElement | null} */ (document.elementFromPoint(x, y)?.closest(".clip-open"))
        ?.dataset.video ?? null,
    center,
  );
  expect(landsOn).toBe(video);

  await page.mouse.click(center.x, center.y);

  await expect
    .poll(() => page.evaluate(() => /** @type {any} */ (window).clipsPlayed))
    .toEqual([{ src: video, isFullscreen: "true" }]);
});

test("a still that doesn't load leaves its box's plain color, with no broken picture", async ({
  page,
}) => {
  const { body } = await openHighlights(page);

  await expect(body.locator(".clip-feature img")).toBeHidden();
  await expect(body.locator(".clip-feature .clip-play")).toBeVisible();
});

test("a game still to be played offers no Highlights, even after a final's sheet did, and a swipe from its Matchup goes nowhere", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sheet } = await openOctoberGame(page, "Brewers at Padres, Tue, Oct 6");
  await expect(sheet.getByRole("tab", { name: "Highlights" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: /^Game details: Guardians at White Sox, Thu, Oct 8/ })
    .click();
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Highlights" })).toBeHidden();
  await sheet.getByRole("tab", { name: "Matchup" }).click();
  await expectShown(sheet.locator("#matchupSection"));

  await (
    await drag(page, { x: 330, y: 500 }, { x: -250 })
  )();

  await expectShown(sheet.locator("#matchupSection"));
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("a reload on a final's Highlights shows them where they were scrolled before the page's code arrives, and the code keeps them there", async ({
  page,
}) => {
  const { sheet, body } = await openHighlights(page);
  const section = sheet.locator("#highlightsSection");
  await section.evaluate((element) => {
    element.scrollTop = 300;
  });
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/highlights")) reads.count += 1;
  });

  await page.reload();

  await expect(sheet.getByRole("tab", { name: "Highlights" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(body.locator(".clip-row")).toHaveCount(15);
  await expect.poll(() => reads.count).toBe(1);
  await expect.poll(() => section.evaluate((element) => element.scrollTop)).toBe(300);
});

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
