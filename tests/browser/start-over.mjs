// After two minutes away, the page starts over where a viewer moved it, on the tab it showed
// (shared/page/long-away.js): the season's standings and bracket each at its top with the header
// back, the pill on the part the tab is named for, the bracket on its opening round, the Games
// list's strip of dates on today, and News at its top. Under two minutes, each stays where it was
// left. Each app's tests move the page off its start, leave, and come back or load again.

import { expect } from "@playwright/test";
import { waitForLoadToSettle } from "./at-rest.mjs";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { readSeasonPartScroll, readSeasonRide, scrollSeasonPartToEnd } from "./season-scroll.mjs";
import { findSeasonPill, findSeasonTab } from "./season-tab.mjs";
import { writeUnreadableLastSeen } from "./unreadable-last-seen.mjs";
import { passTime, setHidden } from "./visibility.mjs";

/** A screen short enough for the bracket to scroll, and narrow enough for it to scroll sideways. */
export const SHORT_PHONE = { width: 390, height: 480 };

export const MINUTE_MS = 60 * 1000;

/**
 * Where the season tab is: the part its pill shows, how far each part and the bracket sideways are
 * scrolled, whether the pill holds at the top, and where the header starts on the page.
 * @param {import("@playwright/test").Page} page
 * @param {string} sideways the bracket's sideways scroller
 */
export async function readSeasonPlace(page, sideways) {
  return {
    shownPart: await findSeasonPill(page)
      .locator('[aria-selected="true"]')
      .getAttribute("data-tab"),
    standingsScroll: await readSeasonPartScroll(page, "standings"),
    bracketScroll: await readSeasonPartScroll(page, "bracket"),
    bracketLeft: await page.locator(sideways).evaluate((element) => Math.round(element.scrollLeft)),
    isPillHeld: await page
      .locator("#bracketStandingsPill")
      .evaluate((pill) => pill.classList.contains("held")),
    headerTop: (await readSeasonRide(page)).headerTop,
  };
}

/**
 * Slides the season tab, already shown, to one of its parts, as a tap on its name does, without a
 * tap on the tab, which would take the part shown back to its top.
 * @param {import("@playwright/test").Page} page
 * @param {"Standings" | "Bracket"} name
 */
async function slideToPart(page, name) {
  await findSeasonPill(page).getByRole("tab", { name, exact: true }).click();
  await expect(page.locator("#bracketStandingsParts")).not.toHaveAttribute("data-sliding");
}

/**
 * Moves the season tab off its start, as a viewer does: the bracket scrolled sideways to its last
 * round, where it's too wide for the screen, and down to its end, the standings to theirs, and the
 * pill left on the part the tab isn't named for, held at the top. Returns where the tab started
 * and where it was left.
 * @param {import("@playwright/test").Page} page
 * @param {string} sideways the bracket's sideways scroller
 */
async function moveSeasonTabOffStart(page, sideways) {
  if ((await findSeasonTab(page).getAttribute("aria-selected")) !== "true")
    await findSeasonTab(page).click();
  await expect(page.locator(sideways)).toBeAttached();
  await expect(findSeasonPill(page)).toBeVisible();
  const start = await readSeasonPlace(page, sideways);
  await slideToPart(page, "Bracket");
  await page
    .locator(sideways)
    .evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
  await scrollSeasonPartToEnd(page, "bracket");
  await slideToPart(page, "Standings");
  await expect(page.locator("#standingsWrap table").first()).toBeVisible();
  await scrollSeasonPartToEnd(page, "standings");
  if (start.shownPart === "standings") await slideToPart(page, "Bracket");
  await expect(page.locator("#bracketStandingsPill")).toHaveClass(/\bheld\b/);
  const left = await readSeasonPlace(page, sideways);
  expect(left).not.toMatchObject(start);
  return { start, left };
}

/**
 * Has the store send the page enough stories to scroll the News tab, with `writeDocument`, which
 * saves a document as the Worker does.
 * @param {import("@playwright/test").Page} page
 * @param {(path: string, data: any) => Promise<unknown>} writeDocument
 */
export async function fillNews(page, writeDocument) {
  const photoUrl = new URL("icon-180.png", page.url()).href;
  const cards = Array.from({ length: 8 }, (_, index) => ({
    lead: {
      url: `https://example.com/story-${index}`,
      title: `Story ${index + 1}`,
      summary: "What happened, in a sentence.",
      author: "A Writer",
      outlet: "ESPN",
      source: "espn",
      publishedAt: "2026-09-20T14:00:00.000Z",
      photo: { url: photoUrl, credit: "Getty Images" },
      teams: [],
    },
    more: [],
  }));
  await writeDocument("news/cards", { cards });
  await expect(page.locator("#newsList .news-card")).toHaveCount(cards.length);
}

/**
 * Where the News tab's stories are on the screen: how far down the third starts.
 * @param {import("@playwright/test").Page} page
 */
export const readNewsPlace = (page) =>
  page
    .locator("#newsList .news-card")
    .nth(2)
    .evaluate((card) => Math.round(card.getBoundingClientRect().top));

/**
 * Shows the News tab scrolled down, and says where its stories are on the screen.
 * @param {import("@playwright/test").Page} page
 */
export async function moveNewsOffTop(page) {
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList .news-card").first()).toBeVisible();
  await page.evaluate(() => scrollTo({ top: 300, behavior: "instant" }));
  expect(await readPageScroll(page)).toBe(300);
  return readNewsPlace(page);
}

/**
 * Has the page leave the screen for `ms` and come back, as a phone's switch to another app and
 * back does, and draw the frame it comes back on.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
async function leaveFor(page, ms) {
  await setHidden(page, true);
  await passTime(page, ms);
  await setHidden(page, false);
  await page.clock.runFor(100);
}

/** @param {import("@playwright/test").Page} page */
export const readPageScroll = (page) => page.evaluate(() => Math.round(scrollY));

/**
 * Leaves News scrolled down and the season tab off its start, then the page for `awayMs`, and
 * brings it back.
 * @param {import("@playwright/test").Page} page
 * @param {{ sideways: string, writeDocument: Parameters<typeof fillNews>[1], awayMs: number }} options
 */
export async function leaveScrolledFor(page, { sideways, writeDocument, awayMs }) {
  await fillNews(page, writeDocument);
  const newsPlace = await moveNewsOffTop(page);
  const season = await moveSeasonTabOffStart(page, sideways);
  await leaveFor(page, awayMs);
  return { newsPlace, ...season };
}

/**
 * Leaves the page off the screen for `awayMs`, as it saves what it shows, while the phone holds
 * its timers, and loads it again with its code held, until the returned function lets it run.
 * @param {import("@playwright/test").Page} page
 * @param {number} awayMs
 */
async function reloadAfter(page, awayMs) {
  await setHidden(page, true);
  await passTime(page, awayMs);
  const release = await holdRequests(page, matchPath("/js/app.js"));
  await page.reload({ waitUntil: "commit" });
  return release;
}

/**
 * Lets the page's held code run, and waits for what it draws to settle. The copy the page put
 * back has already taken the load note away, so the page's loading says its code has run.
 * @param {import("@playwright/test").Page} page
 * @param {() => void} release
 */
async function runPageCode(page, release) {
  release();
  await page.waitForLoadState("domcontentloaded");
  await waitForLoadToSettle(page);
}

/**
 * Checks that a reload `awayMs` after the page left with the season tab off its start shows it
 * where it was left, under two minutes, or from its start, with the bracket on its opening round,
 * the same before the page's code arrives as once it runs.
 * @param {import("@playwright/test").Page} page
 * @param {{ sideways: string, awayMs: number }} options
 */
export async function expectSeasonTabAfterReload(page, { sideways, awayMs }) {
  const { start, left } = await moveSeasonTabOffStart(page, sideways);
  const shown = awayMs >= 2 * MINUTE_MS ? start : left;
  expect(start.bracketLeft).toBeLessThan(left.bracketLeft);

  const release = await reloadAfter(page, awayMs);

  await expect(page.locator("#standingsWrap table").first()).toBeAttached();
  await expect.poll(() => readSeasonPlace(page, sideways)).toEqual(shown);
  await runPageCode(page, release);
  expect(await readSeasonPlace(page, sideways)).toEqual(shown);
}

/**
 * Checks that a reload two minutes after the page left the season tab off its start, with the
 * bracket's opening round moved on by `changeWhileAway` while it was away, shows the bracket on the
 * round it opened on as the page left before the page's code arrives, and on the round still
 * playing once it runs. The season the page saved can't be read, as after a release that reads
 * seasons in a new version, so the page's code first draws the bracket from the store's season,
 * over the copy put back as the page loaded.
 * @param {import("@playwright/test").Page} page
 * @param {{ sideways: string, changeWhileAway: () => Promise<unknown> }} options
 */
export async function expectOpeningRoundAfterReload(page, { sideways, changeWhileAway }) {
  const bracket = page.locator(sideways);
  const readLeft = () => bracket.evaluate((element) => Math.round(element.scrollLeft));
  const { start } = await moveSeasonTabOffStart(page, sideways);

  const release = await reloadAfter(page, 2 * MINUTE_MS);
  await changeWhileAway();
  await page.evaluate(writeUnreadableLastSeen);

  await expect(page.locator("#standingsWrap table").first()).toBeAttached();
  await expect.poll(readLeft).toBe(start.bracketLeft);
  await runPageCode(page, release);
  await expect.poll(readLeft).toBeGreaterThan(start.bracketLeft);
  expect(await readLeft()).toBe(Number(await bracket.getAttribute("data-start-left")));
}

/**
 * Checks that a reload two minutes after the page left the Games list on `otherDay`, out of sight
 * of today on its strip of dates, shows the strip on today, the same before the page's code
 * arrives as once it runs.
 * @param {import("@playwright/test").Page} page
 * @param {string} otherDay
 */
export async function expectDayStripAfterReload(page, otherDay) {
  const strip = page.locator("#seasonGames .day-strip");
  const readLeft = () => strip.evaluate((element) => Math.round(element.scrollLeft));
  const isTodayInStrip = () =>
    strip.locator(".is-today").evaluate((cell) => {
      const shown = /** @type {Element} */ (cell.parentElement?.closest(".day-strip"));
      const { left, right } = shown.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      return box.left >= left && box.right <= right;
    });
  await waitForLoadToSettle(page);
  await page.locator(`#seasonGames .day-cell[data-day="${otherDay}"]`).click();
  await expect(page.locator(`#seasonGames .listed-day[data-day="${otherDay}"]`)).toBeInViewport();
  expect(await isTodayInStrip()).toBe(false);

  const release = await reloadAfter(page, 2 * MINUTE_MS);

  await expect(strip).toBeAttached();
  const shownLeft = await readLeft();
  expect(await isTodayInStrip()).toBe(true);
  await runPageCode(page, release);
  expect(await readLeft()).toBe(shownLeft);
}

/**
 * Checks that a reload shows News where it was left under two minutes after the page left it
 * scrolled down, and at its top after two, before the page's code arrives and once it runs.
 * @param {import("@playwright/test").Page} page
 * @param {Parameters<typeof fillNews>[1]} writeDocument
 */
export async function expectNewsAfterReloads(page, writeDocument) {
  await fillNews(page, writeDocument);
  const place = await moveNewsOffTop(page);

  let release = await reloadAfter(page, MINUTE_MS);
  await expect(page.locator("#newsList .news-card").first()).toBeAttached();
  expect(await readNewsPlace(page)).toBe(place);
  await runPageCode(page, release);
  expect(await readNewsPlace(page)).toBe(place);

  release = await reloadAfter(page, 2 * MINUTE_MS);
  await expect(page.locator("#newsList .news-card").first()).toBeAttached();
  expect(await readPageScroll(page)).toBe(0);
  await runPageCode(page, release);
  expect(await readPageScroll(page)).toBe(0);
}
