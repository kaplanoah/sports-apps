import { test, expect, expectDayAtTop, openApp, readWholeSeasonSchedule, NOW } from "./harness.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";
import { startValkyriesAtWings } from "./game-sheet-games.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

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
  const caption = await readRole(page, "caption");
  const detail = await readRole(page, "detail");
  await expect(page.locator("#stamp b.now")).toHaveCSS("font-size", `${caption.size}px`);
  await expect(page.locator("#stamp")).toHaveCSS("font-size", `${detail.size}px`);
});

test("the header says the WNBA stopped sending today's scores while today has a game, and not once it has none", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.writeDocument("live/status", {
    at: new Date(NOW).toISOString(),
    error: "wnba_feeds_missing",
    detail: "scoreboard",
  });
  const problem = page.locator("#stamp .stamp-err");
  await expect(problem).toHaveText("The WNBA stopped sending today's scores");
  await app.changeSeason((season) => {
    for (const game of season.games) if (game.state === "pre") game.status = "Postponed";
    return season;
  });
  await expect(problem).toHaveCount(0);
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
  const [rowBox, bonusBox] = await Promise.all([
    row.boundingBox(),
    row.locator(".bonus").boundingBox(),
  ]);
  expect(bonusBox?.height).toBe(15);
  expect((bonusBox?.y ?? 0) - (rowBox?.y ?? 0)).toBe(56);
  expect(await readTeamCenters()).toEqual(before);
  await goLive(false);
  await expect(row.locator(".bonus")).toHaveCount(0);
  expect(await readTeamCenters()).toEqual(before);
  expect(Math.abs(before[0] - (await findCenter(row.locator(".score"))))).toBeLessThan(1);
});

test("a regular-season game's score and status sit where a playoff game's do, the score level with its teams", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    startValkyriesAtWings(season);
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, {
      state: "live",
      status: "Q2 5:10",
      period: 2,
      clock: "5:10",
      round: null,
    });
    Object.assign(game.away, { score: 30, seed: null });
    Object.assign(game.home, { score: 27, seed: null });
    return season;
  });
  const readOffsets = (row) =>
    row.evaluate((element) => {
      const findMiddle = (part) => {
        const box = /** @type {Element} */ (element.querySelector(part)).getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const middle = findMiddle(".game-middle");
      return [".game-headline", ".game-status", ".game-side.away .club"].map(
        (part) => findMiddle(part) - middle,
      );
    });
  const regular = page.locator('[data-game="1042600132"]');
  const playoff = page.locator('[data-game="1042600112"]');
  await expect(regular.locator(".game-label")).toHaveCount(0);
  await expect(playoff.locator(".game-label")).toHaveText(/^1st Rd/);
  const [score, status, team] = await readOffsets(regular);
  expect([score, status]).toEqual((await readOffsets(playoff)).slice(0, 2));
  expect(score).toBeCloseTo(team, 0);
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
  const label = await readRole(page, "label");
  const score = await readRole(page, "score");
  expect(parts.map(({ fontSize, fontWeight }) => [fontSize, fontWeight])).toEqual([
    [`${label.size}px`, String(label.weight)],
    [`${score.size}px`, String(score.weight)],
    [`${label.size}px`, String(label.weight)],
  ]);
  expect(date.letterSpacing).toBe("normal");
  expect(parseFloat(month.letterSpacing)).toBeCloseTo(label.spacing, 2);
  expect(parseFloat(weekday.letterSpacing)).toBeCloseTo(label.spacing, 2);
  expect(date.top - month.bottom).toBeCloseTo(3, 1);
  expect(weekday.top - date.bottom).toBeCloseTo(4.5, 1);
});

test("a date that starts with a 1 sits 0.065em left of its column's middle, so the 1's stem centers, in the strip and beside its games, each digit its own width", async ({
  page,
}) => {
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  const day = page.locator('#seasonGames .day-cell[data-day="2026-10-01"]');
  await day.click();
  await expect(day).toHaveClass(/is-chosen/);
  await page.clock.runFor(2000);
  await expect(page.locator('#seasonGames .listed-day[data-day="2026-10-01"]')).toBeInViewport();

  const readOffsets = () =>
    page.evaluate(() =>
      [
        ['.day-cell[data-day="2026-09-30"]', ".cell-number"],
        ['.day-cell[data-day="2026-10-01"]', ".cell-number"],
        ['.day-cell[data-day="2026-10-11"]', ".cell-number"],
        ['.listed-day[data-day="2026-10-01"] .day-label', ".day-number"],
      ].map(([holder, part]) => {
        const box = /** @type {Element} */ (document.querySelector(`#seasonGames ${holder}`));
        const number = /** @type {HTMLElement} */ (box.querySelector(part));
        const middle = (rect) => rect.left + rect.width / 2;
        const { fontSize, fontVariantNumeric } = getComputedStyle(number);
        const offset =
          (middle(number.getBoundingClientRect()) - middle(box.getBoundingClientRect())) /
          parseFloat(fontSize);
        return [number.textContent, Math.round(offset * 200) / 200 + 0, fontVariantNumeric];
      }),
    );
  expect(await readOffsets()).toEqual([
    ["30", 0, "normal"],
    ["1", -0.065, "normal"],
    ["11", -0.065, "normal"],
    ["1", -0.065, "normal"],
  ]);
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

test("a game that may never happen says If necessary in a status's dim ink, a weight lighter than Final", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const ifNeeded = page.locator("#seasonGames .if-needed").first();
  await expect(ifNeeded).toHaveText("If necessary");
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

test("the strip takes in the days of a longer schedule that arrives after a redraw of the same days", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const cells = page.locator("#seasonGames .day-cell");
  await expect(cells.first()).toHaveAttribute("data-day", "2026-09-27");
  await app.changeSeason((season) => ({ ...season }));
  await app.changeDocument("schedules/2026", () => readWholeSeasonSchedule());
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-05-08",
  );
  await expect(cells.first()).toHaveAttribute("data-day", "2026-05-08");
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

test("No games today is a sentence, centered beside today's date, its capitals a touch above the middle of the date's number", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await dropTodaysGames(app);
  const note = page.locator("#seasonGames .no-games .empty-note");
  await expect(note).toHaveText("No games today");
  await expect(note).toHaveCSS("font-size", `${(await readRole(page, "body")).size}px`);
  // Chromium's builds set a baseline up to a pixel apart, so the note's lead over the number is
  // checked loosely.
  const { middle: noteMiddle } = await readCapitals(note);
  const { middle: numberMiddle } = await readCapitals(
    page.locator("#seasonGames .no-games .day-number"),
  );
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

test("a game's series label is a label, and it and If necessary read a step lighter than Final", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").isIfNeeded = true;
    return season;
  });
  const ifNeeded = page.locator('[data-game="1042600132"] .game-status');
  await expect(ifNeeded).toHaveText("If necessary");
  const label = await readRole(page, "label");
  const lighter = String(label.weight - 100);
  await expect(ifNeeded.locator(".if-needed")).toHaveCSS("font-weight", lighter);
  const final = page.locator("#seasonGames .game-status", { hasText: "Final" }).first();
  await expect(final).toHaveCSS("font-weight", String(label.weight));
  const series = page.locator("#seasonGames .series-label").first();
  await expect(series).toHaveCSS("font-weight", lighter);
  await expect(series).toHaveCSS("font-size", `${label.size}px`);
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
  const seed = await readRole(page, "caption");
  const team = await readRole(page, "team");
  expect([seedWeight, nameWeight]).toEqual([String(seed.weight), String(team.weight)]);
  expect(seed.weight).toBeLessThan(team.weight);
  expect(offset).toBeCloseTo(0, 1);
  const isLoaded = await page.evaluate(() => document.fonts.check('400 12px "Barlow Condensed"'));
  expect(isLoaded).toBe(true);
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
