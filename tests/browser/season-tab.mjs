/**
 * Opens the tab of a season's standings and bracket on one of them, as a tap on the tab and then
 * on the part's name in its pill does.
 * @param {import("@playwright/test").Page} page
 * @param {"Standings" | "Bracket"} name
 */
export async function openSeasonPart(page, name) {
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
