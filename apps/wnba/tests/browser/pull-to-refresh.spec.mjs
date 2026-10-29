import { holdClock } from "../../../../tests/browser/harness.mjs";
import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
import {
  leaveFractionDown,
  leavePageFractionDown,
} from "../../../../tests/browser/page-left-down.mjs";
import { countScrollHoldersAt } from "../../../../tests/browser/held-scrolls.mjs";
import {
  findMiddle,
  findSeasonPart,
  readScroll,
  scrollElementTo,
  scrollSeasonPart,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { findSeasonPill, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { fillNews, readNewsPlace } from "../../../../tests/browser/start-over.mjs";
import {
  drag,
  dragAlong,
  openFromHomeScreen,
  pullDown,
  PULL_START,
} from "../../../../tests/browser/touch.mjs";
import { test, expect, openApp } from "./harness.mjs";
import { findList } from "./season-games.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// A reload clears whatever the test left on the window.
/** @param {import("@playwright/test").Page} page */
const markPage = (page) => page.evaluate(() => Object.assign(window, { isSameLoad: true }));
/** @param {import("@playwright/test").Page} page */
const isSameLoad = (page) => page.evaluate(() => "isSameLoad" in window);

/** @param {Awaited<ReturnType<typeof openApp>>} app */
const startGameWhileAway = (app) =>
  app.changeSeasonWhileAway((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });

const SHORTEST_REFRESH_MS = 800;

/** @param {import("@playwright/test").Page} page */
async function openGames(page) {
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  await expect(row).toBeVisible();
  return row;
}

test("pulling the page down on the Home Screen reads what it missed, without reloading", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  const row = await openGames(page);
  await startGameWhileAway(app);
  await markPage(page);

  await pullDown(page, 200);

  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  expect(await isSameLoad(page)).toBe(true);
});

test("a refreshing page shows the turning spokes, held down until the store answers", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");
  const header = page.locator("header.top");
  const release = await app.holdStore();

  await pullDown(page, 200);

  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveClass(/turning/);
  await expect(header).toHaveCSS("top", "56px");
  release();
  await page.clock.runFor(SHORTEST_REFRESH_MS);
  await expect(spinner).toBeHidden();
  await expect(header).toHaveCSS("top", "auto");
});

test("a page that reloads while held down, as for a newer release, comes back in place, its Updates box too", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const header = page.locator("header.top");
  const release = await app.holdStore();
  await pullDown(page, 200);
  await expect(header).toHaveCSS("top", "56px");
  await expect(page.locator("#updates")).toHaveCSS("top", "56px");

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("#updates")).toHaveCSS("top", "auto");
  await expect(header).toHaveCSS("top", "auto");
  release();
});

test("on News, the header changing while the page is held down doesn't move the stories later, once they're scrolled and it changes again", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await page.getByRole("tab", { name: "News" }).click();
  const header = page.locator("header.top");
  /** @param {number} pixels */
  const growHeader = (pixels) =>
    header.evaluate((element, room) => (element.style.paddingBottom = `${room}px`), pixels);
  const release = await app.holdStore();
  await pullDown(page, 200);
  await expect(header).toHaveCSS("top", "56px");
  await growHeader(40);
  await page.clock.runFor(100);
  release();
  await page.clock.runFor(SHORTEST_REFRESH_MS);
  await expect(header).toHaveCSS("top", "auto");
  await page.evaluate(() => scrollTo({ top: 300, behavior: "instant" }));
  const place = await readNewsPlace(page);

  await growHeader(120);

  await expect.poll(() => readNewsPlace(page)).toBe(place);
});

test("on News, the header changing as the page eases back up doesn't move the stories later, once they're scrolled and it changes again", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await page.getByRole("tab", { name: "News" }).click();
  const header = page.locator("header.top");
  // The header grows as the page starts to ease back up from the pull's hold.
  await header.evaluate((element) =>
    element.addEventListener("transitionrun", function growAsEased(event) {
      const { propertyName } = /** @type {TransitionEvent} */ (event);
      if (propertyName !== "top" || element.style.top !== "0px") return;
      element.removeEventListener("transitionrun", growAsEased);
      element.style.paddingBottom = "40px";
    }),
  );
  const release = await app.holdStore();
  await pullDown(page, 200);
  await expect(header).toHaveCSS("top", "56px");
  release();
  await page.clock.runFor(SHORTEST_REFRESH_MS);
  await expect(header).toHaveCSS("padding-bottom", "40px");
  await expect(header).toHaveCSS("top", "auto");
  await page.evaluate(() => scrollTo({ top: 300, behavior: "instant" }));
  const place = await readNewsPlace(page);

  await header.evaluate((element) => (element.style.paddingBottom = "160px"));

  await expect.poll(() => readNewsPlace(page)).toBe(place);
});

test("a pull on a page left a fraction of a pixel down, as a phone can leave it, still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  await leavePageFractionDown(page);
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} top
 */
const scrollPageTo = (page, top) =>
  page.evaluate(
    (to) =>
      new Promise((resolve) => {
        addEventListener("scroll", resolve, { once: true });
        scrollTo({ top: to, behavior: "instant" });
      }),
    top,
  );

test("the page holds up the browser's scrolls only at its top, where a pull can start", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await page.getByRole("tab", { name: "News" }).click();
  expect(await countScrollHoldersAt(page, PULL_START)).toBeGreaterThan(0);

  await scrollPageTo(page, 300);
  expect(await countScrollHoldersAt(page, PULL_START)).toBe(0);
  await scrollPageTo(page, 0);
  expect(await countScrollHoldersAt(page, PULL_START)).toBeGreaterThan(0);

  await app.holdStore();
  await pullDown(page, 200);
  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
});

test("a refresh that ends with the page scrolled down stops holding up the browser's scrolls", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await page.getByRole("tab", { name: "News" }).click();
  const release = await app.holdStore();
  await pullDown(page, 200);
  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await scrollPageTo(page, 300);
  expect(await countScrollHoldersAt(page, PULL_START)).toBeGreaterThan(0);

  release();
  await page.clock.runFor(SHORTEST_REFRESH_MS);

  await expect(page.locator(".pull-refresh")).toBeHidden();
  expect(await countScrollHoldersAt(page, PULL_START)).toBe(0);
});

test("a touch from the top lifted with the page scrolled down stops holding up the browser's scrolls", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await page.getByRole("tab", { name: "News" }).click();
  const header = page.locator("header.top");
  /** @param {string} type */
  const touch = (type) =>
    header.evaluate((target, eventType) => {
      const finger = new Touch({ identifier: 1, target, clientX: 200, clientY: 40 });
      const touches = eventType === "touchstart" ? [finger] : [];
      target.dispatchEvent(
        new TouchEvent(eventType, { bubbles: true, touches, changedTouches: [finger] }),
      );
    }, type);
  await touch("touchstart");
  await scrollPageTo(page, 300);
  expect(await countScrollHoldersAt(page, PULL_START)).toBeGreaterThan(0);

  await touch("touchend");

  expect(await countScrollHoldersAt(page, PULL_START)).toBe(0);
});

/**
 * Opens the Games tab once its list has landed on today, scrolled down from its top, and the scroll
 * that took it there has moved the pull's listeners.
 * @param {import("@playwright/test").Page} page
 */
async function openGamesOnToday(page) {
  await openGames(page);
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  const list = findList(page);
  await expect.poll(() => readScroll(list)).toBeGreaterThan(0);
  return list;
}

test("on Games, a scroll in the list scrolled down doesn't wait on the pull, while a pull from the header above it still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  const list = await openGamesOnToday(page);
  const middle = await findMiddle(list);

  await expect.poll(() => countScrollHoldersAt(page, middle)).toBe(0);
  expect(await countScrollHoldersAt(page, PULL_START)).toBeGreaterThan(0);
  await app.holdStore();
  await pullDown(page, 200);
  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
});

test("on Games, a swipe down inside the list scrolled down scrolls it, while at its top it pulls the page", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  const list = await openGamesOnToday(page);
  const middle = await findMiddle(list);
  await expect.poll(() => countScrollHoldersAt(page, middle)).toBe(0);
  const before = await readScroll(list);
  await app.holdStore();

  await (
    await drag(page, middle, { y: 120 })
  )();
  await expect.poll(() => readScroll(list)).toBeLessThan(before);
  await expect(page.locator(".pull-refresh")).toBeHidden();
  await scrollElementTo(list, 0);
  await (
    await drag(page, middle, { y: 200 })
  )();

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
});

test("on Games, a part the page adds beside the list scrolled down still starts a pull", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  const list = await openGamesOnToday(page);
  const inList = await findMiddle(list);
  await expect.poll(() => countScrollHoldersAt(page, inList)).toBe(0);
  await page.evaluate(() => {
    const part = document.createElement("div");
    part.className = "added-part";
    Object.assign(part.style, { position: "fixed", inset: "0 0 auto", height: "60px" });
    part.style.zIndex = "10";
    document.body.append(part);
  });
  const middle = await findMiddle(page.locator(".added-part"));
  await expect.poll(() => countScrollHoldersAt(page, middle)).toBeGreaterThan(0);
  await app.holdStore();

  await (
    await drag(page, middle, { y: 200 })
  )();

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
});

test("on the season tab, the pull leaves the standings or the bracket scrolled down to the swipe between them, while it still holds the pill", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standingsWrap table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  // The pill's bar lets a drag through to the part under it, so only its names take a touch.
  const pillName = findSeasonPill(page).getByRole("tab", { name: "Standings" });
  const atPill = await countScrollHoldersAt(page, await findMiddle(pillName));

  for (const [name, part] of /** @type {const} */ ([
    ["Standings", "standings"],
    ["Bracket", "bracket"],
  ])) {
    await openSeasonPart(page, name);
    const middle = await findMiddle(findSeasonPart(page, part));
    const atTop = await countScrollHoldersAt(page, middle);
    await scrollSeasonPart(page, part, 200);
    expect(await readScroll(findSeasonPart(page, part))).toBeGreaterThan(0);
    expect(await countScrollHoldersAt(page, middle)).toBe(atTop - 1);
    expect(await countScrollHoldersAt(page, await findMiddle(pillName))).toBe(atPill);
  }
});

test("on Games, the list scrolled down that shows again by its tab is left to scroll without waiting on the pull", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await fillNews(page, app.writeDocument);
  await openGames(page);
  const list = findList(page);
  const middle = await findMiddle(list);
  await page.getByRole("tab", { name: "News" }).click();
  await scrollPageTo(page, 300);
  await scrollPageTo(page, 0);

  await page.getByRole("tab", { name: "Games" }).click();

  expect(await readScroll(list)).toBeGreaterThan(0);
  expect(await countScrollHoldersAt(page, middle)).toBe(0);
});

test("a part of the season scrolled down that slides back in is left to scroll without waiting on the pull", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFromHomeScreen(page);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standingsWrap table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  const standings = findSeasonPart(page, "standings");
  const middle = await findMiddle(standings);
  const atTop = await countScrollHoldersAt(page, middle);
  await scrollSeasonPartToEnd(page, "standings");
  await findSeasonPill(page).getByRole("tab", { name: "Bracket" }).click();
  await expect(page.locator("#bracketWrap .bracket")).toBeInViewport();

  await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();

  expect(await readScroll(standings)).toBeGreaterThan(0);
  expect(await countScrollHoldersAt(page, middle)).toBe(atTop - 1);
});

test("a pull whose moves the browser won't let the page stop still follows the finger, without trying to stop them", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const header = page.locator("header.top");

  const stopsTried = await header.evaluate((target) => {
    let stops = 0;
    /**
     * @param {string} type
     * @param {number} clientY
     */
    const touch = (type, clientY) => {
      const finger = new Touch({ identifier: 1, target, clientX: 200, clientY });
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: false,
        touches: [finger],
        changedTouches: [finger],
      });
      event.preventDefault = () => {
        stops += 1;
      };
      target.dispatchEvent(event);
    };
    touch("touchstart", 40);
    touch("touchmove", 60);
    touch("touchmove", 120);
    return stops;
  });

  expect(stopsTried).toBe(0);
  await expect(header).toHaveCSS("top", "35px");
});

test("a short pull settles back without refreshing", async ({ page }) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  await app.holdStore();

  await pullDown(page, 60);

  await expect(page.locator(".pull-refresh")).toBeHidden();
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
});

test("a sideways swipe from the top doesn't pull the page", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);

  const release = await drag(page, { x: 300, y: 40 }, { x: -200, y: 60 });

  await expect(page.locator(".pull-refresh")).toBeHidden();
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
  await release();
});

test("in the browser, pulling to refresh is left to the browser", async ({ page }) => {
  await openApp(page);
  await openGames(page);

  await pullDown(page, 200);

  await expect(page.locator(".pull-refresh")).toHaveCount(0);
});

test("a page let go eases back up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const header = page.locator("header.top");
  await header.evaluate((element) => {
    const transitions = /** @type {string[]} */ ([]);
    new MutationObserver(() => transitions.push(element.style.transition)).observe(element, {
      attributeFilter: ["style"],
    });
    Object.assign(window, { headerTransitions: transitions });
  });

  await pullDown(page, 60);

  await expect(header).toHaveCSS("top", "auto");
  const transitions = await page.evaluate(
    () => /** @type {string[]} */ (/** @type {any} */ (window).headerTransitions),
  );
  expect(transitions).toContain("top 0.3s");
});

test("a page pulled down and back up to where it started settles in place at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);

  const release = await dragAlong(
    page,
    [40, 70, 100, 70, 40].map((y) => ({ x: 200, y })),
  );
  await release();

  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
  await expect(page.locator("header.top")).toHaveCSS("position", "static");
});

test("a page let go stays held to its pull's place until its own move back ends, not a move inside it or another of its own", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  // Right after the page's own handler lets go, a part inside the first moved part ends a move of
  // its top, and then the moved part ends a move of something other than its top.
  await page.evaluate(() =>
    document.addEventListener("touchend", () => {
      const moved = /** @type {HTMLElement} */ (
        [...document.body.children].find((part) => /** @type {HTMLElement} */ (part).style.top)
      );
      const inside = /** @type {HTMLElement} */ (moved.querySelector("*"));
      /**
       * @param {HTMLElement} part
       * @param {string} propertyName
       */
      const endMove = (part, propertyName) => {
        part.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName }));
        return moved.style.position;
      };
      Object.assign(window, {
        positionsAfterOtherMoves: [endMove(inside, "top"), endMove(moved, "opacity")],
      });
    }),
  );

  await pullDown(page, 60);

  expect(await page.evaluate(() => /** @type {any} */ (window).positionsAfterOtherMoves)).toEqual([
    "relative",
    "relative",
  ]);
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
});

test("a swipe down in an open sheet is the sheet's, not a pull", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.locator(SETTINGS);
  await expect(sheet).toBeVisible();
  const box = /** @type {{ x: number, y: number }} */ (await sheet.boundingBox());

  const release = await drag(page, { x: box.x + 40, y: box.y + 20 }, { y: 120 });

  await expect(page.locator(".pull-refresh")).toBeHidden();
  expect(await page.locator("header.top").evaluate((header) => header.style.top)).toBe("");
  await release();
});

test("on the season tab, a pull holds the standings down with the header", async ({ page }) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openSeasonPart(page, "Standings");
  const standings = page.locator("#standingsWrap");
  await expect(standings.locator("table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  const before = await standings.boundingBox();
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
  await expect.poll(async () => (await standings.boundingBox()).y).toBe(before.y + 56);
});

test("on the season tab, a pull on the standings left a fraction of a pixel down, as a phone can leave them, still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openSeasonPart(page, "Standings");
  const standings = page.locator("#standingsWrap");
  await expect(standings.locator("table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  await leaveFractionDown(findSeasonPart(page, "standings"));
  await app.holdStore();
  const box = /** @type {{ x: number, y: number }} */ (await standings.boundingBox());

  const release = await drag(page, { x: box.x + 40, y: box.y + 20 }, { y: 200 });
  await release();

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
});

test("on a phone, the tab bar stays put while the page is held down", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const tabBar = page.locator("#tabBar");
  const before = await tabBar.boundingBox();
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
  expect(await tabBar.boundingBox()).toEqual(before);
});

/** @param {import("@playwright/test").Locator} spinner */
const readShownSpokes = (spinner) =>
  spinner.evaluate((element) => element.style.getPropertyValue("--pull-spokes"));

test("the spokes appear whole, one by one, as the page is pulled", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 60 });

  expect(await readShownSpokes(spinner)).toBe("3");
  await expect(spinner).not.toHaveClass(/turning/);
  await release();
});

test("the spokes start turning once the pull is far enough, before letting go", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 200 });

  expect(await readShownSpokes(spinner)).toBe("8");
  await expect(spinner).toHaveClass(/turning/);
  await release();
});

test("a refresh quicker than the eye still shows the spokes turning a moment", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");
  // The page's clock otherwise keeps time with the test's, which would race the steps below.
  await holdClock(page);

  await pullDown(page, 200);

  await expect(spinner).toHaveClass(/turning/);
  await page.clock.runFor(SHORTEST_REFRESH_MS - 1);
  await expect(spinner).toBeVisible();
  await page.clock.runFor(1);
  await expect(spinner).toBeHidden();
});

test("the turning spokes step round, and slower under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 200 });

  await expect(spinner).toHaveCSS("animation-name", "spokes-turn");
  await expect(spinner).toHaveCSS("animation-duration", "0.8s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-duration", "2.4s");
  await release();
});
