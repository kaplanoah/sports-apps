import { expect } from "@playwright/test";

// What a phone can hold when the page loads again: the copy of the page it saved as it left, the
// season it drew that from, either one alone, or neither, and a copy older than two minutes, after
// which the Games list opens on today. The store's first answer is the season's record, which
// lists fewer days than its whole schedule, so a reload without the season it saved keeps only a
// day the record lists and opens on today otherwise. Whatever it holds, the list ends on the day it
// showed or on today once the store has answered with the whole season.

/** @typedef {"today" | "shown"} OpenDay */

/**
 * Each state, and where the list opens for a day the season's record lists and for one before.
 * @type {{ name: string, opensOn: { recordDay: OpenDay, earlierDay: OpenDay } }[]}
 */
export const RELOAD_STATES = [
  { name: "nothing saved", opensOn: { recordDay: "today", earlierDay: "today" } },
  {
    name: "the copy and season it saved as it left",
    opensOn: { recordDay: "shown", earlierDay: "shown" },
  },
  {
    name: "a copy saved more than two minutes ago",
    opensOn: { recordDay: "today", earlierDay: "today" },
  },
  { name: "the copy without its season", opensOn: { recordDay: "shown", earlierDay: "today" } },
  { name: "the season without the copy", opensOn: { recordDay: "today", earlierDay: "today" } },
  {
    name: "a season without its whole schedule",
    opensOn: { recordDay: "shown", earlierDay: "today" },
  },
  {
    name: "a season in a version the page doesn't read",
    opensOn: { recordDay: "shown", earlierDay: "today" },
  },
];

/**
 * Changes what the page saved as it left into `state`, before the next load's code runs.
 * @param {string} state
 */
function changeSavedState(state) {
  /** @param {string} key */
  const read = (key) => JSON.parse(localStorage.getItem(key) ?? "null");
  /** @param {string} key @param {unknown} value */
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const seen = read("lastSeen");
  const drawn = read("lastDrawn");
  if (state === "nothing saved") {
    for (const key of ["lastSeen", "lastDrawn", "openSheets", "lastSwitched"])
      localStorage.removeItem(key);
  } else if (state === "a copy saved more than two minutes ago") {
    for (const part of Object.values(drawn)) part.savedAt -= 3 * 60_000;
    write("lastDrawn", drawn);
  } else if (state === "the copy without its season") {
    localStorage.removeItem("lastSeen");
  } else if (state === "the season without the copy") {
    localStorage.removeItem("lastDrawn");
  } else if (state === "a season without its whole schedule") {
    delete seen.schedule;
    write("lastSeen", seen);
  } else if (state === "a season in a version the page doesn't read") {
    seen.season.version = -1;
    write("lastSeen", seen);
  }
}

/**
 * Leaves the Games list on `shownDay` and loads the page again from `state`, then checks the
 * list ends on the day it should once the whole season has arrived.
 * @param {import("@playwright/test").Page} page
 * @param {{ state: string, opensOn: OpenDay, today: string, shownDay: string }} options
 */
export async function expectReloadOpensOn(page, { state, opensOn, today, shownDay }) {
  const chosen = page.locator("#seasonGames .day-cell.is-chosen");
  await expectWholeSeason(page);
  await expect(chosen).toHaveAttribute("data-day", today);
  await page.locator(`#seasonGames .day-cell[data-day="${shownDay}"]`).click();
  await expect(page.locator(`#seasonGames .listed-day[data-day="${shownDay}"]`)).toBeInViewport();
  await page.addInitScript(changeSavedState, state);

  await page.reload();

  const day = opensOn === "today" ? today : shownDay;
  await expectWholeSeason(page);
  await expect(chosen).toHaveAttribute("data-day", day);
  await expect(page.locator(`#seasonGames .listed-day[data-day="${day}"]`)).toBeInViewport();
}

/**
 * Waits for the store's whole season, whose first game is in the spring, rather than its record.
 * @param {import("@playwright/test").Page} page
 */
const expectWholeSeason = (page) =>
  expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^\d{4}-0[3-5]-/,
  );
