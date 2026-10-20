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
    if (!folder || heading) continue;
    for (const [, name] of line.matchAll(/`([\w.-]+\.(?:js|css))`/g)) listed.add(folder + name);
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

test("a module is listed under the heading of its folder", () => {
  const text =
    "## `shared/page/`\n\n- `a.js`: one\n- `b.css` and `c.js`\n\n## `shared/worker/`\n\n- `a.js`: two\n";
  assert.deepEqual(
    [...readListedModules(text)],
    ["shared/page/a.js", "shared/page/b.css", "shared/page/c.js", "shared/worker/a.js"],
  );
});
