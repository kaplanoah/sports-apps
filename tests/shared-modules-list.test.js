import test from "node:test";
import assert from "node:assert/strict";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

const LIST_PATH = ".claude/rules/shared-modules.md";

/** @param {string} text */
function readListedModules(text) {
  const listed = new Set();
  let folder = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^## `(shared\/[^`]+\/)`$/);
    if (heading) folder = heading[1];
    else if (/^## /.test(line)) folder = null;
    const item = line.match(/^- `([\w.-]+\.(?:js|css))`:/);
    if (folder && item) listed.add(folder + item[1]);
  }
  return listed;
}

const listed = readListedModules(readRepoFile(LIST_PATH));
const modules = listTrackedFiles().filter(
  (path) => /^shared\/.+\.(?:js|css)$/.test(path) && !path.startsWith("shared/page/networks/"),
);

// A session reuses a shared module only if the list it reads names it.
test("the shared modules' list names every shared module", () => {
  assert.deepEqual(
    modules.filter((path) => !listed.has(path)),
    [],
  );
});

test("the shared modules' list names no module that's gone", () => {
  assert.deepEqual(
    [...listed].filter((path) => !modules.includes(path)),
    [],
  );
});

test("a module is listed by the item it starts, under the heading of its folder", () => {
  const text = [
    "- `before.js`: before any folder",
    "## `shared/page/`",
    "- `a.js`: one",
    "- `b.css`: what `c.js` decides",
    "## `shared/worker/`",
    "- `a.js`: two",
    "## Other",
    "- `after.js`: past the folders",
  ].join("\n");
  assert.deepEqual(
    [...readListedModules(text)],
    ["shared/page/a.js", "shared/page/b.css", "shared/worker/a.js"],
  );
});
