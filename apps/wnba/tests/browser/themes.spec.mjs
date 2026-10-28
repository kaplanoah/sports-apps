import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithNews } from "./views.mjs";
import { testThemes } from "../../../../tests/browser/themes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

testThemes(test, expect, {
  openWithEverything: openWithNews,
  viewGroups: VIEW_GROUPS,
  chipLooks: {
    "the page's tabs": ["outlined"],
    "a team's and a player's sheets": ["filled", "outlined"],
    "a game's sheets": ["outlined"],
  },
  themeNames: { light: "Maple", dark: "Walnut" },
});
