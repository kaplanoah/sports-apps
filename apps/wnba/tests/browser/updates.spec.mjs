import { test, expect, openApp } from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";

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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a release note's lines sit 1.3 apart", async ({ page }) => {
    await serveReleaseNote(page);
    await openApp(page, { isShowingUpdates: true });
    const body = await readRole(page, "body");
    await expect(page.locator("#updates .updates-notes .what")).toHaveCSS(
      "line-height",
      `${body.size * 1.3}px`,
    );
  });

  test("a final's team names are set in their sentence's font, at 500, two steps over Body", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
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

  test("the Updates box opens on the latest day's playoff finals, newest first, until it's dismissed, and then lists only what's new", async ({
    page,
  }) => {
    const app = await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");
    await expect(updates.locator(".what")).toHaveText([
      "Liberty beat the Lynx 87-71 to win the First Round 2-0",
      "Fever beat the Aces 99-89 in Game\u00a02, tie the First Round 1-1",
    ]);

    await page.getByRole("button", { name: "Dismiss updates" }).click();
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

  test("a pressed final tints across the box's whole width, halfway to what's above and below it", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
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
    await openApp(page, { isShowingUpdates: true });
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
    await openApp(page, { isShowingUpdates: true });
    await expect(page.locator("#updates .what")).toHaveCount(2);
    const sheet = page.locator("#gameSheet");

    await tapTeamName(page, 0, "Minnesota Lynx");
    await expect(sheet.locator("#gameWhen")).toContainText("Liberty won");
    await expect(page.locator("#teamSheet")).toBeHidden();
    await page.locator("#gameCloseBtn").dispatchEvent("click");
    await expect(sheet).toBeHidden();

    await tapTeamName(page, 1, "Indiana Fever");
    await expect(sheet.locator("#gameWhen")).toContainText("Fever won");
    await expect(page.locator("#teamSheet")).toBeHidden();
  });
});

test.describe("on a phone, in full motion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
  });

  /** @typedef {{ element: string, first: Keyframe, last: Keyframe, direction: string }} Animation */
  /** @param {Animation} animation */
  const isGrowing = ({ element, first, last }) =>
    element === "updates" &&
    first.height === "0px" &&
    first.marginBottom === "0px" &&
    parseFloat(String(last.height)) > 0;
  /** @param {Animation} animation */
  const isOpening = (animation) => isGrowing(animation) && animation.direction === "normal";
  // The box shrinks away as its opening played backward.
  /** @param {Animation} animation */
  const isClosing = (animation) => isGrowing(animation) && animation.direction === "reverse";

  test("the Updates box shrinks away when it's dismissed, and grows open for a new final", async ({
    page,
  }) => {
    const readAnimations = await listAnimations(page);
    const app = await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");

    await page.getByRole("button", { name: "Dismiss updates" }).click();

    expect((await readAnimations()).filter(isClosing)).toHaveLength(1);
    // Shrunk to nothing, the box looks hidden a frame before it is, and a final in between
    // would find it still closing.
    await expect(updates).toHaveAttribute("hidden");

    await app.changeSeason(finishDreamAtMystics);

    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    expect((await readAnimations()).filter(isOpening)).toHaveLength(1);
  });

  test("an Updates box that fills again as it shrinks away stays open", async ({ page }) => {
    const app = await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");
    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");
    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.pause()));

    await app.changeSeason(finishDreamAtMystics);
    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));

    await expect(updates).toBeVisible();
    await expect(updates.locator(".what")).toHaveText([
      "Dream beat the Mystics 88-80 to win the First Round 2-0",
    ]);
  });
});

test.describe("on a phone, with a release note out", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the note sits under the finals, headed New in the app, its word in bold at 500, over its text at Body in the same font, as the finals' team names are, and closes with them", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    await openApp(page, { isShowingUpdates: true });
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

    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await expect(updates).toBeHidden();
    await page.reload();
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();
  });

  test("a new phone lists the notes from the last two weeks, from before the latest finals too, the newest three and how many more under them", async ({
    page,
  }) => {
    await serveReleaseNote(page, [
      CHANNELS_NOTE,
      { at: "2026-09-28T15:00:00Z", text: "Rosters" },
      { at: "2026-09-27T15:00:00Z", text: "News" },
      { at: "2026-09-20T15:00:00Z", text: "Scores" },
      { at: "2026-09-10T15:00:00Z", text: "Brackets" },
    ]);
    await openApp(page, { isShowingUpdates: true });
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

  test("a phone that dismissed the box before it kept its notes' times still hides the notes out by then", async ({
    page,
  }) => {
    await serveReleaseNote(page, [CHANNELS_NOTE, { at: "2026-09-28T15:00:00Z", text: "Rosters" }]);
    await page.addInitScript(() =>
      localStorage.setItem("updatesSeenAt", String(Date.parse("2026-09-29T00:00:00Z"))),
    );
    await openApp(page, { isShowingUpdates: true });

    await expect(page.locator("#updates .updates-notes .what")).toHaveText([
      "Tap a game, then Channels.",
    ]);
  });

  test("dismissing the release notes in another tab hides them in this one", async ({ page }) => {
    await serveReleaseNote(page);
    await openApp(page, { isShowingUpdates: true });
    const notes = page.locator("#updates .updates-notes");
    await expect(notes.locator(".what")).toHaveCount(1);

    await keepInOtherTab(page, "releaseNotesShownUntil", {
      [CHANNELS_NOTE.at]: Date.parse("2026-09-30T21:00:00Z"),
    });

    await expect(notes).toHaveCount(0);
  });
});

test("a computer shows no Updates box", async ({ page }) => {
  await openApp(page, { isShowingUpdates: true });
  await expect(page.locator(".series").first()).toBeVisible();

  await expect(page.locator("#updates")).toBeHidden();
});
