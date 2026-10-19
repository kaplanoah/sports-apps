// The ? that ends, on a touch screen, settings' Notifications note where notifications come only
// from the Home Screen, and the welcome it opens over settings, which rises and closes as a sheet
// does.

import { expect } from "@playwright/test";
import { takeAwayPush } from "./devices.mjs";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
import { drag } from "./touch.mjs";

export const WELCOME = "#homeScreenWelcome";
export const SETTINGS = "#settingsDialog";
const HOME_SCREEN_NOTE = /add this site to your home screen/;

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   openApp: (
 *     page: import("@playwright/test").Page,
 *     options?: { isShowingWelcome?: boolean },
 *   ) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} App
 */

/** @param {import("@playwright/test").Page} page */
const findHelp = (page) => page.getByRole("button", { name: "How to get notifications" });

/**
 * Opens settings and taps the Notifications note's ?.
 * @param {App} app
 */
async function openWelcomeFromHelp({ page, openApp, openSettings }) {
  await takeAwayPush(page);
  await openApp(page);
  await openSettings(page);
  await findHelp(page).click();
  await expect(page.locator(WELCOME)).toBeVisible();
}

/**
 * How far apart the note's lines of words sit, and how tall the note is for each, against its
 * line height.
 * @param {import("@playwright/test").Page} page
 */
const measureNoteLines = (page) =>
  page.locator("#notifyNote").evaluate((note) => {
    const texts = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
    const tops = new Set();
    while (texts.nextNode()) {
      const words = document.createRange();
      words.selectNodeContents(texts.currentNode);
      for (const line of words.getClientRects()) tops.add(line.top);
    }
    const lineTops = [...tops].sort((above, below) => above - below);
    const round = (pixels) => Math.round(pixels * 10) / 10;
    return {
      lineHeight: round(parseFloat(getComputedStyle(note).lineHeight)),
      apart: [...new Set(lineTops.slice(1).map((top, index) => round(top - lineTops[index])))],
      perLine: round(note.getBoundingClientRect().height / lineTops.length),
    };
  });

/**
 * On an iPhone's or iPad's browser, the note says why notifications need the Home Screen and ends
 * with a ?, 15px and a pixel up in its 44px tap, that keeps each line at the note's line height and
 * opens the welcome over settings, which its caret and Escape each close back to settings.
 * @param {App} app
 */
export async function checkHelpOpensWelcome(app) {
  const { page } = app;
  await takeAwayPush(page);
  await app.openApp(page);
  await app.openSettings(page);
  await expect(page.locator("#notifyNote")).toHaveText(HOME_SCREEN_NOTE);
  await expect(findHelp(page)).toBeVisible();
  await expect(findHelp(page)).toHaveCSS("width", "44px");
  await expect(findHelp(page)).toHaveCSS("height", "44px");
  await expect(findHelp(page).locator("svg")).toHaveCSS("width", "15px");
  await expect(findHelp(page).locator("svg")).toHaveCSS("top", "-1px");
  expect(await listTapsOffButtons(page)).toEqual([]);
  const { lineHeight, apart, perLine } = await measureNoteLines(page);
  expect({ apart, perLine }).toEqual({ apart: [lineHeight], perLine: lineHeight });
  await findHelp(page).click();
  const welcome = page.locator(WELCOME);
  await expect(welcome).toBeVisible();
  await expect(page.locator(SETTINGS)).toBeVisible();

  await welcome.getByRole("button", { name: "Close" }).click();
  await expect(welcome).toBeHidden();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await findHelp(page).click();
  await welcome.press("Escape");
  await expect(welcome).toBeHidden();
  await expect(page.locator(SETTINGS)).toBeVisible();
}

/**
 * On a phone, the welcome a first visit opens on is there from the first paint, while the one the
 * ? opens rises over settings as a sheet does, leaving them in sight, and the caret and Continue in
 * browser each slide it down.
 * @param {App} app
 */
export async function checkWelcomeRises({ page, openApp, openSettings }) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await takeAwayPush(page);
  await openApp(page, { isShowingWelcome: true });
  const welcome = page.locator(WELCOME);
  await expect(welcome).toHaveCSS("animation-name", "none");
  await welcome.getByRole("button", { name: "Continue in browser" }).click();

  await openSettings(page);
  for (const button of [".welcome-close", ".welcome-continue"]) {
    await findHelp(page).click();
    await expect(welcome).toHaveCSS("animation-name", "sheet-rise");
    expect(
      await welcome.evaluate((dialog) => getComputedStyle(dialog, "::backdrop").backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    const isSliding = await welcome.evaluate((dialog, selector) => {
      /** @type {HTMLButtonElement} */ (dialog.querySelector(selector)).click();
      return dialog.hasAttribute("open") && dialog.style.transform === "translateY(100%)";
    }, button);
    expect(isSliding, button).toBe(true);
    await expect(welcome).toBeHidden();
    await expect(page.locator(SETTINGS)).toBeVisible();
  }
}

/**
 * Notes, on each frame until the returned function stops and reads them, how far down the welcome
 * sits while it's open, and where settings are.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<{ welcomeTop: number | null, settings: string }[]>>}
 */
async function trackWelcomeFrames(page) {
  await page.evaluate(
    ({ welcomeSelector, settingsSelector }) => {
      const welcome = /** @type {HTMLDialogElement} */ (document.querySelector(welcomeSelector));
      const settings = /** @type {HTMLElement} */ (document.querySelector(settingsSelector));
      const frames = /** @type {object[]} */ ([]);
      const note = () => {
        const box = settings.getBoundingClientRect();
        frames.push({
          welcomeTop: welcome.open ? welcome.getBoundingClientRect().top : null,
          settings: [box.left, box.top, box.width, box.height].join(" "),
        });
        if (/** @type {any} */ (window).trackedFrames === frames) requestAnimationFrame(note);
      };
      Object.assign(window, { trackedFrames: frames });
      requestAnimationFrame(note);
    },
    { welcomeSelector: WELCOME, settingsSelector: SETTINGS },
  );
  return () =>
    page.evaluate(() => {
      const frames = /** @type {any} */ (window).trackedFrames;
      Object.assign(window, { trackedFrames: null });
      return frames;
    });
}

/**
 * Whether each number is at least the one before it, or, going `up`, at most.
 * @param {number[]} tops
 * @param {{ up?: boolean }} [options]
 */
const isOneWay = (tops, { up = false } = {}) =>
  tops.every((top, index) => index === 0 || (up ? top <= tops[index - 1] : top >= tops[index - 1]));

/**
 * On a phone, a slow swipe down too short to close moves the welcome down with the finger and
 * springs it back to the top, and a flick down slides it away to settings, the welcome never
 * stepping back on any frame and settings never moving.
 * @param {App} app
 */
export async function checkWelcomeSwipesDown(app) {
  const { page } = app;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openWelcomeFromHelp(app);
  const welcome = page.locator(WELCOME);
  await expect.poll(async () => (await welcome.boundingBox())?.y).toBe(0);

  let readFrames = await trackWelcomeFrames(page);
  const lift = await drag(
    page,
    { x: 300, y: 300 },
    { y: 40 },
    { durationMs: 1000, isFrameByFrame: true },
  );
  await expect.poll(async () => (await welcome.boundingBox())?.y).toBeGreaterThan(0);
  const dragged = await readFrames();
  readFrames = await trackWelcomeFrames(page);
  await lift();
  await expect.poll(async () => (await welcome.boundingBox())?.y).toBe(0);
  const sprungBack = await readFrames();
  expect(dragged.filter((frame) => frame.welcomeTop > 0).length).toBeGreaterThan(1);
  expect(isOneWay(dragged.map((frame) => frame.welcomeTop))).toBe(true);
  expect(sprungBack.at(0)?.welcomeTop).toBeGreaterThan(0);
  expect(
    isOneWay(
      sprungBack.map((frame) => frame.welcomeTop),
      { up: true },
    ),
  ).toBe(true);
  await expect(welcome).toBeVisible();

  readFrames = await trackWelcomeFrames(page);
  const liftFlick = await drag(page, { x: 300, y: 300 }, { y: 300 });
  await liftFlick();
  await expect(welcome).toBeHidden();
  const flicked = await readFrames();
  const slid = flicked.filter((frame) => frame.welcomeTop !== null);
  expect(isOneWay(slid.map((frame) => frame.welcomeTop))).toBe(true);
  expect(slid.filter((frame) => frame.welcomeTop > 0).length).toBeGreaterThan(1);

  const settingsPlaces = [...dragged, ...sprungBack, ...flicked].map((frame) => frame.settings);
  expect(new Set(settingsPlaces).size).toBe(1);
  await expect(page.locator(SETTINGS)).toBeVisible();
}

/**
 * In Safari, a theme picked on the welcome the ? opened loads the page again, still on the welcome,
 * which stays closed through the next load once it closes.
 * @param {App & { darkLook: string }} app
 */
export async function checkPickKeepsWelcome(app) {
  const { page, darkLook } = app;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => false });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await takeAwayPush(page);
  // A load that marks the welcome closed would hide what the page keeps through its reload.
  await app.openApp(page, { isShowingWelcome: true });
  const welcome = page.locator(WELCOME);
  await welcome.getByRole("button", { name: "Continue in browser" }).click();
  await app.openSettings(page);
  await findHelp(page).click();
  await expect(welcome).toBeVisible();
  await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
  await welcome.getByRole("radio", { name: darkLook }).click();
  await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole("radio", { name: darkLook })).toBeChecked();

  await welcome.getByRole("button", { name: "Close" }).click();
  await expect(welcome).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(welcome).toBeHidden();
}

/**
 * A welcome closed before the page's code arrived rises when the ? opens it again.
 * @param {App} app
 */
export async function checkRiseAfterEarlyClose({ page, openApp, openSettings }) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await takeAwayPush(page);
  await openApp(page, { isShowingWelcome: true });
  const release = await holdRequests(page, matchPath("/js/app.js"));
  await page.reload({ waitUntil: "commit" });
  const welcome = page.locator(WELCOME);
  await welcome.getByRole("button", { name: "Continue in browser" }).click();
  await expect(welcome).toBeHidden();
  release();
  await page.waitForLoadState("domcontentloaded");

  await openSettings(page);
  await findHelp(page).click();
  await expect(welcome).toHaveCSS("animation-name", "sheet-rise");
}

/**
 * Before the page's code arrives, the caret closes a first visit's welcome at once, for good.
 * @param {App} app
 */
export async function checkCaretBeforeCode({ page, openApp }) {
  await page.route(matchPath("/js/app.js"), (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await openApp(page, { isShowingWelcome: true });
  const welcome = page.locator(WELCOME);
  await welcome.getByRole("button", { name: "Close" }).click();
  await expect(welcome).toBeHidden();
  // The welcome is drawn before the first paint, so it would show by the time the page's code runs.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(welcome).toBeHidden();
}

/**
 * Where the welcome's caret sits, opened from the ?: how far over the welcome's room, out past its
 * words, from settings' own caret, and over its heading.
 * @param {App} app
 */
async function measureWelcomeCaret(app) {
  await openWelcomeFromHelp(app);
  return app.page.locator(WELCOME).evaluate((welcome, settingsSelector) => {
    const style = getComputedStyle(welcome);
    const room = welcome.getBoundingClientRect();
    const close = welcome.querySelector(".welcome-close").getBoundingClientRect();
    const heading = welcome.querySelector(".welcome-title").getBoundingClientRect();
    const settingsClose = document
      .querySelector(`${settingsSelector} .sheet-close`)
      .getBoundingClientRect();
    return {
      overRoom: room.top + parseFloat(style.paddingTop) - close.top,
      pastWords: room.left + parseFloat(style.paddingLeft) - close.left,
      besideSettingsCaret: close.left - settingsClose.left,
      overHeading: heading.top - close.bottom,
    };
  }, SETTINGS);
}

/**
 * On a phone, the welcome's caret, opened from the ?, sits over settings' own caret, 14px over the
 * welcome's room and 14px over its heading.
 * @param {App} app
 */
export async function checkCaretPlace(app) {
  const { overRoom, besideSettingsCaret, overHeading } = await measureWelcomeCaret(app);
  expect({ overRoom, besideSettingsCaret, overHeading }).toEqual({
    overRoom: 14,
    besideSettingsCaret: 0,
    overHeading: 14,
  });
}

/**
 * On a tablet, where the welcome keeps to a column in the middle, its caret reaches 12px out past
 * its words, as a sheet's does, 14px over the welcome's room and 14px over its heading.
 * @param {App} app
 */
export async function checkCaretPlaceOnTablet(app) {
  const { overRoom, pastWords, overHeading } = await measureWelcomeCaret(app);
  expect({ overRoom, pastWords, overHeading }).toEqual({
    overRoom: 14,
    pastWords: 12,
    overHeading: 14,
  });
}

/**
 * An iPad with a trackpad, where the welcome isn't drawn, says why notifications need the Home
 * Screen with no ? to open it.
 * @param {App} app
 */
export async function checkNoHelpWithoutTouch({ page, openApp, openSettings }) {
  await takeAwayPush(page);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator("#notifyNote")).toHaveText(HOME_SCREEN_NOTE);
  await expect(findHelp(page)).toHaveCount(0);
}

/**
 * Android's menu dots reach into their icon's sides in the settings' box, and sit as set by eye
 * in each.
 * @param {App} app
 */
export async function checkMenuDots({ page, openApp, openSettings }) {
  await openApp(page, { isShowingWelcome: true });
  const welcomeDots = page.locator(`${WELCOME} .menu-glyph`);
  await expect(welcomeDots).toHaveCSS("top", "-0.5px");
  await expect(welcomeDots).toHaveCSS("margin", "0px");
  await page.locator(WELCOME).getByRole("button", { name: "Continue in browser" }).click();
  await openSettings(page);
  const boxDots = page.locator("#homeScreenTip .menu-glyph");
  await expect(boxDots).toHaveCSS("margin", "0px -1.5px");
  await expect(boxDots).toHaveCSS("vertical-align", "-1.5px");
}
