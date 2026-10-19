import { findSeasonPart } from "./season-scroll.mjs";

/**
 * Brings the page's tabs back into view as a person does, scrolling the season's part shown back
 * to its top, since on a wide screen the tabs ride away with the header as it scrolls.
 * @param {import("@playwright/test").Page} page
 */
export async function scrollTabsIntoView(page) {
  const isTabInView = await findSeasonTab(page).evaluate((tab) => {
    const box = tab.getBoundingClientRect();
    return box.bottom > 0 && box.top < innerHeight;
  });
  if (isTabInView) return;
  const shown = /** @type {import("#shared/bracket-standings.js").SeasonPart} */ (
    await findSeasonPill(page).locator('[aria-selected="true"]').getAttribute("data-tab")
  );
  await findSeasonPart(page, shown).evaluate((part) =>
    part.scrollTo({ top: 0, behavior: "instant" }),
  );
}

/**
 * Opens the tab of a season's standings and bracket on one of them, as a tap on the tab and then
 * on the part's name in its pill does.
 * @param {import("@playwright/test").Page} page
 * @param {"Standings" | "Bracket"} name
 */
export async function openSeasonPart(page, name) {
  await scrollTabsIntoView(page);
  await findSeasonTab(page).click();
  await findSeasonPill(page).getByRole("tab", { name, exact: true }).click();
}

/**
 * The tab of a season's standings and bracket in the tab bar, named for the one it opens on.
 * @param {import("@playwright/test").Page} page
 */
export const findSeasonTab = (page) => page.locator("#tab-bracket-standings");

/**
 * The pill over a season's standings and bracket.
 * @param {import("@playwright/test").Page} page
 */
export const findSeasonPill = (page) =>
  page.getByRole("tablist", { name: "Bracket and standings" });
