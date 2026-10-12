import { test, expect, findGameButton, openApp } from "./harness.mjs";
import { expectWithinBudgets } from "../../../../tests/browser/layer-count.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";

// Each layer a phone keeps takes its memory, and an iPhone short of it leaves parts undrawn. Each
// budget is the view's count in CI's Chromium once nothing asked for a layer ahead. A change that
// should add a layer re-records its view's budget from the count this test names, once the owner's
// phone has drawn it on beta.
// Search's round button beside the tab bar is a layer of its own on every view.
const BUDGETS = {
  Bracket: 12,
  // The strip of days and the list of games each scroll on their own.
  Games: 14,
  Standings: 12,
  News: 9,
  Search: 13,
  "Team sheet, Team": 19,
  // The roster's numbers and names stay put as one table rather than two cells a player, each a
  // layer of its own.
  "Team sheet, Roster": 23,
  "Team sheet over the game's": 18,
};

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

test("each view, a team's sheet on each section, and a sheet over a sheet keep within their layer budgets", async ({
  page,
}) => {
  await openApp(page);
  const teamSheet = page.locator("#teamSheet");
  /** @param {string} name */
  const showTab = (name) => async () => {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  };
  /** @param {string} name */
  const showSection = (name) => async () => {
    await teamSheet.getByRole("tab", { name }).click();
    await expectShown(page.locator(`#${name.toLowerCase()}Section`));
  };

  await expectWithinBudgets(
    page,
    [
      ...["Bracket", "Games", "Standings", "News", "Search"].map((name) => ({
        view: name,
        show: showTab(name),
      })),
      {
        view: "Team sheet over the game's",
        show: async () => {
          await showTab("Games")();
          await (
            await findGameButton(page, "Game details: Aces at Fever, First Round Game 2")
          ).click();
          await expect(page.locator("#gameSheet .line-score")).toBeVisible();
          await page
            .locator("#gameSheet .faceoff")
            .getByRole("button", { name: "Team details: Indiana Fever" })
            .click();
          await expectShown(teamSheet);
        },
      },
      { view: "Team sheet, Roster", show: showSection("Roster") },
      { view: "Team sheet, Team", show: showSection("Team") },
    ],
    BUDGETS,
  );
});
