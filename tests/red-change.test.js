import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideGate,
  findLabeler,
  findRedReasons,
  readDiff,
  readIssueEvents,
} from "../worker/red-change.mjs";

/**
 * A diff that adds `added` to `path` at line 10, after the lines it keeps, and takes out
 * `removed`.
 * @param {string} path
 * @param {string[]} added
 * @param {{ kept?: string[], removed?: string[] }} [lines]
 */
const createDiff = (path, added, { kept = ["kept"], removed = ["removed"] } = {}) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${10 - kept.length},${kept.length + removed.length} +${10 - kept.length},${kept.length + added.length} @@`,
    ...kept.map((line) => ` ${line}`),
    ...added.map((line) => `+${line}`),
    ...removed.map((line) => `-${line}`),
    "",
  ].join("\n");

/** @param {string} path @param {string[]} [addedLines] */
const findReasons = (path, addedLines = []) =>
  findRedReasons([
    { path, addedLines: addedLines.map((text, index) => ({ number: index + 1, text })), hunks: [] },
  ]);

/** @param {string} diff */
const findDiffReasons = (diff) => findRedReasons(readDiff(diff));

test("a diff lists each file with its added lines, numbered as the new file has them, and its hunks", () => {
  const diff = createDiff("apps/wnba/page/styles.css", [".a {", "  color: red;"]);
  assert.deepEqual(readDiff(diff), [
    {
      path: "apps/wnba/page/styles.css",
      addedLines: [
        { number: 10, text: ".a {" },
        { number: 11, text: "  color: red;" },
      ],
      hunks: [
        [
          { kind: "kept", text: "kept" },
          { kind: "added", text: ".a {" },
          { kind: "added", text: "  color: red;" },
          { kind: "removed", text: "removed" },
        ],
      ],
    },
  ]);
});

test("a moved file is listed under both its paths", () => {
  const diff = "diff --git a/shared/page/sheet.js b/shared/page/sheets.js\n";
  assert.deepEqual(
    readDiff(diff).map(({ path }) => path),
    ["shared/page/sheets.js", "shared/page/sheet.js"],
  );
});

test("any change to the shared code that moves, layers, or draws the page is red, and so is moving or deleting one of its stylesheets", () => {
  for (const file of [
    "sheet.js",
    "sheet-reopen.js",
    "slide-panels.js",
    "sheet.css",
    "sheet-swipe.js",
    "sheet-sections.js",
    "side-swipe.js",
    "bracket-standings.js",
    "pager.css",
    "pill-thumb.js",
    "tab-bar.js",
    "eased-redraw.js",
    "show-last-drawn.js",
    "day-strip.js",
    "strip-slide.js",
    "chrome.css",
    "team-sheet.css",
    "game-cards.css",
    "day-strip.css",
  ])
    assert.equal(findReasons(`shared/page/${file}`).length, 1, file);
  assert.deepEqual(findReasons("shared/page/stamp.js", ["export const x = 1;"]), []);
  assert.deepEqual(findReasons("apps/mlb/page/js/sheet.js", ["export const x = 1;"]), []);
});

const SHARED_STYLESHEETS = [
  "sheet.css",
  "pager.css",
  "chrome.css",
  "team-sheet.css",
  "game-cards.css",
  "day-strip.css",
].map((file) => `shared/page/${file}`);

test("a shared stylesheet's change to how text looks, or to its spacing, sizes, and colors, isn't red", () => {
  const quietLines = [
    "  font-size: var(--type-detail-size);",
    "  font-weight: 600;",
    "  font-family: var(--heading);",
    "  letter-spacing: 0.02em;",
    "  line-height: 1.3;",
    "  text-transform: uppercase;",
    "  color: var(--ink-dim);",
    "  margin-top: 14px;",
    "  padding: 10px 22px;",
    "  width: calc(100% - 24px);",
    "  border-radius: var(--radius-sheet);",
    "  background: var(--card);",
    "  --head-height: 64px;",
    "}",
    "",
  ];
  for (const path of SHARED_STYLESHEETS)
    for (const line of quietLines) {
      assert.deepEqual(findDiffReasons(createDiff(path, [line])), [], `${path} adds ${line}`);
      assert.deepEqual(
        findDiffReasons(createDiff(path, [], { removed: [line] })),
        [],
        `${path} removes ${line}`,
      );
    }
});

test("a shared stylesheet's comments aren't red, even a hunk that starts inside one", () => {
  const path = "shared/page/sheet.css";
  const comment = [
    "/* A sheet's title is centered, clear of the close button, so a transform: there,",
    "   or a position: fixed, would move it {",
    "   with the rest. */",
  ];
  assert.deepEqual(findDiffReasons(createDiff(path, comment)), []);
  assert.deepEqual(findDiffReasons(createDiff(path, [], { removed: comment })), []);
  assert.deepEqual(
    findDiffReasons(
      createDiff(path, ["   its parts, like a game's teams,", "   and its score. */"], {
        kept: ["   a line that a comment opened above the hunk,"],
        removed: [],
      }),
    ),
    [],
  );
});

test("a shared stylesheet's change to how parts layer, stack, scroll, or show is red, added or removed", () => {
  const stackLines = [
    "  transform: translateX(var(--thumb-left, 0));",
    "  will-change: transform;",
    "  transition: opacity 0.2s;",
    "  -webkit-backdrop-filter: blur(8px);",
    "  position: relative;",
    "  position: absolute;",
    "  overflow: hidden;",
    "  overflow-x: auto;",
    "  overscroll-behavior: none;",
    "  -webkit-overflow-scrolling: touch;",
    "  scroll-snap-type: x mandatory;",
    "  touch-action: pan-y;",
    "  z-index: 20;",
    "  opacity: 0;",
    "  visibility: hidden;",
    "  display: none;",
    "  isolation: isolate;",
    "  mix-blend-mode: multiply;",
  ];
  for (const path of SHARED_STYLESHEETS)
    for (const line of stackLines) {
      assert.equal(findDiffReasons(createDiff(path, [line])).length, 1, `${path} adds ${line}`);
      assert.equal(
        findDiffReasons(createDiff(path, [], { removed: [line] })).length,
        1,
        `${path} removes ${line}`,
      );
    }
});

test("a shared stylesheet's selectors and at-rules are red, since they say which parts its rules reach", () => {
  for (const line of [
    ".sheet-page .sheet-top {",
    ".pager-thumb,",
    "@media (min-width: 780px) {",
    "@property --cover-end {",
  ])
    assert.match(
      findDiffReasons(createDiff("shared/page/pager.css", [line])).join(),
      /shared\/page\/pager\.css changes how parts layer, stack, scroll, or show/,
      line,
    );
});

test("an added line that makes a layer is red in any page's CSS or JavaScript", () => {
  const layerLines = [
    "  transform: translateX(0);",
    "  -webkit-transform: none;",
    "  filter: blur(2px);",
    "  backdrop-filter: blur(8px);",
    "  -webkit-backdrop-filter: blur(8px);",
    "  mask: url(#m);",
    "  mask-image: linear-gradient(black, transparent);",
    "  clip-path: inset(0);",
    "  will-change: transform;",
    "  animation: spin 1s linear infinite;",
    "  transition: opacity 200ms;",
    "  transition-duration: 200ms;",
    "  contain: paint;",
    "  content-visibility: auto;",
    "  position: fixed;",
    "  position:sticky;",
    ".bar { top: 0; position: sticky }",
    "  element.style.transform = `translateX(${offset}px)`;",
    "  element.style.webkitBackdropFilter = 'blur(4px)';",
    "  element.style.willChange = 'transform';",
    '  element.style.setProperty("transform", value);',
    '  element.style.setProperty("position", "fixed");',
    '  element.style.position = "sticky";',
    "  element.animate([{ opacity: 0 }, { opacity: 1 }], 200);",
    '  const style = html`<div style="transform: scale(2)"></div>`;',
  ];
  for (const path of [
    "shared/page/stamp.js",
    "shared/page/type.css",
    "apps/wnba/page/styles.css",
    "apps/mlb/page/js/games-view.js",
  ])
    for (const line of layerLines)
      assert.equal(findReasons(path, [line]).length, 1, `${path}: ${line}`);
});

test("lines that only read or name those properties aren't red", () => {
  const quietLines = [
    "  const live = games.filter((game) => game.isLive);",
    "  if (list.contains(target)) return;",
    "  item.transformed = true;",
    "  position: relative;",
    "  position: absolute;",
    '  const isFixed = element.style.position === "fixed";',
    "  // A transform: here would make a layer.",
    "   * transition: none, so the sheet doesn't slide.",
    "  color: var(--now);",
  ];
  for (const line of quietLines)
    assert.deepEqual(findReasons("apps/wnba/page/styles.css", [line]), [], line);
});

test("tests, docs, and the Worker's code are never red", () => {
  for (const path of [
    "tests/browser/sheet-stack.spec.mjs",
    "tests/sheet.test.js",
    "apps/wnba/tests/browser/sheet-stack.spec.mjs",
    "apps/wnba/tests/page.test.js",
    "apps/wnba/worker/src/box-score.js",
    "shared/worker/app-worker.js",
    "AGENTS.md",
  ])
    assert.deepEqual(findReasons(path, ["  transform: none;", "position: fixed;"]), [], path);
});

const RED_DIFF =
  createDiff("shared/page/bracket-standings.js", ["export const x = 1;"]) +
  createDiff("apps/wnba/page/styles.css", ["  will-change: transform;"]);

/**
 * An issue event of `type` for `label`, by `login`, at `at`.
 * @param {string} type
 * @param {string} label
 * @param {string} login
 * @param {string} at
 */
const createEvent = (type, label, login, at) => ({
  event: type,
  created_at: at,
  label: { name: label },
  actor: { login },
});

test("a red change is held until it has the phone-ok label, and says why", () => {
  const diff = RED_DIFF;
  const held = decideGate(diff, { labels: ["bug"] });
  assert.equal(held.isHeld, true);
  assert.match(held.message, /shared\/page\/bracket-standings\.js is shared code/);
  assert.match(
    held.message,
    /apps\/wnba\/page\/styles\.css:10 adds a CSS declaration that sets will-change/,
  );
  assert.match(held.message, /git push -f origin <branch>:beta/);
  assert.match(held.message, /owner adds the phone-ok label after using it on the beta app/);

  const labeled = decideGate(diff, { labels: ["phone-ok"], labeler: "owner", owner: "owner" });
  assert.equal(labeled.isHeld, false);
  assert.match(labeled.message, /labeled phone-ok/);
});

test("a red change labeled phone-ok by anyone but the owner is held, and says the label has to come from the owner", () => {
  const held = decideGate(RED_DIFF, { labels: ["phone-ok"], labeler: "helper", owner: "owner" });
  assert.equal(held.isHeld, true);
  assert.match(held.message, /labeled phone-ok by helper/);
  assert.match(held.message, /has to come from the repository's owner, owner/);

  const unnamed = decideGate(RED_DIFF, { labels: ["phone-ok"], labeler: null, owner: "owner" });
  assert.equal(unnamed.isHeld, true);
  assert.equal(decideGate(RED_DIFF, { labels: ["phone-ok"], labeler: "", owner: "" }).isHeld, true);
});

test("the phone-ok label's adder is whoever added it last, whatever else was labeled", () => {
  const events = [
    createEvent("labeled", "phone-ok", "owner", "2026-10-07T10:00:00Z"),
    createEvent("unlabeled", "phone-ok", "owner", "2026-10-07T11:00:00Z"),
    createEvent("labeled", "phone-ok", "helper", "2026-10-07T12:00:00Z"),
    createEvent("labeled", "bug", "owner", "2026-10-07T13:00:00Z"),
    {
      event: "head_ref_force_pushed",
      created_at: "2026-10-07T14:00:00Z",
      actor: { login: "owner" },
    },
  ];
  assert.equal(findLabeler(events, "phone-ok"), "helper");
  assert.equal(findLabeler(events.toReversed(), "phone-ok"), "helper");
  assert.equal(findLabeler(events.slice(3), "phone-ok"), null);
});

test("a pull request's events are read page by page, with the token, until a short page", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) =>
      createEvent(
        "labeled",
        "bug",
        "owner",
        `2026-10-07T10:00:${String(index % 60).padStart(2, "0")}Z`,
      ),
    ),
    [createEvent("labeled", "phone-ok", "owner", "2026-10-07T12:00:00Z")],
  ];
  /** @type {{ url: string, authorization: string }[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const headers = /** @type {Record<string, string>} */ (init?.headers);
    requests.push({ url: String(url), authorization: headers.authorization });
    return Response.json(pages[requests.length - 1]);
  };

  const events = await readIssueEvents({
    repository: "owner/repo",
    pullNumber: "408",
    token: "token",
    fetchImpl,
  });

  assert.equal(events.length, 101);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://api.github.com/repos/owner/repo/issues/408/events?per_page=100&page=1",
      "https://api.github.com/repos/owner/repo/issues/408/events?per_page=100&page=2",
    ],
  );
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer token"));
});

test("events GitHub won't give fail the gate's read", async () => {
  /** @type {typeof fetch} */
  const fetchImpl = async () => new Response("", { status: 403 });
  await assert.rejects(
    readIssueEvents({ repository: "owner/repo", pullNumber: "408", token: "token", fetchImpl }),
    /GitHub answered 403 for the events of #408/,
  );
});

test("a change that isn't red passes without the label", () => {
  const diff =
    createDiff("apps/mlb/page/js/games-view.js", ["  const label = 'Final';"]) +
    createDiff("tests/sheet.test.js", ["  transform: none;"]);
  assert.deepEqual(decideGate(diff, { labels: [] }), {
    isHeld: false,
    message: "Not a red change.",
  });
});

test("CI's check needs the gate, which a label change runs again without a push", () => {
  const workflow = readFileSync(`${import.meta.dirname}/../.github/workflows/ci.yml`, "utf8");
  assert.match(workflow, /types: \[[^\]]*\blabeled, unlabeled\]/);
  assert.match(workflow, /\n {2}check:\n {4}if: always\(\)\n {4}needs: \[[^\]]*\bgate\b/);
  assert.match(
    workflow,
    /github\.event_name == 'pull_request' && needs\.gate\.result != 'success'/,
  );
  assert.match(
    workflow,
    /git diff --no-renames HEAD\^1 HEAD \| node worker\/red-change\.mjs "\$LABELS"/,
  );
  assert.match(
    workflow,
    /gate:[\s\S]*?pull-requests: read[\s\S]*?PR: \$\{\{ github\.event\.pull_request\.number \}\}/,
  );
});
