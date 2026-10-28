import { AxeBuilder } from "@axe-core/playwright";
import { checkEachView } from "./view-walk.mjs";
import { THEMES, showTheme } from "./theme-layout.mjs";

/**
 * @typedef {{
 *   openWithEverything: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   viewGroups: Record<string, import("./view-walk.mjs").View[]>,
 *   themeNames: Record<(typeof THEMES)[number], string>,
 * }} App
 */

/** axe's rules the browser tests leave out, each with why. */
const RULES_LEFT_OUT = [
  // contrast.mjs already holds every shown text at rest to WCAG's AA contrast, from the colors
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
async function listAccessibilityProblems(page) {
  const { violations } = await new AxeBuilder({ page }).disableRules(RULES_LEFT_OUT).analyze();
  return violations.map((violation) => ({
    rule: violation.id,
    parts: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/**
 * Every view of the page, in each of its themes, passing axe's checks.
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {App} app
 */
export function testAccessibility(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  const { light, dark } = app.themeNames;

  for (const [group, views] of Object.entries(app.viewGroups)) {
    test(`${group} pass axe's checks for assistive tech, in ${light} and ${dark}`, async ({
      page,
    }) => {
      test.slow();
      await app.openWithEverything(page);
      await checkEachView(page, views, async (view) => {
        for (const theme of THEMES) {
          await showTheme(page, theme);
          expect(await listAccessibilityProblems(page), `${view.name} in ${theme}`).toEqual([]);
        }
        await showTheme(page, "light");
      });
    });
  }
}
