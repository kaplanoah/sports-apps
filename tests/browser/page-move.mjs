import { expect } from "@playwright/test";
import {
  LEAVE_OFF_BUTTON,
  MOVE_BUTTON,
  MOVE_TEXT,
  MOVE_TITLE,
  NOTIFICATIONS_TEXT,
  NOTIFICATIONS_TITLE,
  TURN_ON_BUTTON,
} from "../../shared/page/move-cards.js";
import { listLowContrastText } from "./contrast.mjs";
import { IPHONE } from "./devices.mjs";
import { LOCKED_PAGE_PATH } from "./harness.mjs";
import { WELCOME } from "./home-screen-help.mjs";
import { listStrayPeriods } from "./stray-periods.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
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
async function followHandoff(page, pageHost, leave) {
  const handoff = page.waitForResponse(`${findNewAddress(pageHost)}access/handoff?**`);
  await leave();
  const response = await handoff;
  const address = new URL(response.headers().location, response.url());
  await page.goto(address.href);
  return address;
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
 * @param {Pick<MovingApp, "page" | "serve" | "pageHost" | "oldHost">} app
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
 * Taps Use new site in an Android phone's Home Screen app, which keeps `choices`, and returns the
 * handoff it opens, which the test holds rather than opening, since Safari is where the move goes
 * on, with the phone's light or dark setting and the page's clock as the finger landed.
 * @param {MovingApp} app
 * @param {Record<string, unknown>} choices
 * @param {string} [addedOnTheme]
 */
async function tapUseNewSite(app, choices, addedOnTheme) {
  const { page, pageHost } = app;
  await openOldHomeScreenApp(app, choices, addedOnTheme);
  const handoffAddress = `${findNewAddress(pageHost)}access/handoff?**`;
  await page.route(handoffAddress, (route) => route.abort());
  const handoff = page.waitForRequest(handoffAddress);
  const { tappedAt, isDark } = await page.evaluate(() => ({
    tappedAt: Date.now(),
    isDark: matchMedia("(prefers-color-scheme: dark)").matches,
  }));
  await tapUpdatesButton(page, MOVE_BUTTON);
  return {
    handoff: new URL((await handoff).url()),
    colorScheme: /** @type {const} */ (isDark ? "dark" : "light"),
    tappedAt,
  };
}

/**
 * Opens a move's handoff in Safari, never signed in, on the phone the move left from.
 * @param {MovingApp} app
 * @param {{ handoff: URL, colorScheme: "light" | "dark" }} move
 */
async function openInSafari({ browser, serve, pageHost }, { handoff, colorScheme }) {
  const safari = await browser.newContext({ ...IPHONE, reducedMotion: "reduce", colorScheme });
  const safariPage = await safari.newPage();
  await serve(safariPage, { accessCode: ACCESS_CODE, pageHost });
  // A navigation the test starts throws on the redirect Playwright doesn't route, so the blank page
  // starts it, as a link would.
  await followHandoff(safariPage, pageHost, () =>
    safariPage.evaluate((href) => location.assign(href), handoff.href),
  );
  return safariPage;
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
  expect(carried).toMatchObject({ choices: { appearance: '"auto"' }, fromApp: true });
  expect(at - move.tappedAt).toBeGreaterThanOrEqual(0);
  expect(at - move.tappedAt).toBeLessThan(60_000);

  const safariPage = await openInSafari(app, move);
  const welcome = safariPage.locator(WELCOME);
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole("heading")).toHaveText(`Finish moving ${appName}`);
  await expect(welcome.locator(".welcome-steps > li")).toHaveCount(4);
  await expect(welcome.locator(".welcome-steps > li").last()).toContainText(
    `Delete the old ${appName} Site`,
  );
  await expect(welcome.getByRole("radio")).toHaveCount(2);
  await expect(welcome.getByRole("radio", { name: looks.dark, exact: true })).toBeChecked();
  await expect(welcome.getByRole("button", { name: "Continue in browser" })).toBeVisible();
  await expect(welcome.getByRole("button", { name: "Install" })).toHaveCount(0);
  await checkCardInEachLook(safariPage);
  await safariPage.context().close();
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
  expect(unpack(move.handoff.searchParams.get("carried")).icon).toBeUndefined();
  const safariPage = await openInSafari(app, move);
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    safariPage.locator(WELCOME).getByRole("radio", { name: looks.light, exact: true }),
  ).toBeChecked();
  await safariPage.context().close();
}

/**
 * A pick of the icon in the moving welcome changes only the icon the site is added with, and rides
 * in the address the site is added from.
 * @param {MovingApp} app
 */
export async function checkMovingIconPick(app) {
  const { page, looks } = app;
  await page.emulateMedia({ colorScheme: "dark" });
  const safariPage = await openInSafari(app, await tapUseNewSite(app, { appearance: "dark" }));
  const icon = safariPage.locator("#homeScreenIcon");
  const darkIcon = await icon.getAttribute("href");
  await safariPage.locator(WELCOME).getByRole("radio", { name: looks.light, exact: true }).check();
  await expect(icon).not.toHaveAttribute("href", darkIcon);
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await safariPage.evaluate(() => localStorage.getItem("appearance"))).toBe('"dark"');
  const address = new URL(safariPage.url());
  expect(unpack(address.searchParams.get("carried")).icon).toBe("light");
  await safariPage.context().close();
}

/**
 * Closing the moving welcome ends the move, and nothing is left in the address to carry it.
 * @param {MovingApp} app
 */
export async function checkMovingWelcomeCloses(app) {
  const safariPage = await openInSafari(app, await tapUseNewSite(app, { appearance: "dark" }));
  const welcome = safariPage.locator(WELCOME);
  await welcome.getByRole("button", { name: "Close" }).click();
  await expect(welcome).toBeHidden();
  await expectAtAddressCarryingNothing(safariPage, findNewAddress(app.pageHost));
  expect(await safariPage.evaluate(() => localStorage.getItem("pageMove"))).toBeNull();
  await safariPage.context().close();
}

/**
 * Opens the new site's Home Screen app for the first time, signed in, from the address a move with
 * notifications on carried.
 * @param {MovingApp} app
 */
async function openNewHomeScreenApp({ page, serve, pageHost }) {
  await page.addInitScript(leaveNotificationsUnanswered);
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
  await expect(updates.locator(".move-card-text")).toHaveText(NOTIFICATIONS_TEXT);
  await expect(updates.getByRole("button", { name: LEAVE_OFF_BUTTON })).toBeVisible();
  await expect(updates.getByRole("button", { name: TURN_ON_BUTTON })).toBeVisible();
  await expect(updates.getByRole("button", { name: "Dismiss notifications" })).toBeVisible();
  await expectAtAddressCarryingNothing(page, findNewAddress(app.pageHost));
  await checkCardRoles(page);
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
