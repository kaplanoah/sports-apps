import { test, expect, openApp } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { TABS_GROUP, checkEachView } from "../../../../tests/browser/view-walk.mjs";
import { ALIGNMENT_TOLERANCE, readTeamLines } from "../../../../tests/browser/team-lines.mjs";
import { TEAM_LINE_EXPECTATIONS } from "./team-line-expectations.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const THEMES = /** @type {const} */ (["light", "dark"]);

const SEASON_VIEWS = new Set(["Bracket", "Standings", "News"]);
const TAB_VIEWS = VIEW_GROUPS[TABS_GROUP];
const ALIGNMENT_VIEWS = {
  ...VIEW_GROUPS,
  Bracket: TAB_VIEWS.filter((view) => view.name === "Bracket"),
  Standings: TAB_VIEWS.filter((view) => view.name === "Standings"),
  News: TAB_VIEWS.filter((view) => view.name === "News"),
  "Games and Search": TAB_VIEWS.filter((view) => !SEASON_VIEWS.has(view.name)),
};

/** @type {Record<string, string[]>} */
const EXPECTED_ROLES = {
  Bracket: ["large"],
  Standings: ["team"],
  News: ["label"],
  "Games and Search": ["team"],
  "a team's and a player's sheets": ["large", "small", "team"],
  "a game's sheets": ["large", "team"],
};

for (const width of [390, 1280]) {
  for (const colorScheme of THEMES) {
    for (const [group, views] of Object.entries(ALIGNMENT_VIEWS)) {
      if (!(group in EXPECTED_ROLES)) continue;
      test(`team lines in ${group} align marks and attachments with their names at ${width}px in ${colorScheme}`, async ({
        page,
      }) => {
        test.slow();
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        if (group === "Bracket" || group === "Standings") await openApp(page);
        else {
          await openWithEverything(page);
          await page.emulateMedia({ colorScheme });
        }
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        const roles = new Set();
        const placements = new Set();
        const states = new Set();
        const attachments = new Set();
        const names = new Set();
        await checkEachView(page, views, async (view) => {
          const drawn = await readTeamLines(page, TEAM_LINE_EXPECTATIONS);
          expect(drawn.problems, view.name).toEqual([]);
          for (const role of drawn.roles) roles.add(role);
          for (const placement of drawn.placements) placements.add(placement);
          for (const state of drawn.states) states.add(state);
          for (const attachment of drawn.attachments) attachments.add(attachment);
          for (const name of drawn.names) names.add(name);
        });
        expect([...roles].sort()).toEqual(EXPECTED_ROLES[group]);
        if (group === "Bracket") {
          expect(states).toContain("winner");
          expect(states).toContain("TBD");
          expect(attachments).toEqual(new Set(["outside seed"]));
        } else if (group === "Standings") {
          expect(attachments).toEqual(new Set([".conference-tag", ".seed-note"]));
        } else if (group === "News") {
          expect(placements).toContain("label before");
          expect(attachments).toEqual(new Set());
        } else if (group === "Games and Search") {
          expect(placements).toContain("team after");
          expect(attachments).toEqual(new Set(["team seed before", "team seed after"]));
        } else if (group === "a game's sheets") {
          expect(placements).toContain("large after");
          expect(placements).toContain("team after");
          expect(attachments).toEqual(
            new Set([
              "large seed before",
              "large seed after",
              "team seed before",
              "team seed after",
            ]),
          );
        } else {
          expect([...names].some((name) => name.length > 14)).toBe(true);
          expect(attachments).toEqual(new Set([".conference-tag", ".seed-note"]));
        }
      });
    }
  }
}

for (const colorScheme of THEMES) {
  test(`All-Star artwork keeps its scale beside the real team names in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme });
    await openApp(page, { isWholeSeason: true });
    await page.getByRole("tab", { name: "Games" }).click();
    await page.locator('#seasonGames .day-cell[data-day="2026-07-25"]').click();
    await expect(page.locator(".all-star-mark")).toHaveCount(2);
    const drawn = await readTeamLines(page, TEAM_LINE_EXPECTATIONS);
    expect(drawn.problems).toEqual([]);
    expect(drawn.states).toContain("All-Star");
    expect(drawn.names).toEqual(expect.arrayContaining(["Spoon", "Coop"]));
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
    const name = page.locator("#seasonGames .team-name").filter({ hasText: "Valkyries" }).first();
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
    expect((await readTeamLines(page, TEAM_LINE_EXPECTATIONS)).problems).toEqual([]);
  });
}
