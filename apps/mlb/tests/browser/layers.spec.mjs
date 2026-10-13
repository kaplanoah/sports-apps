import { test, expect, openApp, buildSnapshotWithStarters, ON_A_PHONE } from "./harness.mjs";
import { expectWithinBudgets } from "../../../../tests/browser/layer-count.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";

// Each layer a phone keeps takes its memory, and an iPhone short of it leaves parts undrawn. Each
// budget is the view's count in CI's Chromium once nothing asked for a layer ahead. A change that
// should add a layer re-records its view's budget from the count this test names, once the owner's
// phone has drawn it on beta.
// Search's round button beside the tab bar is a layer of its own on every view.
const BUDGETS = {
  Bracket: 22,
  Games: 16,
  Standings: 25,
  News: 9,
  Search: 10,
  "Game sheet": 19,
  "Club's sheet over a game's": 19,
};

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

test("each view, a game's sheet, and a club's sheet over it keep within their layer budgets", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  /** @param {string} name */
  const showTab = (name) => async () => {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  };

  await expectWithinBudgets(
    page,
    [
      ...["Bracket", "Standings", "News", "Search", "Games"].map((name) => ({
        view: name,
        show: showTab(name),
      })),
      {
        view: "Game sheet",
        show: async () => {
          await page
            .getByRole("button", { name: "Game details: Astros at Athletics, Thu, Sep 24" })
            .click();
          await expectShown(page.locator("#gameSheet"));
        },
      },
      {
        view: "Club's sheet over a game's",
        show: async () => {
          await page
            .locator("#gameSheet")
            .getByRole("button", { name: "Team details: Astros" })
            .first()
            .click();
          await expect(page.locator("#teamTitle")).toHaveText("Astros");
          await expectShown(page.locator("#teamSheet"));
        },
      },
    ],
    BUDGETS,
  );
});
