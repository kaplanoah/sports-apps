import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker/src/index.js";

const ENV = { APP_KEY: "k3y" };
const ORIGIN = "https://mlb-app.example";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** @param {string} path @param {{ env?: { APP_KEY?: string }, method?: string }} [options] */
const requestPage = (path, { env = ENV, method = "GET" } = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { method }), env);

test("the page is a whole document with what an iPhone needs to save it as an app", async () => {
  const response = await requestPage("/k3y/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  const page = await response.text();
  assert.ok(page.startsWith("<!doctype html>\n"));
  for (const tag of [
    'content="width=device-width, initial-scale=1, viewport-fit=cover"',
    '<link rel="manifest" href="manifest.webmanifest" />',
    '<link rel="apple-touch-icon" href="icon-180.png" />',
    '<meta name="apple-mobile-web-app-title" content="MLB" />',
  ])
    assert.ok(page.includes(tag), tag);
  assert.ok(page.includes('<script type="module" src="js/app.js"></script>'));
});

test("the page asks nothing of other sites before it draws, and serves its own font", async () => {
  const page = await (await requestPage("/k3y/")).text();
  assert.doesNotMatch(page, /https:\/\//);
  const font = await requestPage("/k3y/fonts/chivo-mono-latin.woff2");
  assert.equal(font.headers.get("content-type"), "font/woff2");
});

test("the page links the shared chrome, then Diagnostics, before its own styles, so its own rules win ties", async () => {
  const page = await (await requestPage("/k3y/")).text();
  const chromeAt = page.indexOf('<link rel="stylesheet" href="shared/chrome.css" />');
  const diagnosticsAt = page.indexOf('<link rel="stylesheet" href="shared/diagnostics.css" />');
  const stylesAt = page.indexOf('<link rel="stylesheet" href="styles.css" />');
  assert.ok(chromeAt !== -1 && diagnosticsAt !== -1 && stylesAt !== -1);
  assert.ok(chromeAt < diagnosticsAt && diagnosticsAt < stylesAt);
});

test("every response keeps the address out of search engines and referrers", async () => {
  for (const path of ["/k3y/", "/k3y/js/app.js", "/k3y/missing.js"]) {
    const response = await requestPage(path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
  }
  const robots = await requestPage("/robots.txt", { env: {} });
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
});

test("the page's files are served with their types, and the icon as PNG bytes", async () => {
  const script = await requestPage("/k3y/js/app.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(
    await script.text(),
    readFileSync(`${import.meta.dirname}/../page/js/app.js`, "utf8"),
  );

  const shared = await requestPage("/k3y/shared/worker-store.js");
  assert.equal(shared.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(
    await shared.text(),
    readFileSync(`${import.meta.dirname}/../../../shared/page/worker-store.js`, "utf8"),
  );

  const chrome = await requestPage("/k3y/shared/chrome.css");
  assert.equal(chrome.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(
    await chrome.text(),
    readFileSync(`${import.meta.dirname}/../../../shared/page/chrome.css`, "utf8"),
  );

  const diagnostics = await requestPage("/k3y/shared/diagnostics.css");
  assert.equal(diagnostics.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(
    await diagnostics.text(),
    readFileSync(`${import.meta.dirname}/../../../shared/page/diagnostics.css`, "utf8"),
  );

  const icon = await requestPage("/k3y/icon-180.png");
  assert.equal(icon.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await icon.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], PNG_SIGNATURE);
  assert.equal(bytes.length, readFileSync(`${import.meta.dirname}/../page/icon-180.png`).length);

  const manifest = await (await requestPage("/k3y/manifest.webmanifest")).json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.short_name, "MLB");
  for (const { src } of manifest.icons)
    assert.equal((await requestPage(`/k3y/${src}`)).status, 200, src);
});

test("a browser that already has a file gets a 304 instead of the file again", async () => {
  const first = await requestPage("/k3y/js/app.js");
  const etag = first.headers.get("etag");
  assert.match(etag ?? "", /^"[0-9a-f]{32}"$/);
  assert.equal(first.headers.get("cache-control"), "no-cache");

  for (const sent of [etag, `W/${etag}`, `"other", ${etag}`]) {
    const again = await worker.fetch(
      new Request(`${ORIGIN}/k3y/js/app.js`, { headers: { "if-none-match": sent } }),
      ENV,
    );
    assert.equal(again.status, 304, sent);
    assert.equal(await again.text(), "", sent);
  }

  const changed = await worker.fetch(
    new Request(`${ORIGIN}/k3y/js/app.js`, { headers: { "if-none-match": '"other"' } }),
    ENV,
  );
  assert.equal(changed.status, 200);
  const icon = await requestPage("/k3y/icon-180.png");
  assert.notEqual(icon.headers.get("etag"), etag);
});

test("the key without a slash redirects, so the page's relative links work", async () => {
  const response = await requestPage("/k3y?from=home");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "/k3y/?from=home");
});

test("without the key, or without an APP_KEY, there is no page", async () => {
  assert.equal((await requestPage("/other/")).status, 404);
  assert.equal((await requestPage("/k3y/", { env: {} })).status, 404);
  assert.equal((await requestPage("/k3y/nope.html")).status, 404);
  assert.equal((await requestPage("/k3y/", { method: "POST" })).status, 405);
  const head = await requestPage("/k3y/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("nothing but robots.txt answers outside the key", async () => {
  for (const path of [
    "/",
    "/mcp",
    "/snapshot?season=2026",
    "/pitcher?id=1",
    "/rotation?club=PHI&date=2026-10-01",
    "/store/seasons/2026",
  ]) {
    const response = await requestPage(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
  }
});

test("the page's snapshot route checks the season before reading MLB", async () => {
  const response = await requestPage("/k3y/snapshot?season=1800");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /season must be a whole year/);
  assert.equal((await requestPage("/k3y/snapshot", { method: "POST" })).status, 405);
});

test("the pitcher route checks the pitcher before reading MLB, and answers only GET", async () => {
  const response = await requestPage("/k3y/pitcher?id=nope&season=2026");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /id must be an MLB person id/);
  assert.equal((await requestPage("/k3y/pitcher?id=1", { method: "POST" })).status, 405);
});

test("the rotation route checks the club and day before reading MLB, and answers only GET", async () => {
  const response = await requestPage("/k3y/rotation?club=nope&date=2026-10-01");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /club must be an MLB club/);
  const undated = await requestPage("/k3y/rotation?club=PHI");
  assert.match((await undated.json()).error, /date must be a day written YYYY-MM-DD/);
  const post = await requestPage("/k3y/rotation?club=PHI&date=2026-10-01", { method: "POST" });
  assert.equal(post.status, 405);
});
