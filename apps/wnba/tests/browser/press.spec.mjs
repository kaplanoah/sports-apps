import { holdClock } from "../../../../tests/browser/harness.mjs";
import { test, expect, openApp } from "./harness.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { findMiddle } from "../../../../tests/browser/season-scroll.mjs";
import { findSeasonPill, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { SETTINGS, openSettings } from "../../../../tests/browser/settings.mjs";
import { turnOnDiagnostics } from "../../../../tests/browser/diagnostics-switch.mjs";
import {
  sendClick,
  sendFinger,
  sendScroll,
  sendSecondFinger,
} from "../../../../tests/browser/stray-click.mjs";
import { readBackground, readPressTint } from "../../../../tests/browser/press-looks.mjs";

// A row that opens something tints while it's pressed, and a touch that's part of a scroll, as one
// that stops a list still gliding is, never taps what it landed on, as on an iPhone (press.js).

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/**
 * Notes, in the page, each time a button is first marked pressed.
 * @param {import("@playwright/test").Page} page
 */
const notePresses = (page) =>
  page.evaluate(() => {
    const presses = /** @type {number[]} */ ([]);
    Object.assign(window, { presses });
    new MutationObserver((changes) => {
      for (const change of changes)
        if (/** @type {Element} */ (change.target).classList.contains("is-pressed"))
          presses.push(performance.now());
    }).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  });

/** @param {import("@playwright/test").Page} page */
const readPresses = (page) =>
  page.evaluate(() => /** @type {number[]} */ (/** @type {any} */ (window).presses));

test("a finger held on a game's row tints the row, and the tint lets go once the finger lifts", async ({
  page,
}) => {
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#seasonGames .game-day.is-today .game-row").first();
  await expect(row).toBeVisible();
  const pressed = await readBackground(row, "var(--pressed-row)");

  const lift = await drag(page, await findMiddle(row), {});

  await expect(row.locator(".game-open")).toHaveClass(/is-pressed/);
  expect(await readPressTint(row)).toBe(pressed);

  await lift();

  await expect(row.locator(".game-open")).not.toHaveClass(/is-pressed/);
});

test("a finger that starts a scroll on a row never tints it", async ({ page }) => {
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#seasonGames .game-day.is-today .game-row").first();
  await expect(row).toBeVisible();
  await notePresses(page);

  const lift = await drag(page, await findMiddle(row), { y: -120 });
  await lift();
  await page.clock.runFor(200);

  expect(await readPresses(page)).toEqual([]);
});

/** @param {import("@playwright/test").Page} page */
async function openStandings(page) {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const row = page.locator('#standings-league tr[data-team="LVA"]');
  await expect(row).toBeVisible();
  return { row, button: row.locator(".team-open") };
}

test("a finger that drags a team's row in the standings never opens the team, even when iOS still sends the tap", async ({
  page,
}) => {
  const { row, button } = await openStandings(page);
  await holdClock(page);

  await (
    await drag(page, await findMiddle(row), { y: -30 })
  )();

  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a finger the browser takes for a scroll never opens a team, even one the click lands on beside it", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [6, 12], isCancelled: true });

  const beside = page
    .locator('#standings-league tr[data-team]:not([data-team="LVA"]) .team-open')
    .first();
  expect(await sendClick(beside)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a finger the browser takes for a scroll and that iOS ends with a cancel never opens the team", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [12], isCancelled: true, isTouchCancelled: true });

  expect(await sendClick(button)).toBe(false);
});

test("a finger that drifts on a team's row without the browser taking it for a scroll still opens the team, as a sloppy tap does", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [6, 14] });

  expect(await sendClick(button)).toBe(true);
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("a second finger landing after the browser took the first for a scroll doesn't let the first one's click through", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12], isCancelled: true });

  await sendSecondFinger(button, "pointerdown");

  expect(await sendClick(button)).toBe(false);
});

/** @param {import("@playwright/test").Page} page */
const findStandingsPart = (page) => page.locator('.season-part[data-part="standings"]');

/**
 * Flings the standings from a team's row, as a finger does that lifts while they glide on, and
 * sends the first frame of their glide.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} button
 */
async function flingStandings(page, button) {
  await sendFinger(button, { moves: [12], isCancelled: true, isScrolling: true });
  await sendScroll(page, findStandingsPart(page));
}

/**
 * Sends two more frames of the standings' glide, 80ms apart, so the glide outlasts the time a
 * list takes to count as at rest after any one frame.
 * @param {import("@playwright/test").Page} page
 */
async function glideStandingsOn(page) {
  for (let frame = 0; frame < 2; frame += 1) {
    await page.clock.runFor(80);
    await sendScroll(page, findStandingsPart(page));
  }
}

test("a still finger on a team's row while the standings glide never opens the team, even when iOS sends the tap, and never tints the row", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await flingStandings(page, button);
  await notePresses(page);

  await sendFinger(button, { moves: [] });
  await page.clock.runFor(200);

  expect(await readPresses(page)).toEqual([]);
  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a still finger on a team's row while the standings glide never opens the team, even when the glide's first frame comes after the finger lifts", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12], isCancelled: true });
  await sendScroll(page, findStandingsPart(page));

  await sendFinger(button, { moves: [] });

  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a still finger on a team's row while the standings glide never opens the team, even once the click iOS sends for the fling itself has come and gone", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await flingStandings(page, button);
  expect(await sendClick(button)).toBe(false);
  await glideStandingsOn(page);

  await sendFinger(button, { moves: [] });

  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a still tap on a team's row once the standings have come to rest opens the team, even right after the page's own code scrolls them", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await flingStandings(page, button);
  await page.clock.runFor(200);
  await sendScroll(page, findStandingsPart(page));

  await sendFinger(button, { moves: [] });

  expect(await sendClick(button)).toBe(true);
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("a still tap beside the standings while they glide, like one on the pill's Bracket, works", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await flingStandings(page, button);
  const bracket = findSeasonPill(page).getByRole("tab", { name: "Bracket", exact: true });

  await sendFinger(bracket, { moves: [] });

  expect(await sendClick(bracket)).toBe(true);
  await expect(bracket).toHaveAttribute("aria-selected", "true");
});

/**
 * Opens the Games list and flings it from today's first game, as a finger does that lifts while
 * the list glides on, and sends the first frame of the glide, which the strip's dates slide with.
 * @param {import("@playwright/test").Page} page
 */
async function flingGamesList(page) {
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  const button = page.locator("#seasonGames .game-day.is-today .game-row .game-open").first();
  await expect(button).toBeVisible();
  await holdClock(page);
  await sendFinger(button, {
    moves: [12],
    isCancelled: true,
    isScrolling: true,
    scrollsAlong: "#seasonGames .day-strip",
  });
  await sendScroll(page, page.locator("#seasonGames .day-list"));
  await sendScroll(page, page.locator("#seasonGames .day-strip"));
  return button;
}

test("a still finger on a game's row while the Games list glides, its strip's dates sliding with it, never opens the game", async ({
  page,
}) => {
  const button = await flingGamesList(page);

  await sendFinger(button, { moves: [] });

  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#gameSheet")).toBeHidden();
});

test("a still tap on a date in the Games list's strip while the list glides works, though the strip's dates slide with it", async ({
  page,
}) => {
  await flingGamesList(page);
  const date = page.locator("#seasonGames .day-strip button[data-day]").first();

  await sendFinger(date, { moves: [] });

  expect(await sendClick(date)).toBe(true);
});

test("a click a second after a scroll, like a screen reader's, still opens the team", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12], isCancelled: true });

  await page.clock.runFor(1000);

  expect(await sendClick(button)).toBe(true);
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("a click right after a scroll on what takes no tap, like a sheet's backdrop, still does its job", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await button.click();
  await expect(page.locator("#teamSheet")).toBeVisible();
  await holdClock(page);
  await sendFinger(page.locator("#teamTitle"), { moves: [12], isCancelled: true });

  expect(await sendClick(page.locator("dialog:has(#teamSheet)"))).toBe(true);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a finger the browser takes for a scroll on a player's name in a roster never opens her", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
  const name = page.locator("#rosterSection .player-open").first();
  await expect(name).toBeVisible();
  await holdClock(page);

  await sendFinger(name, { moves: [12], isCancelled: true });

  expect(await sendClick(name)).toBe(false);
  await expect(page.locator("#playerSheet")).toBeHidden();
});

/**
 * Opens the News on one story, and returns its headline.
 * @param {import("@playwright/test").Page} page
 */
async function openNewsStory(page) {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");
  await app.writeDocument("news/cards", {
    cards: [
      {
        lead: {
          id: "athletic",
          url: "https://example.com/athletic",
          title: "The Liberty's defense held the Dream to 30 percent",
          outlet: "The Athletic",
          source: "athletic",
          summary: "What happened, in a sentence.",
          author: "A Writer",
          publishedAt: "2026-09-30T14:00:00.000Z",
          teams: ["NYL", "ATL"],
        },
        more: [],
      },
    ],
  });
  const headline = page.locator(".news-card h3.news-title a");
  await expect(headline).toBeVisible();
  return headline;
}

test("a finger the browser takes for a scroll on a story in the News never opens it", async ({
  page,
}) => {
  const headline = await openNewsStory(page);
  await holdClock(page);

  await sendFinger(headline, { moves: [12], isCancelled: true });

  expect(await sendClick(headline)).toBe(false);
});

test("a still finger on a story in the News while the page glides never opens it", async ({
  page,
}) => {
  const headline = await openNewsStory(page);
  await holdClock(page);
  await sendFinger(headline, { moves: [12], isCancelled: true, isScrolling: true });
  await sendScroll(page);

  await sendFinger(headline, { moves: [] });

  expect(await sendClick(headline)).toBe(false);
});

test("a still tap on a tab while the News glides switches to it, as an iPhone's tab bar takes one mid-glide", async ({
  page,
}) => {
  const headline = await openNewsStory(page);
  await holdClock(page);
  await sendFinger(headline, { moves: [12], isCancelled: true, isScrolling: true });
  await sendScroll(page);
  const games = page.getByRole("tab", { name: "Games" });

  await sendFinger(games, { moves: [] });

  expect(await sendClick(games)).toBe(true);
  await expect(games).toHaveAttribute("aria-selected", "true");
});

test("a finger the browser takes for a scroll on an Appearance choice in settings never picks it", async ({
  page,
}) => {
  await openApp(page);
  await openSettings(page);
  const maple = page.locator(`${SETTINGS} label.appearance-choice`, { hasText: "Maple" });
  await expect(maple).toBeVisible();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await holdClock(page);

  await sendFinger(maple, { moves: [12], isCancelled: true });

  expect(await sendClick(maple)).toBe(false);
  await expect(maple.locator("input")).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test("a finger the browser takes for a scroll on a Diagnostics section's name never opens or closes it", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);
  const record = page.locator(`${SETTINGS} details.diagnostics-record`).first();
  await expect(record).toBeAttached();
  const isOpen = await record.evaluate(
    (details) => /** @type {HTMLDetailsElement} */ (details).open,
  );
  await holdClock(page);

  await sendFinger(record.locator("summary"), { moves: [12], isCancelled: true });

  expect(await sendClick(record.locator("summary"))).toBe(false);
  expect(await record.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open)).toBe(
    isOpen,
  );
});

test("a finger the browser takes for a scroll on a part of a row that takes no tap never opens the team the click lands on", async ({
  page,
}) => {
  const { row, button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(row, { moves: [12], isCancelled: true });

  expect(await sendClick(button)).toBe(false);
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a second finger the browser cancels while the first taps a team's row doesn't stop the tap", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [] });

  await sendSecondFinger(button, "pointercancel");

  expect(await sendClick(button)).toBe(true);
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("a still tap on a team's row in the standings opens the team, and Enter after a drag does too", async ({
  page,
}) => {
  const { row, button } = await openStandings(page);
  const sheet = page.locator("#teamSheet");

  await (
    await drag(page, await findMiddle(row), {})
  )();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await holdClock(page);

  await (
    await drag(page, await findMiddle(row), { y: -30 })
  )();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
});

test("a quick tap on a suggestion tints it before its search replaces the list", async ({
  page,
}) => {
  await openApp(page, { isWholeSeason: true });
  await page.locator("#tab-search").click();
  const input = page.locator("#gameSearch .search-input");
  await input.fill("Lib");
  const suggestion = page.locator("#gameSearch .search-suggestion", {
    hasText: "Liberty next game",
  });
  await expect(suggestion).toBeVisible();
  await notePresses(page);
  const searched = page.evaluate(
    () =>
      new Promise((done) => {
        const field = /** @type {HTMLInputElement} */ (
          document.querySelector("#gameSearch .search-input")
        );
        const watch = () =>
          field.value === "Liberty next game"
            ? done(performance.now())
            : requestAnimationFrame(watch);
        watch();
      }),
  );

  await suggestion.tap();
  const searchedAt = /** @type {number} */ (await searched);

  const [pressedAt] = await readPresses(page);
  expect(pressedAt).toBeLessThan(searchedAt);
  expect(searchedAt - pressedAt).toBeGreaterThanOrEqual(100);
});

test.describe("under a mouse", () => {
  test.use({ hasTouch: false, isMobile: false });

  test("a press tints a team's line in the bracket at once, and lets go on release", async ({
    page,
  }) => {
    await openApp(page);
    const line = page.locator('[data-series="1-0"] .team-line.won');
    await expect(line).toBeVisible();
    const pressed = await readBackground(line, "var(--pressed-row)");
    const middle = await findMiddle(line);
    await page.mouse.move(middle.x, middle.y);

    await page.mouse.down();

    await expect(line.locator(".team-open")).toHaveClass(/is-pressed/);
    expect(await readPressTint(line)).toBe(pressed);

    await page.mouse.up();

    await expect(line.locator(".team-open")).not.toHaveClass(/is-pressed/);
  });

  test("a press tints a team's row in the standings at once", async ({ page }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const row = page.locator("#standings-league tr:has(.team-open)").nth(2);
    await expect(row).toBeVisible();
    const pressed = await readBackground(row, "var(--pressed-row)");
    const middle = await findMiddle(row);
    await page.mouse.move(middle.x, middle.y);

    await page.mouse.down();

    await expect(row.locator(".team-open")).toHaveClass(/is-pressed/);
    expect(await readPressTint(row.locator("td").first())).toBe(pressed);
  });
});
