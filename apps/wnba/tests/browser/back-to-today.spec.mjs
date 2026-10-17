import { test, expect, expectDayAtTop } from "./harness.mjs";
import { leavePagePixelDown } from "../../../../tests/browser/page-left-down.mjs";
import { findCell, findDay, findList, openSeasonGames } from "./season-games.mjs";

// A tap on Today, or on Games while it shows, brings the Games list back to today.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a tap on a day brings its games to the top, a tap on Today brings today back, and so does a tap on Games while it shows", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");

    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");
    await page.locator("#seasonGames .go-today").click();
    await expectDayAtTop(page, "2026-09-30");

    await page.locator("#seasonGames .strip-month").evaluate(() => {
      const list = /** @type {Element} */ (document.querySelector("#seasonGames .day-list"));
      list.scrollTo({ top: 0, behavior: "instant" });
    });
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).not.toHaveAttribute(
      "data-day",
      "2026-09-30",
    );
    await page.getByRole("tab", { name: "Games" }).click();
    await expectDayAtTop(page, "2026-09-30");
  });

  test("a tap on Games brings today back at once, even with the page left a pixel from its top", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    await findCell(page, "2026-09-20").click();
    await expectDayAtTop(page, "2026-09-20");
    expect(await leavePagePixelDown(page)).toBe(1);

    await page.getByRole("tab", { name: "Games" }).click();

    await expectDayAtTop(page, "2026-09-30");
  });

  test("after a swipe of the strip, a tap on Games while it shows, or on Today, brings today's date back to the strip's middle and its month over it, leaving the list where it is", async ({
    page,
  }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const month = page.locator("#seasonGames .strip-month");
    const strip = page.locator("#seasonGames .day-strip");
    const readStripLeft = () => strip.evaluate((element) => element.scrollLeft);
    const centered = await readStripLeft();
    const top = await findList(page).evaluate((list) => list.scrollTop);
    const box = await strip.boundingBox();

    for (const tap of [
      () => page.getByRole("tab", { name: "Games" }).click(),
      () => page.locator("#seasonGames .go-today").click(),
    ]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(-2400, 0);
      await expect(month).toHaveText("August");

      await tap();

      await expect.poll(readStripLeft).toBe(centered);
      await expect(month).toHaveText("September");
      expect(await findList(page).evaluate((list) => list.scrollTop)).toBe(top);
    }
  });

  test("a tap on Today where the list already is moves nothing", async ({ page }) => {
    await openSeasonGames(page);
    await expectDayAtTop(page, "2026-09-30");
    const top = await findList(page).evaluate((list) => list.scrollTop);

    await page.locator("#seasonGames .go-today").click();

    expect(await findList(page).evaluate((list) => list.scrollTop)).toBe(top);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test("a tap on Games with the page left a pixel down glides the page to its top while the list flies to today", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.clock.runFor(1000);
  await findCell(page, "2026-09-29").click();
  await page.clock.runFor(2000);
  await expectDayAtTop(page, "2026-09-29");
  expect(await leavePagePixelDown(page)).toBe(1);

  await page.getByRole("tab", { name: "Games" }).click();
  await page.clock.runFor(2000);

  await expectDayAtTop(page, "2026-09-30");
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("a tap on Today flies the list there on a spring, never stepping back, and lands on today", async ({
  page,
}) => {
  await openSeasonGames(page);
  await findCell(page, "2026-09-29").click();
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-29");
  // Each frame comes only as the test moves the clock, however slow the machine draws.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.evaluate(() => {
    const tops = /** @type {number[]} */ ([]);
    const note = () => {
      tops.push(
        /** @type {Element} */ (document.querySelector("#seasonGames .day-list")).scrollTop,
      );
      if (tops.length < 120) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
    Object.assign(window, { listTops: tops });
  });

  await page.locator("#seasonGames .go-today").click();
  await page.clock.runFor(2000);

  const tops = /** @type {number[]} */ (
    await page.evaluate(() => /** @type {any} */ (window).listTops)
  );
  const moved = tops.filter((top, index) => index === 0 || top !== tops[index - 1]);
  expect(moved.length).toBeGreaterThan(4);
  for (let index = 1; index < moved.length; index += 1)
    expect(moved[index]).toBeGreaterThan(moved[index - 1]);
  await expectDayAtTop(page, "2026-09-30");
});

test("a tap on Games while a flick of the list still slides the dates to today ends the slide at once, today's date in the strip's middle", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-30");
  const dayBefore = await findDay(page, "2026-09-30").evaluate(
    (today) => /** @type {HTMLElement} */ (today.previousElementSibling).dataset.day,
  );
  // Each frame comes only as the test moves the clock, however slow the machine draws.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  // The list chooses its top day from its scroll event, which comes when the browser draws, so the
  // clock moves on only once it has. A wheel's turn that moves nothing puts the list in hand.
  /**
   * @param {string} day
   * @param {{ isInHand: boolean }} options
   */
  const bringToTop = (day, { isInHand }) =>
    findList(page).evaluate((list, [shown, isWheeled]) => {
      const scrolled = new Promise((resolve) => {
        list.addEventListener("scroll", resolve, { once: true });
      });
      if (isWheeled) list.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      const listed = /** @type {HTMLElement} */ (list.querySelector(`[data-day="${shown}"]`));
      list.scrollTop = listed.offsetTop - Number.parseFloat(getComputedStyle(list).paddingTop);
      return scrolled;
    }, /** @type {[string, boolean]} */ ([day, isInHand]));
  await bringToTop(dayBefore, { isInHand: false });
  await page.clock.runFor(100);
  await expect(findCell(page, dayBefore)).toHaveClass(/is-chosen/);
  await bringToTop("2026-09-30", { isInHand: true });
  await page.clock.runFor(100);
  await expect(page.locator("#seasonGames .strip-lens")).toHaveCount(1);

  await page.getByRole("tab", { name: "Games" }).click();

  await expect(page.locator("#seasonGames .strip-lens")).toHaveCount(0);
  const offCenter = await findCell(page, "2026-09-30").evaluate((cell) => {
    const strip = /** @type {HTMLElement} */ (cell.parentElement);
    const { left, width } = cell.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    return left + width / 2 - (box.left + box.width / 2);
  });
  expect(Math.abs(offCenter)).toBeLessThan(1);
});

test("a tap on Today where the list already is pulses today's date, 4% bigger and back over 290ms", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.clock.runFor(1000);
  await expectDayAtTop(page, "2026-09-30");

  // Each animation is noted as it starts, since a slow machine can finish one before it's read.
  await page.evaluate(() => {
    const pulses = [];
    Object.assign(window, { pulses });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this instanceof HTMLElement && this.matches(".day-cell"))
        pulses.push({
          day: this.dataset.day,
          duration: /** @type {KeyframeAnimationOptions} */ (options).duration,
          transforms: /** @type {Keyframe[]} */ (keyframes).map((keyframe) => keyframe.transform),
        });
      return animate.call(this, keyframes, options);
    };
  });
  await page.locator("#seasonGames .go-today").click();

  const pulses = await page.evaluate(() => Reflect.get(window, "pulses"));
  expect(pulses).toEqual([
    { day: "2026-09-30", duration: 290, transforms: ["scale(1)", "scale(1.04)", "scale(1)"] },
  ]);
  await page.clock.runFor(400);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expectDayAtTop(page, "2026-09-30");
});
