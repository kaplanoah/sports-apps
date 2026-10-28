import { holdClock } from "./harness.mjs";
import { SETTINGS } from "./settings.mjs";
import { turnOnDiagnostics } from "./diagnostics-switch.mjs";

// How every control shows its press and its focus (press.js and controls.css), and how far a
// switch takes a tap, which every app's pages share.

/**
 * @typedef {{
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} App
 */

/** @param {import("@playwright/test").Locator} locator */
async function findMiddle(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Nothing shows to press");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Holds the mouse down on the middle of what a locator shows.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} locator
 */
async function pressOn(page, locator) {
  const middle = await findMiddle(locator);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
}

/**
 * The color a background of `value` takes beside `locator`, under the same tokens.
 * @param {import("@playwright/test").Locator} locator
 * @param {string} value
 */
const readBackground = (locator, value) =>
  locator.evaluate((element, value) => {
    const probe = document.createElement("span");
    probe.style.background = value;
    element.parentElement?.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, value);

/** @param {import("@playwright/test").Page} page */
const readFocusedOutline = (page) =>
  page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) throw new Error("Nothing has focus");
    const style = getComputedStyle(focused);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  });

/**
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {App} app
 */
export function testControlStates(test, expect, app) {
  test("a press fades the settings button at once, and its fade eases back as the press lets go", async ({
    page,
  }) => {
    await app.openApp(page);
    const button = page.getByRole("button", { name: "Settings", exact: true });
    await expect(button).toHaveCSS("transition-duration", "0.15s");

    await pressOn(page, button);

    await expect(button).toHaveClass(/is-pressed/);
    await expect(button).toHaveCSS("opacity", "0.3");
    await expect(button).toHaveCSS("transition-duration", "0s");
  });

  test("a press on settings' close shows before settings close", async ({ page }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const close = page.locator(`${SETTINGS} .sheet-close`);
    await holdClock(page);

    await close.click();

    await expect(close).toHaveCSS("opacity", "0.3");
    await expect(page.locator(SETTINGS)).toHaveAttribute("open");
    await page.clock.runFor(1000);
    await expect(page.locator(SETTINGS)).toBeHidden();
  });

  test("a press darkens a filled button with black", async ({ page }) => {
    await app.openApp(page);
    await turnOnDiagnostics(page);
    await app.openSettings(page);
    const report = page.locator("#diagnosticsReport");
    const pressed = await readBackground(report, "color-mix(in srgb, var(--accent) 80%, #000)");

    await pressOn(page, report);

    await expect(report).toHaveClass(/is-pressed/);
    await expect(report).toHaveCSS("opacity", "1");
    await expect(report).toHaveCSS("background-color", pressed);
  });

  test("a press tints a game's row with the pressed row's ink, past its sides", async ({
    page,
  }) => {
    await app.openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const row = page.locator("#seasonGames .game-day.is-today .game-row:has(> .game-open)").first();
    const pressed = await readBackground(row, "color-mix(in srgb, var(--ink) 12%, transparent)");

    await pressOn(page, row);

    await expect(row.locator(".game-open")).toHaveClass(/is-pressed/);
    await expect(row).toHaveCSS("background-color", pressed);
    await expect(row).toHaveCSS(
      "box-shadow",
      `${pressed} -12px 0px 0px 0px, ${pressed} 12px 0px 0px 0px`,
    );
    await expect(row.locator(".game-open")).toHaveCSS("opacity", "1");
  });

  test("a tap a little above or below a switch lands on it, though the switch looks the same", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const toggle = page.getByRole("switch", { name: "Diagnostics" });
    await toggle.scrollIntoViewIfNeeded();
    const reach = await toggle.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const lands = (/** @type {number} */ y) =>
        document.elementFromPoint(middle.x, y)?.closest('[role="switch"]') === element;
      return {
        height: box.height,
        above: lands(middle.y - 21),
        below: lands(middle.y + 21),
        pastAbove: lands(middle.y - 23),
        pastBelow: lands(middle.y + 23),
        fill: getComputedStyle(element, "::before").backgroundColor,
      };
    });

    expect(reach.height).toBeLessThan(44);
    expect(reach).toMatchObject({ above: true, below: true, pastAbove: false, pastBelow: false });
    expect(reach.fill).toBe("rgba(0, 0, 0, 0)");
  });

  test("a tap leaves no focus ring on what it focuses, nor on what focus goes back to", async ({
    page,
  }) => {
    await app.openApp(page);
    const button = page.getByRole("button", { name: "Settings", exact: true });

    await button.click();
    await page.getByRole("switch", { name: "Diagnostics" }).click();

    expect(await readFocusedOutline(page)).toMatch(/^none /);

    await page.keyboard.press("Escape");
    await expect(page.locator(SETTINGS)).toBeHidden();

    await expect(button).toBeFocused();
    expect(await readFocusedOutline(page)).toMatch(/^none /);
  });

  test("under the keyboard, the focused control shows its ring, and settings themselves never do", async ({
    page,
  }) => {
    await app.openApp(page);
    const button = page.getByRole("button", { name: "Settings", exact: true });
    await button.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("body")).toHaveClass(/\bkbd\b/);

    await expect(button).toBeFocused();
    expect(await readFocusedOutline(page)).toBe("solid 2px");

    await page.keyboard.press("Enter");
    await expect(page.locator(SETTINGS)).toBeVisible();
    await page.locator(SETTINGS).evaluate((dialog) => dialog.focus());

    expect(await readFocusedOutline(page)).toMatch(/^none /);
  });
}
