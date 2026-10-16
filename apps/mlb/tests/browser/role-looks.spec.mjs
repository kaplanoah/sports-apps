import {
  test,
  expect,
  openApp,
  openLockedApp,
  buildFixtureSnapshot,
  keepFromEarlierVisit,
  EVENING_FIXTURE,
  ON_A_PHONE,
} from "./harness.mjs";
import { VIEW_GROUPS, checkEachView, openWithEverything } from "./views.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { listRoleLooks } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 390, height: 844 } });

// The one font and case each type role draws in.
const ROLE_LOOKS = {
  title: "Chivo Mono, capitals",
  headline: "Libre Franklin",
  heading: "Libre Franklin, capitals",
  "team-large": "Libre Franklin",
  team: "Libre Franklin",
  score: "Chivo Mono",
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

// The Mariners out, a day after this device last dismissed the Updates box.
const SEASON_WITH_A_CLUB_OUT = {
  year: 2026,
  teams: {},
  series: {},
  log: [
    {
      kind: "elim",
      team: "SEA",
      via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }],
      ended: "2026-09-24T00:55:00Z",
      at: "2026-09-25T00:40:00Z",
    },
  ],
};

/**
 * Each place the views don't reach, opened in a browser of its own, and what shows once it's
 * drawn.
 * @type {{
 *   name: string,
 *   device?: object,
 *   open: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   shown: (page: import("@playwright/test").Page) => import("@playwright/test").Locator,
 * }[]}
 */
const OTHER_PLACES = [
  {
    name: "the gate",
    open: (page) => openLockedApp(page, { accessCode: "FASTBREAK" }),
    shown: (page) => page.getByRole("heading", { name: "Enter your access code" }),
  },
  {
    name: "a bracket with a series under way",
    open: async (page) => {
      const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
      snapshot.series.AL_WC1.started = true;
      await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
      await openSeasonPart(page, "Bracket");
    },
    shown: (page) => page.locator("#bracketWrap .nscore", { hasText: "0" }).first(),
  },
  {
    name: "the bracket before the playoff field is set",
    open: async (page) => {
      await openApp(page, { liveAvailable: false });
      await openSeasonPart(page, "Bracket");
    },
    shown: (page) => page.getByRole("heading", { name: "No playoff field yet" }),
  },
  {
    name: "the Updates box, with a club out and a release note",
    device: ON_A_PHONE,
    open: async (page) => {
      await page.route("**/js/release-notes.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: 'import { html } from "#shared/html.js";\nexport const RELEASE_NOTES = [{ at: "2026-09-24T23:00:00Z", text: html`Tap a game, then <b>Matchup</b>.` }];',
        }),
      );
      await keepFromEarlierVisit(page, "updatesSeenAt", {
        2026: Date.parse("2026-09-24T20:00:00Z"),
      });
      return openApp(page, {
        liveAvailable: false,
        store: { "seasons/2026": SEASON_WITH_A_CLUB_OUT },
      });
    },
    shown: (page) => page.locator("#updates .updates-notes b"),
  },
];

test("each type role draws in one font and one case in every view, but for the second looks named", async ({
  page,
  browser,
}) => {
  test.slow();
  const looks = new Set();
  /** @param {import("@playwright/test").Page} shown */
  const addLooks = async (shown) => {
    for (const look of await listRoleLooks(shown)) looks.add(look);
  };
  await openWithEverything(page);
  await checkEachView(page, Object.values(VIEW_GROUPS).flat(), () => addLooks(page));
  for (const place of OTHER_PLACES) {
    const context = await browser.newContext({ reducedMotion: "reduce", ...place.device });
    const placePage = await context.newPage();
    await place.open(placePage);
    await expect(place.shown(placePage), place.name).toBeVisible();
    await addLooks(placePage);
    await context.close();
  }

  expect([...looks].sort()).toEqual(
    [
      ...Object.entries(ROLE_LOOKS).map(([role, look]) => `${role}: ${look}`),
      ...Object.keys(SECOND_LOOKS),
    ].sort(),
  );
});
