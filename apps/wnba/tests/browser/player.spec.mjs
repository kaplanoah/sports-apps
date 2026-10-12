import { test, expect, openApp, openGameSheet, matchPath, formatRgb } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { checkRanksAreDim } from "../../../../tests/browser/rank-ink.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };

/** @param {import("@playwright/test").Page} page */
async function openLibertyRoster(page) {
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
  const roster = page.locator("#rosterSection");
  await expect(roster.locator(".roster-coach")).toBeVisible();
  return roster;
}

/**
 * Opens a player's sheet from her name on the roster, once her numbers have loaded.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function openFromRoster(page, name) {
  const roster = await openLibertyRoster(page);
  await roster.getByRole("button", { name }).click();
  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator(".player-facts")).toBeVisible();
  return sheet;
}

test("a player's name on her roster opens her sheet over it: her facts, her last game over her averages, her playoff games, and her ranks", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openFromRoster(page, "Breanna Stewart");

  await expect(sheet.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await expect(sheet.locator("#playerNote")).toHaveText("Liberty•#30•Connecticut");
  await expect(sheet.locator(".player-fact")).toHaveText([
    "PositionForward",
    `Height6'4"`,
    "Age32",
    "Debut2016",
  ]);
  await expect(sheet.locator(".player-game-line td")).toHaveText(["19", "2", "3", "40.0"]);
  await expect(sheet.locator(".player-average td")).toHaveText(["Avg20.8", "8.3", "3.3", "32.9"]);
  await expect(sheet.locator(".team-game .player-points")).toHaveText(["34Pts", "21Pts"]);
  await expect(sheet.locator(".player-rank-row")).toHaveCount(8);
  await expect(sheet.locator(".player-rank-row").first()).toHaveText(/Pts\s*20.8\s*7th of 125/);
  await expect(sheet.locator(".player-curve b")).toHaveCount(8);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await sheet.getByRole("button", { name: "Back to Team" }).click();
  await expect(sheet).toBeHidden();
  await expectShown(page.locator("#rosterSection"));
});

test("a tap anywhere in a player's row on her roster opens her sheet, and a tap on a column's name only sorts", async ({
  page,
}) => {
  await openApp(page);
  const roster = await openLibertyRoster(page);
  await roster.getByRole("columnheader", { name: "Pts" }).getByRole("button").click();
  await expect(roster).not.toHaveAttribute("inert");

  await roster
    .locator("table.roster tbody tr", { hasText: "Stewart" })
    .locator("td")
    .last()
    .click();

  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await expectShown(sheet);
});

test("her last game's AVG hangs left of the four columns, which center on the sheet by themselves", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const sheet = await openFromRoster(page, "Breanna Stewart");
  const [table, label, sheetBox] = await Promise.all(
    [sheet.locator("table.player-game"), sheet.locator(".player-average-label"), sheet].map(
      (locator) => locator.boundingBox(),
    ),
  );
  if (!table || !label || !sheetBox) throw new Error("not shown");

  expect(Math.abs(table.x + table.width / 2 - (sheetBox.x + sheetBox.width / 2))).toBeLessThan(1);
  expect(label.x + label.width).toBeLessThanOrEqual(table.x);
});

test("her mark on each curve is her team's mark color for the theme", async ({ page }) => {
  await openApp(page);
  const sheet = await openFromRoster(page, "Breanna Stewart");
  const mark = sheet.locator(".player-curve b").first();

  await expect(mark).toHaveCSS("background-color", "rgb(68, 146, 116)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(mark).toHaveCSS("background-color", "rgb(135, 213, 181)");
});

test("each of her facts is centered under its label", async ({ page }) => {
  await openApp(page);
  const sheet = await openFromRoster(page, "Breanna Stewart");
  // Each part stretches across its fact, so its words' own box shows where they sit.
  const [label, value] = await sheet
    .locator(".player-fact")
    .first()
    .evaluate((fact) =>
      [...fact.children].map((part) => {
        const words = document.createRange();
        words.selectNodeContents(part);
        const box = words.getBoundingClientRect();
        return box.left + box.width / 2;
      }),
    );
  expect(Math.abs(label - value)).toBeLessThan(1);
});

test.describe("a player who is out", () => {
  test.use({ timezoneId: "America/New_York" });

  /**
   * Where the Out box sits: from the band over it, the sheet's sides, and the part under it.
   * @param {import("@playwright/test").Locator} sheet
   */
  const measureOutBox = (sheet) =>
    sheet.evaluate((element) => {
      const box = /** @type {HTMLElement} */ (element.querySelector(".out-box"));
      const band = /** @type {HTMLElement} */ (element.querySelector(".sheet-top"));
      const content = /** @type {HTMLElement} */ (element.querySelector(".sheet-content"));
      const [boxRect, bandRect, sheetRect] = [box, band, content].map((part) =>
        part.getBoundingClientRect(),
      );
      const nextRect = /** @type {HTMLElement} */ (box.nextElementSibling).getBoundingClientRect();
      return {
        above: boxRect.top - bandRect.bottom,
        left: boxRect.left - sheetRect.left,
        right: sheetRect.right - boxRect.right,
        below: nextRect.top - boxRect.bottom,
      };
    });

  /**
   * How far RotoWire's sentence is under her reason, and where it's from under the sentence.
   * @param {import("@playwright/test").Locator} box
   */
  const measureOutLines = (box) =>
    box.evaluate((element) => {
      const [line, sentence, source] = [".out-line", ".out-sentence", ".out-source"].map((name) =>
        /** @type {HTMLElement} */ (element.querySelector(name)).getBoundingClientRect(),
      );
      return { sentence: sentence.top - line.bottom, source: source.top - sentence.bottom };
    });

  for (const viewport of [PHONE, { width: 1280, height: 900 }])
    test(`at ${viewport.width}px wide, her sheet opens on a box saying why, her chip leading it and RotoWire's sentence 6px under it and the day ESPN changed it 4px under that, 11.5px from the band, the sheet's sides, and what's under it`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      const sheet = await openFromRoster(page, "Elizabeth Balogun");
      const box = sheet.locator(".out-box");

      await expect(sheet.locator("#playerTitle")).toHaveText("Elizabeth Balogun");
      await expect(box.locator(".out-line")).toHaveText("OutNot injury related");
      await expect(box.locator(".out-sentence")).toHaveText(
        "Balogun (not with team) is out for Wednesday's game against the Dream.",
      );
      await expect(box.locator(".out-source")).toHaveText("RotoWire•Sep 22");
      await expect(box.locator("+ .sheet-message")).toHaveText("No games yet this season");
      await expect(sheet.locator(".player-dnp").first()).toHaveText("DNP");
      expect(await measureOutBox(sheet)).toEqual({
        above: 11.5,
        left: 11.5,
        right: 11.5,
        below: 11.5,
      });
      await expect(box).toHaveCSS("padding", "10px 9.5px 8px");
      expect(await measureOutLines(box)).toEqual({ sentence: 6, source: 4 });
      await expect(box.locator(".foul-chip")).toHaveCSS("margin-right", "7px");
      await expect(box.locator(".out-words")).toHaveCSS("top", "-1px");
      await expect(box.locator(".out-line")).toHaveCSS("font-size", "15px");
      await expect(box.locator(".out-sentence")).toHaveCSS("font-size", "14.5px");
      await expect(box.locator(".out-source")).toHaveCSS("font-size", "13px");
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
    });

  test("the box's border is Maple's or Walnut's own, and its wash the chip's orange", async ({
    page,
  }) => {
    await openApp(page);
    const box = (await openFromRoster(page, "Elizabeth Balogun")).locator(".out-box");

    await expect(box).toHaveCSS("border-top-color", "rgb(230, 200, 159)");
    await expect(box).toHaveCSS(
      "background-color",
      /^color\(srgb 0\.635\d* 0\.227\d* 0\.039\d* \/ 0\.065\)$/,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(box).toHaveCSS("border-top-color", "rgb(86, 61, 42)");
    await expect(box).toHaveCSS(
      "background-color",
      /^color\(srgb 0\.941\d* 0\.478\d* 0\.227\d* \/ 0\.065\)$/,
    );
  });

  test("one out for the season has rest of season after her reason, past an en dash, and no sentence when RotoWire says only that she's out", async ({
    page,
  }) => {
    await openApp(page);
    const box = (await openFromRoster(page, "Satou Sabally")).locator(".out-box");

    await expect(box.locator(".out-line")).toHaveText("OutConcussion\u2013rest of season");
    await expect(box.locator(".out-sentence, .out-source")).toHaveCount(0);
  });
});

test("a player short of the WNBA's rule shows her numbers without a rank, but where she would rank, all in the dim color, and says why", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openFromRoster(page, "Leonie Fiebich");

  await expect(sheet.locator(".player-rank", { hasText: " of " })).toHaveText(["7th of 76"]);
  await expect(sheet.locator(".player-rank", { hasText: "would be" })).toHaveCount(7);
  expect(await checkRanksAreDim(sheet, ".player-rank")).toEqual(Array(8).fill(true));
  await expect(sheet.locator(".player-rank-note")).toHaveText(
    "The WNBA only ranks players who've played 31 games or, for shooting percentages, made a certain number of shots. She's played 21 games.",
  );
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("where a player short of the rule would rank is a hairline in her mark color through the curve, 4px above it and 3.5px past its foot, with no dot", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openFromRoster(page, "Leonie Fiebich");
  const line = sheet.locator(".player-curve i.provisional").first();
  await expect(line).toBeVisible();
  await expect(sheet.locator(".player-rank").first()).toHaveText(/^would be \d+(st|nd|rd|th)$/);

  const shape = await line.evaluate((element) => {
    const curve = /** @type {HTMLElement} */ (element.parentElement);
    const box = element.getBoundingClientRect();
    const curveBox = curve.getBoundingClientRect();
    const place = (parseFloat(element.style.top) / 100) * curveBox.height + curveBox.top;
    return {
      above: place - box.top,
      past: box.bottom - curveBox.bottom,
      color: getComputedStyle(element).borderLeftColor,
      team: getComputedStyle(curve).getPropertyValue("--team").trim(),
      dots: curve.querySelectorAll("b").length,
    };
  });
  expect(shape.above).toBeCloseTo(4, 1);
  expect(shape.past).toBeCloseTo(3.5, 1);
  expect(shape.dots).toBe(0);
  expect(shape.color).toBe(formatRgb(shape.team));
});

test("on a phone, a player who played enough games but made too few shots for a percentage says which, its lines even, so no word sits alone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const sheet = await openFromRoster(page, "Pauline Astier");
  const note = sheet.locator(".player-rank-note");

  await expect(note).toHaveText(
    "She hasn't made enough 3-pointers to be ranked in 3P%. The WNBA only ranks shooting percentages for players who've made a certain number of shots.",
  );
  const lastLineWords = await note.evaluate((element) => {
    const words = document.createRange();
    words.selectNodeContents(element);
    const lines = [...words.getClientRects()];
    const lastTop = Math.max(...lines.map((line) => line.top));
    const lastLine = lines.filter((line) => Math.abs(line.top - lastTop) < 2);
    const width = lastLine.reduce((sum, line) => sum + line.width, 0);
    return width / element.getBoundingClientRect().width;
  });
  expect(lastLineWords).toBeGreaterThan(0.5);
});

test("a top scorer's name in a box score opens her sheet over the game's, and a leader's name on a team's sheet over the team's", async ({
  page,
}) => {
  await openApp(page);
  const game = await openGameSheet(page, "Game details: Aces at Fever, First Round Game 2");
  await game.getByRole("button", { name: "A'ja Wilson" }).click();
  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator("#playerTitle")).toHaveText("A'ja Wilson");
  await expect(sheet.getByRole("button", { name: "Back to Game" })).toBeVisible();

  await sheet.getByRole("button", { name: "Back to Game" }).click();
  await expect(sheet).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
  await page.locator("#teamSection").getByRole("button", { name: "Breanna Stewart" }).click();
  await expect(sheet.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await expect(sheet.getByRole("button", { name: "Back to Team" })).toBeVisible();
});

test("her sheet, which reads her numbers again, the roster, and the team's sheet open again on a reload", async ({
  page,
}) => {
  await openApp(page);
  await openFromRoster(page, "Breanna Stewart");

  const reread = page.waitForRequest(/\/player\?id=1627668&team=NYL&season=2026$/);
  await page.reload();
  await reread;

  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator(".player-curve b")).toHaveCount(8);
  await sheet.getByRole("button", { name: "Back to Team" }).click();
  await expect(page.locator("#rosterSection .roster-coach")).toBeVisible();
});

test("her sheet that didn't load says so over Try again, which holds its shape as it reads her again", async ({
  page,
}) => {
  await openApp(page);
  const roster = await openLibertyRoster(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 502, json: { error: "test" } });
  await page.route(matchPath("/player"), refuse);
  await roster.getByRole("button", { name: "Breanna Stewart" }).click();
  const sheet = page.locator("#playerSheet");
  const block = sheet.locator("#playerBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load her numbers");
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.unroute(matchPath("/player"), refuse);
  const release = await holdRequests(page, matchPath("/player"));
  await block.getByRole("button", { name: "Try again" }).click();
  await expect(sheet.locator("#playerBody .placeholder").first()).toBeVisible();
  release();
  await expect(sheet.locator(".player-facts")).toBeVisible();
  await expect(block).toHaveCount(0);
});
