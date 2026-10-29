import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  EVENING_FIXTURE,
  BROADCASTS_FIXTURE,
  BOX_SCORES,
  openSettings,
} from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { openRanking } from "./settings-sheet.mjs";
import { checkEachView } from "../../../../tests/browser/view-walk.mjs";
import { ALIGNMENT_TOLERANCE, readTeamLines } from "../../../../tests/browser/team-lines.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const THEMES = /** @type {const} */ (["light", "dark"]);

/** @type {Record<string, string[]>} */
const EXPECTED_ROLES = {
  "the settings pages": ["small", "team"],
  "the page's tabs": ["label", "team"],
  "a game's sheets": ["label", "small", "team"],
  "a club's and a player's sheets": ["large", "small", "team"],
};

for (const width of [390, 1280]) {
  for (const colorScheme of THEMES) {
    for (const [group, allViews] of Object.entries(VIEW_GROUPS)) {
      if (!(group in EXPECTED_ROLES)) continue;
      const views =
        group === "the settings pages"
          ? allViews.filter((view) => view.name === "Ranking")
          : allViews;
      test(`team lines in ${group} align marks and attachments with their names at ${width}px in ${colorScheme}`, async ({
        page,
      }) => {
        test.slow();
        await page.setViewportSize({ width, height: 900 });
        await openWithEverything(page);
        await page.emulateMedia({ colorScheme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        const roles = new Set();
        const placements = new Set();
        const states = new Set();
        const attachments = new Set();
        const names = new Set();
        await checkEachView(page, views, async (view) => {
          const drawn = await readTeamLines(page, "mlb");
          expect(drawn.problems, view.name).toEqual([]);
          for (const role of drawn.roles) roles.add(role);
          for (const placement of drawn.placements) placements.add(placement);
          for (const state of drawn.states) states.add(state);
          for (const attachment of drawn.attachments) attachments.add(attachment);
          for (const name of drawn.names) names.add(name);
        });
        expect([...roles].sort()).toEqual(EXPECTED_ROLES[group]);
        if (group === "the settings pages") {
          expect(placements).toContain("small before");
        } else if (group === "the page's tabs") {
          expect(placements).toContain("team after");
          expect(states).toContain("winner");
          expect(states).toContain("TBD");
          expect(attachments).toEqual(new Set(["rank chip"]));
        } else if (group === "a game's sheets") {
          expect(placements).toContain("small after");
          expect(placements).toContain("team after");
        } else {
          expect([...names].some((name) => name.length > 14)).toBe(true);
          expect(attachments).toEqual(new Set(["rank chip"]));
        }
      });
    }
  }
}

for (const colorScheme of THEMES) {
  test(`All-Star artwork keeps its scale beside the real league names in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme });
    const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
    snapshot.slate.allStar = {
      id: "823443",
      date: snapshot.slate.today.date,
      away: "AL",
      home: "NL",
      state: "final",
      start: "2026-09-24T17:00:00Z",
      score: [4, 0],
      allStar: true,
    };
    await openApp(page, { snapshots: { 2026: snapshot } });
    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator(".all-star-mark")).toHaveCount(2);
    const drawn = await readTeamLines(page, "mlb");
    expect(drawn.problems).toEqual([]);
    expect(drawn.states).toContain("All-Star");
    expect(drawn.names).toEqual(expect.arrayContaining(["American League", "National League"]));
  });
}

for (const colorScheme of THEMES) {
  test(`compact Ranking keeps its Small names and league chips aligned in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await openSettings(page);
    await openRanking(page);
    await expect(page.locator("#rankingDialog .rank-id .league-tag").first()).toBeVisible();
    const drawn = await readTeamLines(page, "mlb");
    expect(drawn.problems).toEqual([]);
    expect(drawn.attachments).toContain("league chip");
  });
}

for (const colorScheme of THEMES) {
  test(`a long team name gives way before its dot in a narrow line in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const name = page
      .locator("#seasonGames .team-name")
      .filter({ hasText: "Diamondbacks" })
      .first();
    await expect(name).toBeVisible();
    const geometry = await name.evaluate((element, tolerance) => {
      const club = element.parentElement;
      club.style.maxWidth = "60px";
      const dot = club.querySelector(".dot").getBoundingClientRect();
      const text = element.getBoundingClientRect();
      const line = club.getBoundingClientRect();
      return {
        clipped: element.scrollWidth > element.clientWidth,
        fits: text.right <= line.right + tolerance,
        dot: dot.width,
        width: line.width,
      };
    }, ALIGNMENT_TOLERANCE);
    expect(geometry).toEqual({ clipped: true, fits: true, dot: 14, width: 60 });
    expect((await readTeamLines(page, "mlb")).problems).toEqual([]);
  });
}

for (const width of [390, 1280]) {
  for (const colorScheme of THEMES) {
    test(`club headings share their notes' baseline at ${width}px in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await openApp(page, {
        now: BROADCASTS_FIXTURE.now,
        snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
        boxScores: BOX_SCORES,
      });
      await page.getByRole("tab", { name: "Games", exact: true }).click();
      await page
        .locator("#seasonGames")
        .getByRole("button", { name: /^Game details: Rays at Yankees, Wed, Oct 7/ })
        .click();
      const lineup = page
        .locator("#gameSheet .sheet-part-head")
        .filter({ has: page.getByText("Lineup", { exact: true }) })
        .first();
      await expect(lineup).toBeVisible();
      const game = await readTeamLines(page, "mlb");
      expect(game.problems).toEqual([]);
      expect(game.states).toContain("baseline heading");
      await page
        .locator("#gameBody .game-row")
        .getByRole("button", { name: /^Yankees\b.*team details$/ })
        .click();
      await expect(page.locator("#teamSheet .field-heads")).toBeVisible();
      const team = await readTeamLines(page, "mlb");
      expect(team.problems).toEqual([]);
      expect(team.states).toContain("field comparison");
      expect(team.states).toContain("baseline series");
      expect(team.states).toContain("baseline heading");
      await page
        .locator("#teamSheet")
        .getByRole("button", { name: "Back to Game", exact: true })
        .click();
      await page
        .locator("#gameBody .game-row")
        .getByRole("button", { name: /^Rays\b.*team details$/ })
        .click();
      await expect(
        page.locator("#teamSheet .series-opp .tbd").filter({ hasText: "Bye" }),
      ).toBeVisible();
      expect((await readTeamLines(page, "mlb")).problems).toEqual([]);
    });
  }
}
