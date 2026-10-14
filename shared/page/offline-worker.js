// The service worker keeps a copy of the page and every file it loads, so the page opens at once
// on a weak connection or none, and draws what it last showed. It opens the copy and reads the
// page again behind it, and a newer page replaces the copy only once all of its files are kept,
// so the copy always opens whole. A deploy then reaches the page on its next open, or when its
// release check reloads it. It also keeps the pictures from other sites, like the news' photos,
// that the page last showed, so they're back as soon as what it last showed is. Only the page,
// its files, and those pictures go through here; version.json, the store, and everything else
// always reach the Worker. What it keeps is only ever a shortcut: a copy the phone can't read
// leaves each request to the Worker, as if there were no copy, so a phone whose storage fails
// still opens the page whenever the Worker can answer. Each page it opens, and how, it notes for
// Diagnostics (service-worker-steps.js).

const PAGE_CACHE = "page";
const IMAGE_CACHE = "images";
const PAGE_FILE_PATH = /\.(?:js|css|woff2)$/;
const PAGE_FILE_TAG = /<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g;
const STYLESHEET_FILE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

const findPageAddress = () => self.registration.scope;

/** @param {URL} url */
function isPageAddress(url) {
  const page = new URL(findPageAddress());
  return (
    url.origin === page.origin &&
    (url.pathname === page.pathname || url.pathname === `${page.pathname}index.html`)
  );
}

/** @param {URL} url */
const isPageFile = (url) =>
  url.href.startsWith(findPageAddress()) && PAGE_FILE_PATH.test(url.pathname);

/**
 * Every file of the page's own that its markup loads.
 * @param {string} page
 */
function listPageFiles(page) {
  const addresses = [...page.matchAll(PAGE_FILE_TAG)].map(
    ([, address]) => new URL(address, findPageAddress()),
  );
  return [...new Set(addresses.filter(isPageFile).map((url) => url.href))];
}

/**
 * Every file of the page's own that a kept stylesheet loads, like a font.
 * @param {Cache} cache
 * @param {string[]} files
 */
async function listStylesheetFiles(cache, files) {
  const stylesheets = files.filter((file) => file.endsWith(".css"));
  const texts = await Promise.all(
    stylesheets.map(async (stylesheet) => (await cache.match(stylesheet))?.text() ?? ""),
  );
  const addresses = texts.flatMap((text, index) =>
    [...text.matchAll(STYLESHEET_FILE)].map(([, address]) => new URL(address, stylesheets[index])),
  );
  return addresses.filter(isPageFile).map((url) => url.href);
}

/**
 * Every file the copy of `page` opens with, once its stylesheets are kept.
 * @param {Cache} cache
 * @param {string} page
 */
async function listCopyFiles(cache, page) {
  const files = listPageFiles(page);
  return [...new Set([...files, ...(await listStylesheetFiles(cache, files))])];
}

/**
 * @param {Cache} cache
 * @param {string} file
 */
async function keepFile(cache, file) {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`${file} answered ${response.status}`);
  await cache.put(file, response);
}

// Each file that arrives stays, so the next try on a weak connection picks up where this one
// stopped.
/**
 * @param {Cache} cache
 * @param {string[]} files
 */
async function keepMissingFiles(cache, files) {
  const kept = await Promise.all(files.map((file) => cache.match(file)));
  const missing = files.filter((file, index) => !kept[index]);
  const results = await Promise.allSettled(missing.map((file) => keepFile(cache, file)));
  if (results.some(({ status }) => status === "rejected"))
    throw new Error("A file of the page didn't arrive.");
}

/**
 * @param {Cache} cache
 * @param {string[]} files
 */
async function forgetOtherFiles(cache, files) {
  const wanted = new Set([findPageAddress(), ...files]);
  const keys = await cache.keys();
  await Promise.all(keys.filter(({ url }) => !wanted.has(url)).map((key) => cache.delete(key)));
}

// Until all of the page's files have arrived, the copy stays as it was.
/** @param {Response} response */
async function keepPage(response) {
  const page = await response.text();
  const cache = await caches.open(PAGE_CACHE);
  await keepMissingFiles(cache, listPageFiles(page));
  const files = await listCopyFiles(cache, page);
  await keepMissingFiles(cache, files);
  const headers = { "content-type": response.headers.get("content-type") ?? "text/html" };
  await cache.put(findPageAddress(), new Response(page, { headers }));
  await forgetOtherFiles(cache, files);
}

const forgetPage = () => caches.delete(PAGE_CACHE);

/**
 * What a request names, for a step: the page, or a file by its name.
 * @param {string} url
 */
const nameRequest = (url) =>
  isPageAddress(new URL(url)) ? "the page" : (new URL(url).pathname.split("/").pop() ?? url);

/**
 * What a cache holds for the request, or nothing: when it holds nothing, or when it can't be read,
 * as when the phone's storage fails, which the Worker then answers in its place.
 * @param {string} url
 * @param {string} cacheName
 * @returns {Promise<Response | null>}
 */
async function matchKept(url, cacheName) {
  try {
    return (await caches.match(url, { cacheName })) ?? null;
  } catch (error) {
    noteWorkerStep(`Couldn't read ${nameRequest(url)} from the copy: ${describeFailure(error)}`);
    return null;
  }
}

// The Worker shows its access gate at the page's address, which it says never to store, to a
// phone that is signed out, and the copy would get past it.
/** @param {Response} response */
const isGate = (response) => /\bno-store\b/.test(response.headers.get("cache-control") ?? "");

// Whether the copy now opens what the Worker shows: the newer page, or the gate, with no copy.
/** @param {Response} response */
async function followPage(response) {
  if (isGate(response)) await forgetPage();
  else if (response.ok) await keepPage(response);
  return isGate(response) || response.ok;
}

/** @type {Promise<boolean> | null} */
let refreshing = null;

// One read at a time, shared by every open and every page waiting on it.
function refreshCopy() {
  refreshing ??= fetch(findPageAddress())
    .then(followPage)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * The page from the Worker, noting how it answered, or that it didn't.
 * @param {FetchEvent} event
 */
async function openPageFromWorker(event) {
  try {
    const response = await fetch(event.request);
    const status = response.ok ? "" : `, which answered ${response.status}`;
    event.waitUntil(noteWorkerStep(`Opened the page from the Worker${status}`));
    return response;
  } catch (error) {
    event.waitUntil(noteWorkerStep(`Couldn't open the page: ${describeFailure(error)}`));
    throw error;
  }
}

/** @param {FetchEvent} event */
async function openPage(event) {
  const copy = await matchKept(findPageAddress(), PAGE_CACHE);
  if (copy) {
    event.waitUntil(noteWorkerStep("Opened the page from the copy"));
    event.waitUntil(refreshCopy());
    return copy;
  }
  const response = await openPageFromWorker(event);
  event.waitUntil(followPage(response.clone()).catch(() => {}));
  return response;
}

/** @param {string} file */
async function isNamedByCopy(file) {
  const cache = await caches.open(PAGE_CACHE);
  const kept = await cache.match(findPageAddress());
  return !!kept && (await listCopyFiles(cache, await kept.text())).includes(file);
}

// A file the Worker no longer has belongs to a release it has replaced, so a copy that needs it
// can't open whole, and the page's reload then reaches the Worker. A copy that can't be read
// stays until it can, since the Worker answers in its place meanwhile.
/** @param {string} file */
async function forgetCopyNaming(file) {
  try {
    if (await isNamedByCopy(file)) await forgetPage();
  } catch (error) {
    noteWorkerStep(`Couldn't check the copy for ${nameRequest(file)}: ${describeFailure(error)}`);
  }
}

/** @param {Request} request */
async function readPageFile(request) {
  const kept = await matchKept(request.url, PAGE_CACHE);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.status === 404) await forgetCopyNaming(request.url);
  return response;
}

/**
 * @param {Request} request
 * @param {URL} url
 */
const isOtherSiteImage = (request, url) =>
  request.destination === "image" && url.origin !== new URL(findPageAddress()).origin;

/** @param {Request} request */
async function readImage(request) {
  return (await matchKept(request.url, IMAGE_CACHE)) ?? fetch(request);
}

/**
 * @param {Cache} cache
 * @param {string} url
 */
async function keepImage(cache, url) {
  if (await cache.match(url)) return;
  // Another site's picture answers opaquely, so its status can't be read; the page lists only the
  // ones it has shown.
  const response = await fetch(url, {
    mode: "no-cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  await cache.put(url, response);
}

/** @param {string[]} urls */
async function keepImages(urls) {
  const cache = await caches.open(IMAGE_CACHE);
  await Promise.allSettled(urls.map((url) => keepImage(cache, url)));
  const wanted = new Set(urls);
  const keys = await cache.keys();
  await Promise.all(keys.filter(({ url }) => !wanted.has(url)).map((key) => cache.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && isPageAddress(url)) event.respondWith(openPage(event));
  else if (isPageFile(url)) event.respondWith(readPageFile(request));
  else if (isOtherSiteImage(request, url)) event.respondWith(readImage(request));
});

// A phone gets its first copy as soon as the worker starts, not on the page's next open. The
// activation doesn't wait for it, since the page's requests would wait with it.
self.addEventListener("activate", () => {
  refreshCopy();
});

// A page a deploy replaced reloads only once the copy holds the newer page, or the reload would
// open the copy it already runs.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "refreshPageCopy") return;
  event.waitUntil(refreshCopy().then((isCurrent) => event.ports[0]?.postMessage(isCurrent)));
});

// A page leaving the screen names the pictures it shows, and only those stay.
self.addEventListener("message", (event) => {
  const { type, urls } = event.data ?? {};
  if (type !== "keepImages" || !Array.isArray(urls)) return;
  event.waitUntil(keepImages(urls.filter((url) => typeof url === "string")));
});
