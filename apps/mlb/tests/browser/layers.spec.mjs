import { test, expect, openApp, buildSnapshotWithStarters, ON_A_PHONE } from "./harness.mjs";
import { expectWithinBudgets } from "../../../../tests/browser/layer-count.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

// Each layer a phone keeps takes its memory, and an iPhone short of it leaves parts undrawn. Each
// budget is the view's count in CI's Chromium once nothing asked for a layer ahead. A change that
// should add a layer re-records its view's budget from the count this test names, once the owner's
// phone has drawn it on beta.
// Search's round button beside the tab bar is a layer of its own on every view, and the pill over
// the bracket and standings one on each of theirs.
const BUDGETS = {
  Bracket: 23,
  Games: 17,
  Standings: 26,
  News: 9,
  Search: 12,
  "Game sheet": 20,
  "Club's sheet over a game's": 20,
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
      .../** @type {const} */ (["Bracket", "Standings"]).map((name) => ({
        view: name,
        show: () => openSeasonPart(page, name),
      })),
      ...["News", "Search", "Games"].map((name) => ({ view: name, show: showTab(name) })),
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
          await expect(page.locator("#teamTitle")).toHaveText("Houston Astros");
          await expectShown(page.locator("#teamSheet"));
        },
      },
    ],
    BUDGETS,
  );
});
