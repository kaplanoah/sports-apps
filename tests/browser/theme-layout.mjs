import { expect } from "@playwright/test";
import { countTimedAnimations } from "./animations.mjs";
import { waitForPressesToEnd } from "./tap-states.mjs";

// The parts a theme may lift a pixel or two, where its colors look off center otherwise.
const PLACED_BY_EYE = ".nscore";

/**
 * Where every shown element sits, keyed by its tag, its classes, and its path of child indexes
 * from the body, rounded to the half pixel, once no row is pressed, since a pressed row's class
 * would name its button differently from one read to the next. A theme changes only colors, so two
 * themes' layouts of the same view are the same.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, string>>}
 */
export async function readLayout(page) {
  await waitForPressesToEnd(page);
  return page.evaluate((placedByEye) => {
    /** @param {number} value */
    const round = (value) => Math.round(value * 2) / 2;
    /** @param {Element} element */
    const readPath = (element) => {
      const path = [];
      for (
        let node = element;
        node !== document.body;
        node = /** @type {Element} */ (node.parentElement)
      )
        path.unshift([.../** @type {Element} */ (node.parentElement).children].indexOf(node));
      return path.join(".");
    };
    /** @type {Record<string, string>} */
    const layout = {};
    for (const element of document.body.querySelectorAll("*")) {
      if (!element.checkVisibility() || element.matches(placedByEye)) continue;
      const box = element.getBoundingClientRect();
      const name = `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""} ${readPath(element)}`;
      layout[name] = [box.x, box.y, box.width, box.height].map(round).join(" ");
    }
    return layout;
  }, PLACED_BY_EYE);
}

/**
 * The elements whose place or size differs between two layouts, each with both.
 * @param {Record<string, string>} first
 * @param {Record<string, string>} second
 */
export const listLayoutChanges = (first, second) =>
  [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .filter((name) => first[name] !== second[name])
    .map((name) => `${name}: ${first[name] ?? "hidden"} -> ${second[name] ?? "hidden"}`);

/**
 * Shows the app's light or dark theme, as the phone's setting picks it, once any color it eases
 * into has arrived.
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
export async function showTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // A link that eases its color on hover eases it into the new theme's too.
  await expect.poll(() => countTimedAnimations(page)).toBe(0);
}

/**
 * The elements whose place or size differs between the app's light and dark themes, which change
 * only colors, read with the page in each and left in the light one.
 * @param {import("@playwright/test").Page} page
 */
export async function listThemeLayoutChanges(page) {
  await showTheme(page, "light");
  const light = await readLayout(page);
  await showTheme(page, "dark");
  const dark = await readLayout(page);
  await showTheme(page, "light");
  return listLayoutChanges(light, dark);
}
