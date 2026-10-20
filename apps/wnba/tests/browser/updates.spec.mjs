import { test, expect, openApp } from "./harness.mjs";
import {
  EASE_HALFWAY_MS,
  finishTimedAnimations,
  listAnimations,
  waitForTimedAnimations,
} from "../../../../tests/browser/animations.mjs";
import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
import { expectRowHeldStill, trackRowFrames } from "../../../../tests/browser/kept-place.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { scrollPageToEnd } from "../../../../tests/browser/page-left-down.mjs";
import {
  findCenter,
  findTouchTargets,
  holdHeaderStill,
  readHeaderReach,
  readPillHoldTop,
  readSeasonPartScroll,
  readSeasonRide,
  scrollSeasonPart,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { fillNews, moveNewsOffTop } from "../../../../tests/browser/start-over.mjs";
import {
  holdClock,
  sendClick,
  sendFinger,
  sendScroll,
} from "../../../../tests/browser/stray-click.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";
import { dismissUpdatesBox } from "../../../../tests/browser/updates-box.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Dream at Mystics, Game 2, final as the Worker found it.
 * @param {any} season
 */
function finishDreamAtMystics(season) {
  const game = season.games.find((each) => each.id === "1042600132");
  Object.assign(game, { state: "final", status: "Final", end: "2026-10-01T01:10:00Z" });
  Object.assign(game.away, { score: 88 });
  Object.assign(game.home, { score: 80 });
  return season;
}

/**
 * Valkyries at Wings, Game 2, final, as the Worker found it some time after its last play.
 * @param {any} season
 */
function finishValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, {
    state: "final",
    status: "Final",
    end: "2026-10-01T03:05:00Z",
    finalAt: "2026-10-01T03:20:00Z",
  });
  Object.assign(game.away, { score: 90 });
  Object.assign(game.home, { score: 84 });
  return season;
}

const CHANNELS_NOTE = { at: "2026-09-30T20:55:00Z", text: "Tap a game, then <b>Channels</b>." };

/**
 * Serves the page release notes in place of the app's own, by default one out an hour before the
 * harness's now.
 * @param {import("@playwright/test").Page} page
 * @param {{ at: string, text: string }[]} [notes]
 */
const serveReleaseNote = (page, notes = [CHANNELS_NOTE]) =>
  page.route("**/js/release-notes.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import { html } from "#shared/html.js";
export const RELEASE_NOTES = [${notes.map((note) => `{ at: "${note.at}", text: html\`${note.text}\` }`).join(", ")}];`,
    }),
  );

/**
 * Opens the app on the bracket with the Updates box shown, once the page has drawn what the store
 * sent, so the box and its stand-ins hold still where a test measures them.
 * @param {import("@playwright/test").Page} page
 */
async function openBracketWithUpdates(page) {
  await openApp(page, { updatesBox: "shown" });
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await waitForLoadToSettle(page);
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a release note's lines sit 1.3 apart", async ({ page }) => {
    await serveReleaseNote(page);
    await openApp(page, { updatesBox: "shown" });
    const body = await readRole(page, "body");
    await expect(page.locator("#updates .updates-notes .what")).toHaveCSS(
      "line-height",
      `${body.size * 1.3}px`,
    );
  });

  test("a final's team names are set in their sentence's font, at 500, two steps over Body", async ({
    page,
  }) => {
    await openApp(page, { updatesBox: "shown" });
    const what = page.locator("#updates .updates-list .what").first();
    const team = what.locator("b").first();
    await expect(team).toHaveCSS(
      "font-family",
      await what.evaluate((element) => getComputedStyle(element).fontFamily),
    );
    await expect(team).toHaveCSS(
      "font-weight",
      String((await readRole(page, "body")).weight + 200),
    );
  });

  test("a new phone shows no Updates box for the finals and notes already out, and opens it for the next final", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    const app = await openApp(page, { updatesBox: "new" });
    const updates = page.locator("#updates");
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();

    await app.changeSeason(finishDreamAtMystics);

    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    await expect(updates.locator(".what")).toHaveText([
      "Dream beat the Mystics 88-80 to win the First Round 2-0",
    ]);
  });

  test("the Updates box lists the playoff finals since its last dismissal, newest first, until it's dismissed again, and then lists only what's new", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");
    await expect(updates.locator(".what")).toHaveText([
      "Liberty beat the Lynx 87-71 to win the First Round 2-0",
      "Fever beat the Aces 99-89 in Game\u00a02, tie the First Round 1-1",
    ]);

    await dismissUpdatesBox(page);
    await expect(updates).toBeHidden();
    await page.reload();
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();

    await app.changeSeason(finishDreamAtMystics);

    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    await expect(updates.locator(".what")).toHaveText([
      "Dream beat the Mystics 88-80 to win the First Round 2-0",
    ]);
  });

  test("a dismissed final the Worker found after its last play stays dismissed, and the next one found shows", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");
    await app.changeSeason(finishValkyriesAtWings);
    await expect(updates.locator(".what").first()).toHaveText(
      "Valkyries beat the Wings 90-84 to win the First Round 2-0",
    );

    await dismissUpdatesBox(page);
    await expect(updates).toBeHidden();

    await app.changeSeason((season) =>
      finishDreamAtMystics(
        Object.assign(season, {
          games: season.games.map((game) =>
            game.id === "1042600132" ? { ...game, finalAt: "2026-10-01T03:30:00Z" } : game,
          ),
        }),
      ),
    );
    await expect(updates.locator(".what")).toHaveText([
      "Dream beat the Mystics 88-80 to win the First Round 2-0",
    ]);
  });

  test("a pressed final tints across the box's whole width, halfway to what's above and below it", async ({
    page,
  }) => {
    await openApp(page, { updatesBox: "shown" });
    const finals = page.locator("#updates .updates-list li");
    await expect(finals).toHaveCount(2);

    /** @param {number} index */
    const pressAndMeasure = (index) =>
      finals.nth(index).evaluate((final) => {
        final.querySelector(".game-open")?.classList.add("is-pressed");
        const box = /** @type {HTMLElement} */ (final.closest(".updates"));
        const boxStyle = getComputedStyle(box);
        const fill = getComputedStyle(final, "::before");
        const line = final.getBoundingClientRect();
        const area = box.getBoundingClientRect();
        return {
          fill: {
            top: line.top + parseFloat(fill.top),
            bottom: line.bottom - parseFloat(fill.bottom),
            left: line.left + parseFloat(fill.left),
            right: line.right - parseFloat(fill.right),
            color: fill.backgroundColor,
          },
          lineTop: line.top,
          inside: {
            top: area.top + parseFloat(boxStyle.borderTopWidth),
            bottom: area.bottom - parseFloat(boxStyle.borderBottomWidth),
            left: area.left + parseFloat(boxStyle.borderLeftWidth),
            right: area.right - parseFloat(boxStyle.borderRightWidth),
          },
          head: /** @type {Element} */ (box.querySelector(".updates-head")).getBoundingClientRect()
            .bottom,
          texts: [...box.querySelectorAll(".updates-list .what")].map((text) => {
            const { top, bottom } = text.getBoundingClientRect();
            return { top, bottom };
          }),
        };
      });

    const first = await pressAndMeasure(0);
    expect(first.fill.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(first.fill.left).toBeCloseTo(first.inside.left, 1);
    expect(first.fill.right).toBeCloseTo(first.inside.right, 1);
    expect(first.fill.top - first.head).toBeCloseTo(first.lineTop - first.fill.top, 0);
    expect(first.fill.bottom - first.texts[0].bottom).toBeCloseTo(
      first.texts[1].top - first.fill.bottom,
      0,
    );

    await finals
      .nth(0)
      .locator(".game-open")
      .evaluate((open) => open.classList.remove("is-pressed"));
    const last = await pressAndMeasure(1);
    expect(last.fill.bottom).toBeCloseTo(last.inside.bottom, 1);
    expect(last.fill.top).toBeCloseTo(first.fill.bottom, 1);
  });

  test("dismissing the Updates box in another tab hides it in this one", async ({ page }) => {
    await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");

    await keepInOtherTab(page, "updatesSeenAt", await page.evaluate(() => Date.now()));

    await expect(updates).toBeHidden();
  });
});

test.describe("on a phone, tapping an update", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /**
   * Taps the middle of a team's name in an update, as a thumb would.
   * @param {import("@playwright/test").Page} page
   * @param {number} index
   * @param {string} name the team's full name
   */
  async function tapTeamName(page, index, name) {
    const team = page
      .locator("#updates li")
      .nth(index)
      .getByRole("button", { name: `Team details: ${name}` });
    const box = await team.boundingBox();
    if (!box) throw new Error(`${name} isn't in update ${index}`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  test("opens that update's game's sheet, even on a team's name", async ({ page }) => {
    await openApp(page, { updatesBox: "shown" });
    await expect(page.locator("#updates .what")).toHaveCount(2);
    const sheet = page.locator("#gameSheet");

    await tapTeamName(page, 0, "Minnesota Lynx");
    await expect(sheet.locator("#gameWhen")).toContainText("Liberty won");
    await expect(page.locator("#teamSheet")).toBeHidden();
    await page.locator("#gameSheet .sheet-close").dispatchEvent("click");
    await expect(sheet).toBeHidden();

    await tapTeamName(page, 1, "Indiana Fever");
    await expect(sheet.locator("#gameWhen")).toContainText("Fever won");
    await expect(page.locator("#teamSheet")).toBeHidden();
  });

  test("on the season tab, a finger on an update lands in the bracket, so a press tints the update and a drag scrolls the bracket without opening the game", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    const update = page.locator("#updates li").first();
    const from = findCenter(await update.boundingBox());

    expect(await findTouchTargets(page, { update: from })).toEqual({ update: "bracket" });

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await expect(update.locator(".game-open")).toHaveClass(/\bis-pressed\b/);
    await page.mouse.move(from.x, from.y + 40);
    await page.mouse.up();
    await expect(update.locator(".game-open")).not.toHaveClass(/\bis-pressed\b/);

    await (
      await drag(page, from, { y: -120 })
    )();

    await expect.poll(() => readSeasonPartScroll(page, "bracket")).toBeGreaterThan(0);
    await expect(page.locator("#gameSheet")).toBeHidden();
  });

  test("on the season tab, an update's stand-in rides with it, so a tap with the header partly gone opens its game, and once the pill holds the stand-ins take no touch", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    await scrollSeasonPart(page, "bracket", 30);
    const update = page.locator("#updates li").first();
    const at = findCenter(await update.boundingBox());

    await page.touchscreen.tap(at.x, at.y);

    await expect(page.locator("#gameSheet #gameWhen")).toContainText("Liberty won");
    await page.locator("#gameSheet .sheet-close").dispatchEvent("click");
    await expect(page.locator("#gameSheet")).toBeHidden();

    await scrollSeasonPart(page, "bracket", await readHeaderReach(page));

    await expect(page.locator('[data-part="bracket"] .rider-taps')).toHaveCSS("display", "none");
  });

  test("on the season tab, a finger the browser takes for a scroll on an update's stand-in never opens its game, even when iOS still sends the tap", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    await scrollSeasonPart(page, "bracket", 30);
    const standIn = page.locator('[data-part="bracket"] .rider-tap').first();
    await expect(standIn).toBeAttached();
    await holdClock(page);

    await sendFinger(standIn, { moves: [12], isCancelled: true });

    expect(await sendClick(standIn)).toBe(false);
    await expect(page.locator("#gameSheet")).toBeHidden();
  });

  test("on the season tab, a still finger on an update's stand-in while the bracket glides never opens its game, even when iOS still sends the tap", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    await scrollSeasonPart(page, "bracket", 30);
    const standIn = page.locator('[data-part="bracket"] .rider-tap').first();
    await expect(standIn).toBeAttached();
    await holdClock(page);
    await sendFinger(standIn, { moves: [12], isCancelled: true, isScrolling: true });
    await sendScroll(page, page.locator('.season-part[data-part="bracket"]'));

    await sendFinger(standIn, { moves: [] });

    expect(await sendClick(standIn)).toBe(false);
    await expect(page.locator("#gameSheet")).toBeHidden();
  });

  test("on the season tab, an update that loses its game's button while the box keeps its size leaves the stand-ins under the others, so a tap on the update under it opens that update's own game", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    await expect(page.locator(".rider-tap")).toHaveCount(2 * 3);
    const box = page.locator("#updates");
    const height = (await box.boundingBox())?.height;

    await page
      .locator("#updates li")
      .first()
      .locator(".game-open")
      .evaluate((button) => button.remove());

    await expect(page.locator(".rider-tap")).toHaveCount(2 * 2);
    expect((await box.boundingBox())?.height).toBe(height);
    const at = findCenter(await page.locator("#updates li").nth(1).boundingBox());
    await page.touchscreen.tap(at.x, at.y);

    await expect(page.locator("#gameSheet #gameWhen")).toContainText("Fever won");
  });

  test("where the header stays put, a tap on an update opens its game from the update itself, with no stand-in over the bracket", async ({
    page,
  }) => {
    await holdHeaderStill(page);
    await openBracketWithUpdates(page);

    await expect(page.locator(".rider-tap")).toHaveCount(0);

    const at = findCenter(await page.locator("#updates li").first().boundingBox());
    await page.touchscreen.tap(at.x, at.y);

    await expect(page.locator("#gameSheet #gameWhen")).toContainText("Liberty won");
  });
});

test.describe("on a phone, in full motion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
  });

  /** @typedef {import("../../../../tests/browser/animations.mjs").PlayedAnimation} PlayedAnimation */
  /** @param {PlayedAnimation} animation */
  const isOpening = ({ classes, first, last, direction }) =>
    classes.includes("updates") &&
    direction === "normal" &&
    first.height === "0px" &&
    first.marginBottom === "0px" &&
    parseFloat(String(last.height)) > 0;
  // The box shrinks away on its opening's curve, from where it is to nothing.
  /** @param {PlayedAnimation} animation */
  const isClosing = ({ classes, first, last, direction }) =>
    classes.includes("updates") &&
    direction === "normal" &&
    last.height === "0px" &&
    last.marginBottom === "0px" &&
    parseFloat(String(first.height)) > 0;

  test("on the season tab, after a trip to the standings and back, a tap on an update still opens its game and a tap on the X still closes the box", async ({
    page,
  }) => {
    await openBracketWithUpdates(page);
    const parts = page.locator("#bracketStandingsParts");
    await openSeasonPart(page, "Standings");
    await expect(page.locator("#standings-league")).toBeInViewport();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await openSeasonPart(page, "Bracket");
    await expect(page.locator("#bracketWrap .bracket")).toBeInViewport();
    await expect(parts).not.toHaveAttribute("data-sliding");
    const at = findCenter(await page.locator("#updates li").first().boundingBox());

    await page.touchscreen.tap(at.x, at.y);

    await expect(page.locator("#gameSheet #gameWhen")).toContainText("Liberty won");
    await page.locator("#gameSheet .sheet-close").dispatchEvent("click");
    await expect(page.locator("#gameSheet")).toBeHidden();

    await dismissUpdatesBox(page);

    await expect(page.locator("#updates")).toBeHidden();
    await expect(page.locator(".rider-tap")).toHaveCount(0);
  });

  test("the Updates box shrinks away when it's dismissed, and grows open for a new final", async ({
    page,
  }) => {
    const readAnimations = await listAnimations(page);
    const app = await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");

    await dismissUpdatesBox(page);

    expect((await readAnimations()).filter(isClosing)).toHaveLength(1);
    // Shrunk to nothing, the box looks hidden a frame before it is, and a final in between
    // would find it still closing.
    await expect(updates).toHaveAttribute("hidden");

    await app.changeSeason(finishDreamAtMystics);

    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    expect((await readAnimations()).filter(isOpening)).toHaveLength(1);
  });

  test("with the standings scrolled, the Updates box growing open moves no row on the screen on any frame, and the pill stays held", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "new" });
    await openSeasonPart(page, "Standings");
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await scrollSeasonPartToEnd(page, "standings");
    await waitForLoadToSettle(page);
    const readFrames = await trackRowFrames(page, "#standingsWrap tr");

    await app.changeSeason(finishDreamAtMystics);

    await expect(page.locator("#updates .updates-count")).toHaveText(
      "1 update since earlier today",
    );
    await waitForTimedAnimations(page);
    expectRowHeldStill(await readFrames(), { isPillHeld: true });
  });

  test("with the standings at their top, the Updates box grows open in view over them", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "new" });
    await openSeasonPart(page, "Standings");
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await waitForLoadToSettle(page);

    await app.changeSeason(finishDreamAtMystics);

    await expect(page.locator("#updates .updates-count")).toHaveText(
      "1 update since earlier today",
    );
    await waitForTimedAnimations(page);
    await expect(page.locator("#updates")).toBeInViewport({ ratio: 1 });
    expect(await readSeasonPartScroll(page, "standings")).toBe(0);
  });

  test("with News scrolled, the Updates box growing open moves no story on the screen on any frame", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "new" });
    await fillNews(page, app.writeDocument);
    await moveNewsOffTop(page);
    await waitForLoadToSettle(page);
    const readFrames = await trackRowFrames(page, "#newsList .news-card");

    await app.changeSeason(finishDreamAtMystics);

    await expect(page.locator("#updates .updates-count")).toHaveText(
      "1 update since earlier today",
    );
    await waitForTimedAnimations(page);
    expectRowHeldStill(await readFrames(), { isPillHeld: false });
  });

  test("with the Games list on an earlier day, the Updates box growing open keeps that day at the list's top", async ({
    page,
  }) => {
    const app = await openApp(page, { updatesBox: "new", isWholeSeason: true });
    await page.getByRole("tab", { name: "Games" }).click();
    const day = page.locator('#seasonGames .listed-day[data-day="2026-09-20"]');
    await page.locator('#seasonGames .day-cell[data-day="2026-09-20"]').click();
    await expect(day).toBeInViewport();
    await waitForLoadToSettle(page);
    const readDayGap = () =>
      day.evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          /** @type {Element} */ (element.closest(".day-list")).getBoundingClientRect().top,
      );
    const gap = await readDayGap();

    await app.changeSeason(finishDreamAtMystics);

    await expect(page.locator("#updates .updates-count")).toHaveText(
      "1 update since earlier today",
    );
    await waitForTimedAnimations(page);
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
      "data-day",
      "2026-09-20",
    );
    expect(await readDayGap()).toBeCloseTo(gap, 0);
  });

  test("an Updates box that fills again as it shrinks away grows back open from where it had shrunk to, and shrinks away again from where it has grown back to", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    const readAnimations = await listAnimations(page);
    const app = await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count").first()).toHaveText("2 updates since yesterday");
    // Each easing of the box starts held halfway, so none can finish before the next step. The
    // box's ride with the bracket's scroll isn't an easing.
    await updates.evaluate((box, halfway) => {
      const animate = box.animate.bind(box);
      box.animate = (frames, options) => {
        const animation = animate(frames, options);
        if (animation.timeline === document.timeline) {
          animation.pause();
          animation.currentTime = halfway;
        }
        return animation;
      };
    }, EASE_HALFWAY_MS);
    const readLastOfBox = async () =>
      (await readAnimations()).filter(({ classes }) => classes.includes("updates")).at(-1);
    const readBox = () =>
      updates.evaluate((box) => {
        const { height, opacity } = getComputedStyle(box);
        const easings = box
          .getAnimations()
          .filter((animation) => animation.timeline === document.timeline);
        return { height, opacity, easings: easings.length };
      });

    await dismissUpdatesBox(page);
    const halfClosed = await readBox();

    // The release note leaves with the finals it was dismissed with, so the box's own parts
    // change as it grows back.
    await app.changeSeason(finishDreamAtMystics);
    // The box keeps the release note's heading while it's held shrinking, until the new final
    // redraws it without one.
    await expect(updates.locator(".updates-count")).toHaveText(["1 update since earlier today"]);
    const reopening = await readLastOfBox();
    expect(reopening.direction).toBe("normal");
    expect(reopening.first).toMatchObject({
      height: halfClosed.height,
      opacity: halfClosed.opacity,
    });
    const halfReopened = await readBox();
    expect(halfReopened.easings).toBe(1);

    await dismissUpdatesBox(page);
    const closing = await readLastOfBox();
    expect(closing.direction).toBe("normal");
    expect(closing.first.height).toBe(halfReopened.height);
    expect(closing.last.height).toBe("0px");
    expect((await readBox()).easings).toBe(1);
    await finishTimedAnimations(page);
    await expect(updates).toBeHidden();
  });
});

test.describe("on a phone, with a release note out", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the note sits under the finals, headed New in the app, its word in bold at 500, over its text at Body in the same font, as the finals' team names are, and closes with them", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    await openApp(page, { updatesBox: "shown" });
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText([
      "2 updates since yesterday",
      "New in the app",
    ]);
    await expect(updates.locator(".updates-notes .what")).toHaveText("Tap a game, then Channels.");
    const bold = updates.locator(".updates-notes .what b");
    await expect(bold).toHaveCSS(
      "font-weight",
      String((await readRole(page, "body")).weight + 200),
    );
    const font = await bold.evaluate((element) => getComputedStyle(element).fontFamily);
    await expect(updates.locator(".updates-notes .what")).toHaveCSS("font-family", font);
    await expect(updates.locator(".updates-list .what b").first()).toHaveCSS("font-family", font);
    await expect(updates.locator(".updates-list .what b").first()).toHaveCSS(
      "font-weight",
      String((await readRole(page, "body")).weight + 200),
    );
    const finals = await updates.locator(".updates-list").first().boundingBox();
    const notes = await updates.locator(".updates-notes").boundingBox();
    expect(notes.y).toBeGreaterThan(finals.y + finals.height);

    await dismissUpdatesBox(page);
    await expect(updates).toBeHidden();
    await page.reload();
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();
  });

  test("the box lists the newest three notes and how many more under them", async ({ page }) => {
    await serveReleaseNote(page, [
      CHANNELS_NOTE,
      { at: "2026-09-28T15:00:00Z", text: "Rosters" },
      { at: "2026-09-27T15:00:00Z", text: "News" },
      { at: "2026-09-20T15:00:00Z", text: "Scores" },
    ]);
    await openApp(page, { updatesBox: "shown" });
    const notes = page.locator("#updates .updates-notes");

    await expect(notes.locator(".what")).toHaveText([
      "Tap a game, then Channels.",
      "Rosters",
      "News",
    ]);
    await expect(notes.locator(".more")).toHaveText("and 1 more");
    const readTextLeft = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().left;
    };
    const noteLeft = await notes.locator(".what").first().evaluate(readTextLeft);
    expect(await notes.locator(".more").evaluate(readTextLeft)).toBe(noteLeft);
  });

  test.describe("on a small phone, with a full Updates box", () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await serveReleaseNote(page, [
        CHANNELS_NOTE,
        { at: "2026-09-28T15:00:00Z", text: "Rosters, with each player's stats" },
        { at: "2026-09-27T15:00:00Z", text: "News from each team's outlets" },
      ]);
    });

    /**
     * Opens the app with its box full, and checks a view keeps most of the screen and the page
     * scrolls the rest of it into view.
     * @param {import("@playwright/test").Page} page
     * @param {string} selector
     */
    const expectMostOfScreen = async (page, selector) => {
      const view = page.locator(selector);
      await page.evaluate(() => document.fonts.ready);
      expect(await view.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(
        Math.floor(568 * 0.6),
      );
      await scrollPageToEnd(page);
      expect(
        await view.evaluate((element) => Math.round(element.getBoundingClientRect().bottom)),
      ).toBeLessThanOrEqual(568);
    };

    test("the box rides away with the bracket as it scrolls, until the pill holds at the top", async ({
      page,
    }) => {
      await openApp(page, { updatesBox: "shown" });
      await expect(page.locator("#updates .updates-notes .what")).toHaveCount(3);
      await expect(page.locator("#bracketWrap .bracket")).toBeVisible();

      await scrollSeasonPartToEnd(page, "bracket");

      await expect
        .poll(() => readSeasonRide(page))
        .toMatchObject({ pillTop: await readPillHoldTop(page), pageScroll: 0 });
      const box = await page.locator("#updates").boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(await readPillHoldTop(page));
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
      ).toBeLessThanOrEqual(1);
    });

    test("where the header stays put, the box leaves the bracket most of the screen, and the page scrolls the rest of it into view", async ({
      page,
    }) => {
      await holdHeaderStill(page);
      await openApp(page, { updatesBox: "shown" });
      await expect(page.locator("#updates .updates-notes .what")).toHaveCount(3);
      await expect(page.locator("#bracketWrap .bracket")).toBeVisible();

      await expectMostOfScreen(page, "#view-bracket-standings");
    });

    test("the box leaves the Games list most of the screen, and the page scrolls the rest of it into view", async ({
      page,
    }) => {
      await openApp(page, { updatesBox: "shown" });
      await expect(page.locator("#updates .updates-notes .what")).toHaveCount(3);
      await page.getByRole("tab", { name: "Games" }).click();
      await expect(page.locator("#view-games .day-list")).toBeVisible();

      await expectMostOfScreen(page, "#view-games");
    });
  });

  test("dismissing the release notes in another tab hides them in this one", async ({ page }) => {
    await serveReleaseNote(page);
    await openApp(page, { updatesBox: "shown" });
    const notes = page.locator("#updates .updates-notes");
    await expect(notes.locator(".what")).toHaveCount(1);

    await keepInOtherTab(page, "releaseNotesShownUntil", {
      [CHANNELS_NOTE.at]: Date.parse("2026-09-30T21:00:00Z"),
    });

    await expect(notes).toHaveCount(0);
  });
});

test("a computer shows no Updates box", async ({ page }) => {
  await openApp(page, { updatesBox: "shown" });
  await expect(page.locator(".series").first()).toBeVisible();

  await expect(page.locator("#updates")).toBeHidden();
});
