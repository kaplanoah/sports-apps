import { test, expect } from "./harness.mjs";
import { checkEachView, openWithNews } from "./views.mjs";
import { listRoleLooks } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 390, height: 844 } });

// The one font and case each type role draws in.
const ROLE_LOOKS = {
  title: "Barlow Condensed, capitals",
  headline: "Barlow",
  heading: "Barlow, capitals",
  "team-large": "Barlow Condensed",
  team: "Barlow Condensed",
  "team-compact": "Barlow Condensed",
  score: "Barlow Condensed",
  "stat-large": "Barlow Condensed",
  stat: "Barlow Condensed",
  body: "Barlow",
  detail: "Barlow",
  label: "Barlow, capitals",
  caption: "Barlow",
  setting: "Barlow",
  "setting-note": "Barlow",
};

// A second look a role keeps for some of its text, and which text and why.
const SECOND_LOOKS = {
  "score: Barlow": "the Games list's dates, set as a wall calendar's",
  "caption: Barlow Condensed": "a game row's seeds, set as the names beside them",
  "detail: Barlow Condensed": "a team's name on its game cards, and a player's averages",
  "stat: Barlow, capitals": "the bracket's seeds, set as the Seed beside them",
};

test("each type role draws in one font and one case in every view, but for the second looks named", async ({
  page,
}) => {
  await openWithNews(page);
  const looks = new Set();
  await checkEachView(page, async () => {
    for (const look of await listRoleLooks(page)) looks.add(look);
  });

  expect([...looks].sort()).toEqual(
    [
      ...Object.entries(ROLE_LOOKS).map(([role, look]) => `${role}: ${look}`),
      ...Object.keys(SECOND_LOOKS),
    ].sort(),
  );
});
