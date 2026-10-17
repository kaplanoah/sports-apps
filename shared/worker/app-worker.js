import {
  ACCESS_PATH,
  createAccessCookie,
  readAccess,
  respondAccessRequired,
  serveAccess,
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
// it has been replaced and reloads, whatever release its own code is from.
const REPLACED_RELEASE_PATH = /^release\/([^/]+)\/version\.json$/;

/** @param {string} commit */
const serveReplacedRelease = (commit) =>
  new Response(JSON.stringify({ version: null, commit, builtAt: null }), {
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
 * @param {string | null} releaseCommit
 */
function createPageServer(pageFiles, releaseCommit) {
  const files = decodePageFiles(pageFiles);
  const releaseFolder = releaseCommit && nameReleaseFolder(releaseCommit);
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

// The page and its store answer under the APP_KEY secret, and at the address the PAGE_HOST secret
// names without it, where the access code alone guards them, so only while the Worker has one.
// Only robots.txt and health answer anywhere.
/**
 * @param {URL} url
 * @param {any} env
 * @returns {string | null} what the page's paths start with, or null where nothing answers
 */
function findAppPrefix(url, env) {
  if (env.PAGE_HOST && url.hostname === env.PAGE_HOST) return env.ACCESS_CODE ? "" : null;
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

const isStorePath = (appPath) =>
  appPath === "/watch" || appPath.startsWith("/store/") || appPath.startsWith("/push/");

const isIndexPath = (appPath) => appPath === "/" || appPath === "/index.html";

const GATE_PATH = "/gate.html";

/**
 * An app's Worker: its page, its store, its live snapshot, and any reads of its own, all under the
 * APP_KEY secret or at the PAGE_HOST address, and behind the ACCESS_CODE secret when the Worker
 * has one.
 * @param {object} app
 * @param {Parameters<typeof decodePageFiles>[0]} app.pageFiles
 * @param {(url: URL) => Response | Promise<Response>} app.serveSnapshot
 * @param {(request: Request, env: any, storePath: string) => Response | Promise<Response>} app.forwardToStore
 * @param {(env: any) => Promise<boolean>} app.isStoreAnswering
 * @param {Record<string, (url: URL, env: any) => Response | Promise<Response>>} [app.reads] more GET
 *   paths, each handed the Worker's bindings, so it can read the store
 */
export function createAppWorker({
  pageFiles,
  serveSnapshot,
  forwardToStore,
  isStoreAnswering,
  reads = {},
}) {
  const releaseCommit = readReleaseCommit(pageFiles);
  const servePageFile = createPageServer(pageFiles, releaseCommit);
  const serveHealth = createHealthServer({ isStoreAnswering, release: releaseCommit });
  const isDataPath = (appPath) =>
    isStorePath(appPath) || appPath === "/snapshot" || Object.hasOwn(reads, appPath);

  // Until the phone sends the access code, the page's address shows the gate instead, and
  // nothing from the season answers. The page's other files are the repo's own, and public.
  async function serveLocked(request, appPath) {
    if (isDataPath(appPath)) return respondAccessRequired();
    if (!isIndexPath(appPath)) return servePageFile(request, appPath);
    const gate = await servePageFile(request, GATE_PATH);
    gate.headers.set("cache-control", "no-store");
    return gate;
  }

  // Each visit to a page with a code renews its cookie, so a phone in use never has to type it again.
  async function servePage(request, env, appPath, prefix) {
    const page = await servePageFile(request, appPath);
    if (env.ACCESS_CODE)
      page.headers.append("set-cookie", await createAccessCookie(request, env, prefix));
    return page;
  }

  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return serveRobots(releaseCommit);
      if (url.pathname === "/health") return serveHealth(env);
      const prefix = findAppPrefix(url, env);
      const appPath = prefix === null ? null : findAppPath(url.pathname, prefix);
      if (appPath === null) return serveNotFound();
      if (appPath === "") return redirectToFolder(url);
      if (appPath === ACCESS_PATH) return serveAccess(request, env, prefix);
      if ((await readAccess(request, env)) !== "open") return serveLocked(request, appPath);
      if (isStorePath(appPath)) return forwardToStore(request, env, appPath);
      if (request.method === "GET" && appPath === "/snapshot") return serveSnapshot(url);
      if (request.method === "GET" && Object.hasOwn(reads, appPath))
        return reads[appPath](url, env);
      if (isIndexPath(appPath)) return servePage(request, env, appPath, prefix);
      return servePageFile(request, appPath);
    },
  };
}
