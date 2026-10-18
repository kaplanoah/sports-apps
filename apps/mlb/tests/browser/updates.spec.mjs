import {
  test,
  expect,
  openApp,
  openBracket,
  buildFixtureSnapshot,
  EVENING_FIXTURE,
  keepUpdatesFromEarlierVisit,
  ON_A_PHONE,
  readKept,
} from "./harness.mjs";
import { createReading } from "../../worker/src/readings.js";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("a computer shows no Updates box, since each device keeps its own dismissal", async ({
  page,
}) => {
  await openBracket(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        year: 2026,
        teams: {},
        series: {},
        log: [{ kind: "lock", at: "2026-09-24T20:00:00Z" }],
      },
    },
  });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await expect(page.locator("#updates")).toBeHidden();
});

const SEASON_WITH_TWO_UPDATES = {
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
    { kind: "lock", at: "2026-09-25T00:30:00Z" },
  ],
};

/** @param {import("@playwright/test").Page} page */
const serveReleaseNote = (page) =>
  page.route("**/js/release-notes.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export const RELEASE_NOTES = [{ at: "2026-09-24T23:00:00Z", text: "Something new." }];',
    }),
  );

test.describe("on a new phone", () => {
  test.use(ON_A_PHONE);

  test("shows no Updates box for the updates and notes already out, and opens it for the next update", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    const app = await openApp(page, {
      liveAvailable: false,
      store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
    });
    const updates = page.locator("#updates");
    await expect(page.locator("#standingsWrap")).toBeVisible();
    await expect(updates).toBeHidden();

    await app.writeFromWorker("seasons/2026", {
      ...SEASON_WITH_TWO_UPDATES,
      log: [
        ...SEASON_WITH_TWO_UPDATES.log,
        {
          kind: "elim",
          team: "HOU",
          via: [{ team: "HOU", won: false, opp: "LAA", score: [2, 5] }],
          at: "2026-09-25T01:30:00Z",
        },
      ],
    });

    await expect(updates.locator(".what")).toHaveCount(1);
    await expect(updates.locator(".what")).toContainText("Astros");
  });
});

test.describe("on a phone that has used the app before", () => {
  test.use(ON_A_PHONE);
  test.beforeEach(({ page }) => keepUpdatesFromEarlierVisit(page));

  test("rebuilds updates from the saved readings as the Worker adds to them, each club in its line's font at 500", async ({
    page,
  }) => {
    const currentSnapshot = buildFixtureSnapshot(EVENING_FIXTURE);
    const earlier = createReading({ ...currentSnapshot, asOf: "2026-09-24T20:00:00Z" });
    [earlier.teams.NYY, earlier.teams.BOS] = [
      { ...earlier.teams.NYY, seed: earlier.teams.BOS.seed },
      { ...earlier.teams.BOS, seed: earlier.teams.NYY.seed },
    ];
    const part = `${currentSnapshot.slate.today.date}-01`;
    const app = await openApp(page, {
      store: {
        "seasons/2026": {
          year: 2026,
          teams: currentSnapshot.teams,
          series: currentSnapshot.series,
          projected: true,
          log: [],
        },
        [`readings-2026/${part}`]: {
          id: part,
          day: currentSnapshot.slate.today.date,
          number: 1,
          start: earlier,
          changes: [],
        },
      },
    });

    const updates = page.locator("#updates");
    await expect.poll(() => app.countOpenSockets()).toBe(1);
    await expect(updates).toBeHidden();
    await app.updateFromWorker();
    await expect(updates).toContainText(/Yankees passed the .*Red Sox for the AL 4 seed/);

    app.changeSnapshots((snapshot) => {
      const { PHI, ...teams } = snapshot.teams;
      return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
    });
    await app.updateFromWorker();

    await expect(updates).toContainText(/Mets .*Phillies/);
    expect((await app.readDocument(`readings-2026/${part}`)).changes).toHaveLength(2);
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    const body = await readRole(page, "body");
    const what = updates.locator(".what").first();
    await expect(what).toHaveCSS("font-size", `${body.size}px`);
    await expect(what).toHaveCSS("font-weight", String(body.weight - 50));
    const team = what.locator("b").first();
    await expect(team).toHaveCSS(
      "font-family",
      await what.evaluate((element) => getComputedStyle(element).fontFamily),
    );
    await expect(team).toHaveCSS("font-weight", String(body.weight + 100));
  });

  test("a release note shows in the Updates box, headed New in the app, until it's dismissed", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    await openApp(page);
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText("New in the app");
    await expect(updates.locator(".what")).toHaveText("Something new.");

    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await expect(updates).toBeHidden();
    expect(await readKept(page, "updatesSeenAt")).toEqual({
      2026: Date.parse("2026-09-24T20:00:00Z"),
    });
    const [shownUntil] = Object.values(await readKept(page, "releaseNotesShownUntil"));
    expect(shownUntil).toBeLessThanOrEqual(await page.evaluate(() => Date.now()));
    await page.reload();
    await expect(page.locator("#standingsWrap")).toBeVisible();
    await expect(updates).toBeHidden();
  });

  test("the update list leaves 18px below it", async ({ page }) => {
    await openApp(page, {
      liveAvailable: false,
      store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
    });

    await expect(page.locator("#updates")).toHaveCSS("margin-bottom", "18px");
  });

  test("dismissing updates goes by the newest one's time, not this device's clock", async ({
    page,
  }) => {
    await openApp(page, {
      liveAvailable: false,
      now: "2026-09-25T03:00:00Z",
      store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
    });

    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await expect(page.locator("#updates")).toBeHidden();
    expect(await readKept(page, "updatesSeenAt")).toEqual({
      2026: Date.parse("2026-09-25T00:40:00Z"),
    });
  });

  test("dismissing updates in another tab hides them in this one", async ({ page }) => {
    await openApp(page, {
      liveAvailable: false,
      store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
    });
    await expect(page.locator("#updates .when")).toHaveCount(2);

    await keepInOtherTab(page, "updatesSeenAt", { 2026: Date.parse("2026-09-25T00:40:00Z") });

    await expect(page.locator("#updates")).toBeHidden();
  });

  test("dismissing the release notes in another tab hides them in this one", async ({ page }) => {
    await serveReleaseNote(page);
    await openApp(page);
    await expect(page.locator("#updates .what")).toHaveText("Something new.");

    await keepInOtherTab(page, "releaseNotesShownUntil", {
      "2026-09-24T23:00:00Z": Date.parse("2026-09-25T00:00:00Z"),
    });

    await expect(page.locator("#updates")).toBeHidden();
  });
});
