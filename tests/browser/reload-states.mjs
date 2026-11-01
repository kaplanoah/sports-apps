import { expect } from "@playwright/test";
import { UPDATING_WAIT_MS } from "../../shared/page/catch-up-note.js";
import { matchPath } from "./harness.mjs";

// What a phone can hold when the page loads again: the copy of the page it saved as it left, the
// season it drew that from, either one alone, or neither, and a copy older than two minutes, after
// which the Games list opens on today. A page showing the copy draws once the store has handed
// over all it holds, the whole schedule with the season's record, so it keeps any day it showed,
// and keeps the copy while the record alone lacks that day and the schedule is on its way. A
// page that draws the season it saved without its whole schedule, from the record, which lists
// fewer days, keeps only a day the record lists and opens on today otherwise. Whatever it holds,
// the list ends on the day it showed or on today once the store has answered with the whole season.

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
  { name: "the copy without its season", opensOn: { recordDay: "shown", earlierDay: "shown" } },
  { name: "the season without the copy", opensOn: { recordDay: "today", earlierDay: "today" } },
  {
    name: "a season without its whole schedule",
    opensOn: { recordDay: "shown", earlierDay: "today" },
  },
  {
    name: "a season in a version the page doesn't read",
    opensOn: { recordDay: "shown", earlierDay: "shown" },
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
  await leaveListOn(page, { today, shownDay });
  await page.addInitScript(changeSavedState, state);

  await page.reload();

  await expectListOn(page, opensOn === "today" ? today : shownDay);
}

/**
 * Leaves the Games list on `shownDay`, a day before any the season's record lists, and loads the
 * page again from the copy without its season, with the record answering only once the store has
 * stopped holding what it sends, then checks the list ends on that day once the whole season has
 * arrived. The page asks for the schedule only after the record, so the record alone fills the list
 * first, as on a slow network.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string }} options
 */
export async function expectLateRecordKeepsShownDay(page, { today, shownDay }) {
  await leaveListOn(page, { today, shownDay });
  await page.addInitScript(changeSavedState, "the copy without its season");
  const record = matchPath(`/store/seasons/${today.slice(0, 4)}`);
  /** @type {() => void} */
  let noteAsked = () => {};
  const asked = new Promise((resolve) => (noteAsked = () => resolve(undefined)));
  /** @type {() => void} */
  let answer = () => {};
  const answered = new Promise((resolve) => (answer = () => resolve(undefined)));
  /** @param {import("@playwright/test").Route} route */
  const holdRecord = async (route) => {
    noteAsked();
    await answered;
    await route.fallback();
  };
  await page.route(record, holdRecord);

  await page.reload();
  await asked;
  await page.clock.runFor(UPDATING_WAIT_MS);
  answer();
  await page.unroute(record, holdRecord);

  await expectListOn(page, shownDay);
}

/**
 * Leaves the Games list on `shownDay`, once it shows the whole season on today.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string }} days
 */
async function leaveListOn(page, { today, shownDay }) {
  await expectWholeSeason(page);
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute("data-day", today);
  await page.locator(`#seasonGames .day-cell[data-day="${shownDay}"]`).click();
  await expect(page.locator(`#seasonGames .listed-day[data-day="${shownDay}"]`)).toBeInViewport();
}

/**
 * Checks the Games list ends on `day` once the whole season has arrived.
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
async function expectListOn(page, day) {
  await expectWholeSeason(page);
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute("data-day", day);
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
