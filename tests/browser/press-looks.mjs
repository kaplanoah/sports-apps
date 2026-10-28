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

/**
 * The tint a press lays over a row, the color of the inset shadow that fills it, or null where
 * nothing fills it.
 * @param {import("@playwright/test").Locator} locator
 */
export const readPressTint = (locator) =>
  locator.evaluate(
    (element) =>
      getComputedStyle(element).boxShadow.match(
        /(\w+\([^)]*\)|transparent) 0px 0px 0px [\d.]+px inset/,
      )?.[1] ?? null,
  );

/**
 * On the access code's gate, a press darkens Open with black, as it does every filled button.
 * @param {import("@playwright/test").Page} page
 */
export async function checkGateOpenPress(page) {
  const open = page.getByRole("button", { name: "Open" });
  const pressed = await readBackground(open, "color-mix(in srgb, var(--accent) 80%, #000)");

  await pressOn(page, open);

  await expect(open).toHaveClass(/is-pressed/);
  await expect(open).toHaveCSS("background-color", pressed);
  await page.mouse.up();
}
