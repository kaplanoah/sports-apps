// How a text field shows its focus (controls.css): no ring once a tap focuses it, nor as keys move
// its cursor, and the app's focus ring around the box that looks like the field once the keyboard
// reaches it, in each of the phone's looks.

import { THEMES } from "./theme-layout.mjs";

/** @param {import("@playwright/test").Locator} box */
const readRing = (box) =>
  box.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.color = "var(--focus-ring)";
    document.body.append(probe);
    const ringColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      ringColor,
    };
  });

/**
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {{ field: import("@playwright/test").Locator, box: import("@playwright/test").Locator }} parts
 */
export async function checkFieldRing(page, expect, { field, box }) {
  for (const colorScheme of THEMES) {
    await page.emulateMedia({ colorScheme });
    await field.click();
    await expect(field).toBeFocused();
    expect((await readRing(box)).outline).toMatch(/^none /);
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "ArrowUp", "ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect(page.locator("body")).not.toHaveClass(/\bkbd\b/);
    expect((await readRing(box)).outline).toMatch(/^none /);

    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
    await expect(page.locator("body")).toHaveClass(/\bkbd\b/);
    const ring = await readRing(box);
    expect(ring.outline).toBe(`solid 2px ${ring.ringColor}`);
  }
}
