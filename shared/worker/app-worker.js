// The Worker's routing: the page, its store, and its sheets' reads, only under the page's key, or
// without it at the address PAGE_HOST names, behind the access code (access-gate.js), and
// robots.txt and health with neither (health.js). With PAGE_HOST and ACCESS_CODE configured, the
// Worker moves the keyed page to PAGE_HOST. Each release's files have a folder named for its
// commit. Browsers keep its code and styles for good, but always revalidate index.html.

import {
  TRANSPORT_SECURITY,
  SECURITY_HEADERS,
  REQUIRED_CSP_DIRECTIVES,
} from "../page/security-headers.js";
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
import { CONTACT_ROUTE } from "../page/contact-rules.js";
import { serveContact } from "./contact-request.js";
import { COUNT_PATH, serveCount } from "./daily-count.js";
import { createHealthServer } from "./health.js";

const WATCH_PATH = "/watch";
const CONTACT_PATH = `/${CONTACT_ROUTE}`;

const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
};
/** @param {string[]} hashes @param {Request} request */
function createContentSecurityPolicy(hashes, request) {
  const socket = new URL(request.url);
  socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
  return [
    "default-src 'self'",
    `${REQUIRED_CSP_DIRECTIVES.scripts} ${hashes.map((hash) => `'sha256-${hash}'`).join(" ")}`.trim(),
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https:",
    `connect-src 'self' ${socket.origin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    REQUIRED_CSP_DIRECTIVES.frames,
  ].join("; ");
}

/** @param {Request} request @param {URL} url @param {string} appPath */
function isUntrustedRequest(request, url, appPath) {
  const needsOrigin = !["GET", "HEAD"].includes(request.method) || appPath === WATCH_PATH;
  return needsOrigin && request.headers.get("origin") !== url.origin;
}

/** @param {URL} url */
function redirectToHttps(url) {
  if (url.protocol !== "http:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return null;
  url.protocol = "https:";
  return new Response(null, { status: 308, headers: { location: url.href } });
}

/** @param {Response} response @param {Request} request */
function addSecurityHeaders(response, request) {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if (new URL(request.url).protocol === "https:")
    secured.headers.set("strict-transport-security", TRANSPORT_SECURITY);
  return secured;
}

// No other release uses these addresses, so a browser keeps release files except index.html for good.
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

/** @param {Record<string, { contentType: string, text?: string, base64?: string, scriptHashes?: string[] }>} pageFiles */
function decodePageFiles(pageFiles) {
  const files = new Map();
  for (const [path, { contentType, text, base64, scriptHashes }] of Object.entries(pageFiles)) {
    files.set(path, { contentType, body: text ?? decodeBase64(base64), etag: null, scriptHashes });
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
 * @param {boolean} isMoving
 */
function writeBody({ path, body }, request, isMoving) {
  if (path === MANIFEST_PATH && isFromSafari(request)) return dropStartUrl(body);
  // The pages omit optional head tags, so the marker precedes their first script.
  if (path === "index.html" && isMoving)
    return body.replace("<script", '<meta name="moving-to-page-host" content="true">\n<script');
  return body;
}

/**
 * @param {Parameters<typeof decodePageFiles>[0]} pageFiles
 * @param {string | null} releaseFolder
 */
function createPageServer(pageFiles, releaseFolder) {
  const files = decodePageFiles(pageFiles);
  // Every load revalidates index.html and files outside the release's folder. An unchanged
  // rendered body gets a 304 instead of the file.
  return async function servePageFile(request, pagePath, isMoving = false) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
    const { path, headers: cacheHeaders } = findPageFile(pagePath, releaseFolder);
    const replaced = REPLACED_RELEASE_PATH.exec(path);
    if (replaced) return serveReplacedRelease(replaced[1]);
    const file = files.get(path);
    if (!file) return serveNotFound();
    const body = writeBody({ path, body: file.body }, request, isMoving);
    file.etag ??= hashBody(file.body);
    const etag = body === file.body ? await file.etag : await hashBody(body);
    const headers = {
      "content-type": file.contentType,
      ...(file.contentType.startsWith("text/html")
        ? {
            "content-security-policy": createContentSecurityPolicy(
              file.scriptHashes ?? [],
              request,
            ),
          }
        : {}),
      etag,
      ...(path === "index.html" ? PAGE_HEADERS : cacheHeaders),
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
  appPath === WATCH_PATH || appPath.startsWith("/store/") || appPath.startsWith("/push/");

const GATE_PATH = "/gate.html";

/**
 * An app's Worker: its page, its store, and any reads of its own, all under the APP_KEY secret or
 * at the PAGE_HOST address, and behind the ACCESS_CODE secret when the Worker has one.
 * @param {object} app
 * @param {string} app.name the app's name, which its daily counts and Contact reports carry; the app
 *   supplies it, never a visitor
 * @param {Parameters<typeof decodePageFiles>[0]} app.pageFiles
 * @param {(request: Request, env: any, storePath: string) => Response | Promise<Response>} app.forwardToStore
 * @param {(env: any) => Promise<Record<string, import("./feed-failures.js").FeedFailure>>} app.readFeedFailures
 * @param {Record<string, (url: URL, env: any) => Response | Promise<Response>>} [app.reads] more GET
 *   paths, each handed the Worker's bindings, so it can read the store
 */
export function createAppWorker({ name, pageFiles, forwardToStore, readFeedFailures, reads = {} }) {
  const releaseCommit = readReleaseCommit(pageFiles);
  const releaseFolder = releaseCommit && nameReleaseFolder(releaseCommit);
  const servePageFile = createPageServer(pageFiles, releaseFolder);
  // Decided by the file a path names, since the release's folder names the page too.
  const isIndexPath = (appPath) => findPageFile(appPath, releaseFolder).path === "index.html";
  const serveHealth = createHealthServer({ readFeedFailures, release: releaseCommit });
  const isDataPath = (appPath) =>
    appPath === CONTACT_PATH ||
    isStorePath(appPath) ||
    appPath === COUNT_PATH ||
    Object.hasOwn(reads, appPath);

  // Until the phone sends the access code, the page's address shows the gate instead, or, for a
  // phone that never sent one under a key that's moving, the same page at PAGE_HOST, whose gate
  // asks there. Nothing from the season answers. The page's other files are the repo's own, and
  // public.
  async function serveLocked(request, env, { url, appPath, prefix, access }) {
    if (isDataPath(appPath)) return respondAccessRequired();
    if (!isIndexPath(appPath)) return servePageFile(request, appPath);
    if (access === "missing" && canMoveToPageHost(prefix, env))
      return redirectToPageHost(url, appPath, env);
    const gate = await servePageFile(request, GATE_PATH);
    gate.headers.set("cache-control", "no-store");
    return gate;
  }

  // Each visit to a page with a code renews its cookie, so a phone in use never has to type it again.
  async function servePage(request, env, appPath, prefix) {
    const page = await servePageFile(request, appPath, canMoveToPageHost(prefix, env));
    if (env.ACCESS_CODE)
      page.headers.append("set-cookie", await createAccessCookie(request, env, prefix));
    return page;
  }

  const worker = {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const redirect = redirectToHttps(url);
      if (redirect) return redirect;
      if (url.pathname === "/robots.txt") return serveRobots(releaseCommit);
      if (url.pathname === "/health") return serveHealth(env);
      const prefix = findAppPrefix(url, env);
      const appPath = prefix === null ? null : findAppPath(url.pathname, prefix);
      if (appPath === null) return serveNotFound();
      if (isUntrustedRequest(request, url, appPath)) return respondText("Forbidden.\n", 403);
      if (appPath === "") return redirectToFolder(url);
      if (appPath === ACCESS_PATH) return serveAccess(request, env, prefix);
      if (appPath === HANDOFF_PATH) return serveHandoff(request, env, prefix);
      if (appPath === MOVE_PATH && canMoveToPageHost(prefix, env))
        return serveMoveHandoff(request, env);
      const access = await readAccess(request, env);
      if (access !== "open") return serveLocked(request, env, { url, appPath, prefix, access });
      if (appPath === CONTACT_PATH) return serveContact(request, env, name);
      if (isStorePath(appPath)) return forwardToStore(request, env, appPath);
      if (appPath === COUNT_PATH) return serveCount(request, env, name);
      if (request.method === "GET" && Object.hasOwn(reads, appPath))
        return reads[appPath](url, env);
      if (isIndexPath(appPath)) return servePage(request, env, appPath, prefix);
      return servePageFile(request, appPath);
    },
  };
  return {
    async fetch(request, env = {}) {
      return addSecurityHeaders(await worker.fetch(request, env), request);
    },
  };
}
