import { test as base } from "@playwright/test";
import { checkPage } from "../../../../worker/check-page.mjs";
import {
  BROKEN_CHECK_TIMEOUT_MS,
  serveUnreachableStore,
} from "../../../../tests/browser/page-check.mjs";
import { test, expect, matchPath, serveLockedApp, LOCKED_PAGE_PATH } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ACCESS_CODE = "FASTBREAK";

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

test("a page that asks for no code passes once it draws, saying its code isn't needed", async ({
  page,
  baseURL,
}) => {
  const { changeAccessCode } = await serveLockedApp(page, { accessCode: ACCESS_CODE });
  changeAccessCode("");

  const check = await checkPage(page, { pageUrl: findPageUrl(baseURL), accessCode: ACCESS_CODE });

  expect(check).toEqual({
    status: "drawn",
    note: "the page asks for no code, so its access code secret isn't needed",
  });
});

test("a page that asks for no code and draws nothing is broken", async ({ page, baseURL }) => {
  const { changeAccessCode } = await serveLockedApp(page, { accessCode: ACCESS_CODE });
  changeAccessCode("");
  await serveUnreachableStore(page);

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    timeoutMs: BROKEN_CHECK_TIMEOUT_MS,
  });

  expect(check).toEqual({
    status: "broken",
    reason: `the page says "Can't reach the page's server right now"`,
  });
});

test("a page whose store doesn't answer is broken", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });
  await serveUnreachableStore(page);

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    timeoutMs: BROKEN_CHECK_TIMEOUT_MS,
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
    timeoutMs: BROKEN_CHECK_TIMEOUT_MS,
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
