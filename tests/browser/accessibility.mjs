import { AxeBuilder } from "@axe-core/playwright";

/** axe's rules the browser tests leave out, each with why. */
const RULES_LEFT_OUT = [
  // contrast.mjs already holds every shown text to WCAG's AA contrast, pressed too, from the colors
  // the page draws, where axe guesses at what sits behind text and gives up on much of it.
  "color-contrast",
  // Buttons whose names put their context before their visible words, until #907 leads
  // each name with them.
  "label-content-name-mismatch",
  // The views sit outside a main landmark, and the Search tab outside its tablist, until
  // #907 puts them in theirs.
  "region",
  "landmark-one-main",
  "aria-required-parent",
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
