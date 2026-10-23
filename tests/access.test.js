import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./repo-files.js";
import { reloadWhenSignedOut } from "#shared/access.js";
import { STEPS_CACHE } from "#shared/service-worker.js";

/** @param {string[]} events */
function watchReloads(events) {
  globalThis.location = /** @type {any} */ ({ reload: () => events.push("reload") });
}

test("a page turned away for want of the access code forgets its offline copy and the pictures it kept, then reloads, keeping the service worker's steps", async (t) => {
  const events = [];
  const kept = new Set(["page", "images", STEPS_CACHE]);
  globalThis.caches = /** @type {any} */ ({
    keys: async () => [...kept],
    delete: async (name) => events.push(`forget ${name}`) && kept.delete(name),
  });
  watchReloads(events);
  t.after(() => {
    delete globalThis.caches;
    delete globalThis.location;
  });

  await reloadWhenSignedOut(new Response(null, { status: 200 }));
  assert.deepEqual(events, []);

  await reloadWhenSignedOut(new Response(null, { status: 401 }));
  assert.deepEqual(events, ["forget page", "forget images", "reload"]);
  assert.deepEqual([...kept], [STEPS_CACHE]);
});

test("a browser without the cache API still reloads a page turned away", async (t) => {
  const events = [];
  watchReloads(events);
  t.after(() => delete globalThis.location);

  await reloadWhenSignedOut(new Response(null, { status: 401 }));

  assert.deepEqual(events, ["reload"]);
});

// The worker's steps are a plain script it loads, which can't import the page's name for their
// cache, so the page keeps what the worker kept only while the two names agree.
test("the page names the worker's steps' cache as the worker does", () => {
  const worker = readRepoFile("shared/page/service-worker-steps.js");
  assert.equal(/^const STEPS_CACHE = "([^"]+)";$/m.exec(worker)?.[1], STEPS_CACHE);
});
