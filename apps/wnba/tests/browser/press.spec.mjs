import { test, expect, openApp } from "./harness.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { findSeasonPill, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

// A row that opens something tints while it's pressed, and a finger that drifts or that the
// browser takes for a scroll never taps a button or link, as on an iPhone (press.js).

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/**
 * The middle of what a locator shows.
 * @param {import("@playwright/test").Locator} locator
 */
async function findMiddle(locator) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await locator.boundingBox()
  );
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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

  const lift = await drag(page, await findMiddle(row), {});

  await expect(row.locator(".game-open")).toHaveClass(/is-pressed/);
  await expect(row).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

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

/**
 * Clicks a button or link, as iOS can after a finger left it, and says whether the click went
 * through.
 * @param {import("@playwright/test").Locator} target
 */
const sendClick = (target) =>
  target.evaluate((element) =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  );

/**
 * Sends a finger's pointer on a button or link as the browser does: down at its middle, each move
 * down the screen by `moves`, then up, or cancelled once the browser takes the touch for a scroll,
 * and the touch's end, a lift or, as iOS ends some, a cancel.
 * @param {import("@playwright/test").Locator} target
 * @param {{ moves: number[], isCancelled?: boolean, isTouchCancelled?: boolean }} finger
 */
const sendFinger = (target, { moves, isCancelled = false, isTouchCancelled = false }) =>
  target.evaluate(
    (element, finger) => {
      const box = element.getBoundingClientRect();
      /**
       * @param {string} type
       * @param {number} down
       */
      const send = (type, down) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "touch",
            isPrimary: true,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2 + down,
          }),
        );
      send("pointerdown", 0);
      for (const down of finger.moves) send("pointermove", down);
      send(finger.isCancelled ? "pointercancel" : "pointerup", finger.moves.at(-1) ?? 0);
      const end = finger.isTouchCancelled ? "touchcancel" : "touchend";
      element.dispatchEvent(new TouchEvent(end, { bubbles: true }));
    },
    { moves, isCancelled, isTouchCancelled },
  );

/**
 * Holds the page's clock still, so a click sent after a finger comes as soon after its lift as
 * iOS sends it, however slow the machine.
 * @param {import("@playwright/test").Page} page
 */
const holdClock = async (page) => page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} sheetId
 */
const isSheetOpen = (page, sheetId) =>
  page.evaluate(
    (id) => document.querySelector(`dialog[open] #${id}:not([hidden])`) !== null,
    sheetId,
  );

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
  expect(await isSheetOpen(page, "teamSheet")).toBe(false);
});

test("a finger the browser takes for a scroll before it drifts never opens the team", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [4], isCancelled: true });

  expect(await sendClick(button)).toBe(false);
});

test("a finger that drifts past 10px never opens a team, even one the click lands on beside it", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [6, 12] });

  const beside = page
    .locator('#standings-league tr[data-team]:not([data-team="LVA"]) .team-open')
    .first();
  expect(await sendClick(beside)).toBe(false);
  expect(await isSheetOpen(page, "teamSheet")).toBe(false);
});

test("a finger that drifts and that iOS ends with a cancel never opens the team", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);

  await sendFinger(button, { moves: [12], isCancelled: true, isTouchCancelled: true });

  expect(await sendClick(button)).toBe(false);
});

test("a second finger landing after the first drifted doesn't let the first one's click through", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12] });

  await button.evaluate((element) =>
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: false }),
    ),
  );

  expect(await sendClick(button)).toBe(false);
});

test("a still tap right after a finger drifted, like one on the pill's Bracket, works", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12] });
  const bracket = findSeasonPill(page).getByRole("tab", { name: "Bracket", exact: true });

  await sendFinger(bracket, { moves: [] });

  expect(await sendClick(bracket)).toBe(true);
  await expect(bracket).toHaveAttribute("aria-selected", "true");
});

test("a click a second after a finger drifted, like a screen reader's, still opens the team", async ({
  page,
}) => {
  const { button } = await openStandings(page);
  await holdClock(page);
  await sendFinger(button, { moves: [12] });

  await page.clock.runFor(1000);

  expect(await sendClick(button)).toBe(true);
  expect(await isSheetOpen(page, "teamSheet")).toBe(true);
});

test("a finger that drifts on a player's name in a roster never opens her", async ({ page }) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
  const name = page.locator("#rosterSection .player-open").first();
  await expect(name).toBeVisible();
  await holdClock(page);

  await sendFinger(name, { moves: [12] });

  expect(await sendClick(name)).toBe(false);
  expect(await isSheetOpen(page, "playerSheet")).toBe(false);
});

test("a finger that drifts on a story in the News never opens it", async ({ page }) => {
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
  await holdClock(page);

  await sendFinger(headline, { moves: [12] });

  expect(await sendClick(headline)).toBe(false);
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
    const middle = await findMiddle(line);
    await page.mouse.move(middle.x, middle.y);

    await page.mouse.down();

    await expect(line).not.toHaveCSS("box-shadow", "none");

    await page.mouse.up();

    await expect(line.locator(".team-open")).not.toHaveClass(/is-pressed/);
  });

  test("a press tints a team's row in the standings at once", async ({ page }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const row = page.locator("#standings-league tr:has(.team-open)").nth(2);
    await expect(row).toBeVisible();
    const middle = await findMiddle(row);
    await page.mouse.move(middle.x, middle.y);

    await page.mouse.down();

    await expect(row.locator("td").first()).not.toHaveCSS("box-shadow", "none");
  });
});
