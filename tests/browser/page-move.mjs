import { expect } from "@playwright/test";
import { waitForLoadToSettle } from "./at-rest.mjs";
import { listLowContrastText } from "./contrast.mjs";
import { WELCOME } from "./home-screen-help.mjs";
import { listNeverShownWords } from "./never-shown-words.mjs";
import { stubPushManager } from "./push-stub.mjs";
import { findCenter } from "./season-scroll.mjs";
import { openSettings } from "./settings.mjs";
import { listStrayPeriods } from "./stray-periods.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
import { listTextOffRoles } from "./type-roles.mjs";

const OLD_ADDRESS = "https://app.example-subdomain.workers.dev/test-key/";
const PAGE_HOST = "app.example.com";
const ACCESS_CODE = "FASTBREAK";
const MOVE_PATH = "/access/move";

const CARD_TITLE = "New icon and link";
const CARD_TEXT =
  "The app has a new icon (took me embarrassingly long to notice the WNBA ball is always orange and white) and a simpler link. Please add the new site to your home screen.";
const ASK_TITLE = "Keep notifications on?";
const ASK_TEXT =
  "You had notifications turned on from the old site. Apple requires approving notifications again for a new site. You can always configure notifications in settings.";

const PUSH_STUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
  keptKey: "test-push-subscription",
  nextEndpointKey: "test-next-endpoint",
};

/**
 * @typedef {import("@playwright/test").Page} Page
 * @typedef {{ light: string, dark: string }} Looks
 * @typedef {(page: Page, options?: { isShowingWelcome?: boolean, address?: string }) => Promise<unknown>} OpenApp
 * @typedef {(page: Page, options: { accessCode: string }) => Promise<{ openPageHost: (host: string) => void }>} ServeLockedApp
 */

const markOnHomeScreen = () => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

/** @param {{ choices?: Record<string, string>, icon?: string | null, isNotifying?: boolean }} move */
const packMove = ({ choices = {}, icon = null, isNotifying = false }) =>
  Buffer.from(JSON.stringify({ choices, icon, isNotifying })).toString("base64url");

/** @param {string} address */
const readMove = (address) =>
  JSON.parse(
    Buffer.from(
      /** @type {string} */ (new URL(address).searchParams.get("move")),
      "base64url",
    ).toString(),
  );

/**
 * Checks the page as each app's tests check every view: each text in its type role, readable,
 * ending as its sentences call for, and each tap landing on a button.
 * @param {Page} page
 */
async function checkReads(page) {
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
}

/** @param {Page} page */
async function checkReadsInEachLook(page) {
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await checkReads(page);
  }
}

/**
 * Signs in at the app's old address, under its key at Cloudflare's own, while its Worker has no
 * address of its own to hand off to.
 * @param {Page} page
 * @param {ServeLockedApp} serveLockedApp
 */
async function signInAtOldAddress(page, serveLockedApp) {
  const worker = await serveLockedApp(page, { accessCode: ACCESS_CODE });
  await page.goto(OLD_ADDRESS);
  await page.getByRole("textbox", { name: "Access code" }).fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Open" }).click();
  return worker;
}

/** @param {Page} page */
const countMoveAsks = (page) => {
  const asks = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(MOVE_PATH)) asks.count += 1;
  });
  return asks;
};

/**
 * A browser at the old address of an app that's moving stays while its Worker has no address of
 * its own, and once it has one, leaves for the handoff there, carrying the browser's choices.
 * @param {{ page: Page, serveLockedApp: ServeLockedApp }} app
 */
export async function checkBrowserLeaves({ page, serveLockedApp }) {
  const worker = await signInAtOldAddress(page, serveLockedApp);
  await expect(page.locator("#updates")).toBeAttached();
  expect(page.url()).toBe(OLD_ADDRESS);
  await page.evaluate(() => localStorage.setItem("appearance", JSON.stringify("dark")));
  worker.openPageHost(PAGE_HOST);
  const leaving = page.waitForRequest(/^https:\/\/app\.example\.com\/access\/handoff\?token=/);

  await page.reload({ waitUntil: "commit" });

  const move = readMove((await leaving).url());
  expect(move).toMatchObject({
    choices: { appearance: JSON.stringify("dark") },
    icon: null,
    isNotifying: false,
  });
}

/**
 * An app that isn't moving never asks its Worker for a handoff, and stays at its old address, even
 * where its Worker has an address of its own.
 * @param {{ page: Page, serveLockedApp: ServeLockedApp }} app
 */
export async function checkNeverMoves({ page, serveLockedApp }) {
  const asks = countMoveAsks(page);
  const worker = await signInAtOldAddress(page, serveLockedApp);
  await expect(page.locator("#updates")).toBeAttached();
  worker.openPageHost(PAGE_HOST);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("#updates")).toBeAttached();
  expect(page.url()).toBe(OLD_ADDRESS);
  expect(asks.count).toBe(0);
}

/**
 * The welcome a move opens on, in the app's name, picks only the icon the app is added with,
 * which the move's address keeps, and which a change of the phone's look doesn't undo.
 * @param {{ page: Page, openApp: OpenApp, looks: Looks, appName: string, neverShown: string[] }} app
 */
export async function checkMovingWelcome({ page, openApp, looks, appName, neverShown }) {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, { isShowingWelcome: true, address: `/?move=${packMove({})}` });
  const welcome = page.locator(WELCOME);
  await expect(welcome.getByRole("heading")).toHaveText(`Finish moving ${appName}`);
  await expect(welcome.locator(".welcome-steps > li:visible")).toHaveText([
    `Pick your icon You can change your theme later in Settings ${looks.light} ${looks.dark}`,
    "Tap Share",
    "Tap Add to Home Screen",
    `Delete the old ${appName} Site Press and hold, then tap Delete Bookmark`,
  ]);
  await expect(welcome.getByRole("radio")).toHaveCount(2);
  await expect(welcome.locator(".welcome-close")).toBeVisible();
  await expect(welcome.getByRole("button", { name: "Continue in browser" })).toBeVisible();
  await checkReads(page);
  expect(await listNeverShownWords(page, neverShown)).toEqual([]);

  const icon = page.locator("#homeScreenIcon");
  await expect(icon).toHaveAttribute("href", "icon-light-180.png");
  await welcome.getByRole("radio", { name: looks.dark }).check();
  await expect(icon).toHaveAttribute("href", "icon-180.png");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => readMove(page.url()).icon).toBe("dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(icon).toHaveAttribute("href", "icon-180.png");
  await checkReadsInEachLook(page);
}

/** @param {Page} page */
const findNotice = (page) => page.locator("#updates .move-notice");

/**
 * Taps one of the notice's buttons where it shows, once the page has settled, as a finger does,
 * which on the season tab lands on its stand-in under it (rider-taps.js).
 * @param {Page} page
 * @param {string} name
 * @param {"button" | "link"} role
 */
async function tapNoticeButton(page, name, role = "button") {
  const button = findNotice(page).getByRole(role, { name, exact: true });
  await expect(button).toBeVisible();
  await waitForLoadToSettle(page);
  const { x, y } = findCenter(await button.boundingBox());
  await page.mouse.click(x, y);
}

/** @param {import("@playwright/test").Locator} icon */
const readIconPicture = (icon) =>
  icon.evaluate((element) => {
    const { width, height, backgroundImage } = getComputedStyle(element);
    return { width, height, backgroundImage };
  });

/**
 * A Home Screen app at the old address shows no card while its Worker has no address of its own,
 * and, once it has one, the card, whose button opens the handoff in Safari, carrying the app's
 * choices, and whose X takes it away for good.
 * @param {{ page: Page, serveLockedApp: ServeLockedApp }} app
 */
export async function checkMoveCard({ page, serveLockedApp }) {
  await page.addInitScript(markOnHomeScreen);
  await page.emulateMedia({ colorScheme: "light" });
  const worker = await signInAtOldAddress(page, serveLockedApp);
  await expect(page.locator("#updates")).toBeAttached();
  const notice = findNotice(page);
  await expect(notice).toHaveCount(0);
  worker.openPageHost(PAGE_HOST);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(notice.locator(".move-notice-title")).toHaveText(CARD_TITLE);
  await expect(notice.locator(".move-notice-text")).toHaveText(CARD_TEXT);
  const button = notice.getByRole("link", { name: "Use new site" });
  await expect(button).toHaveAttribute(
    "href",
    /^x-safari-https:\/\/app\.example\.com\/access\/handoff\?token=[^&]+&move=[^&]+&app-theme=auto$/,
  );
  const handoff = /** @type {string} */ (await button.getAttribute("href"));
  expect(readMove(handoff.replace("x-safari-", ""))).toMatchObject({
    icon: null,
    isNotifying: false,
  });
  const icon = notice.locator(".move-notice-icon");
  const lightIcon = await readIconPicture(icon);
  expect(lightIcon).toMatchObject({ width: "44px", height: "44px" });
  await checkReadsInEachLook(page);
  const darkIcon = await readIconPicture(icon);
  expect(darkIcon).toMatchObject({ width: "44px", height: "44px" });
  expect(darkIcon.backgroundImage).not.toBe(lightIcon.backgroundImage);

  await page.evaluate(() => {
    localStorage.setItem("appearance", JSON.stringify("dark"));
    addEventListener("click", (event) => event.preventDefault());
  });
  await tapNoticeButton(page, "Use new site", "link");
  const tapped = /** @type {string} */ (await button.getAttribute("href"));
  expect(readMove(tapped.replace("x-safari-", "")).choices.appearance).toBe(JSON.stringify("dark"));

  await tapNoticeButton(page, "Dismiss move note");
  await expect(notice).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#updates")).toBeAttached();
  await expect(notice).toHaveCount(0);
}

/**
 * Opens the new icon's first open of a move from an address where notifications were on.
 * @param {Page} page
 * @param {OpenApp} openApp
 */
async function openNotifyingMove(page, openApp) {
  await page.addInitScript(markOnHomeScreen);
  await openApp(page, { address: `/?move=${packMove({ isNotifying: true })}` });
}

/**
 * The new icon's first open of a move from an address where notifications were on asks to keep
 * them on, with no move left in its address, and Leave off, or the X, answers it for good.
 * @param {{ page: Page, openApp: OpenApp, name: "Leave off" | "Dismiss notifications ask" }} app
 */
export async function checkNotificationsAsk({ page, openApp, name }) {
  await openNotifyingMove(page, openApp);
  const notice = findNotice(page);
  await expect(notice.locator(".move-notice-title")).toHaveText(ASK_TITLE);
  await expect(notice.locator(".move-notice-text")).toHaveText(ASK_TEXT);
  await expect(notice.getByRole("button")).toHaveText(["", "Leave off", "Turn on"]);
  expect(new URL(page.url()).searchParams.has("move")).toBe(false);
  await checkReadsInEachLook(page);

  await tapNoticeButton(page, name);
  await expect(notice).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#updates")).toBeAttached();
  await expect(notice).toHaveCount(0);
}

/**
 * The new icon's first open of a move from an address where notifications were off asks nothing.
 * @param {{ page: Page, openApp: OpenApp }} app
 */
export async function checkNoAskWhenOff({ page, openApp }) {
  await page.addInitScript(markOnHomeScreen);
  await openApp(page, { address: `/?move=${packMove({ isNotifying: false })}` });
  await expect(page.locator("#updates")).toBeAttached();
  expect(new URL(page.url()).searchParams.has("move")).toBe(false);
  await expect(findNotice(page)).toHaveCount(0);
}

/**
 * Turn on in the ask turns notifications on as settings' switch does, and answers the ask.
 * @param {{ page: Page, openApp: OpenApp }} app
 */
export async function checkTurnOnFromAsk({ page, openApp }) {
  await page.addInitScript(stubPushManager, PUSH_STUB);
  await openNotifyingMove(page, openApp);

  await tapNoticeButton(page, "Turn on");

  await expect(findNotice(page)).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByRole("switch", { name: "Notifications" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
}
