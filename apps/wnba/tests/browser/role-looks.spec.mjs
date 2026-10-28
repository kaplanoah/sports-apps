import {
  PUSH_STUB,
  stubPushManager,
  stubPushRegistration,
} from "../../../../tests/browser/push-stub.mjs";
import { test, expect, openApp, openLockedApp, MOVING_APP } from "./harness.mjs";
import { ON_A_PHONE } from "./search-page.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { checkEachView } from "../../../../tests/browser/view-walk.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { listRoleLooks } from "../../../../tests/browser/type-roles.mjs";
import { IPHONE } from "../../../../tests/browser/devices.mjs";
import { openOldHomeScreenApp } from "../../../../tests/browser/page-move.mjs";

test.use({
  contextOptions: { reducedMotion: "reduce" },
  viewport: { width: 390, height: 844 },
});

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
  subsetting: "Barlow",
  "setting-note": "Barlow",
  "notice-title": "Barlow",
  "notice-text": "Barlow",
};

// A second look a role keeps for some of its text, and which text and why.
const SECOND_LOOKS = {
  "score: Barlow": "the Games list's dates, set as a wall calendar's",
  "caption: Barlow Condensed": "a game row's seeds, set as the names beside them",
  "detail: Barlow Condensed": "a team's name on its game cards, and a player's averages",
  "stat: Barlow, capitals": "the bracket's seeds, set as the Seed beside them",
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
    name: "settings with notifications",
    open: async (page) => {
      await page.addInitScript(stubPushManager, PUSH_STUB);
      await page.addInitScript(stubPushRegistration);
      await openApp(page);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    },
    shown: (page) => page.locator("#reminderTiming"),
  },
  {
    name: "the gate",
    open: (page) => openLockedApp(page, { accessCode: "FASTBREAK" }),
    shown: (page) => page.getByRole("heading", { name: "Enter your access code" }),
  },
  {
    name: "the Home Screen welcome",
    device: ON_A_PHONE,
    open: (page) => openApp(page, { isShowingWelcome: true }),
    shown: (page) => page.getByRole("heading", { name: "Add WNBA to your home screen" }),
  },
  {
    name: "the bracket before the playoff field is set",
    open: async (page) => {
      const app = await openApp(page);
      await app.changeSeason((season) => ({ ...season, series: [] }));
      await openSeasonPart(page, "Bracket");
    },
    shown: (page) => page.getByRole("heading", { name: "No playoff field yet" }),
  },
  {
    name: "the Updates box, with finals and a release note",
    device: ON_A_PHONE,
    open: async (page) => {
      await page.route("**/js/release-notes.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: 'import { html } from "#shared/html.js";\nexport const RELEASE_NOTES = [{ at: "2026-09-30T20:55:00Z", text: html`Tap a game, then <b>Channels</b>.` }];',
        }),
      );
      return openApp(page, { updatesBox: "shown" });
    },
    shown: (page) => page.locator("#updates .updates-notes b"),
  },
  {
    name: "the card for the new site, in the Home Screen app at the old address",
    device: IPHONE,
    open: (page) => openOldHomeScreenApp({ page, ...MOVING_APP }),
    shown: (page) => page.locator("#updates .move-card-text"),
  },
];

test("each type role draws in one font and one case in every view, but for the second looks named", async ({
  page,
  browser,
}) => {
  // This traverses every view, then opens each remaining place in a separate context.
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
