import { expect } from "@playwright/test";
import { waitForLoadToSettle } from "./at-rest.mjs";
import { holdClock, matchPath } from "./harness.mjs";
import {
  findMiddle,
  findSeasonPart,
  readHeaderReach,
  readScroll,
  scrollSeasonPart,
} from "./season-scroll.mjs";
import { findSeasonPill, openSeasonPart } from "./season-tab.mjs";
import { setHidden } from "./visibility.mjs";
import { drag, openFromHomeScreen, pullDown, PULL_START } from "./touch.mjs";

/** @param {import("@playwright/test").Page} page @param {string} cards */
export const readGeometry = (page, cards) =>
  page.locator("#bracketWrap").evaluate((wrap, selector) => {
    const top = wrap.getBoundingClientRect().top;
    return [...wrap.querySelectorAll(selector)].map((card) => {
      const box = card.getBoundingClientRect();
      return [Math.round((box.top - top) * 100) / 100, box.height];
    });
  }, cards);

/** @param {import("@playwright/test").Page} page @param {string} cards */
async function watchSettlement(page, cards) {
  await page.evaluate(() => {
    function pauseSettlement() {
      document.removeEventListener("touchend", pauseSettlement);
      document.removeEventListener("touchcancel", pauseSettlement);
      const animations = document
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === "top",
        );
      for (const animation of animations) animation.pause();
      Object.assign(window, { bracketPullAnimations: animations });
    }
    document.addEventListener("touchend", pauseSettlement);
    document.addEventListener("touchcancel", pauseSettlement);
  });
  return () =>
    page.locator("#bracketWrap").evaluate((wrap, selector) => {
      const animations = /** @type {Animation[]} */ (
        /** @type {any} */ (window).bracketPullAnimations
      );
      const header = /** @type {HTMLElement} */ (document.querySelector("header.top"));
      const frames = [];
      for (const progress of [0, 0.25, 0.5, 0.75, 0.99]) {
        for (const animation of animations)
          animation.currentTime = Number(animation.effect?.getTiming().duration) * progress;
        dispatchEvent(new Event("resize"));
        const top = wrap.getBoundingClientRect().top;
        frames.push({
          offset: parseFloat(getComputedStyle(header).top) || 0,
          tops: [...wrap.querySelectorAll(selector)].map(
            (card) => Math.round((card.getBoundingClientRect().top - top) * 100) / 100,
          ),
        });
      }
      for (const animation of animations) animation.finish();
      return frames;
    }, cards);
}

/**
 * @param {object} options
 * @param {typeof import("./harness.mjs").test} options.test
 * @param {(page: import("@playwright/test").Page) => Promise<{ holdStore: () => Promise<() => void> }>} options.openApp
 * @param {string} options.cards
 * @param {string} options.sideways
 */
export function checkBracketPull({ test, openApp, cards, sideways }) {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });

  for (const reducedMotion of /** @type {const} */ (["reduce", "no-preference"])) {
    test(`bracket card spacing survives held-pull recalculation and repeated refreshes with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await openFromHomeScreen(page);
      const app = await openApp(page);
      await openSeasonPart(page, "Bracket");
      await waitForLoadToSettle(page);
      await holdClock(page);
      const geometry = await readGeometry(page, cards);
      expect(geometry.length).toBeGreaterThan(3);
      const header = page.locator("header.top");

      for (let refresh = 0; refresh < 2; refresh += 1) {
        const answerStore = await app.holdStore();
        const liftFinger = await drag(page, PULL_START, { y: 200 }, { durationMs: 400 });
        await expect(header).toHaveCSS("top", "95px");
        expect(await readGeometry(page, cards)).toEqual(geometry);
        await page.evaluate(() => dispatchEvent(new Event("resize")));
        await page.clock.runFor(100);
        expect(await readGeometry(page, cards)).toEqual(geometry);
        await liftFinger();
        await expect(header).toHaveCSS("top", "56px");
        await page.evaluate(() => dispatchEvent(new Event("resize")));
        await page.clock.runFor(900);
        await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
        expect(await readGeometry(page, cards)).toEqual(geometry);
        answerStore();
        await expect.poll(() => header.evaluate((element) => element.style.top)).toBe("");
        await expect(page.locator(".pull-refresh")).toBeHidden();
        expect(await readGeometry(page, cards)).toEqual(geometry);
      }
    });

    test(`short and cancelled pulls preserve bracket spacing with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await openFromHomeScreen(page);
      await openApp(page);
      await openSeasonPart(page, "Bracket");
      await waitForLoadToSettle(page);
      const geometry = await readGeometry(page, cards);

      for (const isCancelled of [false, true]) {
        const liftFinger = await drag(page, PULL_START, { y: isCancelled ? 200 : 60 });
        await page.evaluate(() => dispatchEvent(new Event("resize")));
        await page.clock.runFor(100);
        expect(await readGeometry(page, cards)).toEqual(geometry);
        const readFrames = await watchSettlement(page, cards);
        if (isCancelled)
          await page.locator("header.top").dispatchEvent("touchcancel", { touches: [] });
        await liftFinger();
        const frames = await readFrames();
        await expect(page.locator(".pull-refresh")).toBeHidden();
        await expect
          .poll(() => page.locator("header.top").evaluate((element) => element.style.top))
          .toBe("");
        expect(await readGeometry(page, cards)).toEqual(geometry);
        for (const frame of frames) expect(frame.tops).toEqual(geometry.map(([top]) => top));
        if (reducedMotion === "no-preference") {
          expect(new Set(frames.map(({ offset }) => offset)).size).toBeGreaterThan(2);
          for (let index = 1; index < frames.length; index += 1)
            expect(frames[index].offset).toBeLessThanOrEqual(frames[index - 1].offset);
        }
      }
    });
  }

  test("a real header and viewport resize changes bracket room equally at rest and during a pull", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFromHomeScreen(page);
    await openApp(page);
    await openSeasonPart(page, "Bracket");
    await waitForLoadToSettle(page);
    const original = await readGeometry(page, cards);
    const header = page.locator("header.top");
    /** @param {number} padding @param {number} height */
    const resizeRoom = async (padding, height) => {
      await header.evaluate(
        (element, pixels) => (element.style.paddingBottom = pixels ? `${pixels}px` : ""),
        padding,
      );
      await page.setViewportSize({ width: 390, height });
      await waitForLoadToSettle(page);
    };
    await resizeRoom(40, 820);
    await expect.poll(() => readGeometry(page, cards)).not.toEqual(original);
    const resized = await readGeometry(page, cards);
    const resizedReach = await readHeaderReach(page);
    await resizeRoom(0, 900);
    await expect.poll(() => readGeometry(page, cards)).toEqual(original);

    const liftFinger = await drag(page, PULL_START, { y: 60 });
    await resizeRoom(40, 820);
    await expect.poll(() => readGeometry(page, cards)).toEqual(resized);
    await expect.poll(() => readHeaderReach(page)).toBe(resizedReach);
    await liftFinger();
    await expect(page.locator(".pull-refresh")).toBeHidden();
    await expect.poll(() => readGeometry(page, cards)).toEqual(resized);
    await resizeRoom(0, 900);
    await expect.poll(() => readGeometry(page, cards)).toEqual(original);
  });

  test("a failed refresh settles without keeping a pull offset and a later refresh recovers", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFromHomeScreen(page);
    await openApp(page);
    await openSeasonPart(page, "Bracket");
    await waitForLoadToSettle(page);
    await holdClock(page);
    const original = await readGeometry(page, cards);
    let failures = 0;
    /** @param {import("@playwright/test").Route} route */
    const failStore = (route) => {
      failures += 1;
      return route.fulfill({ status: 503, body: "" });
    };
    await page.route(matchPath("/store/"), failStore);
    await pullDown(page, 200);
    await expect.poll(() => failures).toBeGreaterThan(0);
    await page.evaluate(() => dispatchEvent(new Event("resize")));
    await page.clock.runFor(900);
    expect(await readGeometry(page, cards)).toEqual(original);
    await page.clock.runFor(10_000);
    await expect(page.locator(".pull-refresh")).toBeHidden();
    await page.clock.runFor(100);
    expect(await page.locator("header.top").evaluate((element) => element.style.top)).toBe("");
    const failed = await readGeometry(page, cards);
    await page.evaluate(() => dispatchEvent(new Event("resize")));
    await page.clock.runFor(100);
    expect(await readGeometry(page, cards)).toEqual(failed);

    await page.unroute(matchPath("/store/"), failStore);
    await pullDown(page, 200);
    await page.clock.runFor(1000);
    await expect(page.locator(".pull-refresh")).toBeHidden();
    await expect(page.locator(".catch-up-line")).toHaveCount(0);
    await page.clock.runFor(100);
    expect(await readGeometry(page, cards)).toEqual(original);
  });

  test("refresh and reload preserve the bracket column and each season part's vertical place", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFromHomeScreen(page);
    const app = await openApp(page);
    await openSeasonPart(page, "Standings");
    await waitForLoadToSettle(page);
    await scrollSeasonPart(page, "standings", 100);
    const pillName = findSeasonPill(page).getByRole("tab", { name: "Bracket", exact: true });
    await pillName.click();
    await scrollSeasonPart(page, "bracket", 80);
    const bracket = page.locator(sideways);
    await bracket.evaluate((element) =>
      element.scrollTo({ left: element.scrollWidth, behavior: "instant" }),
    );
    const readPlace = async () => ({
      standings: await readScroll(findSeasonPart(page, "standings")),
      bracket: await readScroll(findSeasonPart(page, "bracket")),
      left: await bracket.evaluate((element) => element.scrollLeft),
    });
    const place = await readPlace();
    expect(place.standings).toBeGreaterThan(0);
    expect(place.bracket).toBeGreaterThan(0);
    expect(place.left).toBeGreaterThan(0);
    const geometry = await readGeometry(page, cards);
    const answerStore = await app.holdStore();
    await (
      await drag(page, await findMiddle(pillName), { y: 200 })
    )();
    await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
    await page.evaluate(() => dispatchEvent(new Event("resize")));
    await page.clock.runFor(900);
    expect(await readGeometry(page, cards)).toEqual(geometry);
    answerStore();
    await expect(page.locator(".pull-refresh")).toBeHidden();
    expect(await readPlace()).toEqual(place);
    await setHidden(page, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForLoadToSettle(page);
    expect(await readPlace()).toEqual(place);
  });
}
