import { test, expect, openApp, openGameSheet, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { openContact, serveContact } from "../../../../tests/browser/contact-views.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// What a sheet reads from the Worker beside the season, which a reload reads again.
const SHEET_READS = [
  "/box-score",
  "/preview",
  "/lead",
  "/roster",
  "/player",
  "/store/averages/",
  "/contact",
];

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function openTeamRoster(page, name) {
  await openSeasonPart(page, "Standings");
  await page
    .getByRole("button", { name: new RegExp(`^${name}\\b.*team details$`) })
    .first()
    .click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
  await expect(page.locator("#rosterSection .roster-coach")).toBeVisible();
}

// Each sheet, opened on what it reads from the Worker, and the read a reload starts again, if it
// reads any. A sheet the page holds joins this list, or the test that checks the list fails.
const SHEETS = [
  {
    id: "gameSheet",
    name: "a final's box score",
    read: "/box-score",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      const sheet = await openGameSheet(page, "Game details: Aces at Fever, First Round Game 2");
      await expect(sheet.locator(".line-score")).toBeVisible();
    },
  },
  {
    id: "gameSheet",
    name: "a preview's meetings",
    read: "/preview",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      const sheet = await openGameSheet(page, "Game details: Fever at Aces, First Round Game 3");
      await expect(sheet.locator(".meeting-score").first()).toBeVisible();
    },
  },
  {
    id: "teamSheet",
    name: "a team's roster sorted by points",
    read: "/roster",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await openTeamRoster(page, "Liberty");
      const points = page.locator("#rosterSection").getByRole("columnheader", { name: "Pts" });
      await points.getByRole("button").click();
      await expect(points).toHaveAttribute("aria-sort", "descending");
    },
  },
  {
    id: "playerSheet",
    name: "a player's numbers",
    read: "/player",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await openTeamRoster(page, "Liberty");
      await page.locator("#rosterSection").getByRole("button", { name: "Breanna Stewart" }).click();
      await expect(page.locator("#playerSheet .player-curve b")).toHaveCount(8);
    },
  },
  {
    id: "playerSheet",
    name: "why a player is out",
    read: "/player",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await openTeamRoster(page, "Liberty");
      await page
        .locator("#rosterSection")
        .getByRole("button", { name: "Elizabeth Balogun" })
        .click();
      await expect(page.locator("#playerSheet .out-sentence")).toBeVisible();
    },
  },
  {
    id: "contactDialog",
    name: "Contact's menu",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await serveContact(page);
      const dialog = await openContact(page);
      await expect(dialog.locator(".contact-domain")).toBeVisible();
    },
  },
];

/**
 * What the sheet shows, its sections each on its own line.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
const readSheetText = (page, id) =>
  page.locator(`#${id}`).evaluate((sheet) => /** @type {HTMLElement} */ (sheet).innerText);

test("every sheet is on the list of sheets a reload draws again", async ({ page }) => {
  await openApp(page);
  const ids = await page
    .locator(".sheet-page, .settings-panel:not(#settingsDialog)")
    .evaluateAll((sheets) => sheets.map((sheet) => sheet.id));
  expect(ids.toSorted()).toEqual([...new Set(SHEETS.map(({ id }) => id))].toSorted());
});

for (const { id, name, read, open } of SHEETS)
  test(`a reload draws ${name} as it was while its reads wait, never placeholders`, async ({
    page,
  }) => {
    await openApp(page);
    await open(page);
    const before = await readSheetText(page, id);
    const releases = await Promise.all(
      SHEET_READS.map((path) => holdRequests(page, matchPath(path))),
    );
    const reread = read && page.waitForRequest(matchPath(read));

    await page.reload();
    if (reread) await reread;
    else await expect(page.locator(`#${id}`)).toBeVisible();

    await expect(page.locator(`#${id} .placeholder`)).toHaveCount(0);
    expect(await readSheetText(page, id)).toBe(before);
    for (const release of releases) release();
  });
