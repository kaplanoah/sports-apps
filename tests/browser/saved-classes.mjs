import { expect } from "@playwright/test";
import { holdRequests } from "./hold-requests.mjs";
import { setHidden } from "./visibility.mjs";

// A part the page draws whole is put back with the classes its code gave it, like a pager's held
// class, and none its markup gave it when it was saved, since a release may have changed those
// (shared/page/show-last-drawn.js). These tests save the season pill with classes from a layout
// that has changed and reload with the page's modules held, so only that putting back shows.

const PILL = "#bracketStandingsPill";

/**
 * Has the next load find the pill saved as `saved`, before the page's own code runs.
 * @param {import("@playwright/test").Page} page
 * @param {{ classes: string, markupClasses?: string }} saved
 */
const saveObsoletePill = (page, saved) =>
  page.addInitScript((pill) => {
    const drawn = JSON.parse(localStorage.getItem("lastDrawn") ?? "{}");
    drawn.bracketStandingsPill = {
      markup: "",
      hidden: false,
      scrolls: [],
      savedAt: Date.now(),
      ...pill,
    };
    localStorage.setItem("lastDrawn", JSON.stringify(drawn));
  }, saved);

/**
 * Loads the page again with its modules held and says which classes the pill shows from the copy.
 * @param {import("@playwright/test").Page} page
 */
async function reloadWithModulesHeld(page) {
  const release = await holdRequests(page, /\/js\/app\.js/);
  await page.reload({ waitUntil: "commit" });
  await page.waitForFunction(() => document.querySelector("#bracketStandingsPill"));
  const classes = await page.locator(PILL).evaluate((pill) => pill.className.split(" ").sort());
  release();
  return classes;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<unknown>} openPage
 */
export async function expectSavedClassesFitLayout(page, openPage) {
  await openPage();
  await saveObsoletePill(page, {
    classes: "pager-bar settings-obsolete held",
    markupClasses: "pager-bar settings-obsolete",
  });
  expect(await reloadWithModulesHeld(page)).toEqual(["held", "pager-bar"]);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<unknown>} openPage
 */
export async function expectLegacySavedClassesAreLeftOut(page, openPage) {
  await openPage();
  await saveObsoletePill(page, { classes: "pager-bar settings-obsolete held" });
  expect(await reloadWithModulesHeld(page)).toEqual(["pager-bar"]);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<unknown>} openPage
 */
export async function expectMarkupClassesSaved(page, openPage) {
  await openPage();
  await page.locator(PILL).evaluate((pill) => pill.classList.add("held"));
  await setHidden(page, true);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("lastDrawn") ?? "{}").bracketStandingsPill,
  );
  expect(saved).toMatchObject({ classes: "pager-bar held", markupClasses: "pager-bar" });
}
