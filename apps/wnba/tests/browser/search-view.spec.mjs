import { test, expect, matchPath } from "./harness.mjs";
import {
  ON_A_PHONE,
  findGamesLine,
  findInput,
  findLine,
  findSearch,
  openSeasonGames,
  readTopDay,
  sendSearch,
  tapSearch,
} from "./search-page.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { leavePagePixelDown } from "../../../../tests/browser/page-left-down.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { showTallUpdatesBox } from "../../../../tests/browser/updates-box.mjs";
import { setHidden } from "../../../../tests/browser/visibility.mjs";

// How Search comes and goes: starting over, closing, and coming back after a reload, on a phone.

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

/** @param {import("@playwright/test").Page} page */
async function leaveForTwoMinutes(page) {
  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
}

test("Cancel empties the search and goes back to the tab before it; another tab leaves the search as it was", async ({
  page,
}) => {
  await openSeasonGames(page);
  await openSeasonPart(page, "Standings");
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await page.getByRole("tab", { name: "Games" }).click();
  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("Liberty");

  await page.locator("#gameSearch .search-cancel").first().tap();

  await expect(page.locator("#view-games")).toBeVisible();
  await tapSearch(page);
  await expect(findInput(page)).toHaveValue("");
});

test("Search tapped again while it shows starts over: an empty field with its examples, ready to type", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await expect(findInput(page)).not.toBeFocused();

  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toBeFocused();
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
});

test("Search tapped again starts over at once, even with the page left a pixel from its top", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  expect(await leavePagePixelDown(page)).toBe(1);

  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("");
});

test("Search tapped again with the page scrolled under a tall Updates box takes the page back to its top, and only the next tap starts over", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await showTallUpdatesBox(page, 600);
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1);

  await tapSearch(page);

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(findInput(page)).toHaveValue("Liberty");

  await tapSearch(page);

  await expect(findInput(page)).toHaveValue("");
});

test("the field's clear button empties it and brings the examples back, ready to type", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await page.locator("#gameSearch .search-clear").tap();

  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toBeFocused();
  await expect(page.locator("#gameSearch .search-clear")).toBeHidden();
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
});

test("two minutes away closes the search and goes back to the tab before it, and less leaves it as it was", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await setHidden(page, true);
  await page.clock.runFor(60_000);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await expect(findInput(page)).toHaveValue("Liberty");

  await leaveForTwoMinutes(page);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await expect(page.locator("#view-games")).toBeVisible();
  await expect(findSearch(page)).toBeHidden();
});

test("a reload shows the search as it was before the page's code arrives, and the tab before it after two minutes away", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  await findGamesLine(page).tap();
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  let release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-10-04"]')).toBeInViewport();
  await leaveForTwoMinutes(page);
  release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#view-games")).toBeVisible();
  await expect(page.locator("#view-search")).toBeHidden();
  await expect(page.locator("#tabBar")).not.toHaveClass(/is-unselected/);
  release();
});

test("a search put back from an earlier release names its field as this one does", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await findInput(page).evaluate((input) => {
    input.setAttribute("placeholder", "Search games");
    input.setAttribute("aria-label", "Search games");
  });
  await setHidden(page, true);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await expect(findInput(page)).toHaveAttribute("placeholder", "Teams, players, and games");
  await expect(findInput(page)).toHaveAttribute("aria-label", "Teams, players, and games");
});
