import { expect } from "@playwright/test";
import { ANDROID_AGENT, IPHONE_AGENT } from "./devices.mjs";
import { LOCKED_PAGE_PATH } from "./harness.mjs";
import { setHidden } from "./visibility.mjs";

const markOnHomeScreen = () => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

/**
 * Picks the dark look in Settings on an iPhone's Home Screen app and checks the note under the
 * icons says how to update the icon, with a link that opens Safari on that look, then checks
 * neither the browser nor an Android Home Screen app shows the note.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   context: import("@playwright/test").BrowserContext,
 *   browser: import("@playwright/test").Browser,
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   looks: { light: string, dark: string },
 * }} app
 */
export async function checkReAddNote({ page, context, browser, openApp, openSettings, looks }) {
  await page.addInitScript(markOnHomeScreen);
  await openApp(page);
  await openSettings(page);
  const note = page.locator("#appearanceNote");
  await expect(note).toBeHidden();
  await page.getByRole("radio", { name: looks.dark }).check();
  await expect(note).toHaveText(
    "Apple only sets icons when you add a site to your home screen. To update your icon, re-add the site",
  );
  const safariAddress = new URL(page.url());
  safariAddress.searchParams.set("app-theme", "dark");
  await expect(note.getByRole("link", { name: "re-add the site" })).toHaveAttribute(
    "href",
    `x-safari-${safariAddress.href}`,
  );
  const noteBelowIcons = await page.evaluate(
    () =>
      document.querySelector("#appearanceNote").getBoundingClientRect().top -
      document.querySelector("#settingsDialog .appearance-choices").getBoundingClientRect().bottom,
  );
  // The row's 14px gap, less the 3px the note's tall lines and the names over it add.
  expect(noteBelowIcons).toBe(11);

  const browserTab = await context.newPage();
  await openApp(browserTab);
  await openSettings(browserTab);
  await browserTab.getByRole("radio", { name: looks.light }).check();
  await expect(browserTab.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(browserTab.locator("#appearanceNote")).toBeHidden();

  const android = await browser.newContext({ userAgent: ANDROID_AGENT, reducedMotion: "reduce" });
  const androidApp = await android.newPage();
  await androidApp.addInitScript(markOnHomeScreen);
  await openApp(androidApp);
  await openSettings(androidApp);
  await androidApp.getByRole("radio", { name: looks.dark }).check();
  await expect(androidApp.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(androidApp.locator("#appearanceNote")).toBeHidden();
  await android.close();
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
const HANDOFF_ROUTE = `**/${HANDOFF_PATH}`;

/** @param {import("@playwright/test").Request} request */
const isHandoffRequest = (request) =>
  request.method() === "POST" && request.url().endsWith(`/${HANDOFF_PATH}`);

/** @param {string} look */
const buildHandoffLink = (look) =>
  new RegExp(
    `^x-safari-http://[^/]+${LOCKED_PAGE_PATH}${HANDOFF_PATH}\\?token=[^&]+&app-theme=${look}$`,
  );

/** @param {import("@playwright/test").Page} page */
const findReAddLink = (page) =>
  page.locator("#appearanceNote").getByRole("link", { name: "re-add the site" });

// A handoff's answer is read in the page's own steps after the network has finished it, so the
// page counts each one it has read, and a test can wait for that.
/** @param {string} handoffPath */
function countHandoffsRead(handoffPath) {
  const page = /** @type {any} */ (window);
  const fetchFromWorker = window.fetch;
  page.handoffsRead = 0;
  window.fetch = async (...request) => {
    const response = await fetchFromWorker(...request);
    if (!String(request[0]).endsWith(handoffPath)) return response;
    const readJson = response.json.bind(response);
    response.json = async () => {
      const body = await readJson();
      page.handoffsRead += 1;
      return body;
    };
    return response;
  };
}

/** @param {import("@playwright/test").Page} page */
const readHandoffsRead = (page) => page.evaluate(() => /** @type {any} */ (window).handoffsRead);

/**
 * Signs in to an iPhone's Home Screen app behind its access code and opens settings, counting
 * each handoff the page asks for.
 * @param {LockedApp} app
 */
async function openLockedSettings({ page, serveLockedApp, openSettings }) {
  await page.addInitScript(markOnHomeScreen);
  await page.addInitScript(countHandoffsRead, HANDOFF_PATH);
  await serveLockedApp(page, { accessCode: "FASTBREAK" });
  const handoffs = { count: 0 };
  page.on("request", (request) => {
    if (isHandoffRequest(request)) handoffs.count += 1;
  });
  await page.goto(LOCKED_PAGE_PATH);
  await page.getByRole("textbox", { name: "Access code" }).fill("FASTBREAK");
  await page.getByRole("button", { name: "Open" }).click();
  await openSettings(page);
  return handoffs;
}

/**
 * Has the page leave the screen for `ms`, as a phone's switch to another app does, which freezes
 * the page's timers, so only its clock moves on.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
async function leaveFor(page, ms) {
  await setHidden(page, true);
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + ms);
  await setHidden(page, false);
}

/**
 * Picks the light look and then the dark one before the light one's handoff answers, and checks
 * the link stays on the dark one, then that the note renews its handoff halfway through, tries
 * again soon after a renewal fails, renews as it comes back from short trips away once that's
 * due, and leaves with settings, renewing no more.
 * @param {LockedApp} app
 */
export async function checkHandoffRenewal(app) {
  const { page, looks } = app;
  const handoffs = await openLockedSettings(app);
  const link = findReAddLink(page);
  /** @type {(value?: unknown) => void} */
  let releaseFirst = () => {};
  const firstHeld = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const holdFirstAnswer = async (route) => {
    await firstHeld;
    await route.fallback();
  };
  await page.route(HANDOFF_ROUTE, holdFirstAnswer, { times: 1 });
  await page.getByRole("radio", { name: looks.light }).check();
  await page.getByRole("radio", { name: looks.dark }).check();
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  releaseFirst();
  await expect.poll(() => readHandoffsRead(page)).toBe(2);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));
  expect(handoffs.count).toBe(2);

  await page.route(HANDOFF_ROUTE, (route) => route.fulfill({ status: 503 }), { times: 1 });
  await page.clock.runFor(5 * 60 * 1000);
  await expect.poll(() => handoffs.count).toBe(3);
  // The clock moves a little at a time, since a renewal sets its timer only once its answer arrives.
  const readCountAfterTenSeconds = async () => {
    await page.clock.runFor(10 * 1000);
    return handoffs.count;
  };
  await expect.poll(readCountAfterTenSeconds).toBe(4);
  await expect.poll(() => readHandoffsRead(page)).toBe(3);

  // Each trip is short of the two minutes that close settings, and the third passes the renewal.
  await leaveFor(page, 110 * 1000);
  await leaveFor(page, 110 * 1000);
  expect(handoffs.count).toBe(4);
  await leaveFor(page, 110 * 1000);
  await expect.poll(() => handoffs.count).toBe(5);
  await expect.poll(() => readHandoffsRead(page)).toBe(4);
  await expect(link).toHaveAttribute("href", buildHandoffLink("dark"));

  await page.locator("#settingsCloseBtn").click();
  await expect(page.locator("#appearanceNote")).toBeEmpty();
  await page.clock.runFor(15 * 60 * 1000);
  expect(handoffs.count).toBe(5);
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
  await page.getByRole("radio", { name: looks.dark }).check();
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
  await expect(safariPage.locator("#homeScreenWelcome")).toBeVisible();
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(safariPage.getByRole("textbox", { name: "Access code" })).toHaveCount(0);
  await safari.close();
}
