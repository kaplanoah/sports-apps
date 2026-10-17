import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAppPage,
  hideAddress,
  isFromRelease,
  nameAccessSecrets,
  readPageAccess,
} from "../worker/check-page.mjs";

const PAGE_URL = "https://wnba-app.example-subdomain.workers.dev/k3y/";

test("each app's page is opened with its own channel's secrets", () => {
  assert.deepEqual(nameAccessSecrets("wnba", "production"), {
    pageUrl: "WNBA_PAGE_URL",
    accessCode: "WNBA_ACCESS_CODE",
  });
  assert.deepEqual(nameAccessSecrets("mlb", "beta"), {
    pageUrl: "MLB_BETA_PAGE_URL",
    accessCode: "MLB_BETA_ACCESS_CODE",
  });
});

test("a page with no address isn't opened, and one with no code opens without signing in", () => {
  assert.equal(readPageAccess("wnba", "production", {}), null);
  assert.deepEqual(readPageAccess("wnba", "beta", { WNBA_BETA_PAGE_URL: PAGE_URL }), {
    pageUrl: PAGE_URL,
    accessCode: undefined,
  });
  assert.deepEqual(
    readPageAccess("wnba", "production", { WNBA_PAGE_URL: PAGE_URL, WNBA_ACCESS_CODE: "LAYUP" }),
    { pageUrl: PAGE_URL, accessCode: "LAYUP" },
  );
});

test("an address saved without its ending slash gets one, so the page's routes hang off its folder", () => {
  assert.deepEqual(readPageAccess("mlb", "production", { MLB_PAGE_URL: PAGE_URL.slice(0, -1) }), {
    pageUrl: PAGE_URL,
    accessCode: undefined,
  });
});

test("an app without its page's secret goes unchecked, naming the secret", async () => {
  assert.deepEqual(await checkAppPage({ app: "mlb", channel: "beta", env: {} }), {
    status: "unchecked",
    reason: "no MLB_BETA_PAGE_URL secret",
  });
});

test("a browser that doesn't start fails the check rather than skipping it", async () => {
  await assert.rejects(
    checkAppPage({
      app: "mlb",
      channel: "production",
      env: { MLB_PAGE_URL: PAGE_URL },
      launchBrowser: async () => {
        throw new Error("Executable doesn't exist at /ms-playwright/chromium");
      },
    }),
    /Executable doesn't exist/,
  );
});

test("a page is the release whose commit its scripts' folder starts", () => {
  const sources = [
    "https://wnba-app.example-subdomain.workers.dev/k3y/release/abc1234/js/app.js",
    "https://wnba-app.example-subdomain.workers.dev/k3y/release/abc1234/shared/tabs.js",
    "https://cdn.example/analytics.js",
  ];
  assert.equal(isFromRelease(sources, `abc1234${"0".repeat(33)}`), true);
  assert.equal(isFromRelease(sources, `def5678${"0".repeat(33)}`), false);
  assert.equal(isFromRelease(["https://cdn.example/analytics.js"], "abc1234"), false);
});

test("a reason never shows the page's address, its Worker's, or its key", () => {
  const check = hideAddress(
    {
      status: "broken",
      reason: `the page didn't load: net::ERR_FAILED at ${PAGE_URL}, from https://wnba-app.example-subdomain.workers.dev, for /k3y/release/abc1234/js/app.js`,
    },
    PAGE_URL,
  );
  assert.deepEqual(check, {
    status: "broken",
    reason:
      "the page didn't load: net::ERR_FAILED at <page>/, from <worker>, for /<key>/release/abc1234/js/app.js",
  });
  assert.deepEqual(hideAddress({ status: "drawn" }, PAGE_URL), { status: "drawn" });
});

test("a reason hides the Worker's name without its scheme, and the key on its own", () => {
  const check = hideAddress(
    {
      status: "broken",
      reason:
        "the page didn't load: getaddrinfo ENOTFOUND wnba-app.example-subdomain.workers.dev, key k3y, folder /k3y",
    },
    PAGE_URL,
  );
  assert.deepEqual(check, {
    status: "broken",
    reason: "the page didn't load: getaddrinfo ENOTFOUND <worker>, key <key>, folder /<key>",
  });
});
