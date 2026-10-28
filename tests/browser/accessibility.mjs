import { AxeBuilder } from "@axe-core/playwright";

/** axe's rules the browser tests leave out, each with why. */
const RULES_LEFT_OUT = [
  // contrast.mjs already holds every shown text to WCAG's AA contrast, pressed too, from the colors
  // the page draws, where axe guesses at what sits behind text and gives up on much of it.
  "color-contrast",
];

/**
 * Each of axe's WCAG and best-practice failures on what the page shows, as its rule and the parts
 * it found, so a failure names what to fix.
 * @param {import("@playwright/test").Page} page
 */
export async function listAccessibilityProblems(page) {
  const { violations } = await new AxeBuilder({ page }).disableRules(RULES_LEFT_OUT).analyze();
  return violations.map((violation) => ({
    rule: violation.id,
    parts: violation.nodes.map((node) => node.target.join(" ")),
  }));
}
