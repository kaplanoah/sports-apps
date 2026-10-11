import { test, expect, expectDayAtTop, openApp } from "./harness.mjs";
import { readStripEdges, scrollStripBy } from "../../../../tests/browser/day-strip-edges.mjs";

// The Games view as one season: a strip of its days over every game day, opening on today.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** @param {import("@playwright/test").Page} page */
const findList = (page) => page.locator("#seasonGames .day-list");

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
const findDay = (page, day) => page.locator(`#seasonGames .listed-day[data-day="${day}"]`);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
const findCell = (page, day) => page.locator(`#seasonGames .day-cell[data-day="${day}"]`);

/**
 * Opens the page on the whole season, once the store's list of every game has arrived, which
 * comes after the season and draws the list again.
 * @param {import("@playwright/test").Page} page
 */
async function openWholeSeason(page) {
  const app = await openApp(page, { isWholeSeason: true });
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  return app;
}

/**
 * Opens the whole season on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGames(page) {
  const app = await openWholeSeason(page);
  await page.getByRole("tab", { name: "Games" }).click();
  return app;
}

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the Games view opens on today, under a strip of every day from the season's first game to its last, today's chosen and named for its month", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await expect(page.locator("#seasonGames .strip-month")).toHaveText("September");
    const today = findCell(page, "2026-09-30");
    await expect(today).toHaveAttribute("aria-current", "date");
    await expect(today).toHaveAttribute("aria-label", "Wednesday, September 30");

    const listed = await page
      .locator("#seasonGames .listed-day")
      .evaluateAll((days) => days.map((day) => day.getAttribute("data-day")));
    const cells = await page
      .locator("#seasonGames .day-cell")
      .evaluateAll((all) => all.map((cell) => cell.getAttribute("data-day")));
    expect(listed[0] < "2026-06-01").toBe(true);
    expect(cells[0]).toBe(listed[0]);
    expect(cells.at(-1)).toBe(listed.at(-1));
    expect(cells.length).toBeGreaterThan(listed.length);
    const quietDays = cells.filter((day) => !listed.includes(day));
    for (const day of quietDays.slice(0, 3)) {
      await expect(findCell(page, day)).toHaveClass(/is-quiet/);
      await expect(findCell(page, day)).toBeEnabled();
    }
    await expect(findCell(page, listed[0])).not.toHaveClass(/is-quiet/);
    await expect(findCell(page, listed[0]).locator(".cell-month")).toHaveCount(
      listed[0].endsWith("-01") ? 1 : 0,
    );
    await expect(findCell(page, "2026-09-01").locator(".cell-month")).toHaveText("Sep");
  });

  test("scrolling the games moves the strip's chosen day and its month to the day at the top", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const august = await page
      .locator('#seasonGames .listed-day[data-day^="2026-08-1"]')
      .first()
      .getAttribute("data-day");

    await findList(page).evaluate((list, day) => {
      const shown = /** @type {HTMLElement} */ (list.querySelector(`[data-day="${day}"]`));
      const gap = Number.parseFloat(getComputedStyle(list).paddingTop);
      list.scrollTo({ top: shown.offsetTop - gap, behavior: "instant" });
    }, august);

    await expectDayAtTop(page, august);
    await expect(page.locator("#seasonGames .strip-month")).toHaveText("August");
    await expect(findCell(page, august)).toBeInViewport();
  });

  test("the strip's chosen day passes to the next day once none of a day's text shows under the bar, whether or not its last game has a line under its teams", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const chosen = page.locator("#seasonGames .day-cell.is-chosen");
    const scrollList = (top) =>
      findList(page).evaluate((list, to) => list.scrollTo({ top: to, behavior: "instant" }), top);

    for (const passed of ["2026-08-10", "2026-10-04"]) {
      await scrollList(
        await findDay(page, passed).evaluate(
          (listed) => /** @type {HTMLElement} */ (listed).offsetTop,
        ),
      );
      await expect(findDay(page, passed).locator(".game-row").first()).toBeAttached();
      const { textBottom, next } = await findList(page).evaluate((list, shown) => {
        const listed = /** @type {HTMLElement} */ (list.querySelector(`[data-day="${shown}"]`));
        const listTop = list.getBoundingClientRect().top;
        const walker = document.createTreeWalker(listed, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let bottom = 0;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (!text.nodeValue?.trim()) continue;
          range.selectNodeContents(text);
          bottom = Math.max(
            bottom,
            range.getBoundingClientRect().bottom - listTop + list.scrollTop,
          );
        }
        return { textBottom: bottom, next: listed.nextElementSibling?.getAttribute("data-day") };
      }, passed);

      await scrollList(Math.floor(textBottom) - 1);
      await expect(chosen).toHaveAttribute("data-day", passed);
      await scrollList(Math.ceil(textBottom));
      await expect(chosen).toHaveAttribute("data-day", next);
      await scrollList(Math.floor(textBottom) - 1);
      await expect(chosen).toHaveAttribute("data-day", passed);
    }
  });

  test("a day far from the list's top stands in for its games, and scrolling draws each day whole before it shows", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await expect(findDay(page, "2026-06-10").locator(".game-list")).toHaveClass(/is-stand-in/);
    expect(await page.locator("#seasonGames .game-row").count()).toBeLessThan(100);
    await findList(page).evaluate((list) => list.scrollTo({ top: 0, behavior: "instant" }));

    for (let step = 0; step < 20; step += 1) {
      await findList(page).evaluate((list) => list.scrollBy(0, list.clientHeight));
      await expect
        .poll(() =>
          findList(page).evaluate((list) => {
            const top = list.getBoundingClientRect().top;
            const bottom = top + list.clientHeight;
            return [...list.querySelectorAll(".game-list.is-stand-in")].filter((standIn) => {
              const box = standIn.getBoundingClientRect();
              return box.bottom > top && box.top < bottom;
            }).length;
          }),
        )
        .toBe(0);
    }
  });

  test("scrolling the games to their end brings the season's last day to the top, chosen in the strip, as a tap on it does", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const last = await page.locator("#seasonGames .listed-day").last().getAttribute("data-day");

    await findList(page).evaluate((list) =>
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" }),
    );

    await expectDayAtTop(page, last);
    await findCell(page, "2026-10-24").click();
    await expectDayAtTop(page, "2026-10-24");
    await findCell(page, last).click();
    await expectDayAtTop(page, last);
  });

  test("a tap on a day brings its games to the top, a tap on Today brings today back, and so does a tap on Games while it shows", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");

    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");
    await page.locator("#seasonGames .go-today").click();
    await expectDayAtTop(page, "2026-09-30");

    await page.locator("#seasonGames .strip-month").evaluate(() => {
      const list = /** @type {Element} */ (document.querySelector("#seasonGames .day-list"));
      list.scrollTo({ top: 0, behavior: "instant" });
    });
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).not.toHaveAttribute(
      "data-day",
      "2026-09-30",
    );
    await page.getByRole("tab", { name: "Games" }).click();
    await expectDayAtTop(page, "2026-09-30");
  });

  test("Today looks the same on today as on any other day", async ({ page }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const goToday = page.locator("#seasonGames .go-today");
    const readLook = () =>
      goToday.evaluate((button) => {
        const { color, backgroundColor, boxShadow, fontWeight } = getComputedStyle(button);
        return { color, backgroundColor, boxShadow, fontWeight, attributes: button.outerHTML };
      });
    const onToday = await readLook();

    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");

    expect(await readLook()).toEqual(onToday);
    await expect(goToday).toHaveCSS("font-size", "14px");
    const icon = await goToday.locator("svg").boundingBox();
    expect(icon.width).toBe(14);
  });

  test("today's date says Today over it in the strip, chosen or not, where every other date says its weekday", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await expect(findCell(page, "2026-09-30")).toHaveText(/^Today\s*30$/);
    await expect(findCell(page, "2026-09-29")).toHaveText(/^Tue\s*29$/);

    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");

    await expect(findCell(page, "2026-09-30")).toHaveText(/^Today\s*30$/);
  });

  test("a tap on a date without games brings in its No games row, which leaves once it's out of sight, without moving the list", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await expect(findDay(page, "2026-09-28")).toHaveCount(0);

    await findCell(page, "2026-09-28").click();

    await expectDayAtTop(page, "2026-09-28");
    await expect(findDay(page, "2026-09-28").locator(".empty-note")).toHaveText("No games");
    await expect(findDay(page, "2026-09-28").locator(".day-number")).toHaveText("28");

    await page.locator("#seasonGames .go-today").click();

    await expect(findDay(page, "2026-09-28")).toHaveCount(0);
    await expectDayAtTop(page, "2026-09-30");
  });

  test("swiping the strip names the month in its middle, and the list's next move names its top day's again", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const month = page.locator("#seasonGames .strip-month");
    const strip = await page.locator("#seasonGames .day-strip").boundingBox();

    await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
    await page.mouse.wheel(-2400, 0);

    await expect(month).toHaveText("August");
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
      "data-day",
      "2026-09-30",
    );
    await findList(page).evaluate((list) => list.scrollBy({ top: 40, behavior: "instant" }));
    await expect(month).toHaveText("September");
  });

  test("a tap on Today where the list already is moves nothing", async ({ page }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const top = await findList(page).evaluate((list) => list.scrollTop);

    await page.locator("#seasonGames .go-today").click();

    expect(await findList(page).evaluate((list) => list.scrollTop)).toBe(top);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test("the header holds still while the games scroll under the bar, which ends in a line once a day is under it", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const header = await page.locator("header.top").boundingBox();
    await expect(page.locator("#seasonGames .day-bar")).toHaveClass(/stuck/);

    await findList(page).evaluate((list) => list.scrollTo({ top: 0, behavior: "instant" }));

    await expect(page.locator("#seasonGames .day-bar")).not.toHaveClass(/stuck/);
    expect(await page.locator("header.top").boundingBox()).toEqual(header);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // A phone on the Home Screen draws the page short of the screen unless it's a pixel taller.
    const list = await findList(page).boundingBox();
    expect(Math.round(list.y + list.height)).toBeGreaterThanOrEqual(844);
    expect(Math.round(list.y + list.height)).toBeLessThanOrEqual(845);
  });

  test("after two minutes away, the list goes back to today, and after less it stays where it was", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");
    const setHidden = (/** @type {boolean} */ hidden) =>
      page.evaluate((isHidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setHidden(true);
    await page.clock.runFor(60 * 1000);
    await setHidden(false);
    await page.clock.runFor(100);
    await expectDayAtTop(page, "2026-09-20");

    await setHidden(true);
    await page.clock.runFor(2 * 60 * 1000);
    await setHidden(false);
    await page.clock.runFor(100);
    await expectDayAtTop(page, "2026-09-30");
  });

  test("after a night away, the list follows its start day to today once the store says the game it opened on has ended", async ({
    page,
  }) => {
    const app = await openSeasonGames(page);
    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q4 0:40", period: 4, clock: "0:40" });
      return season;
    });
    await expect(page.locator('[data-game="1042600132"] .clock')).toHaveText("Q4 0:40");
    await expectDayAtTop(page, "2026-09-30");
    const setHidden = (/** @type {boolean} */ hidden) =>
      page.evaluate((isHidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setHidden(true);
    await page.clock.fastForward("12:00:00");
    await app.changeSeasonWhileAway((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "final", status: "Final", period: 4, clock: "" });
      return season;
    });
    await setHidden(false);
    await page.clock.runFor(100);

    await expect(page.locator('[data-game="1042600132"] .game-status')).toContainText("Final");
    await expectDayAtTop(page, "2026-10-01");
  });

  test("after a night away, a swipe on the strip before the store catches up keeps the list where it is", async ({
    page,
  }) => {
    const app = await openSeasonGames(page);
    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q4 0:40", period: 4, clock: "0:40" });
      return season;
    });
    await expect(page.locator('[data-game="1042600132"] .clock')).toHaveText("Q4 0:40");
    await expectDayAtTop(page, "2026-09-30");
    const setHidden = (/** @type {boolean} */ hidden) =>
      page.evaluate((isHidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await setHidden(true);
    await page.clock.fastForward("12:00:00");
    await app.changeSeasonWhileAway((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "final", status: "Final", period: 4, clock: "" });
      return season;
    });
    const release = await app.holdStore();
    await setHidden(false);
    await page.clock.runFor(100);
    await expectDayAtTop(page, "2026-09-30");

    await page.locator("#seasonGames .day-strip").evaluate((strip) => {
      strip.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      strip.scrollLeft -= 200;
    });
    release();

    await expect(page.locator('[data-game="1042600132"] .game-status')).toContainText("Final");
    await page.clock.runFor(100);
    await expectDayAtTop(page, "2026-09-30");
  });

  test("after two minutes away on another tab, the Games list opens on today once it's shown", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standings-league")).toBeInViewport();

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(2 * 60 * 1000);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(100);
    await page.getByRole("tab", { name: "Games" }).click();

    await expectDayAtTop(page, "2026-09-30");
  });

  test("a game the Worker saves redraws its day, and a game added to an earlier day leaves the day at the top where it is", async ({
    page,
  }) => {
    const app = await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");

    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q1 8:00", period: 1, clock: "8:00" });
      season.games.push({ ...game, id: "added", start: "2026-09-20T23:30:00Z", state: "pre" });
      return season;
    });

    await expect(page.locator('[data-game="1042600132"] .clock')).toHaveText("Q1 8:00");
    await expectDayAtTop(page, "2026-09-30");
    await findCell(page, "2026-09-20").click();
    await expect(findDay(page, "2026-09-20").locator('[data-game="added"]')).toBeInViewport();
  });

  test("a game on a new day keeps each day after it in its own place, rather than writing each one over with the day before's games", async ({
    page,
  }) => {
    const app = await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await findDay(page, "2026-09-30").evaluate((day) => Reflect.set(day, "isKept", true));

    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      season.games.push({ ...game, id: "added", start: "2026-09-28T23:30:00Z", state: "pre" });
      return season;
    });

    await expect(findDay(page, "2026-09-28").locator('[data-game="added"]')).toHaveCount(1);
    expect(await findDay(page, "2026-09-30").evaluate((day) => Reflect.get(day, "isKept"))).toBe(
      true,
    );
  });

  test("a tab left while on another day shows the same day when it's shown again", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");

    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standings-league")).toBeInViewport();
    await page.getByRole("tab", { name: "Games" }).click();

    await expectDayAtTop(page, "2026-09-20");
  });

  test("a page that opens on another tab opens the Games list on today once it's shown", async ({
    page,
  }) => {
    await openWholeSeason(page);
    await expect(page.locator("#stamp")).toBeVisible();

    await page.getByRole("tab", { name: "Games" }).click();

    await expectDayAtTop(page, "2026-09-30");
  });
});

test.describe("on a wide screen, with reduced motion", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
    contextOptions: { reducedMotion: "reduce" },
  });

  test("the strip and its line stop at the column's edges, eleven whole days filling it, with the month and Today 2px in from its edges, whatever days are at the strip's ends", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");

    const edges = await readStripEdges(page);
    for (const part of [edges.line, edges.strip]) {
      expect(part.left).toBeCloseTo(edges.column.left, 1);
      expect(part.right).toBeCloseTo(edges.column.right, 1);
    }
    expect(edges.wholeDays).toBe(11);
    expect(edges.firstDayLeft).toBeCloseTo(edges.strip.left, 0);
    expect(edges.lastDayRight).toBeCloseTo(edges.strip.right, 0);
    expect(edges.monthLeft - edges.column.left).toBeCloseTo(2, 1);
    expect(edges.column.right - edges.todayRight).toBeCloseTo(2, 1);

    await scrollStripBy(page, 2 * 51);
    const moved = await readStripEdges(page);
    expect(moved.firstDayLeft).toBeCloseTo(moved.strip.left, 0);
    expect(moved.monthLeft).toBe(edges.monthLeft);
    expect(moved.todayRight).toBe(edges.todayRight);
  });

  test("the strip comes to rest on whole days, on the nearer one, after a scroll leaves it between them", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const strip = page.locator("#seasonGames .day-strip");
    const start = await strip.evaluate((element) => element.scrollLeft);
    const step = await findCell(page, "2026-09-30").evaluate(
      (cell) =>
        /** @type {Element} */ (cell.nextElementSibling).getBoundingClientRect().left -
        cell.getBoundingClientRect().left,
    );

    await scrollStripBy(page, step * 0.6);

    await expect
      .poll(() => strip.evaluate((element) => element.scrollLeft))
      .toBeCloseTo(start + step, 0);
    const edges = await readStripEdges(page);
    expect(edges.wholeDays).toBe(11);
    expect(edges.firstDayLeft).toBeCloseTo(edges.strip.left, 0);
  });
});

test("a tap on Today flies the list there on a spring, never stepping back, and lands on today", async ({
  page,
}) => {
  await openSeasonGames(page);
  await findCell(page, "2026-09-29").click();
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-29");
  // Each frame comes only as the test moves the clock, however slow the machine draws.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.evaluate(() => {
    const tops = /** @type {number[]} */ ([]);
    const note = () => {
      tops.push(
        /** @type {Element} */ (document.querySelector("#seasonGames .day-list")).scrollTop,
      );
      if (tops.length < 120) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
    Object.assign(window, { listTops: tops });
  });

  await page.locator("#seasonGames .go-today").click();
  await page.clock.runFor(2000);

  const tops = /** @type {number[]} */ (
    await page.evaluate(() => /** @type {any} */ (window).listTops)
  );
  const moved = tops.filter((top, index) => index === 0 || top !== tops[index - 1]);
  expect(moved.length).toBeGreaterThan(4);
  for (let index = 1; index < moved.length; index += 1)
    expect(moved[index]).toBeGreaterThan(moved[index - 1]);
  await expectDayAtTop(page, "2026-09-30");
});

for (const { screen, viewport } of [
  { screen: "a phone", viewport: { width: 390, height: 844 } },
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport, hasTouch: screen === "a phone", isMobile: screen === "a phone" });

    test("scrolling the games slides the dates behind the chosen day's box, which holds still, on a spring that never steps back, and settles with the top day in the box", async ({
      page,
    }) => {
      await openSeasonGames(page);
      await page.clock.runFor(1000);
      await expectDayAtTop(page, "2026-09-30");
      const [dayBefore, twoBefore] = await findDay(page, "2026-09-30").evaluate((today) => {
        const before = /** @type {HTMLElement} */ (today.previousElementSibling);
        const earlier = /** @type {HTMLElement} */ (before.previousElementSibling);
        return [before.dataset.day, earlier.dataset.day];
      });
      // Each frame comes only as the test moves the clock, however slow the machine draws.
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
      await page.evaluate(() => {
        const frames =
          /** @type {{ box: number[] | null, left: number, copyOff: number | null }[]} */ ([]);
        const strip = /** @type {HTMLElement} */ (
          document.querySelector("#seasonGames .day-strip")
        );
        // A day's width and the step to the next, which the box's copy of the dates keeps.
        const readSpacing = (/** @type {Element} */ day) => {
          const { left, width } = day.getBoundingClientRect();
          const next = /** @type {Element} */ (day.nextElementSibling).getBoundingClientRect();
          return [width, next.left - left];
        };
        const daySpacing = readSpacing(/** @type {Element} */ (strip.firstElementChild));
        const note = () => {
          const boxes = [
            ...document.querySelectorAll("#seasonGames .strip-lens"),
            ...document.querySelectorAll("#seasonGames .day-strip:not(.is-sliding) > .is-chosen"),
          ].map((box) => {
            const { left, width } = box.getBoundingClientRect();
            return [left, width];
          });
          const copy = document.querySelector("#seasonGames .strip-lens-track > .day-cell");
          frames.push({
            box: boxes.length === 1 ? boxes[0] : null,
            left: strip.scrollLeft,
            copyOff: copy
              ? Math.max(
                  ...readSpacing(copy).map((size, index) => Math.abs(size - daySpacing[index])),
                )
              : null,
          });
          if (frames.length < 90) requestAnimationFrame(note);
        };
        requestAnimationFrame(note);
        Object.assign(window, { stripFrames: frames });
      });
      // A wheel's turn that moves nothing puts the list in hand, as a finger does.
      /** @param {string} day */
      const bringToTop = (day) =>
        findList(page).evaluate((list, shown) => {
          list.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
          const listed = /** @type {HTMLElement} */ (list.querySelector(`[data-day="${shown}"]`));
          list.scrollTop = listed.offsetTop - Number.parseFloat(getComputedStyle(list).paddingTop);
        }, day);

      await bringToTop(dayBefore);
      await page.clock.runFor(100);
      await bringToTop(twoBefore);
      await page.clock.runFor(1400);

      const frames =
        /** @type {{ box: number[] | null, left: number, copyOff: number | null }[]} */ (
          await page.evaluate(() => Reflect.get(window, "stripFrames"))
        );
      expect(frames.every((frame) => frame.box)).toBe(true);
      const copyOffs = frames.flatMap((frame) => (frame.copyOff === null ? [] : [frame.copyOff]));
      expect(copyOffs.length).toBeGreaterThan(4);
      for (const copyOff of copyOffs) expect(copyOff).toBeCloseTo(0, 1);
      for (const frame of frames) {
        expect(frame.box?.[0]).toBeCloseTo(/** @type {number[]} */ (frames[0].box)[0], 1);
        expect(frame.box?.[1]).toBeCloseTo(/** @type {number[]} */ (frames[0].box)[1], 1);
      }
      const lefts = frames.map((frame) => frame.left);
      expect(new Set(lefts).size).toBeGreaterThan(4);
      for (let index = 1; index < lefts.length; index += 1)
        expect(lefts[index]).toBeLessThanOrEqual(lefts[index - 1]);
      await expect(page.locator("#seasonGames .strip-lens")).toHaveCount(0);
      await expect(findCell(page, twoBefore)).toHaveClass(/is-chosen/);
      const offCenter = await findCell(page, twoBefore).evaluate((cell) => {
        const strip = /** @type {HTMLElement} */ (cell.parentElement);
        const { left, width } = cell.getBoundingClientRect();
        const box = strip.getBoundingClientRect();
        return left + width / 2 - (box.left + box.width / 2);
      });
      expect(Math.abs(offCenter)).toBeLessThan(1);
    });
  });
}

test("a scroll the page makes itself, without a finger or wheel on the list, swaps the strip's chosen day at once, without sliding its dates", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-30");
  const dayBefore = await findDay(page, "2026-09-30").evaluate(
    (today) => /** @type {HTMLElement} */ (today.previousElementSibling).dataset.day,
  );

  // Each frame comes only as the test moves the clock, so a slide would still be under way.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  // The list chooses its top day from its scroll event, which comes when the browser draws, so the
  // clock moves on only once it has.
  await findDay(page, dayBefore).evaluate((listed) => {
    const list = /** @type {HTMLElement} */ (listed.parentElement);
    const scrolled = new Promise((resolve) => {
      list.addEventListener("scroll", resolve, { once: true });
    });
    listed.scrollIntoView();
    return scrolled;
  });
  await page.clock.runFor(100);

  const strip = await page.evaluate(() => ({
    chosen: document.querySelector("#seasonGames .day-cell.is-chosen")?.getAttribute("data-day"),
    isSliding: !!document.querySelector("#seasonGames .day-strip.is-sliding, .strip-lens"),
  }));
  expect(strip).toEqual({ chosen: dayBefore, isSliding: false });
});

test("a tap on Today where the list already is pulses today's date, 4% bigger and back over 290ms", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-30");

  // Each animation is noted as it starts, since a slow machine can finish one before it's read.
  await page.evaluate(() => {
    const pulses = [];
    Object.assign(window, { pulses });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this instanceof HTMLElement && this.matches(".day-cell"))
        pulses.push({
          day: this.dataset.day,
          duration: /** @type {KeyframeAnimationOptions} */ (options).duration,
          transforms: /** @type {Keyframe[]} */ (keyframes).map((keyframe) => keyframe.transform),
        });
      return animate.call(this, keyframes, options);
    };
  });
  await page.locator("#seasonGames .go-today").click();

  const pulses = await page.evaluate(() => Reflect.get(window, "pulses"));
  expect(pulses).toEqual([
    { day: "2026-09-30", duration: 290, transforms: ["scale(1)", "scale(1.04)", "scale(1)"] },
  ]);
  await page.clock.runFor(400);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expectDayAtTop(page, "2026-09-30");
});

test("a redraw that makes the list shorter as it adds a day leaves the day at the top where it is while the change eases in", async ({
  page,
}) => {
  const app = await openSeasonGames(page);
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-30");
  const readListHeight = () => findList(page).evaluate((list) => list.clientHeight);
  const heightBefore = await readListHeight();

  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    season.games.push({ ...game, id: "added", start: "2026-09-28T23:30:00Z", state: "pre" });
    return season;
  });

  await expect(findDay(page, "2026-09-28").locator('[data-game="added"]')).toHaveCount(1);
  expect(await readListHeight()).not.toBe(heightBefore);
  await page.clock.runFor(500);
  await expectDayAtTop(page, "2026-09-30");
});
