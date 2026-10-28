// How a test presses a control and reads the look its press takes (press.js and controls.css).

import { expect } from "@playwright/test";

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
export async function pressOn(page, locator) {
  const middle = await findMiddle(locator);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
}

/**
 * The color a background of `value` takes beside `locator`, under the same tokens.
 * @param {import("@playwright/test").Locator} locator
 * @param {string} value
 */
export const readBackground = (locator, value) =>
  locator.evaluate((element, value) => {
    const probe = document.createElement("span");
    probe.style.background = value;
    element.parentElement?.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, value);

/** The background a press gives a filled button, darkened with black (controls.css). */
export const PRESSED_FILLED_BACKGROUND = "color-mix(in srgb, var(--accent) 80%, #000)";

/** The background a press gives an outlined button, with some ink (controls.css). */
export const PRESSED_OUTLINED_BACKGROUND = "color-mix(in srgb, var(--ink) 10%, var(--raised))";

/**
 * An inset shadow in a computed `box-shadow`, its color first and its spread second, as text,
 * since a test hands the page text rather than a regular expression.
 */
export const INSET_SHADOW_PATTERN = String.raw`(\w+\([^)]*\)|transparent) 0px 0px 0px ([\d.]+)px inset`;

/**
 * The color of the first inset shadow with no offset or blur in an element's `box-shadow`, the tint
 * a press lays over a row, which is transparent at rest, or null where there is none.
 * @param {import("@playwright/test").Locator} locator
 */
export const readPressTint = (locator) =>
  locator.evaluate(
    (element, pattern) =>
      getComputedStyle(element).boxShadow.match(new RegExp(pattern))?.[1] ?? null,
    INSET_SHADOW_PATTERN,
  );

/**
 * On the access code's gate, a press darkens Open with black, as it does every filled button.
 * @param {import("@playwright/test").Page} page
 */
export async function checkGateOpenPress(page) {
  const open = page.getByRole("button", { name: "Open" });
  const pressed = await readBackground(open, PRESSED_FILLED_BACKGROUND);

  await pressOn(page, open);

  await expect(open).toHaveClass(/is-pressed/);
  await expect(open).toHaveCSS("background-color", pressed);
  await page.mouse.up();
}

/**
 * Marks every row's button pressed, as press.js marks the one a finger holds, so each row shows its
 * tint at once, or lets every one go again.
 * @param {import("@playwright/test").Page} page
 * @param {boolean} isPressed
 */
export const markEveryRowPressed = (page, isPressed) =>
  page.evaluate((isPressed) => {
    const BUTTON = "button, a[href], summary";
    const rows = [...document.querySelectorAll(".press-tint")].map((row) =>
      row.matches(BUTTON) ? row : row.querySelector(BUTTON),
    );
    const cells = document.querySelectorAll(".row-button-cell button");
    for (const button of [...rows, ...cells]) {
      button?.classList.toggle("is-pressed", isPressed);
      button?.classList.toggle("is-row-press", isPressed);
    }
  }, isPressed);
