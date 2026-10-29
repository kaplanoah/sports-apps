import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  EVENING_FIXTURE,
  openSettings,
} from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { checkEachView } from "../../../../tests/browser/view-walk.mjs";
import { readTeamLines } from "../../../../tests/browser/team-lines.mjs";
import { TEAM_LINE_EXPECTATIONS } from "./team-line-expectations.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const THEMES = /** @type {const} */ (["light", "dark"]);

for (const width of [390, 1280]) {
  for (const colorScheme of THEMES) {
    test(`team lines use the approved font centers and attachments at ${width}px in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
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
      await checkEachView(page, Object.values(VIEW_GROUPS).flat(), async (view) => {
        const drawn = await readTeamLines(page, TEAM_LINE_EXPECTATIONS);
        expect(drawn.problems, view.name).toEqual([]);
        for (const role of drawn.roles) roles.add(role);
        for (const placement of drawn.placements) placements.add(placement);
        for (const state of drawn.states) states.add(state);
        for (const attachment of drawn.attachments) attachments.add(attachment);
        for (const name of drawn.names) names.add(name);
        if (process.env.ALIGNMENT_SCREENSHOTS)
          await page.screenshot({
            path: testInfo.outputPath(`${view.name.replaceAll(/[^a-z0-9]/gi, "-")}.png`),
          });
      });
      expect([...roles].sort()).toEqual(["label", "large", "small", "team"]);
      expect(placements).toContain("team after");
      expect(states).toContain("winner");
      expect(states).toContain("TBD");
      expect([...names].some((name) => name.length > 14)).toBe(true);
      expect(placements).toContain("small after");
      expect(attachments).toContain("rank chip");
    });
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
    const drawn = await readTeamLines(page, TEAM_LINE_EXPECTATIONS);
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
    await page
      .locator(".settings-main")
      .evaluate((element) => (element.scrollTop = element.scrollHeight));
    const drawn = await readTeamLines(page, TEAM_LINE_EXPECTATIONS);
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
    const geometry = await name.evaluate((element) => {
      const club = element.parentElement;
      club.style.maxWidth = "60px";
      const dot = club.querySelector(".dot").getBoundingClientRect();
      const text = element.getBoundingClientRect();
      const line = club.getBoundingClientRect();
      return {
        clipped: element.scrollWidth > element.clientWidth,
        fits: text.right <= line.right + 0.08,
        dot: dot.width,
        width: line.width,
      };
    });
    expect(geometry).toEqual({ clipped: true, fits: true, dot: 14, width: 60 });
    expect((await readTeamLines(page, TEAM_LINE_EXPECTATIONS)).problems).toEqual([]);
  });
}
