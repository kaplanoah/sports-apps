import { expect } from "@playwright/test";
import { EASE_HALFWAY_MS, finishTimedAnimations, listAnimations } from "./animations.mjs";
import { ANDROID_AGENT, IPHONE_AGENT } from "./devices.mjs";
import { LOCKED_PAGE_PATH, matchPath } from "./harness.mjs";
import { listLowContrastText } from "./contrast.mjs";
import { WELCOME } from "./home-screen-help.mjs";
import { SETTINGS } from "./settings.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { keepInOtherTab } from "./other-tab.mjs";
import { listStrayPeriods } from "./stray-periods.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
import { listTextOffRoles } from "./type-roles.mjs";
import { listChipsOffCenter } from "./chip-centering.mjs";
import { passTime, setHidden } from "./visibility.mjs";

const markOnHomeScreen = () => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

// Notes, for each easing the note starts, whether it started inside the event that reports a
// change of the phone's look, in `lookChangeEasings`.
const markLookChangeEasings = () => {
  /** @type {boolean[]} */
  const easings = [];
  Reflect.set(window, "lookChangeEasings", easings);
  let isInLookChange = false;
  const { addEventListener } = MediaQueryList.prototype;
  /** @type {any} */ (MediaQueryList.prototype).addEventListener = function (
    /** @type {string} */ type,
    /** @type {(event: Event) => void} */ listener,
    /** @type {any} */ options,
  ) {
    /** @param {Event} event */
    const reportedInLookChange = (event) => {
      isInLookChange = true;
      try {
        listener.call(this, event);
      } finally {
        isInLookChange = false;
      }
    };
    return addEventListener.call(
      this,
      type,
      type === "change" ? reportedInLookChange : listener,
      options,
    );
  };
  const { animate } = Element.prototype;
  Element.prototype.animate = function (keyframes, options) {
    if (this.classList.contains("re-add-note")) easings.push(isInLookChange);
    return animate.call(this, keyframes, options);
  };
};

const NOTE_WORDS =
  "Apple only sets icons when you add a site to your home screen. To update your icon, re-add the site";

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   looks: { light: string, dark: string },
 * }} App
 */

/**
 * Opens the page as a Home Screen app added on `look`, which opens at the address that names it.
 * @param {import("@playwright/test").Page} page
 * @param {App["openApp"]} openApp
 * @param {"light" | "dark"} look
 */
async function openHomeScreenApp(page, openApp, look) {
  await page.addInitScript(markOnHomeScreen);
  await openApp(page);
  await page.goto(`/?theme=${look}`);
}

/** @param {import("@playwright/test").Page} page */
const findNote = (page) => page.locator("#appearanceNote");

/**
 * The looks of the icons the note draws, by the picture each shows: the one the app has, then the
 * one adding it again gives.
 * @param {import("@playwright/test").Page} page
 */
const readNoteIcons = (page) =>
  findNote(page)
    .locator(".home-screen-icon")
    .evaluateAll((icons) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      /** @param {string} look */
      const readPicture = (look) => {
        probe.style.backgroundImage = `var(--home-screen-icon-${look})`;
        return getComputedStyle(probe).backgroundImage;
      };
      const pictures = { light: readPicture("light"), dark: readPicture("dark") };
      probe.remove();
      return icons.map(
        (icon) =>
          Object.keys(pictures).find(
            (look) => pictures[look] === getComputedStyle(icon).backgroundImage,
          ) ?? "neither",
      );
    });

/**
 * Checks the page with the note showing, as each app's tests check every view: each text in its
 * type role, readable, ending as its sentences call for, and each tap landing on a button.
 * @param {import("@playwright/test").Page} page
 */
async function checkNoteReads(page) {
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
const pick = (page, name) =>
  page.locator(SETTINGS).getByRole("radio", { name, exact: true }).check();

/** @param {import("@playwright/test").Page} page */
const closeSettings = (page) => page.locator(`${SETTINGS} .settings-body .sheet-close`).click();

/**
 * In an iPhone's Home Screen app added on the dark look, picking the light one in settings shows
 * the note `noteAbove` pixels under the icons' names, with the icon the app has, the one adding it
 * again gives, and a link that opens Safari on the light look. Picking the dark look again takes
 * it away, and it shows on each open of settings, and after a reload, while the light look stays
 * picked, on System while the phone shows the light look, with a link on System, and follows a
 * look picked in another tab, but never in the browser or in an Android Home Screen app.
 * @param {App & {
 *   context: import("@playwright/test").BrowserContext,
 *   browser: import("@playwright/test").Browser,
 *   noteAbove: number,
 * }} app
 */
export async function checkReAddNote({
  page,
  context,
  browser,
  openApp,
  openSettings,
  looks,
  noteAbove,
}) {
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  const note = findNote(page);
  await expect(note).toBeHidden();

  await pick(page, looks.light);
  await expect(note).toHaveText(NOTE_WORDS);
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  const safariAddress = new URL(page.url());
  safariAddress.searchParams.set("app-theme", "light");
  await expect(note.getByRole("link", { name: "re-add the site" })).toHaveAttribute(
    "href",
    `x-safari-${safariAddress.href}`,
  );
  const noteBelowIcons = await page.evaluate(
    (settingsSelector) =>
      document.querySelector("#appearanceNote").getBoundingClientRect().top -
      document.querySelector(`${settingsSelector} .appearance-choices`).getBoundingClientRect()
        .bottom,
    SETTINGS,
  );
  expect(noteBelowIcons).toBe(noteAbove);
  await checkNoteReads(page);

  await pick(page, looks.dark);
  await expect(note).toBeHidden();
  await pick(page, looks.light);
  await closeSettings(page);
  await openSettings(page);
  await expect(note).toHaveText(NOTE_WORDS);
  await closeSettings(page);
  await page.reload();
  await openSettings(page);
  await expect(note).toBeVisible();
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  await page.emulateMedia({ colorScheme: "light" });
  await pick(page, "System");
  await expect(note).toBeVisible();
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  safariAddress.searchParams.set("app-theme", "auto");
  await expect(note.getByRole("link", { name: "re-add the site" })).toHaveAttribute(
    "href",
    `x-safari-${safariAddress.href}`,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(note).toBeHidden();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(note).toBeVisible();
  await keepInOtherTab(page, "appearance", "light");
  await expect(note).toBeVisible();
  await keepInOtherTab(page, "appearance", "dark");
  await expect(note).toBeHidden();

  const browserTab = await context.newPage();
  await openApp(browserTab);
  await openSettings(browserTab);
  await pick(browserTab, looks.light);
  await expect(browserTab.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(findNote(browserTab)).toBeHidden();

  const android = await browser.newContext({ userAgent: ANDROID_AGENT, reducedMotion: "reduce" });
  const androidApp = await android.newPage();
  await openHomeScreenApp(androidApp, openApp, "light");
  await openSettings(androidApp);
  await pick(androidApp, looks.dark);
  await expect(androidApp.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(findNote(androidApp)).toBeHidden();
  await android.close();
}

/**
 * A reload with settings open on the note shows the note as it was before the page's code arrives,
 * so nothing under it moves once the code runs, and the code still takes it away once it's no longer
 * due.
 * @param {App} app
 */
export async function checkReAddNoteOnReload({ page, openApp, openSettings, looks }) {
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  await pick(page, looks.light);
  const note = findNote(page);
  await expect(note).toHaveText(NOTE_WORDS);
  const readHeight = () => note.evaluate((element) => element.getBoundingClientRect().height);
  const height = await readHeight();
  const release = await holdRequests(page, matchPath("/js/app.js"), { times: 1 });

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(note).toHaveText(NOTE_WORDS);
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  await expect.poll(readHeight).toBe(height);

  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(note).toHaveText(NOTE_WORDS);
  await expect.poll(readHeight).toBe(height);

  // The page's code, not the copy put back, decides: a look another tab picked while the page
  // was away takes the note away once the code runs.
  const releaseAgain = await holdRequests(page, matchPath("/js/app.js"), { times: 1 });
  await page.reload({ waitUntil: "commit" });
  await expect(note).toHaveText(NOTE_WORDS);
  await page.evaluate(() => localStorage.setItem("appearance", JSON.stringify("dark")));
  releaseAgain();
  await page.waitForLoadState("domcontentloaded");
  await expect(note).toBeEmpty();
}

/**
 * The note's X takes it away for good in that install of the app: not on settings' next open, a
 * pick that sets the icon off again, or a reload.
 * @param {App} app
 */
export async function checkReAddNoteDismissal({ page, openApp, openSettings, looks }) {
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  await pick(page, looks.light);
  const note = findNote(page);
  await expect(note).toBeVisible();
  const dismiss = note.getByRole("button", { name: "Dismiss icon note" });
  const { x, y, width, height } = await dismiss.boundingBox();
  // A finger lands on the X itself, as an iPhone hands the page a tap only on a button.
  expect(
    await page.evaluate(
      ([pointX, pointY]) => document.elementFromPoint(pointX, pointY)?.closest("button")?.id,
      [x + width / 2, y + height / 2],
    ),
  ).toBe("dismissReAddNote");
  await dismiss.click();
  await expect(note).toBeHidden();

  await pick(page, looks.dark);
  await pick(page, looks.light);
  await expect(note).toBeHidden();
  await closeSettings(page);
  await page.reload();
  await openSettings(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(note).toBeHidden();
}

/**
 * A Home Screen app added on System, whose address names no look, has the icon the phone's
 * setting showed as it first opened, and keeps it when the phone's setting changes, so on System
 * the note shows while the phone's setting isn't the icon's.
 * @param {App} app
 */
export async function checkSystemInstallIcon({ page, openApp, openSettings, looks }) {
  await page.addInitScript(markOnHomeScreen);
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await openSettings(page);
  await expect(findNote(page)).toBeHidden();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(findNote(page)).toBeVisible();
  expect(await readNoteIcons(page)).toEqual(["light", "dark"]);
  await checkNoteReads(page);
  await pick(page, looks.dark);
  expect(await readNoteIcons(page)).toEqual(["light", "dark"]);
  await pick(page, looks.light);
  await expect(findNote(page)).toBeHidden();
}

/**
 * A reload, as a new release brings, opens at the address the app's open before it left without
 * the look it was added with, so an app that has yet to keep its icon keeps none until it next
 * opens, rather than the phone's setting, and settings says nothing of it until the viewer
 * switches looks.
 * @param {App} app
 */
export async function checkIconKeptOnlyOnOpen({ page, openApp, openSettings }) {
  const readIcon = await reloadWithoutIcon(page, openApp);

  expect(await readIcon()).toBeNull();
  await openSettings(page);
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(findNote(page)).toBeHidden();
}

/**
 * Opens a Home Screen app added on the dark look, on a light phone, then reloads it, as a new
 * release does, with its icon forgotten, as a first open that was a reload or storage refusing
 * access leaves none.
 * @param {import("@playwright/test").Page} page
 * @param {App["openApp"]} openApp
 * @returns {Promise<() => Promise<string | null>>} reads the icon the app keeps
 */
async function reloadWithoutIcon(page, openApp) {
  await page.emulateMedia({ colorScheme: "light" });
  await openHomeScreenApp(page, openApp, "dark");
  const readIcon = () => page.evaluate(() => localStorage.getItem("homeScreenIcon"));
  expect(await readIcon()).toBe("dark");
  await page.evaluate(() => localStorage.removeItem("homeScreenIcon"));
  // The test's fake clock stands in for the page's timing, which says how the browser loaded it.
  await page.addInitScript(() => {
    performance.getEntriesByType = (type) =>
      type === "navigation" ? [/** @type {any} */ ({ type: "reload" })] : [];
  });
  await page.reload();
  return readIcon;
}

/**
 * An app that doesn't know its icon shows the note from the first switch of looks, with the other
 * look as the icon it has, and, on System, the phone's look, linking to Safari on System. It stays
 * through further picks and a reload, until the X takes it away for good in that install.
 * @param {App} app
 */
export async function checkNoteWithoutIcon({ page, openApp, openSettings, looks }) {
  await reloadWithoutIcon(page, openApp);
  await openSettings(page);
  const note = findNote(page);
  await expect(note).toBeHidden();

  await pick(page, looks.light);
  await expect(note).toHaveText(NOTE_WORDS);
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  await pick(page, looks.dark);
  expect(await readNoteIcons(page)).toEqual(["light", "dark"]);
  await pick(page, "System");
  expect(await readNoteIcons(page)).toEqual(["dark", "light"]);
  const safariAddress = new URL(page.url());
  safariAddress.searchParams.set("app-theme", "auto");
  await expect(note.getByRole("link", { name: "re-add the site" })).toHaveAttribute(
    "href",
    `x-safari-${safariAddress.href}`,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => readNoteIcons(page)).toEqual(["light", "dark"]);

  await page.reload();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(note).toHaveText(NOTE_WORDS);
  await note.getByRole("button", { name: "Dismiss icon note" }).click();
  await expect(note).toBeHidden();
  await pick(page, looks.light);
  await expect(note).toBeHidden();
}

/**
 * With motion on, the note grows in as a pick sets the icon off, and shrinks away as one brings it
 * back, from its full frame to nothing on its opening's curve, quick at first and settling at its
 * end, and only then empties, never starting over for another pick
 * that keeps it away while it shrinks, growing back from wherever its close has reached for one
 * that wants it again, and shrinking from wherever its opening has reached, then growing back to
 * full for one that wants it again. On System, it eases in for a change of the phone's look in a
 * task of its own, outside the event that reports the change, as for a pick.
 * @param {App} app
 */
export async function checkReAddNoteEases({ page, openApp, openSettings, looks }) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(markLookChangeEasings);
  const readAnimations = await listAnimations(page);
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  const note = findNote(page);
  const readEasings = async () =>
    (await readAnimations()).filter(({ classes }) => classes.includes("re-add-note"));
  const readLastEasing = async () => (await readEasings()).at(-1);
  // Picks the look and holds the note's easing still halfway, in one step, so the easing can't
  // finish between them, and reads what the note shows there.
  /** @param {"light" | "dark"} look */
  const pickHeldHalfway = (look) =>
    note.evaluate((element, [value, halfway, settings]) => {
      /** @type {HTMLInputElement} */ (
        document.querySelector(`${settings} input[name="appearance"][value="${value}"]`)
      ).click();
      for (const animation of element.getAnimations()) {
        animation.pause();
        animation.currentTime = halfway;
      }
      const { height, opacity } = getComputedStyle(element);
      return { height, opacity, isFilled: element.childElementCount > 0 };
    }, /** @type {const} */ ([look, EASE_HALFWAY_MS, SETTINGS]));

  await pick(page, looks.light);
  await expect(note).toBeVisible();
  const opening = await readLastEasing();
  expect(opening).toMatchObject({ first: { height: "0px", opacity: 0 }, last: { opacity: "1" } });
  await finishTimedAnimations(page);
  const full = await note.evaluate((element) => getComputedStyle(element).height);

  const halfClosed = await pickHeldHalfway("dark");
  expect(await readLastEasing()).toEqual({
    ...opening,
    first: opening.last,
    last: opening.first,
  });
  expect(halfClosed.isFilled).toBe(true);
  expect(parseFloat(halfClosed.height)).toBeLessThan(parseFloat(full));
  await page.emulateMedia({ colorScheme: "dark" });
  await pick(page, "System");
  expect(await readEasings()).toHaveLength(2);

  await pick(page, looks.light);
  const reopening = await readLastEasing();
  expect(reopening.first).toMatchObject({
    height: halfClosed.height,
    opacity: halfClosed.opacity,
  });
  expect(reopening.last).toMatchObject({ height: full, opacity: "1" });
  await finishTimedAnimations(page);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(NOTE_WORDS);

  await pick(page, looks.dark);
  await finishTimedAnimations(page);
  await expect(note).toBeEmpty();
  const halfOpen = await pickHeldHalfway("light");
  const closedFromHalfOpen = await pickHeldHalfway("dark");
  const closing = await readLastEasing();
  expect(closing.first.height).toBe(halfOpen.height);
  expect(closing.last.height).toBe("0px");
  expect(parseFloat(halfOpen.height)).toBeLessThan(parseFloat(full));
  await pick(page, looks.light);
  expect(await readLastEasing()).toMatchObject({
    first: { height: closedFromHalfOpen.height, opacity: closedFromHalfOpen.opacity },
    last: { height: full, opacity: "1" },
  });
  await finishTimedAnimations(page);
  await expect(note).toHaveCSS("height", full);
  await pick(page, looks.dark);
  await finishTimedAnimations(page);
  await expect(note).toBeHidden();
  await expect(note).toBeEmpty();

  await pick(page, "System");
  await finishTimedAnimations(page);
  await expect(note).toBeEmpty();
  await page.evaluate(() => Reflect.get(window, "lookChangeEasings").splice(0));
  await page.emulateMedia({ colorScheme: "light" });
  await expect(note).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "lookChangeEasings"))).toEqual([false]);
}

/**
 * Holds the next easing the note starts at `halfway`, in the task that starts it, since easings
 * run on the page's own timeline, which the test's clock doesn't hold.
 * @param {number} halfway
 */
const holdNextNoteEasing = (halfway) => {
  const { animate } = Element.prototype;
  Element.prototype.animate = function (keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    if (this.classList.contains("re-add-note")) {
      Element.prototype.animate = animate;
      animation.pause();
      animation.currentTime = halfway;
    }
    return animation;
  };
};

/**
 * A reload restores the note before the page's code arrives, then eases it to the phone's look
 * now, both when the note is due and when it no longer is.
 * @param {App & { isShowingNote: boolean }} app
 */
export async function checkReAddNoteEasesOnReload({ page, openApp, openSettings, isShowingNote }) {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  const readAnimations = await listAnimations(page);
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  await pick(page, "System");
  if (isShowingNote) await page.emulateMedia({ colorScheme: "light" });
  const note = findNote(page);
  if (isShowingNote) await expect(note).toHaveText(NOTE_WORDS);
  else await expect(note).toBeEmpty();
  await finishTimedAnimations(page);
  const heightBefore = await note.evaluate((element) => element.getBoundingClientRect().height);
  const openHeight = await note.evaluate((element) => getComputedStyle(element).height);
  await page.addInitScript(holdNextNoteEasing, EASE_HALFWAY_MS);
  const release = await holdRequests(page, matchPath("/js/app.js"), { times: 1 });

  await page.reload({ waitUntil: "commit" });
  await expect(page.locator(SETTINGS)).toBeVisible();
  expect(await note.evaluate((element) => element.getBoundingClientRect().height)).toBe(
    heightBefore,
  );
  await page.emulateMedia({ colorScheme: isShowingNote ? "dark" : "light" });
  release();
  await page.waitForLoadState("domcontentloaded");

  await page.waitForFunction(
    () => document.querySelector("#appearanceNote").getAnimations().length > 0,
  );
  const easing = (await readAnimations()).find(({ classes }) => classes.includes("re-add-note"));
  expect(easing).toBeDefined();
  await expect(note).toHaveText(NOTE_WORDS);
  const halfway = await note.evaluate((element) => element.getBoundingClientRect().height);
  expect(halfway).toBeGreaterThan(0);
  if (isShowingNote) {
    expect(easing.first.height).toBe(openHeight);
    expect(easing.last.height).toBe("0px");
    expect(halfway).toBeLessThan(heightBefore);
  } else {
    expect(easing.first.height).toBe("0px");
    expect(parseFloat(String(easing.last.height))).toBeGreaterThan(halfway);
  }
  await finishTimedAnimations(page);
  if (isShowingNote) await expect(note).toBeEmpty();
  else await expect(note).toHaveText(NOTE_WORDS);
}

/**
 * Has the page come back to the screen with only its window getting focus, as iOS sometimes
 * reports a Home Screen app coming back.
 * @param {import("@playwright/test").Page} page
 */
const comeBackByFocus = async (page) => {
  await setHidden(page, true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("focus"));
  });
};

/**
 * On System, a change of the phone's look that comes as the app comes back, as a phone reports one
 * made while the app was away, takes the note to its new state at once, both ways, since the phone
 * has already shown the app in its new look, though the app came back by focus alone. One that
 * comes a second after eases it. A close the page left frozen as it went away doesn't empty the
 * note drawn for a change while it was away.
 * @param {App} app
 */
export async function checkReAddNoteOnReturn({ page, openApp, openSettings }) {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await page.addInitScript(markLookChangeEasings);
  await openHomeScreenApp(page, openApp, "dark");
  await openSettings(page);
  await pick(page, "System");
  const note = findNote(page);
  await finishTimedAnimations(page);
  await expect(note).toBeEmpty();
  const countEasings = () => page.evaluate(() => Reflect.get(window, "lookChangeEasings").length);
  const easingsBefore = await countEasings();
  /** @param {"light" | "dark"} look */
  const comeBackOn = async (look) => {
    await setHidden(page, true);
    await setHidden(page, false);
    await page.emulateMedia({ colorScheme: look });
  };

  await comeBackOn("light");
  await expect(note).toHaveText(NOTE_WORDS);
  await comeBackOn("dark");
  await expect(note).toBeEmpty();
  await page.clock.runFor(1000);
  await comeBackByFocus(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(note).toHaveText(NOTE_WORDS);
  expect(await countEasings()).toBe(easingsBefore);

  await page.clock.runFor(1000);
  await page.evaluate(holdNextNoteEasing, EASE_HALFWAY_MS);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => countEasings()).toBe(easingsBefore + 1);
  expect(
    await note.evaluate((element) => ({
      easings: element.getAnimations().length,
      isFilled: element.childElementCount > 0,
    })),
  ).toEqual({ easings: 1, isFilled: true });
  await setHidden(page, true);
  await page.emulateMedia({ colorScheme: "light" });
  await setHidden(page, false);
  await finishTimedAnimations(page);
  await expect(note).toHaveText(NOTE_WORDS);
}

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   serveLockedApp: (page: import("@playwright/test").Page, options: { accessCode: string }) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   looks: { light: string, dark: string },
 * }} LockedApp
 */

const HANDOFF_PATH = "access/handoff";
const HANDOFF_ROUTE = matchPath(`${LOCKED_PAGE_PATH}${HANDOFF_PATH}`);

/** @param {string} look */
const buildHandoffLink = (look) =>
  new RegExp(
    `^x-safari-http://[^/]+${LOCKED_PAGE_PATH}${HANDOFF_PATH}\\?token=[^&]+&app-theme=${look}$`,
  );

/** @param {import("@playwright/test").Page} page */
const findReAddLink = (page) => findNote(page).getByRole("link", { name: "re-add the site" });

// The page counts, in its own steps, each handoff it asks for as it asks, each answer as it
// arrives, and each answer's body as it's read, so a test reads where the page is rather than
// where the network is, which reports to the test in its own time.
/** @param {string} handoffPath */
function countHandoffs(handoffPath) {
  const handoffs = { asked: 0, answered: 0, read: 0 };
  Object.assign(window, { handoffs });
  const fetchFromWorker = window.fetch;
  window.fetch = async (...request) => {
    if (!String(request[0]).endsWith(handoffPath)) return fetchFromWorker(...request);
    handoffs.asked += 1;
    const response = await fetchFromWorker(...request);
    handoffs.answered += 1;
    const readJson = response.json.bind(response);
    response.json = async () => {
      const body = await readJson();
      handoffs.read += 1;
      return body;
    };
    return response;
  };
}

/**
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ asked: number, answered: number, read: number }>}
 */
const readHandoffs = (page) => page.evaluate(() => /** @type {any} */ (window).handoffs);

/**
 * Signs in to an iPhone's Home Screen app behind its access code, added on System on a phone set
 * to light, so its icon is the light look's, and opens settings, with the page counting its
 * handoffs.
 * @param {LockedApp} app
 */
async function openLockedSettings({ page, serveLockedApp, openSettings }) {
  await page.addInitScript(markOnHomeScreen);
  await page.addInitScript(countHandoffs, HANDOFF_PATH);
  await page.emulateMedia({ colorScheme: "light" });
  await serveLockedApp(page, { accessCode: "FASTBREAK" });
  await page.goto(LOCKED_PAGE_PATH);
  await page.getByRole("textbox", { name: "Access code" }).fill("FASTBREAK");
  await page.getByRole("button", { name: "Open" }).click();
  await openSettings(page);
}

/**
 * Has the page leave the screen for `ms`, as a phone's switch to another app does, which freezes
 * the page's timers, so only its clock moves on.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
async function leaveFor(page, ms) {
  await setHidden(page, true);
  await passTime(page, ms);
  await setHidden(page, false);
}

/**
 * Picks the dark look, which sets the light icon off, and checks the link opens Safari at the
 * page's own address until its handoff answers, asking once however the picks go meanwhile, and
 * at the handoff's from then on, then that the note renews its handoff halfway through, tries
 * again soon after a renewal fails, renews as it comes back from short trips away once that's due
 * but not while a renewal's answer is still out, stops with settings closing, asks again as
 * settings opens with the note showing, its link back at the page's own address until that
 * answers, stops once a pick brings the icon's look back, goes back to the page's own address
 * once the Worker makes none, and stops once the X dismisses the note.
 * @param {LockedApp} app
 */
export async function checkHandoffRenewal(app) {
  const { page, openSettings, looks } = app;
  await openLockedSettings(app);
  const link = findReAddLink(page);
  const readAsked = async () => (await readHandoffs(page)).asked;
  const readAnswered = async () => (await readHandoffs(page)).answered;
  const readRead = async () => (await readHandoffs(page)).read;
  const pageAddress = new URL(page.url());
  pageAddress.searchParams.set("app-theme", "dark");
  const pageLink = `x-safari-${pageAddress.href}`;

  const releaseFirst = await holdRequests(page, HANDOFF_ROUTE, { times: 1 });
  await pick(page, looks.dark);
  await expect(link).toHaveAttribute("href", pageLink);
  await expect.poll(readAsked).toBe(1);
  await pick(page, looks.light);
  await pick(page, looks.dark);
  await expect(link).toHaveAttribute("href", pageLink);
  expect(await readAsked()).toBe(1);
  releaseFirst();
  await expect.poll(readRead).toBe(1);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  expect(await readAsked()).toBe(1);

  await page.route(HANDOFF_ROUTE, (route) => route.fulfill({ status: 503 }), { times: 1 });
  await page.clock.runFor(5 * 60 * 1000);
  expect(await readAsked()).toBe(2);
  await expect.poll(readAnswered).toBe(2);
  await page.clock.runFor(30 * 1000);
  expect(await readAsked()).toBe(3);
  await expect.poll(readRead).toBe(2);

  // Each trip is short of the two minutes that close settings, and the third passes the renewal.
  await leaveFor(page, 110 * 1000);
  await leaveFor(page, 110 * 1000);
  expect(await readAsked()).toBe(3);
  await leaveFor(page, 110 * 1000);
  expect(await readAsked()).toBe(4);
  await expect.poll(readRead).toBe(3);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));

  // A return while a renewal's answer is still out, past when it was due, asks no second time.
  const releaseRenewal = await holdRequests(page, HANDOFF_ROUTE, { times: 1 });
  await page.clock.runFor(5 * 60 * 1000);
  expect(await readAsked()).toBe(5);
  await leaveFor(page, 110 * 1000);
  expect(await readAsked()).toBe(5);
  releaseRenewal();
  await expect.poll(readRead).toBe(4);

  await closeSettings(page);
  await page.clock.runFor(15 * 60 * 1000);
  expect(await readAsked()).toBe(5);

  const releaseReopened = await holdRequests(page, HANDOFF_ROUTE, { times: 1 });
  await openSettings(page);
  await expect.poll(readAsked).toBe(6);
  await expect(link).toHaveAttribute("href", pageLink);
  releaseReopened();
  await expect.poll(readRead).toBe(5);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  await pick(page, looks.light);
  await page.clock.runFor(15 * 60 * 1000);
  expect(await readAsked()).toBe(6);

  await pick(page, looks.dark);
  await expect.poll(readRead).toBe(6);
  await page.route(HANDOFF_ROUTE, (route) => route.fulfill({ status: 404 }), { times: 1 });
  await page.clock.runFor(5 * 60 * 1000);
  expect(await readAsked()).toBe(8);
  await expect.poll(readAnswered).toBe(8);
  await expect(link).toHaveAttribute("href", pageLink);
  await page.clock.runFor(10 * 60 * 1000);
  await leaveFor(page, 110 * 1000);
  expect(await readAsked()).toBe(8);

  // A look kept in another tab shows or hides the note, and its handoff follows.
  await keepInOtherTab(page, "appearance", "light");
  await expect(findNote(page)).toBeHidden();
  await keepInOtherTab(page, "appearance", "dark");
  await expect.poll(readRead).toBe(7);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  expect(await readAsked()).toBe(9);
  await keepInOtherTab(page, "appearance", "light");
  await expect(findNote(page)).toBeHidden();
  await page.clock.runFor(15 * 60 * 1000);
  expect(await readAsked()).toBe(9);

  await pick(page, looks.dark);
  await expect.poll(readRead).toBe(8);
  await findNote(page).getByRole("button", { name: "Dismiss icon note" }).click();
  await expect(findNote(page)).toBeHidden();
  await page.clock.runFor(15 * 60 * 1000);
  expect(await readAsked()).toBe(10);
}

/**
 * Signs in to an iPhone's Home Screen app behind its access code, picks the dark look, and opens
 * the note's link in a browser that has never been signed in, as Safari is, which opens the
 * welcome on that look without asking for the code, with no token left in its address.
 * @param {LockedApp & { browser: import("@playwright/test").Browser }} app
 */
export async function checkReAddHandoff(app) {
  const { page, browser, serveLockedApp, looks } = app;
  await openLockedSettings(app);
  await pick(page, looks.dark);
  const link = findReAddLink(page);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  const safariAddress = (await link.getAttribute("href")).replace("x-safari-", "");

  const safari = await browser.newContext({
    userAgent: IPHONE_AGENT,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  const safariPage = await safari.newPage();
  await serveLockedApp(safariPage, { accessCode: "FASTBREAK" });
  await safariPage.goto(safariAddress);
  const redirected = new URL(safariPage.url());
  expect(`${redirected.pathname}${redirected.search}`).toBe(`${LOCKED_PAGE_PATH}?app-theme=dark`);
  // Playwright routes only the first request of a redirect, so the page it leads to is opened
  // again through the Worker, with the cookie the redirect set.
  await safariPage.goto(redirected.href);
  await expect(safariPage.locator(WELCOME)).toBeVisible();
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(safariPage.getByRole("textbox", { name: "Access code" })).toHaveCount(0);
  await safari.close();
}
