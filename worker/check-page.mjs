// Opens an app's live page as a phone does, signed in with its access code, and says whether it
// drew what its store sent. CI runs the page against recorded data; this reaches what only the
// live Worker has, like its secrets, its store, and what the league says today.

const DRAW_TIMEOUT_MS = 30 * 1000;
const RELEASE_FOLDER = /\/release\/([^/]+)\//;

/**
 * @typedef {{ status: "drawn" }
 *   | { status: "broken", reason: string }
 *   | { status: "unchecked", reason: string }} PageCheck
 */

/** @param {string} reason @returns {PageCheck} */
const markBroken = (reason) => ({ status: "broken", reason });
/** @param {string} reason @returns {PageCheck} */
const markUnchecked = (reason) => ({ status: "unchecked", reason });

/**
 * The secrets that open an app's page on a channel: its address, with its key, and its access
 * code when it asks for one.
 * @param {string} app
 * @param {string} channel
 */
export function nameAccessSecrets(app, channel) {
  const prefix = `${app.toUpperCase()}${channel === "beta" ? "_BETA" : ""}`;
  return { pageUrl: `${prefix}_PAGE_URL`, accessCode: `${prefix}_ACCESS_CODE` };
}

// The page's routes, like its access code's, hang off its folder, so its address ends in a slash
// whether or not the secret does.
/**
 * @param {string} app
 * @param {string} channel
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ pageUrl: string, accessCode: string | undefined } | null}
 */
export function readPageAccess(app, channel, env) {
  const secrets = nameAccessSecrets(app, channel);
  const pageUrl = env[secrets.pageUrl];
  if (!pageUrl) return null;
  return {
    pageUrl: pageUrl.endsWith("/") ? pageUrl : `${pageUrl}/`,
    accessCode: env[secrets.accessCode] || undefined,
  };
}

/**
 * The status the Worker answers the code with, sent from the page as its gate sends it.
 * @param {import("@playwright/test").Page} page
 * @param {string} pageUrl
 * @param {string} accessCode
 */
const sendAccessCode = (page, pageUrl, accessCode) =>
  page.evaluate(
    async ({ address, code }) =>
      (
        await fetch(address, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        })
      ).status,
    { address: new URL("access", pageUrl).href, code: accessCode },
  );

/**
 * A refused code means the secret is out of date, not that the page is broken.
 * @param {number} status
 * @returns {PageCheck | null}
 */
function judgeSignIn(status) {
  if (status === 204) return null;
  if (status === 401) return markUnchecked("the Worker refused the access code");
  if (status === 429) return markUnchecked("the Worker had too many tries at the access code");
  return markBroken(`the access code's route answered ${status}`);
}

/**
 * Whether a page whose scripts load from `sources` is the release built from `commit`, which
 * names its folder in short form.
 * @param {string[]} sources
 * @param {string} commit
 */
export function isFromRelease(sources, commit) {
  const folders = sources.map((source) => source.match(RELEASE_FOLDER)?.[1]).filter(Boolean);
  return folders.length > 0 && folders.every((folder) => commit.startsWith(String(folder)));
}

/** @param {import("@playwright/test").Page} page */
const listScriptSources = (page) =>
  page
    .locator("script[src]")
    .evaluateAll((scripts) =>
      scripts.map((script) => /** @type {HTMLScriptElement} */ (script).src),
    );

// A page that can't reach its own server still draws, around a header that says so. A problem
// with the league's feeds isn't the release's, so it doesn't count.
const SERVER_PROBLEM = "^Can't reach";

/**
 * What the header says about reaching the page's server, if anything.
 * @param {import("@playwright/test").Page} page
 */
const readServerProblem = (page) =>
  page.evaluate(
    (source) =>
      [...document.querySelectorAll("#stamp .stamp-err")]
        .map((problem) => problem.textContent?.trim() ?? "")
        .find((text) => new RegExp(source).test(text)) ?? null,
    SERVER_PROBLEM,
  );

// The page has drawn the store's season once its load note is gone, with no line in its header's
// stamp still catching up or failing to reach its server. The access gate has neither note nor
// stamp.
/** @param {import("@playwright/test").Page} page @param {number} timeoutMs */
const waitForDrawing = (page, timeoutMs) =>
  page
    .waitForFunction(
      (source) => {
        const stamp = document.getElementById("stamp");
        if (!stamp || document.getElementById("loadNote")) return false;
        if (stamp.querySelector(".catch-up-line")) return false;
        const problems = [...stamp.querySelectorAll(".stamp-err")];
        return !problems.some((problem) =>
          new RegExp(source).test(problem.textContent?.trim() ?? ""),
        );
      },
      SERVER_PROBLEM,
      { timeout: timeoutMs },
    )
    .then(
      () => true,
      () => false,
    );

/**
 * @param {import("@playwright/test").Page} page
 * @param {object} options
 * @param {string} options.pageUrl
 * @param {string} [options.accessCode]
 * @param {string} [options.commit] the release the page should be, when it's a new one
 * @param {number} [options.timeoutMs]
 * @returns {Promise<PageCheck>}
 */
export async function checkPage(
  page,
  { pageUrl, accessCode, commit, timeoutMs = DRAW_TIMEOUT_MS },
) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(pageUrl);
  if (!response?.ok()) return markBroken(`the page answered ${response?.status()}`);
  if (accessCode) {
    const signInProblem = judgeSignIn(await sendAccessCode(page, pageUrl, accessCode));
    if (signInProblem) return signInProblem;
    await page.goto(pageUrl);
  }
  if (commit && !isFromRelease(await listScriptSources(page), commit))
    return markBroken("the page is still the version before");
  if (await waitForDrawing(page, timeoutMs)) return { status: "drawn" };
  if (errors.length) return markBroken(`the page threw: ${errors[0]}`);
  const serverProblem = await readServerProblem(page);
  if (serverProblem) return markBroken(`the page says "${serverProblem}"`);
  return markBroken(`the page drew nothing within ${timeoutMs / 1000} seconds`);
}

/**
 * A check's reason without the page's address, since logs and issues are public: not the whole
 * address, its Worker's with or without its scheme, its folder, or its key on its own, in
 * whatever form a browser's error names them.
 * @param {PageCheck} check
 * @param {string} pageUrl
 * @returns {PageCheck}
 */
export function hideAddress(check, pageUrl) {
  if (check.status === "drawn") return check;
  const { origin, hostname, pathname } = new URL(pageUrl);
  const key = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const masks = [
    [pageUrl, "<page>/"],
    [origin, "<worker>"],
    [hostname, "<worker>"],
    [pathname, "/<key>/"],
    ...(key ? [[key, "<key>"]] : []),
  ];
  const reason = masks.reduce(
    (text, [secret, mask]) => text.replaceAll(secret, mask),
    check.reason,
  );
  return { ...check, reason };
}

const waitFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Chromium, from CHROMIUM_PATH when it names one.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<import("@playwright/test").Browser>}
 */
async function launchChromium(env) {
  // Only a check that has a page to open needs a browser.
  const { chromium } = await import("@playwright/test");
  const executablePath = env.CHROMIUM_PATH;
  return chromium.launch(executablePath ? { executablePath } : {});
}

/**
 * Opens an app's live page in a browser of its own, trying again after `pauseMs` while it's
 * broken, up to `attempts` times. Only a page with no address goes unchecked: a browser that
 * doesn't start throws, so the deploy puts the version before back and the watch's run fails.
 * @param {object} options
 * @param {string} options.app
 * @param {string} options.channel
 * @param {string} [options.commit]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.attempts]
 * @param {number} [options.pauseMs]
 * @param {typeof launchChromium} [options.launchBrowser]
 * @returns {Promise<PageCheck>}
 */
export async function checkAppPage({
  app,
  channel,
  commit,
  env = process.env,
  attempts = 3,
  pauseMs = 5000,
  launchBrowser = launchChromium,
}) {
  const access = readPageAccess(app, channel, env);
  if (!access) return markUnchecked(`no ${nameAccessSecrets(app, channel).pageUrl} secret`);
  const browser = await launchBrowser(env);
  try {
    /** @type {PageCheck} */
    let check = markBroken("the page wasn't opened");
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await waitFor(pauseMs);
      // A service worker would answer the next try from what the last one kept.
      const context = await browser.newContext({ serviceWorkers: "block" });
      check = await checkPage(await context.newPage(), { ...access, commit }).catch((error) =>
        markBroken(`the page didn't load: ${error instanceof Error ? error.message : error}`),
      );
      await context.close();
      if (check.status !== "broken") break;
    }
    return hideAddress(check, access.pageUrl);
  } finally {
    await browser.close();
  }
}
