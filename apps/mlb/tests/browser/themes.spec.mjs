import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testThemes } from "../../../../tests/browser/themes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

testThemes(test, expect, {
  openWithEverything,
  viewGroups: VIEW_GROUPS,
  chipLooks: {
    "the page's tabs": ["filled", "outlined"],
    "a game's sheets": [],
    "a club's and a player's sheets": ["filled", "outlined"],
  },
  themeNames: { light: "Ball", dark: "Night Game" },
});
