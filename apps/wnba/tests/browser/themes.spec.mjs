import { test, expect, THEME_NAMES } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testThemes } from "../../../../tests/browser/themes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

testThemes(test, expect, {
  openWithEverything,
  viewGroups: VIEW_GROUPS,
  chipLooks: {
    "the page's tabs": ["outlined"],
    "a team's and a player's sheets": ["filled", "outlined"],
    "a game's sheets": ["outlined"],
  },
  themeNames: THEME_NAMES,
});
