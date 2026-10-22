// The Worker's routing: the page, its store, and its sheets' reads, only under the page's key, or
// without it at the address PAGE_HOST names, behind the access code (access-gate.js), and
// robots.txt and health with neither (health.js). An app can move its page from under the key to the
// PAGE_HOST address. Each release's files are served from a folder named for its commit, which
// browsers keep for good. A preview of beta's Worker serves its own page files and asks beta, by
// its BETA binding, for everything else (preview-entrypoint.js).

import {
  ACCESS_PATH,
  buildPageHostAddress,
  createAccessCookie,
  HANDOFF_PATH,
  MOVE_PATH,
  readAccess,
  respondAccessRequired,
  serveAccess,
  serveHandoff,
  serveMoveHandoff,
} from "./access-gate.js";
import { createHealthServer } from "./health.js";

const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
// No other release uses a release folder's addresses, so a browser keeps its files for good.
const RELEASE_FILE_HEADERS = {
  ...PAGE_HEADERS,
  "cache-control": "public, max-age=31536000, immutable",
};

/**
 * The folder the page reads a release's code and styles from. A server still on another release
 * has none of its files, so a page never runs two releases' files together.
 * @param {string} commit
 */
export const nameReleaseFolder = (commit) => `release/${commit}/`;

const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
const textEncoder = new TextEncoder();

/** @param {Record<string, { contentType: string, text?: string, base64?: string }>} pageFiles */
function decodePageFiles(pageFiles) {
  const files = new Map();
  for (const [path, { contentType, text, base64 }] of Object.entries(pageFiles)) {
    files.set(path, { contentType, body: text ?? decodeBase64(base64), etag: null });
  }
  return files;
}

/** @param {string | Uint8Array<ArrayBuffer>} body */
async function hashBody(body) {
  const bytes = typeof body === "string" ? textEncoder.encode(body) : body;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0"));
  return `"${hex.join("")}"`;
}

// Cloudflare weakens a file's tag when it compresses the file, so a weak copy still matches.
const hasMatchingTag = (request, etag) =>
  (request.headers.get("if-none-match") ?? "")
    .split(",")
    .some((tag) => tag.trim().replace(/^W\//, "") === etag);

const respondText = (body, status, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

const serveNotFound = () => respondText("Not found\n", 404, PAGE_HEADERS);

// A Worker serves only its own release's folder, so a page still running an earlier release finds
// that folder gone. Its version.json still names the release it asks about, so the page learns
// it has been replaced and reloads. Only a page from before the build wrote the release into the
// page asks here, so this answer's null builtAt stays out of the page's Release type.
const REPLACED_RELEASE_PATH = /^release\/([^/]+)\/version\.json$/;

/** @param {string} commit */
const serveReplacedRelease = (commit) =>
  new Response(JSON.stringify({ version: null, commit, builtAt: null, label: null }), {
    headers: { "content-type": "application/json", ...PAGE_HEADERS, "cache-control": "no-store" },
  });

// Relative links in the page need the address to end in a slash.
const redirectToFolder = (url) =>
  new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });

/**
 * The file a page path names, and how long a browser may keep it.
 * @param {string} pagePath
 * @param {string | null} releaseFolder
 */
function findPageFile(pagePath, releaseFolder) {
  const path = pagePath === "/" ? "index.html" : pagePath.slice(1);
  if (releaseFolder && path.startsWith(releaseFolder))
    return { path: path.slice(releaseFolder.length), headers: RELEASE_FILE_HEADERS };
  return { path, headers: PAGE_HEADERS };
}

const MANIFEST_PATH = "manifest.webmanifest";

// An iPhone, an iPad, which names itself a Mac, or a Mac's Safari.
/** @param {Request} request */
function isFromSafari(request) {
  const agent = request.headers.get("user-agent") ?? "";
  const isMacSafari =
    /Macintosh/.test(agent) && /Safari\//.test(agent) && !/Chrome|Edg\//.test(agent);
  return /iPhone|iPad/.test(agent) || isMacSafari;
}

// Safari reads a manifest once, as the page loads, and opens a Home Screen app at its start_url,
// or, without one, at the page's address as it stands when it's added, which names the theme
// picked before then (pick-theme.js). Chrome offers its own install only with a start_url.
/** @param {string} manifest */
function dropStartUrl(manifest) {
  const parsed = JSON.parse(manifest);
  delete parsed.start_url;
  return JSON.stringify(parsed);
}

/**
 * @param {{ path: string, body: string }} file
 * @param {Request} request
 */
const writeBody = ({ path, body }, request) =>
  path === MANIFEST_PATH && isFromSafari(request) ? dropStartUrl(body) : body;

/**
 * @param {Parameters<typeof decodePageFiles>[0]} pageFiles
 * @param {string | null} releaseFolder
 */
function createPageServer(pageFiles, releaseFolder) {
  const files = decodePageFiles(pageFiles);
  // Every load asks again for a file outside the release's folder, and a browser that already has
  // it gets a 304 instead of the file.
  return async function servePageFile(request, pagePath) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
    const { path, headers: cacheHeaders } = findPageFile(pagePath, releaseFolder);
    const replaced = REPLACED_RELEASE_PATH.exec(path);
    if (replaced) return serveReplacedRelease(replaced[1]);
    const file = files.get(path);
    if (!file) return serveNotFound();
    const body = writeBody({ path, body: file.body }, request);
    file.etag ??= hashBody(file.body);
    const etag = body === file.body ? await file.etag : await hashBody(body);
    const headers = {
      "content-type": file.contentType,
      etag,
      ...cacheHeaders,
      ...(path === MANIFEST_PATH ? { vary: "user-agent" } : {}),
    };
    if (hasMatchingTag(request, etag)) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { headers });
  };
}

// robots.txt answers without the key, so it names the commit the Worker was built from, for the
// deploy to tell its new version from the one before.
const RELEASE_COMMIT_HEADER = "x-release-commit";

/** @param {Parameters<typeof decodePageFiles>[0]} pageFiles */
export function readReleaseCommit(pageFiles) {
  const release = pageFiles["version.json"]?.text;
  return release ? JSON.parse(release).commit : null;
}

/** @param {string | null} commit */
const serveRobots = (commit) =>
  respondText(
    "User-agent: *\nDisallow: /\n",
    200,
    commit ? { [RELEASE_COMMIT_HEADER]: commit } : {},
  );

// The access code alone guards the page at the PAGE_HOST address, so it answers there only while
// the Worker has one.
/** @param {any} env */
const isPageHostOpen = (env) => !!env.PAGE_HOST && !!env.ACCESS_CODE;

// The page and its store answer under the APP_KEY secret, and at the PAGE_HOST address without it.
// Only robots.txt and health answer anywhere.
/**
 * @param {URL} url
 * @param {any} env
 * @returns {string | null} what the page's paths start with, or null where nothing answers
 */
function findAppPrefix(url, env) {
  if (env.PAGE_HOST && url.hostname === env.PAGE_HOST) return isPageHostOpen(env) ? "" : null;
  return env.APP_KEY ? `/${env.APP_KEY}` : null;
}

/**
 * @param {string} pathname
 * @param {string} prefix
 */
function findAppPath(pathname, prefix) {
  if (pathname === prefix) return "";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
}

/**
 * @param {URL} url
 * @param {any} env
 * @returns {{ prefix: string, appPath: string } | null} null where nothing answers
 */
function findAppRoute(url, env) {
  const prefix = findAppPrefix(url, env);
  const appPath = prefix === null ? null : findAppPath(url.pathname, prefix);
  return appPath === null ? null : { prefix: String(prefix), appPath };
}

/**
 * @param {string} prefix
 * @param {any} env
 */
const canMoveToPageHost = (prefix, env) => prefix !== "" && isPageHostOpen(env);

// A browser keeps a 301 for good unless told not to, and a phone that later signs in under the key
// has to reach the page there.
/**
 * @param {URL} url
 * @param {string} appPath
 * @param {any} env
 */
function redirectToPageHost(url, appPath, env) {
  const address = buildPageHostAddress(appPath, env);
  address.search = url.search;
  return new Response(null, {
    status: 301,
    headers: { location: address.href, "cache-control": "no-store" },
  });
}

const isStorePath = (appPath) =>
  appPath === "/watch" || appPath.startsWith("/store/") || appPath.startsWith("/push/");

const GATE_PATH = "/gate.html";
const ACCESS_ROUTES = new Set(["", ACCESS_PATH, HANDOFF_PATH, MOVE_PATH]);

/**
 * How a preview's page file stands with beta: the path after beta's key, whether the phone may
 * see the page, and, when it may and the file is the page's index, the cookie renewing its sign-in.
 * @typedef {{ appPath: string, access: "open" | "missing" | "changed", cookie: string | null }} PageRoute
 */

/**
 * An app's Worker: its page, its store, and any reads of its own, all under the APP_KEY secret or
 * at the PAGE_HOST address, and behind the ACCESS_CODE secret when the Worker has one.
 * @param {object} app
 * @param {Parameters<typeof decodePageFiles>[0]} app.pageFiles
 * @param {(request: Request, env: any, storePath: string) => Response | Promise<Response>} app.forwardToStore
 * @param {(env: any) => Promise<boolean>} app.isStoreAnswering
 * @param {Record<string, (url: URL, env: any) => Response | Promise<Response>>} [app.reads] more GET
 *   paths, each handed the Worker's bindings, so it can read the store
 * @param {boolean} [app.isMovingToPageHost] whether the page under the key sends its phones to the
 *   PAGE_HOST address: one signed in with a handoff from MOVE_PATH, and one that isn't with a 301
 */
export function createAppWorker({
  pageFiles,
  forwardToStore,
  isStoreAnswering,
  reads = {},
  isMovingToPageHost = false,
}) {
  const releaseCommit = readReleaseCommit(pageFiles);
  const releaseFolder = releaseCommit && nameReleaseFolder(releaseCommit);
  const servePageFile = createPageServer(pageFiles, releaseFolder);
  // Decided by the file a path names, since the release's folder names the page too.
  const isIndexPath = (appPath) => findPageFile(appPath, releaseFolder).path === "index.html";
  const serveHealth = createHealthServer({ isStoreAnswering, release: releaseCommit });
  const isDataPath = (appPath) => isStorePath(appPath) || Object.hasOwn(reads, appPath);
  const isMoving = (prefix, env) => isMovingToPageHost && canMoveToPageHost(prefix, env);

  // Until the phone sends the access code, the page's address shows the gate instead. The page's
  // other files are the repo's own, and public. Each visit to a page with a code renews its cookie,
  // so a phone in use never has to type it again.
  /**
   * @param {Request} request
   * @param {string} appPath
   * @param {PageRoute["access"]} access
   * @param {() => Promise<string | null> | string | null} readRenewal
   */
  async function servePageBehindGate(request, appPath, access, readRenewal) {
    if (!isIndexPath(appPath)) return servePageFile(request, appPath);
    if (access !== "open") {
      const gate = await servePageFile(request, GATE_PATH);
      gate.headers.set("cache-control", "no-store");
      return gate;
    }
    const page = await servePageFile(request, appPath);
    const renewal = await readRenewal();
    if (renewal) page.headers.append("set-cookie", renewal);
    return page;
  }

  // Nothing from the season answers until the phone sends the access code.
  /**
   * @param {Request} request
   * @param {any} env
   * @param {{ url: URL, appPath: string, access: PageRoute["access"] }} route
   */
  function serveData(request, env, { url, appPath, access }) {
    if (access !== "open") return respondAccessRequired();
    if (isStorePath(appPath)) return forwardToStore(request, env, appPath);
    if (request.method === "GET") return reads[appPath](url, env);
    return servePageFile(request, appPath);
  }

  /**
   * @param {Request} request
   * @param {any} env
   * @param {URL} url
   * @param {{ prefix: string, appPath: string }} route
   */
  function serveAccessRoute(request, env, url, { prefix, appPath }) {
    if (appPath === "") return redirectToFolder(url);
    if (appPath === ACCESS_PATH) return serveAccess(request, env, prefix);
    if (appPath === HANDOFF_PATH) return serveHandoff(request, env, prefix);
    if (isMoving(prefix, env)) return serveMoveHandoff(request, env);
    return servePageFile(request, appPath);
  }

  /**
   * @param {Request} request
   * @param {any} env
   * @param {URL} url
   */
  async function serveApp(request, env, url) {
    const route = findAppRoute(url, env);
    if (route === null) return serveNotFound();
    if (ACCESS_ROUTES.has(route.appPath)) return serveAccessRoute(request, env, url, route);
    const { prefix, appPath } = route;
    const access = await readAccess(request, env);
    if (isDataPath(appPath)) return serveData(request, env, { url, appPath, access });
    // A phone that never sent the code, under a key that's moving, opens the same page at
    // PAGE_HOST, whose gate asks there.
    if (access === "missing" && isIndexPath(appPath) && isMoving(prefix, env))
      return redirectToPageHost(url, appPath, env);
    return servePageBehindGate(request, appPath, access, () =>
      env.ACCESS_CODE ? createAccessCookie(request, env, prefix) : null,
    );
  }

  /**
   * What beta's Worker tells a preview of an address the preview may serve from its own page
   * files, or null for one beta answers itself.
   * @param {string} address
   * @param {string | null} cookie
   * @param {any} env
   * @returns {Promise<PageRoute | null>}
   */
  async function readPageRoute(address, cookie, env) {
    const url = new URL(address);
    const route = findAppRoute(url, env);
    if (route === null || ACCESS_ROUTES.has(route.appPath) || isDataPath(route.appPath))
      return null;
    const request = new Request(url, { headers: cookie === null ? {} : { cookie } });
    const access = await readAccess(request, env);
    const renewal =
      access === "open" && env.ACCESS_CODE && isIndexPath(route.appPath)
        ? await createAccessCookie(request, env, route.prefix)
        : null;
    return { appPath: route.appPath, access, cookie: renewal };
  }

  // A preview has no secret or store of its own: beta's Worker, with its key, code, and store,
  // says how each page file stands and answers everything else.
  /**
   * @param {Request} request
   * @param {any} beta
   */
  async function servePreview(request, beta) {
    /** @type {PageRoute | null} */
    const route = await beta.readPageRoute(request.url, request.headers.get("cookie"));
    if (route === null) return beta.fetch(request);
    return servePageBehindGate(request, route.appPath, route.access, () => route.cookie);
  }

  return {
    /**
     * @param {Request} request
     * @param {any} [env]
     */
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return serveRobots(releaseCommit);
      if (env.BETA) return servePreview(request, env.BETA);
      if (url.pathname === "/health") return serveHealth(env);
      return serveApp(request, env, url);
    },
    readPageRoute,
  };
}
