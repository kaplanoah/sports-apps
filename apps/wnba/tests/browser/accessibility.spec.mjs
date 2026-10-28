import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { listAccessibilityProblems } from "../../../../tests/browser/accessibility.mjs";
import { checkEachView } from "../../../../tests/browser/view-walk.mjs";
import { showTheme } from "../../../../tests/browser/theme-layout.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.slow();

for (const [group, views] of Object.entries(VIEW_GROUPS)) {
  test(`${group} pass axe's checks for assistive tech, in Maple and Walnut`, async ({ page }) => {
    await openWithEverything(page);
    await checkEachView(page, views, async (view) => {
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        await showTheme(page, theme);
        expect(await listAccessibilityProblems(page), `${view.name} in ${theme}`).toEqual([]);
      }
      await showTheme(page, "light");
    });
  });
}
