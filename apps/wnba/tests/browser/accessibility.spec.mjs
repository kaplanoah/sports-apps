import { test, expect, THEME_NAMES } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testAccessibility } from "../../../../tests/browser/accessibility.mjs";

testAccessibility(test, expect, {
  openWithEverything,
  viewGroups: VIEW_GROUPS,
  themeNames: THEME_NAMES,
});
