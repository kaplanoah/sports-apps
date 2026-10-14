import { test as base } from "@playwright/test";
import { checkPage } from "../../../../worker/check-page.mjs";
import { test, expect, matchPath, serveLockedApp, LOCKED_PAGE_PATH } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ACCESS_CODE = "FASTBREAK";
// A broken page draws nothing, so a check of one waits only this long rather than a deploy's.
const BROKEN_TIMEOUT_MS = 3000;

/** @param {string | undefined} baseURL */
const findPageUrl = (baseURL) => new URL(LOCKED_PAGE_PATH, baseURL).href;

test("a page that draws its season passes, signed in with its code", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });

  const check = await checkPage(page, { pageUrl: findPageUrl(baseURL), accessCode: ACCESS_CODE });

  expect(check).toEqual({ status: "drawn" });
});

test("a code the Worker refuses leaves the page unchecked, not broken", async ({
  page,
  baseURL,
}) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });

  const check = await checkPage(page, { pageUrl: findPageUrl(baseURL), accessCode: "LAYUP" });

  expect(check).toEqual({ status: "unchecked", reason: "the Worker refused the access code" });
});

test("a page whose store doesn't answer is broken", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });
  await page.route(matchPath(`${LOCKED_PAGE_PATH}store/`), (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.routeWebSocket(
    (url) => url.pathname === `${LOCKED_PAGE_PATH}watch`,
    (socket) => socket.close(),
  );

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    timeoutMs: BROKEN_TIMEOUT_MS,
  });

  expect(check).toEqual({
    status: "broken",
    reason: `the page says "Can't reach the page's server right now"`,
  });
});

// The harness's test fails on any error the page throws, which this one throws on purpose.
base("a page whose code throws is broken, and says what it threw", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });
  await page.route(matchPath(`${LOCKED_PAGE_PATH}js/app.js`), (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'throw new Error("The release is broken");',
    }),
  );

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    timeoutMs: BROKEN_TIMEOUT_MS,
  });

  expect(check).toEqual({ status: "broken", reason: "the page threw: The release is broken" });
});

test("a page that isn't the new release is the version before", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    commit: "2".repeat(40),
  });

  expect(check).toEqual({ status: "broken", reason: "the page is still the version before" });
});
