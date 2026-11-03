import { expect } from "@playwright/test";
import { UPDATING_WAIT_MS } from "../../shared/page/catch-up-note.js";
import { SCHEDULE_WAIT_MS } from "../../shared/page/schedule-due.js";
import { matchPath } from "./harness.mjs";

// What a phone can hold when the page loads again: the copy of the page it saved as it left, the
// season it drew that from, either one alone, or neither, and a copy older than two minutes, after
// which the Games list opens on today. A page showing the copy draws once the store has handed
// over all it holds, the whole schedule with the season's record, so it keeps any day it showed,
// and keeps the copy while the record alone lacks that day and the schedule is on its way, for at
// most SCHEDULE_WAIT_MS. A
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
 * Holds each request `pattern` matches until the test answers it.
 * @param {import("@playwright/test").Page} page
 * @param {RegExp} pattern
 */
async function holdRequests(page, pattern) {
  /** @type {() => void} */
  let noteAsked = () => {};
  const asked = new Promise((resolve) => (noteAsked = () => resolve(undefined)));
  /** @type {(isFailing: boolean) => void} */
  let release = () => {};
  /** @type {Promise<boolean>} */
  const released = new Promise((resolve) => (release = resolve));
  /** @param {import("@playwright/test").Route} route */
  const hold = async (route) => {
    noteAsked();
    if (await released) await route.abort();
    else await route.fallback();
  };
  await page.route(pattern, hold);
  /** @param {boolean} isFailing */
  const settle = async (isFailing) => {
    release(isFailing);
    await page.unroute(pattern, hold);
  };
  return { asked, answer: () => settle(false), fail: () => settle(true) };
}

/**
 * Leaves the Games list on `shownDay`, a day before any the season's record lists, and loads the
 * page again from the copy without its season, with the record answering only once the store has
 * stopped holding what it sends.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string, schedulePath: string }} options
 */
async function reloadWithLateRecord(page, { today, shownDay, schedulePath }) {
  await leaveListOn(page, { today, shownDay });
  await page.addInitScript(changeSavedState, "the copy without its season");
  const record = await holdRequests(page, matchPath(`/store/seasons/${today.slice(0, 4)}`));
  const schedule = await holdRequests(page, matchPath(schedulePath));

  await page.reload();
  await record.asked;
  await page.clock.runFor(UPDATING_WAIT_MS);
  await record.answer();
  await schedule.asked;
  return schedule;
}

/**
 * Checks the list ends on `shownDay` after a reload with a late record, once the whole season
 * has arrived. The page asks for the schedule only after the record, so the record alone fills the
 * list first, as on a slow network.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string, schedulePath: string }} options
 */
export async function expectLateRecordKeepsShownDay(page, options) {
  const schedule = await reloadWithLateRecord(page, options);

  await schedule.answer();

  await expectListOn(page, options.shownDay);
}

/**
 * Checks the record alone fills the list, on today, after a reload with a late record whose
 * schedule doesn't answer within SCHEDULE_WAIT_MS, so a read that never answers can't leave the
 * list on its copy.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string, schedulePath: string }} options
 */
export async function expectStalledScheduleLetsRecordFill(page, options) {
  const schedule = await reloadWithLateRecord(page, options);

  await page.clock.runFor(SCHEDULE_WAIT_MS);

  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    options.today,
  );
  await schedule.answer();
  await expectListOn(page, options.today);
}

/**
 * Checks the record alone fills the list, on today, as soon as the schedule's read fails after a
 * reload with a late record, without waiting out SCHEDULE_WAIT_MS.
 * @param {import("@playwright/test").Page} page
 * @param {{ today: string, shownDay: string, schedulePath: string }} options
 */
export async function expectFailedScheduleLetsRecordFill(page, options) {
  const schedule = await reloadWithLateRecord(page, options);

  await schedule.fail();

  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    options.today,
  );
  await expectListOn(page, options.today);
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
