import { test, expect, openApp } from "./harness.mjs";
import { expectReloadOpensOn, RELOAD_STATES } from "../../../../tests/browser/reload-states.mjs";
import {
  MINUTE_MS,
  SHORT_PHONE,
  expectDayStripAfterReload,
  expectNewsAfterReloads,
  expectOpeningRoundAfterReload,
  expectSeasonTabAfterReload,
} from "../../../../tests/browser/start-over.mjs";

// The Games list after a reload from each state a phone can hold, left on a day the season's
// record lists and on one before it, its strip of dates on today after a reload two minutes after
// the page left, and the season tab and News after a reload under two minutes after the page left
// and after two.

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

const SHOWN_DAYS = { recordDay: "2026-09-23", earlierDay: "2026-09-22" };

for (const { name, opensOn } of RELOAD_STATES) {
  for (const [kind, shownDay] of Object.entries(SHOWN_DAYS)) {
    const opens = opensOn[/** @type {keyof typeof SHOWN_DAYS} */ (kind)];
    test(`a reload from ${name}, left on ${shownDay}, opens the Games list on ${opens === "today" ? "today" : "that day"}`, async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
      await openApp(page, { isWholeSeason: true });

      await expectReloadOpensOn(page, {
        state: name,
        opensOn: opens,
        today: "2026-09-24",
        shownDay,
      });
    });
  }
}

test("a reload two minutes or more after the page left the Games list on another day shows its strip of dates on today, before the page's code arrives and once it runs", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await openApp(page, { isWholeSeason: true });
  await expectDayStripAfterReload(page, "2026-09-10");
});

/**
 * Has the store finish each of the series `ids`, won by its first club in `wins` games, as the
 * Worker saves them.
 * @param {Awaited<ReturnType<typeof openApp>>} app
 * @param {string[]} ids
 * @param {number} wins
 */
async function finishSeries(app, ids, wins) {
  const season = await app.readDocument(SEASON_PATH);
  const series = { ...season.series };
  for (const id of ids) series[id] = { ...series[id], winsA: wins, started: true };
  await app.writeFromWorker(SEASON_PATH, { ...season, series });
}

const SEASON_PATH = "seasons/2026";
const WILD_CARD_SERIES = ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"];
const DIVISION_SERIES = ["AL_DS1", "AL_DS2", "NL_DS1", "NL_DS2"];

test.describe("on a short phone", () => {
  test.use({ viewport: SHORT_PHONE });

  const SIDEWAYS = "#bracketWrap .tree-scroll";

  test("a reload two minutes or more after the page left opens the bracket on the round still playing, though another was when the page left, even once the page's saved season can't be read", async ({
    page,
  }) => {
    const app = await openApp(page);
    await finishSeries(app, WILD_CARD_SERIES, 2);
    await expect(page.locator("#bracketWrap .nscore", { hasText: "2" })).toHaveCount(4);
    await expectOpeningRoundAfterReload(page, {
      sideways: SIDEWAYS,
      changeWhileAway: () => finishSeries(app, DIVISION_SERIES, 3),
    });
  });

  test("a reload two minutes or more after the page left starts the season tab over, on the part it's named for, each part at its top with the header back, before the page's code arrives and once it runs", async ({
    page,
  }) => {
    await openApp(page);
    await expectSeasonTabAfterReload(page, { sideways: SIDEWAYS, awayMs: 2 * MINUTE_MS });
  });

  test("a reload under two minutes after the page left shows the season tab where it was left", async ({
    page,
  }) => {
    await openApp(page);
    await expectSeasonTabAfterReload(page, { sideways: SIDEWAYS, awayMs: MINUTE_MS });
  });

  test("a reload shows News where it was left under two minutes after the page left, and at its top after two", async ({
    page,
  }) => {
    const app = await openApp(page);
    await expectNewsAfterReloads(page, app.writeFromWorker);
  });
});
