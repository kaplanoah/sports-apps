import {
  test,
  expect,
  openApp,
  BOX_SCORES,
  PLAYER_DOCS,
  BROADCASTS_FIXTURE,
  buildFixtureSnapshot,
  matchPath,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

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
