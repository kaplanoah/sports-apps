import { test, expect, THEME_NAMES } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testThemes } from "../../../../tests/browser/themes.mjs";
import { TABS_GROUP } from "../../../../tests/browser/view-walk.mjs";

testThemes(test, expect, {
  openWithEverything,
  viewGroups: VIEW_GROUPS,
  chipLooks: {
    "the settings pages": [],
    [TABS_GROUP]: ["outlined"],
    "a team's and a player's sheets": ["filled", "outlined"],
    "a game's sheets": ["outlined"],
  },
  themeNames: THEME_NAMES,
});
