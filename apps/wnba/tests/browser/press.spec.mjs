import { test, expect, openApp } from "./harness.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

// A row that opens something tints while it's pressed, as an iPhone's lists do (press.js).

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
 * Clicks a team's button in the standings, as iOS can after a finger left it, and says whether
 * the team's sheet opened.
 * @param {import("@playwright/test").Locator} button
 */
const clickAndReadSheetOpen = (button) =>
  button.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return document.querySelector("dialog[open] #teamSheet:not([hidden])") !== null;
  });

test("a finger that drags a team's row in the standings never opens the team, even when iOS still sends the tap", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const row = page.locator('#standings-league tr[data-team="LVA"]');
  await expect(row).toBeVisible();

  await (
    await drag(page, await findMiddle(row), { y: -30 })
  )();

  expect(await clickAndReadSheetOpen(row.locator(".team-open"))).toBe(false);
});

test("a still tap on a team's row in the standings opens the team, and Enter after a drag does too", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const row = page.locator('#standings-league tr[data-team="LVA"]');
  await expect(row).toBeVisible();
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
  await row.locator(".team-open").focus();
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
