import { holdClock } from "./harness.mjs";

// Every control that opens, closes, or goes back starts its change on the frame of its tap, never
// after a wait for its press to show. The walk finds those controls itself: in each view, it taps
// one button of each kind the top layer shows, and each tap that leaves a different sheet, screen,
// or search showing is one of them.

/** @typedef {import("./view-walk.mjs").View} View */

const FRAME_MS = 16;
// Past any sheet's motion, so the place a tap leaves shows.
const SETTLE_MS = 2000;

/**
 * Notes, while asked, each change the page makes to its dialogs or its search but a press's own
 * look, and each motion it starts. Call it before the page loads.
 * @param {import("@playwright/test").Page} page
 */
async function watchChanges(page) {
  await page.addInitScript(() => {
    const isPressClass = (/** @type {string} */ name) => name.includes("press");
    const listClasses = (/** @type {string | null} */ text) =>
      (text ?? "")
        .split(/\s+/)
        .filter((name) => name && !isPressClass(name))
        .sort()
        .join(" ");
    const isPressOnly = (/** @type {MutationRecord} */ record) =>
      record.type === "attributes" &&
      record.attributeName === "class" &&
      listClasses(record.oldValue) ===
        listClasses(/** @type {Element} */ (record.target).getAttribute("class"));
    const watch = { changes: 0, isOn: false };
    const observer = new MutationObserver((records) => {
      watch.changes += records.filter((record) => !isPressOnly(record)).length;
    });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (watch.isOn) watch.changes += 1;
      return animate.call(this, keyframes, options);
    };
    document.addEventListener("animationstart", () => {
      if (watch.isOn) watch.changes += 1;
    });
    Object.assign(window, {
      tapWatch: {
        start() {
          watch.changes = 0;
          watch.isOn = true;
          for (const part of document.querySelectorAll("dialog, #gameSearch"))
            observer.observe(part, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
              attributeOldValue: true,
            });
        },
        read() {
          watch.changes += observer.takeRecords().filter((record) => !isPressOnly(record)).length;
          return watch.changes;
        },
        stop() {
          observer.disconnect();
          watch.isOn = false;
        },
      },
    });
  });
}

/**
 * Which dialogs are open, each with its shown sheets and titles, and whether the search shows.
 * @param {import("@playwright/test").Page} page
 */
const readPlace = (page) =>
  page.evaluate(() =>
    JSON.stringify({
      dialogs: [...document.querySelectorAll("dialog[open]")].map((dialog) => ({
        id: dialog.id,
        sheets: [...dialog.querySelectorAll(".sheet-page")]
          .filter((sheet) => sheet.checkVisibility())
          .map((sheet) => sheet.id),
        titles: [...dialog.querySelectorAll("h2")]
          .filter((title) => title.checkVisibility())
          .map((title) => title.textContent?.trim()),
      })),
      search: Boolean(document.querySelector("#gameSearch")?.checkVisibility()),
    }),
  );

/**
 * The middle of the next button of a kind not yet tried that the top layer shows, scrolled to
 * where a tap lands on it, with its kind and name, or null once every kind has been tried. A tab
 * switches what shows in place and a submit button sends, so neither is tried.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} tried
 */
const findNextButton = (page, tried) =>
  page.evaluate((tried) => {
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog[open]");
    const scope = top ?? document;
    const nameKind = (/** @type {Element} */ button) =>
      [
        button.closest(".sheet-page, dialog, [role='tabpanel']")?.id ?? "page",
        [...button.classList].filter((name) => !name.includes("press")).sort(),
        button
          .getAttributeNames()
          .filter((name) => name.startsWith("data-"))
          .sort(),
      ].join("|");
    const buttons = [...scope.querySelectorAll("button")].filter(
      (button) =>
        (top || !button.closest("dialog")) &&
        !button.disabled &&
        button.type !== "submit" &&
        button.getAttribute("role") !== "tab" &&
        !button.closest("[inert]") &&
        button.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    );
    for (const button of buttons) {
      const kind = nameKind(button);
      if (tried.includes(kind)) continue;
      button.scrollIntoView({ block: "center" });
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const name = `${kind} (${button.getAttribute("aria-label") ?? button.textContent?.trim()})`;
      const isReached = button.contains(document.elementFromPoint(x, y));
      return { kind, name, x, y, isReached };
    }
    return null;
  }, tried);

/**
 * Closes every dialog and the search, and opens the view again.
 * @param {import("@playwright/test").Page} page
 * @param {View} view
 * @param {import("@playwright/test").Expect<any>} expect
 */
async function openViewAgain(page, view, expect) {
  while (await page.locator("dialog[open]").count()) {
    await page.keyboard.press("Escape");
    await page.clock.runFor(SETTLE_MS);
  }
  const cancel = page.locator("#gameSearch button.search-cancel");
  if (await cancel.isVisible()) await cancel.click();
  await view.open(page);
  await expect(view.shown(page)).toBeVisible();
  await page.clock.runFor(SETTLE_MS);
}

/**
 * Taps a button, and says whether it left another place showing and whether it had started
 * changing the page by the frame after its tap.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} button
 */
async function tapAndWatch(page, { x, y }) {
  const before = await readPlace(page);
  await holdClock(page);
  await page.evaluate(() => /** @type {any} */ (window).tapWatch.start());
  await page.mouse.click(x, y);
  await page.clock.runFor(FRAME_MS);
  const isStarted = await page.evaluate(() => /** @type {any} */ (window).tapWatch.read() > 0);
  await page.evaluate(() => /** @type {any} */ (window).tapWatch.stop());
  await page.clock.runFor(SETTLE_MS);
  await page.clock.resume();
  return { isMoved: (await readPlace(page)) !== before, isStarted };
}

/**
 * Taps one button of each kind in each view, and lists the taps that opened, closed, or went back.
 * @param {import("@playwright/test").Page} page
 * @param {View[]} views
 * @param {import("@playwright/test").Expect<any>} expect
 */
async function tapEachKindOfButton(page, views, expect) {
  /** @type {string[]} */
  const tried = [];
  /** @type {{ name: string, isStarted: boolean }[]} */
  const moves = [];
  for (const view of views) {
    await openViewAgain(page, view, expect);
    let button = await findNextButton(page, tried);
    while (button) {
      tried.push(button.kind);
      if (button.isReached) {
        const { isMoved, isStarted } = await tapAndWatch(page, button);
        if (isMoved) moves.push({ name: `${view.name}: ${button.name}`, isStarted });
        if (isMoved || !(await view.shown(page).isVisible()))
          await openViewAgain(page, view, expect);
      }
      button = await findNextButton(page, tried);
    }
  }
  return moves;
}

/**
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {{
 *   openWithEverything: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   viewGroups: Record<string, View[]>,
 * }} app
 */
export function testTapsActAtOnce(test, expect, { openWithEverything, viewGroups }) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  for (const [group, views] of Object.entries(viewGroups)) {
    test(`in ${group}, each tap that opens, closes, or goes back starts on the frame of the tap`, async ({
      page,
    }) => {
      test.slow();
      await watchChanges(page);
      await openWithEverything(page);

      const moves = await tapEachKindOfButton(page, views, expect);

      expect(moves.length).toBeGreaterThan(0);
      expect(moves.filter((move) => !move.isStarted).map((move) => move.name)).toEqual([]);
    });
  }
}
