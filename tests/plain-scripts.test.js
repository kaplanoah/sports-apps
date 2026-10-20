import test from "node:test";
import assert from "node:assert/strict";
import { PLAIN_SCRIPTS } from "../eslint.config.mjs";
import { listApps } from "../worker/apps.mjs";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

// The build writes it into the head itself, and lint gives it its own block.
const RELEASE_GUARD = "shared/page/release-guard.js";

const CLASSIC_SHARED_SCRIPT = /<script\b(?![^>]*\btype="module")[^>]*\bsrc="shared\/([^"]+)"/g;

/** @param {string} path */
const listPlainScripts = (path) =>
  [...readRepoFile(path).matchAll(CLASSIC_SHARED_SCRIPT)].map(([, name]) => `shared/page/${name}`);

const listPages = () =>
  listTrackedFiles().filter((path) =>
    listApps().some((app) => new RegExp(`^apps/${app}/page/[^/]+\\.html$`).test(path)),
  );

test("a classic script tag with any attributes is read as a plain script, and a module isn't", () => {
  const read = (/** @type {string} */ markup) =>
    [...markup.matchAll(CLASSIC_SHARED_SCRIPT)].map(([, name]) => name);

  assert.deepEqual(read('<script defer src="shared/a.js"></script>'), ["a.js"]);
  assert.deepEqual(read('<script id="b" src="shared/b.js" async></script>'), ["b.js"]);
  assert.deepEqual(read('<script type="module" src="shared/c.js"></script>'), []);
  assert.deepEqual(read('<script src="shared/d.js" type="module"></script>'), []);
});

// Lint lets these keep what they keep on the device on their own, and reads them as scripts.
test("lint knows every plain script any app's pages load before their modules", () => {
  const loaded = new Set(listPages().flatMap(listPlainScripts));
  loaded.delete(RELEASE_GUARD);

  assert.deepEqual([...loaded].sort(), [...PLAIN_SCRIPTS].sort());
});
