import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAppPage,
  checkPage,
  hideAddress,
  isFromRelease,
  nameAccessSecrets,
  readPageAccess,
} from "../worker/check-page.mjs";

const PAGE_URL = "https://wnba-app.example-subdomain.workers.dev/k3y/";

test("each app's page is opened with its own address and its channel's one access code", () => {
  assert.deepEqual(nameAccessSecrets("wnba", "production"), {
    pageUrl: "WNBA_PAGE_URL",
    accessCode: "ACCESS_CODE",
  });
  assert.deepEqual(nameAccessSecrets("mlb", "beta"), {
    pageUrl: "MLB_BETA_PAGE_URL",
    accessCode: "ACCESS_CODE",
  });
});

test("a page with no address isn't opened, and one with no code opens without signing in", () => {
  assert.equal(readPageAccess("wnba", "production", {}), null);
  assert.deepEqual(readPageAccess("wnba", "beta", { WNBA_BETA_PAGE_URL: PAGE_URL }), {
    pageUrl: PAGE_URL,
    accessCode: undefined,
  });
  assert.deepEqual(
    readPageAccess("wnba", "production", { WNBA_PAGE_URL: PAGE_URL, ACCESS_CODE: "LAYUP" }),
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

/**
 * A page as a browser drives it from an old address that sends it on to `landedUrl`, whose Worker
 * takes the code there and draws once signed in, or, with `thrown`, throws that and never draws.
 * Playwright routes only a redirect's first request, so a browser test can't follow the Worker's
 * move.
 * @param {string} landedUrl
 * @param {{ thrown?: string }} [options]
 */
function openMovedPage(landedUrl, { thrown } = {}) {
  /** @type {string[]} */
  const visits = [];
  /** @type {string[]} */
  const codeAddresses = [];
  let address = "about:blank";
  const page = {
    /** @param {string} event @param {(error: Error) => void} listener */
    on(event, listener) {
      if (thrown && event === "pageerror") listener(new Error(thrown));
    },
    url: () => address,
    /** @param {string} visited */
    async goto(visited) {
      visits.push(visited);
      address = landedUrl;
      return { ok: () => true };
    },
    /** @param {unknown} _ @param {{ address: string }} sent */
    async evaluate(_, sent) {
      codeAddresses.push(sent.address);
      return 204;
    },
    waitForFunction: async () => {
      if (thrown) throw Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" });
    },
  };
  return {
    page: /** @type {import("@playwright/test").Page} */ (/** @type {unknown} */ (page)),
    visits,
    codeAddresses,
  };
}

test("a page its old address sends on signs in, and opens again, where it landed", async () => {
  const { page, visits, codeAddresses } = openMovedPage("https://wnba.sports.example/");

  const check = await checkPage(page, { pageUrl: PAGE_URL, accessCode: "LAYUP" });

  assert.deepEqual(check, { status: "drawn" });
  assert.deepEqual(codeAddresses, ["https://wnba.sports.example/access"]);
  assert.deepEqual(visits, [PAGE_URL, "https://wnba.sports.example/"]);
});

test("a failed check never names the host the page's old address sent it on to", async () => {
  const { page } = openMovedPage("https://wnba.sports.example/", {
    thrown: "Failed to fetch https://wnba.sports.example/store/live",
  });
  const context = { newPage: async () => page, close: async () => {} };
  const browser = { newContext: async () => context, close: async () => {} };

  const check = await checkAppPage({
    app: "wnba",
    channel: "production",
    env: { WNBA_PAGE_URL: PAGE_URL, ACCESS_CODE: "LAYUP" },
    attempts: 1,
    launchBrowser: async () =>
      /** @type {import("@playwright/test").Browser} */ (/** @type {unknown} */ (browser)),
  });

  assert.deepEqual(check, {
    status: "broken",
    reason: "the page threw: Failed to fetch <page host>/store/live",
  });
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

test("a reason hides the page host an old address sent the check on to", () => {
  const check = hideAddress(
    {
      status: "broken",
      reason:
        "the access code's route answered 500 at https://wnba.sports.example/access, on wnba.sports.example",
    },
    PAGE_URL,
    "https://wnba.sports.example/",
  );
  assert.deepEqual(check, {
    status: "broken",
    reason: "the access code's route answered 500 at <page host>/access, on <page host>",
  });
});

test("a page that never left the blank page hides only its own address", () => {
  const reason = `the page didn't load: net::ERR_FAILED at ${PAGE_URL}`;
  assert.deepEqual(hideAddress({ status: "broken", reason }, PAGE_URL, "about:blank"), {
    status: "broken",
    reason: "the page didn't load: net::ERR_FAILED at <page>/",
  });
});

test("thrown check infrastructure failures leave the page unchecked and mask its address", async () => {
  for (const step of ["goto", "evaluate", "waitForFunction"]) {
    const { page } = openMovedPage(PAGE_URL);
    page[step] = async () => {
      throw new Error(`Target closed at ${PAGE_URL}`);
    };
    const context = { newPage: async () => page, close: async () => {} };
    const browser = { newContext: async () => context, close: async () => {} };
    const check = await checkAppPage({
      app: "wnba",
      channel: "production",
      env: { WNBA_PAGE_URL: PAGE_URL, ACCESS_CODE: "LAYUP" },
      attempts: 1,
      launchBrowser: async () =>
        /** @type {import("@playwright/test").Browser} */ (/** @type {unknown} */ (browser)),
    });
    assert.deepEqual(check, {
      status: "unchecked",
      reason: "the page check failed: Target closed at <page>/",
    });
  }
});

test("a refused or rate-limited code cannot verify the authenticated page", async () => {
  for (const [status, reason] of [
    [401, "the Worker refused the access code"],
    [429, "the Worker had too many tries at the access code"],
  ]) {
    const { page } = openMovedPage(PAGE_URL);
    page.evaluate = /** @type {typeof page.evaluate} */ (async () => status);
    assert.deepEqual(await checkPage(page, { pageUrl: PAGE_URL, accessCode: "LAYUP" }), {
      status: "unchecked",
      reason,
    });
  }
});
