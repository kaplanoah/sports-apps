// Opens an app's live page as a phone does, signed in with its access code, and says whether it
// drew what its store sent. CI runs the page against recorded data; this reaches what only the
// live Worker has, like its secrets, its store, and what the league says today.
import { waitFor } from "./check-timing.mjs";

const DRAW_TIMEOUT_MS = 30 * 1000;
const RELEASE_FOLDER = /\/release\/([^/]+)\//;

/**
 * @typedef {{ status: "drawn", isOpenWithoutCode?: boolean }
 *   | { status: "broken", reason: string }
 *   | { status: "unchecked", reason: string }} PageCheck
 */

/** @param {string} reason @returns {{ status: "broken", reason: string }} */
const markBroken = (reason) => ({ status: "broken", reason });
/** @param {string} reason @returns {{ status: "unchecked", reason: string }} */
const markUnchecked = (reason) => ({ status: "unchecked", reason });

/**
 * The secrets that open an app's page on a channel: its address, with its key, and the access
 * code every app on the channel asks for, which the channel's environment holds once.
 * @param {string} app
 * @param {string} channel
 */
export function nameAccessSecrets(app, channel) {
  const prefix = `${app.toUpperCase()}${channel === "beta" ? "_BETA" : ""}`;
  return { pageUrl: `${prefix}_PAGE_URL`, accessCode: "ACCESS_CODE" };
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

// A Worker that asks for no code answers its code's route 404, and its page opens as it is.
const NO_CODE_ASKED = 404;

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

/** @param {import("@playwright/test").Response | null} response @param {string} address */
function judgeSecurityHeaders(response, address) {
  if (!response?.ok()) return markBroken(`the page answered ${response?.status()}`);
  const headers = response.headers();
  const policy = headers["content-security-policy"] ?? "";
  if (!policy.includes("frame-ancestors 'none'") || !policy.includes("script-src 'self'"))
    return markBroken("the page is missing its enforced security policy");
  if (headers["x-frame-options"] !== "DENY")
    return markBroken("the page is missing its embedding protection");
  if (
    new URL(address).protocol === "https:" &&
    !/max-age=31536000(?:;|$)/.test(headers["strict-transport-security"] ?? "")
  )
    return markBroken("the page is missing its HTTPS protection");
  return null;
}

/** @param {import("@playwright/test").Page} page @param {string[]} addresses */
async function checkHttpRedirects(page, addresses) {
  const origins = new Set(addresses.map((address) => new URL(address).origin));
  for (const origin of origins) {
    const url = new URL("/robots.txt", origin);
    if (url.protocol !== "https:") continue;
    url.protocol = "http:";
    const response = await page.request.get(url.href, { maxRedirects: 0 });
    const location = response.headers()["location"];
    const target = location && new URL(location, url);
    if (
      ![301, 302, 307, 308].includes(response.status()) ||
      !target ||
      target.protocol !== "https:"
    )
      return markBroken("HTTP does not redirect to HTTPS");
  }
  return null;
}

/**
 * Signs the page in with its code and opens it again, or says why it couldn't.
 * @param {import("@playwright/test").Page} page
 * @param {string} pageUrl
 * @param {string} accessCode
 * @returns {Promise<{ problem?: PageCheck, isOpenWithoutCode?: boolean }>}
 */
async function signInWithCode(page, pageUrl, accessCode) {
  const status = await sendAccessCode(page, pageUrl, accessCode);
  if (status === NO_CODE_ASKED) return { isOpenWithoutCode: true };
  const problem = judgeSignIn(status);
  if (problem) return { problem };
  const response = await page.goto(pageUrl);
  const securityProblem = judgeSecurityHeaders(response, page.url());
  return securityProblem ? { problem: securityProblem } : {};
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
      (error) => {
        if (error.name === "TimeoutError") return false;
        throw error;
      },
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
  const securityProblem = judgeSecurityHeaders(response, page.url());
  if (securityProblem) return securityProblem;
  // An app moving to its own address sends a browser that isn't signed in there, so the check
  // signs in wherever a phone would land.
  const signIn = accessCode ? await signInWithCode(page, page.url(), accessCode) : {};
  if (signIn.problem) return signIn.problem;
  if (commit && !isFromRelease(await listScriptSources(page), commit))
    return markBroken("the page is still the version before");
  if (await waitForDrawing(page, timeoutMs))
    return signIn.isOpenWithoutCode
      ? { status: "drawn", isOpenWithoutCode: true }
      : { status: "drawn" };
  if (errors.length) return markBroken(`the page threw: ${errors[0]}`);
  const serverProblem = await readServerProblem(page);
  if (serverProblem) return markBroken(`the page says "${serverProblem}"`);
  return markBroken(`the page drew nothing within ${timeoutMs / 1000} seconds`);
}

/**
 * The text with each secret replaced by its mask, in order, so a secret goes before any it holds.
 * @param {string} text
 * @param {[string, string][]} masks each secret and its mask
 */
export const maskSecrets = (text, masks) =>
  masks.reduce((masked, [secret, mask]) => masked.replaceAll(secret, mask), text);

/**
 * An address's site masked, with or without its scheme.
 * @param {URL} address
 * @param {string} mask
 * @returns {[string, string][]}
 */
export const listSiteMasks = ({ origin, hostname }, mask) => [
  [origin, mask],
  [hostname, mask],
];

/**
 * The access code masked, when there is one.
 * @param {string} [accessCode]
 * @returns {[string, string][]}
 */
export const listAccessCodeMasks = (accessCode) =>
  accessCode ? [[accessCode, "<access code>"]] : [];

/**
 * A check's reason without the page's address, since logs and issues are public: not the whole
 * address, its Worker's with or without its scheme, its folder, or its key on its own, in
 * whatever form a browser's error names them, nor the page host the address sent it on to,
 * or the access code.
 * @template {PageCheck} Check
 * @param {Check} check
 * @param {string} pageUrl
 * @param {string} [landedUrl] where the page ended up
 * @param {string} [accessCode]
 * @returns {Check}
 */
export function hideAddress(check, pageUrl, landedUrl = pageUrl, accessCode) {
  if (check.status === "drawn") return check;
  const page = new URL(pageUrl);
  const key = page.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const landed = new URL(landedUrl);
  /** @type {[string, string][]} */
  const masks = [
    [pageUrl, "<page>/"],
    ...listSiteMasks(page, "<worker>"),
    ...(landed.hostname ? listSiteMasks(landed, "<page host>") : []),
    [page.pathname, "/<key>/"],
    ...(key ? /** @type {[string, string][]} */ ([[key, "<key>"]]) : []),
    ...listAccessCodeMasks(accessCode),
  ];
  const reason = maskSecrets(check.reason, masks);
  return { ...check, reason };
}

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
 * @param {() => Promise<void>} close
 * @param {PageCheck} check
 */
async function closeAfterPageCheck(close, check) {
  try {
    await close();
  } catch (error) {
    // A broken attempt's result stands whether or not its cleanup succeeds.
    if (check.status !== "broken") throw error;
  }
}

/** @param {NodeJS.ProcessEnv} env */
function hasEnvironmentProxy(env) {
  return Object.entries(env).some(
    ([name, value]) => /^(?:https?|all)_proxy$/i.test(name) && !!value,
  );
}

/**
 * @param {unknown} error
 * @param {boolean} isInfrastructureUnavailable
 * @param {NodeJS.ProcessEnv} env
 */
function judgePageFailure(error, isInfrastructureUnavailable, env) {
  const message = error instanceof Error ? error.message : String(error);
  const isVerificationFailure =
    /net::ERR_(?:PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|PROXY_CERTIFICATE_INVALID)/.test(
      message,
    ) ||
    (hasEnvironmentProxy(env) && /net::ERR_CERT_AUTHORITY_INVALID/.test(message));
  const isPageFailure =
    (error instanceof Error && error.name === "TimeoutError") ||
    /net::ERR_|Page crashed|Target crashed|Execution context was destroyed|Failed to fetch/.test(
      message,
    );
  return !isInfrastructureUnavailable && !isVerificationFailure && isPageFailure
    ? markBroken(`the page didn't load: ${message}`)
    : markUnchecked(`the page check failed: ${message}`);
}

/**
 * Opens an app's page, retrying page failures up to `attempts` times.
 * Missing access settings and refused or rate-limited codes return unchecked.
 * Unavailable page operations return unchecked; browser or context setup failures throw with
 * access details masked. Cleanup errors preserve a broken attempt's result; otherwise they throw.
 * @param {object} options
 * @param {string} options.app
 * @param {string} options.channel
 * @param {string} [options.commit]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {boolean} [options.isAccessCodeRequired]
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
  isAccessCodeRequired = false,
  attempts = 3,
  pauseMs = 5000,
  launchBrowser = launchChromium,
}) {
  const secrets = nameAccessSecrets(app, channel);
  const access = readPageAccess(app, channel, env);
  if (!access) return markUnchecked(`no ${secrets.pageUrl} secret`);
  if (isAccessCodeRequired && !access.accessCode)
    return markUnchecked(`no ${secrets.accessCode} secret`);
  let landedUrl = access.pageUrl;
  try {
    const browser = await launchBrowser(env);
    /** @type {PageCheck} */
    let check = markUnchecked("the page wasn't opened");
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) await waitFor(pauseMs);
        // A service worker would answer the next try from what the last one kept.
        const context = await browser.newContext({ serviceWorkers: "block" });
        let isContextClosed = false;
        context.on("close", () => {
          isContextClosed = true;
        });
        const page = await context.newPage();
        const opened = await checkPage(page, { ...access, commit })
          .then(async (result) => {
            if (result.status !== "drawn") return result;
            return (await checkHttpRedirects(page, [access.pageUrl, page.url()])) ?? result;
          })
          .catch((error) =>
            judgePageFailure(error, isContextClosed || !browser.isConnected(), env),
          );
        landedUrl = page.url();
        check = hideAddress(opened, access.pageUrl, landedUrl, access.accessCode);
        await closeAfterPageCheck(() => context.close(), check);
        if (check.status !== "broken") break;
      }
      return check;
    } finally {
      await closeAfterPageCheck(() => browser.close(), check);
    }
  } catch (error) {
    const failure = hideAddress(
      markUnchecked(error instanceof Error ? error.message : String(error)),
      access.pageUrl,
      landedUrl,
      access.accessCode,
    );
    // eslint-disable-next-line preserve-caught-error -- Causes may expose page access secrets in public logs.
    throw new Error(failure.reason);
  }
}
