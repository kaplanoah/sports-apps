import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, checkEachView, openWithEverything } from "./views.mjs";
import { listRoleLooks } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 390, height: 844 } });

// The one font and case each type role draws in.
const ROLE_LOOKS = {
  title: "Chivo Mono, capitals",
  headline: "Libre Franklin",
  heading: "Libre Franklin, capitals",
  "team-large": "Libre Franklin",
  team: "Libre Franklin",
  "stat-large": "Chivo Mono",
  stat: "Chivo Mono",
  body: "Libre Franklin",
  detail: "Libre Franklin",
  label: "Libre Franklin, capitals",
  caption: "Libre Franklin",
  setting: "Libre Franklin",
  "setting-note": "Libre Franklin",
};

// A second look a role keeps for some of its text, and which text and why.
const SECOND_LOOKS = {
  "body: Chivo Mono": "a game's start, and Postponed or Time TBD in its place",
  "detail: Chivo Mono": "numbers, and the letters set among them, like a game card's W or L",
  "label: Chivo Mono, capitals": "numbers",
  "caption: Chivo Mono": "numbers, and the letters set among them, like a starter's arm",
};

test("each type role draws in one font and one case in every view, but for the second looks named", async ({
  page,
}) => {
  test.slow();
  await openWithEverything(page);
  const looks = new Set();
  await checkEachView(page, Object.values(VIEW_GROUPS).flat(), async () => {
    for (const look of await listRoleLooks(page)) looks.add(look);
  });

  expect([...looks].sort()).toEqual(
    [
      ...Object.entries(ROLE_LOOKS).map(([role, look]) => `${role}: ${look}`),
      ...Object.keys(SECOND_LOOKS),
    ].sort(),
  );
});
