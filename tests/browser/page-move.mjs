import { expect } from "@playwright/test";
import {
  LEAVE_OFF_BUTTON,
  MOVE_BUTTON,
  MOVE_TEXT,
  MOVE_TITLE,
  NOTIFICATIONS_TITLE,
  TURN_ON_BUTTON,
  writeNotificationsText,
} from "../../shared/page/move-cards.js";
import { listLowContrastText } from "./contrast.mjs";
import { ANDROID_PHONE, IPHONE, takeAwayPush } from "./devices.mjs";
import { LOCKED_PAGE_PATH } from "./harness.mjs";
import { WELCOME } from "./home-screen-help.mjs";
import { PUSH_STUB, stubPushManager } from "./push-stub.mjs";
import { waitForLoadToSettle } from "./at-rest.mjs";
import { findCenter } from "./season-scroll.mjs";
import { openSeasonPart } from "./season-tab.mjs";
import { listStrayPeriods } from "./stray-periods.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
import { openSettings } from "./settings.mjs";
import { listTextOffRoles, readRole } from "./type-roles.mjs";
import { tapUpdatesButton } from "./updates-box.mjs";

const ACCESS_CODE = "FASTBREAK";

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   browser: import("@playwright/test").Browser,
 *   serve: (page: import("@playwright/test").Page, options: { accessCode: string, pageHost?: string }) => Promise<unknown>,
 *   appName: string,
 *   looks: { light: string, dark: string },
 *   pageHost: string,
 *   oldHost: string,
 * }} MovingApp
 */

const markOnHomeScreen = () => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

// CI's browser denies notifications, where a phone that hasn't answered the new site has yet to.
const leaveNotificationsUnanswered = () => {
  Object.defineProperty(Notification, "permission", { get: () => "default" });
};

/**
 * Signs the page in at `address`, and keeps `choices` there.
 * @param {import("@playwright/test").Page} page
 * @param {string} address the page's address at that host
 * @param {Record<string, unknown>} [choices]
 */
async function signIn(page, address, choices = {}) {
  await page.goto(`${address}access`);
  await page.evaluate(async ([code, kept]) => {
    await fetch("access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    for (const [key, value] of Object.entries(kept))
      localStorage.setItem(key, JSON.stringify(value));
  }, /** @type {const} */ ([ACCESS_CODE, choices]));
}

/** @param {string} oldHost */
const findOldAddress = (oldHost) => `https://${oldHost}${LOCKED_PAGE_PATH}`;

/** @param {string} pageHost */
const findNewAddress = (pageHost) => `https://${pageHost}/`;

/**
 * Has the page leave with `leave` for the handoff at `pageHost`, then opens the page it sends on
 * to, with the cookie it set. Playwright routes only the first request of a redirect, so the page
 * it leads to is opened again through the Worker.
 * @param {import("@playwright/test").Page} page
 * @param {string} pageHost
 * @param {() => Promise<unknown>} leave
 */
export async function followHandoff(page, pageHost, leave) {
  const cancellation = new AbortController();
  /** @param {import("@playwright/test").Frame} frame */
  const isHandoffCommit = (frame) =>
    frame === page.mainFrame() && frame.url() === "chrome-error://chromewebdata/";
  // The un-routed redirect cannot serve the fixture host, so Chromium commits its error document.
  const committed = page.waitForEvent("framenavigated", {
    predicate: isHandoffCommit,
    signal: cancellation.signal,
  });
  try {
    const destination = page
      .waitForResponse(`${findNewAddress(pageHost)}access/handoff?**`, {
        signal: cancellation.signal,
      })
      .then((response) => new URL(response.headers().location, response.url()));
    // Response headers (and even response.finished()) precede the redirected document's commit.
    const [address] = await Promise.all([destination, committed, Promise.resolve().then(leave)]);
    await page.goto(address.href);
    return address;
  } finally {
    cancellation.abort();
  }
}

/**
 * Expects the page at `address`, with nothing left in its address to carry choices again.
 * @param {import("@playwright/test").Page} page
 * @param {string} address
 */
async function expectAtAddressCarryingNothing(page, address) {
  await expect(page).toHaveURL(
    (url) => `${url.origin}${url.pathname}` === address && !url.searchParams.has("carried"),
  );
}

/** @param {string} value */
const unpack = (value) => JSON.parse(Buffer.from(value, "base64url").toString());

/** @param {Record<string, unknown>} carried */
const pack = (carried) => Buffer.from(JSON.stringify(carried)).toString("base64url");

/**
 * Checks the page with a card showing, as each app's tests check every view: each text in its type
 * role, readable, ending as its sentences call for, and each tap landing on a button.
 * @param {import("@playwright/test").Page} page
 */
async function checkCardReads(page) {
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
}

/**
 * Checks the card's title and text each draw at its notice role's size and weight.
 * @param {import("@playwright/test").Page} page
 */
async function checkCardRoles(page) {
  for (const [part, role] of [
    ["title", "notice-title"],
    ["text", "notice-text"],
  ]) {
    const { size, weight } = await readRole(page, role);
    const drawn = await findUpdates(page)
      .locator(`.move-card-${part}`)
      .evaluate((text) => {
        const style = getComputedStyle(text);
        return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
      });
    expect(drawn, part).toEqual({ size, weight });
  }
}

/**
 * Checks the card reads in the light look and the dark.
 * @param {import("@playwright/test").Page} page
 */
async function checkCardInEachLook(page) {
  for (const look of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: look });
    await expect(page.locator("html")).toHaveAttribute("data-theme", look);
    await checkCardReads(page);
  }
}

/**
 * Safari signed in at the old address leaves for the new one at once, signed in there with the
 * handoff, with the choices it kept and nothing left in its address to carry them again.
 * @param {MovingApp} app
 */
export async function checkSafariMoves({ page, serve, pageHost, oldHost }) {
  await serve(page, { accessCode: ACCESS_CODE, pageHost });
  await signIn(page, findOldAddress(oldHost), { appearance: "dark" });
  const address = await followHandoff(page, pageHost, () => page.goto(findOldAddress(oldHost)));
  expect(unpack(address.searchParams.get("carried")).choices).toEqual({ appearance: '"dark"' });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("textbox", { name: "Access code" })).toHaveCount(0);
  await expectAtAddressCarryingNothing(page, findNewAddress(pageHost));
  expect(await page.evaluate(() => localStorage.getItem("appearance"))).toBe('"dark"');
}

/**
 * Opens the Home Screen app at the old address, signed in, with `choices` kept, as it was added,
 * with the theme its address named then, if any.
 * @param {Pick<MovingApp, "page" | "serve" | "oldHost"> & { pageHost?: string }} app
 * @param {Record<string, unknown>} [choices]
 * @param {string} [addedOnTheme]
 */
export async function openOldHomeScreenApp(
  { page, serve, pageHost, oldHost },
  choices,
  addedOnTheme,
) {
  await page.addInitScript(markOnHomeScreen);
  await serve(page, { accessCode: ACCESS_CODE, pageHost });
  await signIn(page, findOldAddress(oldHost), choices);
  await page.goto(`${findOldAddress(oldHost)}${addedOnTheme ? `?theme=${addedOnTheme}` : ""}`);
}

/** @param {Pick<MovingApp, "page" | "serve" | "oldHost">} app */
export async function checkHomeScreenWithoutPageHost({ page, serve, oldHost }) {
  await openOldHomeScreenApp({ page, serve, oldHost });
  await waitForLoadToSettle(page);
  await expect(page.locator('meta[name="moving-to-page-host"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: MOVE_BUTTON })).toHaveCount(0);
  await expect(page.locator(".move-card-title")).toHaveCount(0);
  await expect(page).toHaveURL(findOldAddress(oldHost));
}

/** @param {import("@playwright/test").Page} page */
const findUpdates = (page) => page.locator("#updates");

/**
 * The Home Screen app at the old address shows the card for the new site in its Updates box, in
 * each look, and stays put until the fan taps it.
 * @param {MovingApp} app
 */
export async function checkMoveCard(app) {
  const { page } = app;
  await openOldHomeScreenApp(app);
  const updates = findUpdates(page);
  await expect(updates).toBeVisible();
  await expect(updates.locator(".move-card-title")).toHaveText(MOVE_TITLE);
  await expect(updates.locator(".move-card-text")).toHaveText(MOVE_TEXT);
  await expect(updates.locator(".move-card-icon")).toBeVisible();
  await expect(updates.getByRole("button", { name: MOVE_BUTTON })).toBeVisible();
  await expect(updates.getByRole("button", { name: "Dismiss the new site" })).toBeVisible();
  await checkCardRoles(page);
  await checkCardInEachLook(page);
  await expect(page).toHaveURL(findOldAddress(app.oldHost));
}

/**
 * The card's X takes it away for good, across a reload.
 * @param {MovingApp} app
 */
export async function checkMoveCardDismissal(app) {
  const { page } = app;
  await openOldHomeScreenApp(app);
  const updates = findUpdates(page);
  await tapUpdatesButton(page, "Dismiss the new site");
  await expect(updates).toBeHidden();
  await page.reload();
  await expect(page.locator("#loadNote")).toHaveCount(0);
  await expect(updates).toBeHidden();
}

/**
 * On the season tab, where the header rides over the parts, each of the card's buttons has a
 * stand-in under it in each part, and a tap there, on the X's, takes the card away.
 * @param {MovingApp} app
 */
export async function checkMoveCardStandIns(app) {
  const { page } = app;
  await openOldHomeScreenApp(app);
  await openSeasonPart(page, "Bracket");
  await waitForLoadToSettle(page);
  const updates = findUpdates(page);

  await expect(page.locator(".rider-tap")).toHaveCount(2 * 2);

  const { x, y } = findCenter(
    await updates.getByRole("button", { name: "Dismiss the new site" }).boundingBox(),
  );
  expect(
    await page.evaluate(
      ([atX, atY]) => document.elementFromPoint(atX, atY)?.classList.contains("rider-tap"),
      [x, y],
    ),
  ).toBe(true);
  await page.touchscreen.tap(x, y);
  await expect(updates).toBeHidden();
  await expect(page.locator(".rider-tap")).toHaveCount(0);
}

/**
 * Holds the handoff the page opens at `pageHost` rather than opening it, since the browser is where
 * the move goes on, and gives its address once the page asks for it.
 * @param {import("@playwright/test").Page} page
 * @param {string} pageHost
 * @returns {Promise<{ handoff: Promise<URL> }>}
 */
async function holdHandoff(page, pageHost) {
  const handoffAddress = `${findNewAddress(pageHost)}access/handoff?**`;
  await page.route(handoffAddress, (route) => route.abort());
  const asked = page.waitForRequest(handoffAddress);
  return { handoff: asked.then((request) => new URL(request.url())) };
}

/**
 * Taps Use new site in an Android phone's Home Screen app, which keeps `choices`, and returns the
 * handoff it opens, with the phone's light or dark setting and the page's clock as the finger
 * landed.
 * @param {MovingApp} app
 * @param {Record<string, unknown>} choices
 * @param {string} [addedOnTheme]
 * @returns {Promise<{ handoff: URL, colorScheme: "light" | "dark", tappedAt: number }>}
 */
async function tapUseNewSite(app, choices, addedOnTheme) {
  const { page, pageHost } = app;
  await openOldHomeScreenApp(app, choices, addedOnTheme);
  const { handoff } = await holdHandoff(page, pageHost);
  const { tappedAt, isDark } = await page.evaluate(() => ({
    tappedAt: Date.now(),
    isDark: matchMedia("(prefers-color-scheme: dark)").matches,
  }));
  await tapUpdatesButton(page, MOVE_BUTTON);
  return {
    handoff: await handoff,
    colorScheme: isDark ? "dark" : "light",
    tappedAt,
  };
}

/**
 * Opens a move's handoff in the phone's browser, Safari unless `device` is another phone, on the
 * phone's light or dark setting as the move left, with any `choices` a previous visit kept.
 * @param {MovingApp} app
 * @param {{ handoff: URL, colorScheme: "light" | "dark" }} move
 * @param {typeof IPHONE} [device]
 * @param {Record<string, unknown>} [choices]
 */
async function openInBrowser(
  { browser, serve, pageHost },
  { handoff, colorScheme },
  device = IPHONE,
  choices = {},
) {
  const context = await browser.newContext({ ...device, reducedMotion: "reduce", colorScheme });
  const browserPage = await context.newPage();
  if (device === IPHONE)
    await browserPage.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
  await takeAwayPush(browserPage);
  await serve(browserPage, { accessCode: ACCESS_CODE, pageHost });
  if (Object.keys(choices).length) await signIn(browserPage, findNewAddress(pageHost), choices);
  // A navigation the test starts throws on the redirect Playwright doesn't route, so the blank page
  // starts it, as a link would.
  await followHandoff(browserPage, pageHost, () =>
    browserPage.evaluate((href) => location.assign(href), handoff.href),
  );
  return browserPage;
}

/** @param {MovingApp} app @param {URL} handoff */
async function openMovedHomeScreenApp({ browser, serve, pageHost }, handoff) {
  const context = await browser.newContext({
    ...IPHONE,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.addInitScript(markOnHomeScreen);
  await takeAwayPush(page);
  await serve(page, { accessCode: ACCESS_CODE, pageHost });
  await signIn(page, findNewAddress(pageHost));
  const address = new URL(findNewAddress(pageHost));
  address.searchParams.set("carried", handoff.searchParams.get("carried"));
  await page.goto(address.href);
  return page;
}

/**
 * Use new site, in a Home Screen app on a phone set to dark, opens the new site in the browser
 * with the app's choices and the move from the app, where the welcome's steps finish it: pick the
 * icon from the two looks, add the site, and delete the old one.
 * @param {MovingApp} app
 */
export async function checkMovingWelcome(app) {
  const { page, appName, looks } = app;
  await page.emulateMedia({ colorScheme: "dark" });
  const move = await tapUseNewSite(app, { appearance: "auto" });
  const { at, ...carried } = unpack(move.handoff.searchParams.get("carried"));
  expect(carried).toMatchObject({
    choices: { appearance: '"dark"' },
    icon: "dark",
    fromApp: true,
  });
  expect(at - move.tappedAt).toBeGreaterThanOrEqual(0);
  expect(at - move.tappedAt).toBeLessThan(60_000);

  const safariPage = await openInBrowser(app, move);
  const welcome = safariPage.locator(WELCOME);
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole("heading")).toHaveText(`Finish moving ${appName}`);
  await expect(welcome.locator(".welcome-steps > li")).toHaveCount(4);
  const deleteStep = welcome.locator(".welcome-steps > li").last();
  await expect(deleteStep.locator(".welcome-step")).toHaveText(`Delete the old ${appName} Site`);
  await expect(deleteStep.locator(".welcome-note")).toHaveText(
    "Press and hold, then tap Delete Bookmark",
  );
  await expect(welcome.getByRole("radio")).toHaveCount(2);
  await expect(welcome.getByRole("radio", { name: looks.dark, exact: true })).toBeChecked();
  await expect(welcome.getByRole("button", { name: "Continue in browser" })).toBeVisible();
  await expect(welcome.getByRole("button", { name: "Install" })).toHaveCount(0);
  for (const look of /** @type {const} */ (["light", "dark"])) {
    await Promise.all([
      safariPage.waitForURL((url) => url.searchParams.get("theme") === look),
      welcome.getByRole("radio", { name: looks[look], exact: true }).check(),
    ]);
    await expect(safariPage.locator("html")).toHaveAttribute("data-theme", look);
    await checkCardReads(safariPage);
  }
  await safariPage.context().close();
}

/**
 * On an Android phone, the moving welcome's last step says how to remove the old site there.
 * @param {MovingApp} app
 */
export async function checkMovingWelcomeOnAndroid(app) {
  const browserPage = await openInBrowser(
    app,
    await tapUseNewSite(app, { appearance: "dark" }),
    ANDROID_PHONE,
  );
  const deleteStep = browserPage.locator(WELCOME).locator(".welcome-steps > li").last();
  await expect(deleteStep.locator(".welcome-note")).toHaveText("Press and hold, then remove it");
  await browserPage
    .locator(WELCOME)
    .getByRole("radio", { name: app.looks.light, exact: true })
    .check();
  await expect(browserPage.locator("html")).toHaveAttribute("data-theme", "light");
  await browserPage.locator(WELCOME).getByRole("button", { name: "Close", exact: true }).click();
  await openSettings(browserPage);
  await expect(browserPage.locator('input[name="appearance"][value="light"]')).toBeChecked();
  await browserPage.context().close();
}

/**
 * The moving welcome starts on the icon of the theme the fan picked last, not the one the old app
 * was added with.
 * @param {MovingApp} app
 */
export async function checkMovingIconFollowsTheme(app) {
  const { page, looks } = app;
  await page.emulateMedia({ colorScheme: "dark" });
  const move = await tapUseNewSite(app, { appearance: "light" }, "dark");
  expect(unpack(move.handoff.searchParams.get("carried")).icon).toBe("light");
  const safariPage = await openInBrowser(app, move, IPHONE, { appearance: "dark" });
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    safariPage.locator(WELCOME).getByRole("radio", { name: looks.light, exact: true }),
  ).toBeChecked();
  await safariPage.context().close();
  const installed = await openMovedHomeScreenApp(app, move.handoff);
  await openSettings(installed);
  expect(await installed.evaluate(() => localStorage.getItem("homeScreenIcon"))).toBe("light");
  await expect(installed.locator("#appearanceNote")).toBeHidden();
  await installed.reload();
  await expect(installed.locator("#settingsDialog")).toBeVisible();
  await expect(installed.locator("#appearanceNote")).toBeHidden();
  await installed.context().close();
}

/**
 * A pick in the moving welcome sets the icon and its matching theme in the browser and the new
 * Home Screen app. Only a later theme change in Settings shows the icon reminder.
 * @param {MovingApp} app
 */
export async function checkMovingIconPick(app) {
  const { page, looks } = app;
  await page.emulateMedia({ colorScheme: "dark" });
  const safariPage = await openInBrowser(app, await tapUseNewSite(app, { appearance: "dark" }));
  const icon = safariPage.locator("#homeScreenIcon");
  const darkIcon = await icon.getAttribute("href");
  await Promise.all([
    safariPage.waitForURL((url) => url.searchParams.get("theme") === "light"),
    safariPage.locator(WELCOME).getByRole("radio", { name: looks.light, exact: true }).check(),
  ]);
  await expect(icon).not.toHaveAttribute("href", darkIcon);
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await safariPage.evaluate(() => localStorage.getItem("appearance"))).toBe('"light"');
  const address = new URL(safariPage.url());
  expect(unpack(address.searchParams.get("carried")).icon).toBe("light");
  expect(unpack(address.searchParams.get("carried")).choices.appearance).toBe('"light"');
  expect(address.searchParams.get("theme")).toBe("light");
  await safariPage.locator(WELCOME).getByRole("button", { name: "Close" }).click();
  await expect(icon).not.toHaveAttribute("href", darkIcon);
  await safariPage.context().close();
  const installed = await openMovedHomeScreenApp(app, address);
  await openSettings(installed);
  await expect(installed.locator('input[name="appearance"][value="light"]')).toBeChecked();
  expect(await installed.evaluate(() => localStorage.getItem("homeScreenIcon"))).toBe("light");
  await expect(installed.locator("#appearanceNote")).toBeHidden();
  await installed.reload();
  await expect(installed.locator("#settingsDialog")).toBeVisible();
  await expect(installed.locator("#appearanceNote")).toBeHidden();
  await installed.getByRole("radio", { name: looks.dark, exact: true }).check();
  await expect(installed.locator("#appearanceNote")).toBeVisible();
  await installed.context().close();
}

/**
 * Offers Chrome's install dialog, as Chrome does to a page it can install.
 * @param {import("@playwright/test").Page} page
 */
const offerInstall = (page) =>
  page.evaluate(() => {
    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(offer);
  });

/**
 * Closing the moving welcome ends the move, and nothing is left in the address to carry it. The
 * welcome settings' notifications opens from then on holds its own steps, Chrome's Install among
 * them once it's offered, with the theme choices, which set the page's whole look.
 * @param {MovingApp} app
 */
export async function checkMovingWelcomeCloses(app) {
  const safariPage = await openInBrowser(app, await tapUseNewSite(app, { appearance: "dark" }));
  const welcome = safariPage.locator(WELCOME);
  await expect(welcome).toBeVisible();
  await offerInstall(safariPage);
  await welcome.getByRole("button", { name: "Close" }).click();
  await expect(welcome).toBeHidden();
  await expectAtAddressCarryingNothing(safariPage, findNewAddress(app.pageHost));
  expect(await safariPage.evaluate(() => localStorage.getItem("pageMove"))).toBeNull();
  await openSettings(safariPage);
  await safariPage.getByRole("button", { name: "How to get notifications" }).click();
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole("heading")).toHaveText(`Add ${app.appName} to your home screen`);
  await expect(welcome.locator(".welcome-steps > li")).not.toContainText([
    `Delete the old ${app.appName} Site`,
  ]);
  await expect(welcome.getByRole("button", { name: "Install" })).toBeVisible();
  await expect(welcome.locator('[data-ask="browser"]:visible')).toHaveCount(0);
  await expect(welcome.getByRole("radio", { name: app.looks.dark, exact: true })).toBeChecked();
  const icon = safariPage.locator("#homeScreenIcon");
  const darkIcon = await icon.getAttribute("href");
  await welcome.getByRole("radio", { name: app.looks.light, exact: true }).check();
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(safariPage.locator('input[name="appearance"][value="light"]')).toBeChecked();
  await expect(icon).not.toHaveAttribute("href", darkIcon);
  await safariPage.context().close();
}

// A real service worker's requests skip the test's routes for the page's fake hosts, so the page
// gets a registration whose push manager is the stand-in's, held until the test releases it, so
// a tap can land while the page still reads whether the phone is subscribed.
function standInForServiceWorker() {
  const registration = /** @type {ServiceWorkerRegistration} */ (
    /** @type {unknown} */ ({ pushManager: Object.create(PushManager.prototype) })
  );
  const registered = new Promise((resolve) => {
    Object.assign(window, { releaseServiceWorker: () => resolve(registration) });
  });
  navigator.serviceWorker.register = () => registered;
}

/** @param {import("@playwright/test").Page} page */
const releaseServiceWorker = (page) =>
  page.evaluate(() => /** @type {any} */ (window).releaseServiceWorker());

/**
 * Use new site, tapped while the page still reads whether the phone has a push subscription,
 * carries that it has one, so the new site's Home Screen app asks to turn notifications on again.
 * @param {MovingApp} app
 */
export async function checkMoveCarriesNotifications(app) {
  const { page } = app;
  await page.addInitScript(stubPushManager, PUSH_STUB);
  await page.addInitScript(standInForServiceWorker);
  await openOldHomeScreenApp(app);
  await page.evaluate(async () => {
    await Notification.requestPermission();
    await Object.create(PushManager.prototype).subscribe({
      applicationServerKey: new Uint8Array(65).buffer,
    });
  });
  const { handoff } = await holdHandoff(page, app.pageHost);
  await tapUpdatesButton(page, MOVE_BUTTON);
  await releaseServiceWorker(page);
  expect(unpack((await handoff).searchParams.get("carried")).notifications).toBe(true);
}

/**
 * Opens the new site's Home Screen app for the first time, signed in, from the address a move with
 * notifications on carried, where the phone has yet to answer whether the new site may notify,
 * and, with `canSubscribe`, says yes when asked and subscribes.
 * @param {MovingApp} app
 * @param {{ canSubscribe?: boolean }} [options]
 */
async function openNewHomeScreenApp({ page, serve, pageHost }, { canSubscribe = false } = {}) {
  if (canSubscribe) {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await page.addInitScript(standInForServiceWorker);
  } else await page.addInitScript(leaveNotificationsUnanswered);
  await serve(page, { accessCode: ACCESS_CODE, pageHost });
  await signIn(page, findNewAddress(pageHost));
  await page.addInitScript(markOnHomeScreen);
  const at = await page.evaluate(() => Date.now());
  const carried = pack({ at, choices: {}, notifications: true, fromApp: true });
  await page.goto(`${findNewAddress(pageHost)}?carried=${carried}`);
}

/**
 * The new Home Screen app's first open, after a move with notifications on, asks to turn them on
 * again, in each look, with nothing of the move left in its address.
 * @param {MovingApp} app
 */
export async function checkNotificationsAsk(app) {
  const { page } = app;
  await openNewHomeScreenApp(app);
  const updates = findUpdates(page);
  await expect(updates).toBeVisible();
  await expect(updates.locator(".move-card-title")).toHaveText(NOTIFICATIONS_TITLE);
  await expect(updates.locator(".move-card-text")).toHaveText(writeNotificationsText(true));
  await expect(updates.getByRole("button", { name: LEAVE_OFF_BUTTON })).toBeVisible();
  await expect(updates.getByRole("button", { name: TURN_ON_BUTTON })).toBeVisible();
  await expect(updates.getByRole("button", { name: "Dismiss notifications" })).toBeVisible();
  await expectAtAddressCarryingNothing(page, findNewAddress(app.pageHost));
  await checkCardRoles(page);
  await openSettings(page);
  await page.locator('input[name="appearance"][value="auto"]').check();
  await page.locator("#settingsDialog").getByRole("button", { name: "Close", exact: true }).click();
  await checkCardInEachLook(page);
}

/**
 * Leave off, or the X, takes the ask away for good, across a reload.
 * @param {MovingApp} app
 * @param {string} buttonName
 */
export async function checkNotificationsAskGoes(app, buttonName) {
  const { page } = app;
  await openNewHomeScreenApp(app);
  const updates = findUpdates(page);
  await tapUpdatesButton(page, buttonName);
  await expect(updates).toBeHidden();
  await page.reload();
  await expect(page.locator("#loadNote")).toHaveCount(0);
  await expect(updates).toBeHidden();
}

/**
 * Turn on, tapped while the page still reads whether the phone is subscribed, asks the phone,
 * subscribes it, and saves the subscription with the Worker, and the ask goes for good, across a
 * reload.
 * @param {MovingApp} app
 */
export async function checkTurnOn(app) {
  const { page } = app;
  await openNewHomeScreenApp(app, { canSubscribe: true });
  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith("/push/subscription") && response.request().method() === "PUT",
  );
  await tapUpdatesButton(page, TURN_ON_BUTTON);
  await releaseServiceWorker(page);
  expect((await saving).ok()).toBe(true);
  const updates = findUpdates(page);
  await expect(updates).toBeHidden();
  await page.reload();
  await expect(page.locator("#loadNote")).toHaveCount(0);
  await expect(updates).toBeHidden();
}
