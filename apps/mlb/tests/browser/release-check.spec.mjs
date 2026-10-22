import { checkPage } from "../../../../worker/check-page.mjs";
import {
  BROKEN_CHECK_TIMEOUT_MS,
  serveSilentSocket,
  serveUnreachableStore,
} from "../../../../tests/browser/page-check.mjs";
import { test, expect, serveLockedApp, LOCKED_PAGE_PATH } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ACCESS_CODE = "HOMERUN";

/** @param {string | undefined} baseURL */
const findPageUrl = (baseURL) => new URL(LOCKED_PAGE_PATH, baseURL).href;

test("a page that draws its season passes, signed in with its code", async ({ page, baseURL }) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });

  const check = await checkPage(page, { pageUrl: findPageUrl(baseURL), accessCode: ACCESS_CODE });

  expect(check).toEqual({ status: "drawn" });
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

test("a page whose live connection gets the store's first message passes the live check", async ({
  page,
  baseURL,
}) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    isLiveChecked: true,
  });

  expect(check).toEqual({ status: "drawn" });
});

test("a page that draws but whose live connection gets nothing fails the live check", async ({
  page,
  baseURL,
}) => {
  await serveLockedApp(page, { accessCode: ACCESS_CODE });
  await serveSilentSocket(page);

  const check = await checkPage(page, {
    pageUrl: findPageUrl(baseURL),
    accessCode: ACCESS_CODE,
    timeoutMs: BROKEN_CHECK_TIMEOUT_MS,
    isLiveChecked: true,
  });

  expect(check).toEqual({
    status: "broken",
    reason: `the page's live connection got nothing within ${BROKEN_CHECK_TIMEOUT_MS / 1000} seconds`,
  });
});
