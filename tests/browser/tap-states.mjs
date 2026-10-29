import { expect } from "@playwright/test";
import { QUICK_TAP_MS, TAPPABLE } from "../../shared/page/press.js";

/** @param {import("@playwright/test").Page} page */
const isAnyPressed = (page) => page.evaluate(() => !!document.querySelector(".is-pressed"));

/**
 * Lets go of the press a test's own tap still shows, which press.js lets go on the page's clock,
 * and waits until no row is pressed, so its tint, and the ease back that starts as it lets go, are
 * never taken for the page as it rests. A page showing no press keeps its clock where it is.
 * @param {import("@playwright/test").Page} page
 */
export async function letPressesGo(page) {
  if (await isAnyPressed(page)) await page.clock.runFor(QUICK_TAP_MS);
  await expect.poll(() => isAnyPressed(page)).toBe(false);
}

/**
 * The buttons and disclosures on the page that a phone would flash gray when tapped.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listTapFlashes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, summary")]
      .filter(
        (element) =>
          getComputedStyle(element).getPropertyValue("-webkit-tap-highlight-color") !==
          "rgba(0, 0, 0, 0)",
      )
      .map((element) => element.outerHTML.slice(0, 80)),
  );

/**
 * The page's :hover rules that a phone would also apply, and keep, after a tap: those outside a
 * `(hover: hover)` media rule.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listTouchHoverRules = (page) =>
  page.evaluate(() => {
    /** @param {CSSRuleList} rules @param {boolean} isHoverOnly @returns {string[]} */
    const findHoverRules = (rules, isHoverOnly) =>
      [...rules].flatMap((rule) => {
        if (rule instanceof CSSMediaRule)
          return findHoverRules(
            rule.cssRules,
            isHoverOnly || rule.conditionText.includes("(hover: hover)"),
          );
        const isTouchHover =
          rule instanceof CSSStyleRule && rule.selectorText.includes(":hover") && !isHoverOnly;
        return isTouchHover ? [rule.selectorText] : [];
      });
    return [...document.styleSheets].flatMap((sheet) => findHoverRules(sheet.cssRules, false));
  });

/**
 * The spots shown that look tappable, under a pointer, where a tap would land on no button, link,
 * or form control. An iPhone hands the page a tap only on one of those, whatever listens for it,
 * so a row that opens wherever it's tapped has its button reach over it (shared/row-button.css).
 * Each spot is the middle of an element under a pointer, and only what nothing covers counts.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listTapsOffButtons = (page) =>
  page.evaluate((tappable) => {
    /** @param {Element} element */
    const findMiddle = (element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const isShown = box.width > 0 && box.height > 0;
      return isShown && x > 0 && x < innerWidth && y > 0 && y < innerHeight ? { x, y } : null;
    };

    /** @param {Element} element */
    const describe = (element) =>
      element.outerHTML.slice(0, element.outerHTML.indexOf(">") + 1).slice(0, 120);

    const spots = new Set();
    for (const element of document.body.querySelectorAll("*")) {
      if (getComputedStyle(element).cursor !== "pointer" || element.closest(tappable)) continue;
      const middle = findMiddle(element);
      const landing = middle && document.elementFromPoint(middle.x, middle.y);
      if (landing && element.contains(landing) && !landing.closest(tappable))
        spots.add(describe(element));
    }
    return [...spots];
  }, TAPPABLE);
