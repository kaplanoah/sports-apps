import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideGate,
  findLabeling,
  findKeyframeLines,
  findRedReasons,
  findStyleObjectLines,
  listPageStylesheets,
  readDiff,
  readPushTime,
  readTimeline,
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

// A script with no style's object in it, so only the diff's lines decide.
const readPlainScript = () => "";
// No stylesheet beside the ones the change touches, so only the change decides.
const listNoStylesheets = () => [];

/** @param {string} path @param {string[]} [addedLines] */
const findReasons = (path, addedLines = []) =>
  findRedReasons(
    [
      {
        path,
        addedLines: addedLines.map((text, index) => ({ number: index + 1, text })),
        hunks: [],
        hunkStarts: [],
      },
    ],
    readPlainScript,
    listNoStylesheets,
  );

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
      hunkStarts: [9],
      isUnreadable: false,
    },
  ]);
});

test("a diff's header names its one path twice, however many \" b/\" it holds, and any other header can't be read", () => {
  const spaced = "apps/wnba/page/a b/c.js";
  const files = readDiff(createDiff(spaced, ["  transform: none;"]));
  assert.deepEqual(
    files.map(({ path }) => path),
    [spaced],
  );
  assert.equal(findRedReasons(files, readPlainScript, listNoStylesheets).length, 1);
  const moved = "diff --git a/shared/page/sheet.js b/shared/page/sheets.js\n@@ -1 +1 @@\n+x\n";
  assert.deepEqual(readDiff(moved), []);
  assert.deepEqual(
    readDiff(`${createDiff("apps/wnba/page/js/a.js", ["const a = 1;"])}${moved}`).map(
      ({ path, addedLines }) => [path, addedLines.length],
    ),
    [["apps/wnba/page/js/a.js", 1]],
    "a header it can't read ends the file before it",
  );
  const { isHeld, message } = decideGate(moved, { labels: [] });
  assert.equal(isHeld, true);
  assert.match(message, /The gate can't read the diff, so it may change anything/);
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
    "pull-to-refresh.js",
    "spring-scroll.js",
    "chrome.css",
    "team-sheet.css",
    "game-cards.css",
    "day-strip.css",
  ])
    assert.equal(findReasons(`shared/page/${file}`).length, 1, file);
  assert.deepEqual(findReasons("shared/page/stamp.js", ["export const x = 1;"]), []);
  assert.deepEqual(findReasons("apps/mlb/page/js/sheet.js", ["export const x = 1;"]), []);
});

const SHARED_SCRIPT = "shared/page/bracket-standings.js";
const SCRIPT_REASON = [`${SHARED_SCRIPT} is shared code that moves, layers, or draws the page`];

/**
 * Why a change to a shared script is red, from its hunks, each a header and its lines as a diff
 * shows them, with the script as the change leaves it.
 * @param {{ header: string, lines: string[] }[]} hunks
 * @param {string[]} after
 */
const findHunkChangeReasons = (hunks, after) =>
  findRedReasons(
    readDiff(
      [
        `diff --git a/${SHARED_SCRIPT} b/${SHARED_SCRIPT}`,
        `--- a/${SHARED_SCRIPT}`,
        `+++ b/${SHARED_SCRIPT}`,
        ...hunks.flatMap(({ header, lines }) => [header, ...lines]),
      ].join("\n"),
    ),
    () => after.join("\n"),
  );

/**
 * Why a change to a shared script is red, from its lines as a diff shows them, each kept line
 * after a space, each added one after a +, and each removed one after a -, in one hunk from the
 * script's first line, with the script as the change leaves it.
 * @param {string[]} lines
 * @param {string} [after] the script as the change leaves it, when it isn't the hunk's new side
 */
function findScriptChangeReasons(lines, after) {
  const newSide = lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1));
  return findHunkChangeReasons([{ header: "@@ -1 +1 @@", lines }], after?.split("\n") ?? newSide);
}

const SCROLL_UP = [
  " function scrollUpToPartsTop() {",
  "   const partsTopScroll = measurePartsTopScroll();",
  '   if (scrollY > partsTopScroll) scrollTo({ top: partsTopScroll, behavior: "instant" });',
  " }",
];

test("a shared script's comments, blank lines, and formatting aren't red, wherever a hunk starts", () => {
  for (const lines of [
    ["+// Brings the page up so the parts start just under the pill.", ...SCROLL_UP],
    [
      "-/*! The parts start under the pill. */",
      "+/*! The parts start just under the pill. */",
      ...SCROLL_UP,
    ],
    ["-/**", "- * Brings the page up.", "- */", ...SCROLL_UP],
    [
      " /**",
      " * Slides to one of the tab's parts,",
      "- * as a search does.",
      "+ * as a search's row does.",
      " */",
      ...SCROLL_UP,
    ],
    [...SCROLL_UP.slice(0, 3), "+", ...SCROLL_UP.slice(3)],
    [
      "-let restingPart = ''; // the part at rest",
      "+let restingPart = ''; // the part the page's scroll belongs to",
      ...SCROLL_UP,
    ],
    [
      ...SCROLL_UP.slice(0, 2),
      '-  if (scrollY > partsTopScroll) scrollTo({ top: partsTopScroll, behavior: "instant" });',
      "+  if (scrollY > partsTopScroll)",
      '+    scrollTo({ top: partsTopScroll, behavior: "instant" });',
      ...SCROLL_UP.slice(3),
    ],
  ])
    assert.deepEqual(findScriptChangeReasons(lines), [], lines.join("\n"));
});

test("a shared script's change to its code is red, even one that comments code out or back in, or hides in what looks like a comment", () => {
  for (const lines of [
    [...SCROLL_UP.slice(0, 2), "+/*", SCROLL_UP[2], "+*/", SCROLL_UP[3]],
    [...SCROLL_UP.slice(0, 2), "-/*", SCROLL_UP[2], "-*/", SCROLL_UP[3]],
    [
      ...SCROLL_UP.slice(0, 3),
      "+  // Matches shared/*",
      '+  sheet.style.transform = "translateX(0)";',
      SCROLL_UP[3],
    ],
    [
      "-let restingPart = ''; // the part at rest",
      "+let restingPart = 'bracket'; // the part at rest",
      ...SCROLL_UP,
    ],
    ["+/* the page's top */ scrollTo({ top: 0 });", ...SCROLL_UP],
  ])
    assert.deepEqual(findScriptChangeReasons(lines), SCRIPT_REASON, lines.join("\n"));
});

test("a shared script's change in hunks far apart is red only where one changes code", () => {
  const buildScript = (/** @type {string} */ secondReturn) => [
    "// The parts' top, just under the pill.",
    "function a() {",
    "  return 1;",
    "}",
    "",
    "function b() {",
    `  ${secondReturn} // the part at rest`,
    "}",
  ];
  const firstHunk = {
    header: "@@ -1,2 +1,2 @@",
    lines: ["-// The parts' top.", "+// The parts' top, just under the pill.", " function a() {"],
  };
  const buildSecondHunk = (/** @type {string} */ secondReturn) => ({
    header: "@@ -6,3 +6,3 @@",
    lines: [
      " function b() {",
      "-  return 2; // the part",
      `+  ${secondReturn} // the part at rest`,
      " }",
    ],
  });
  assert.deepEqual(
    findHunkChangeReasons([firstHunk, buildSecondHunk("return 2;")], buildScript("return 2;")),
    [],
  );
  assert.deepEqual(
    findHunkChangeReasons([firstHunk, buildSecondHunk("return 3;")], buildScript("return 3;")),
    SCRIPT_REASON,
  );
});

test("a shared script's hunk that only removes lines, as a diff without context gives, is red only for code", () => {
  // A line put back a line too early would land inside the template string, and change it.
  const after = ["const words = `", "hi", "`;", "show(words);"];
  for (const [removed, reasons] of /** @type {[string, string[]][]} */ ([
    ["// the words to show", []],
    ["log(words);", SCRIPT_REASON],
  ]))
    assert.deepEqual(
      findHunkChangeReasons([{ header: "@@ -4 +3,0 @@", lines: [`-${removed}`] }], after),
      reasons,
      removed,
    );
});

test("a shared script that's gone, that a change's hunks don't fit, or that doesn't parse, is red", () => {
  assert.deepEqual(findScriptChangeReasons(["+// a note", " function ("]), SCRIPT_REASON);
  const comment = ["+// Brings the page up so the parts start just under the pill.", ...SCROLL_UP];
  assert.deepEqual(findScriptChangeReasons(comment, ""), SCRIPT_REASON);
  assert.deepEqual(findScriptChangeReasons(comment, "export const x = 1;\n"), SCRIPT_REASON);
  // A change to code, read against the file as it was before it, would show no change at all.
  assert.deepEqual(
    findScriptChangeReasons(
      [" function a() {", "-  return 1;", "+  return 2;", " }"],
      "function a() {\n  return 1;\n}",
    ),
    SCRIPT_REASON,
  );
});

/**
 * The hunk a diff without context shows for a file from `before` to `after`: the lines between
 * those both start and end with, taken out and put back in.
 * @param {string[]} before
 * @param {string[]} after
 */
function createHunk(before, after) {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start])
    start += 1;
  let end = 0;
  while (
    end < Math.min(before.length, after.length) - start &&
    before.at(-1 - end) === after.at(-1 - end)
  )
    end += 1;
  const removed = before.slice(start, before.length - end);
  const added = after.slice(start, after.length - end);
  // A side with no lines names the line before the hunk, as git does.
  const describeSide = (/** @type {string[]} */ lines) =>
    `${lines.length ? start + 1 : start},${lines.length}`;
  return [
    `@@ -${describeSide(removed)} +${describeSide(added)} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
}

/**
 * Why a change is red, from each file it changes, as it was and as the change leaves it, each a
 * list of lines, with the files it leaves as they were.
 * @param {Record<string, { before: string[], after: string[] }>} changed
 * @param {Record<string, string[]>} [kept]
 */
function findChangeReasons(changed, kept = {}) {
  const diff = Object.entries(changed).flatMap(([path, { before, after }]) => [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...createHunk(before, after),
  ]);
  /** @type {Record<string, string[]>} */
  const files = { ...kept };
  for (const [path, { after }] of Object.entries(changed)) files[path] = after;
  return findRedReasons(
    readDiff(diff.join("\n")),
    (path) => files[path]?.join("\n") ?? "",
    () => Object.keys(files).filter((path) => path.endsWith(".css")),
  );
}

/**
 * Why a change to a stylesheet that adds `added` to a rule, or takes `removed` out of it, is red.
 * @param {string} path
 * @param {{ added?: string[], removed?: string[], kept?: string[] }} rule
 */
function findRuleChangeReasons(path, { added = [], removed = [], kept = ["  color: red;"] }) {
  const before = [".part {", ...kept, ...removed, "}"];
  const after = [".part {", ...kept, ...added, "}"];
  return findChangeReasons({ [path]: { before, after } });
}

const SHARED_STYLESHEETS = [
  "sheet.css",
  "pager.css",
  "chrome.css",
  "team-sheet.css",
  "game-cards.css",
  "day-strip.css",
].map((file) => `shared/page/${file}`);
// Stylesheets beside the shared ones that move and draw the page: a page's own, and the rest of
// the shared ones.
const PAGE_STYLESHEETS = ["apps/wnba/page/styles.css", "shared/page/type.css"];
// A stylesheet of each kind, for what only its kind decides.
const SHARED_STYLESHEET = "shared/page/sheet.css";
const PAGE_STYLESHEET = "apps/wnba/page/styles.css";
const EACH_KIND = [SHARED_STYLESHEET, PAGE_STYLESHEET];

/**
 * Asserts that adding each of `lines` to a rule, and taking it out of one, gives `count` reasons.
 * @param {string[]} paths
 * @param {string[]} lines
 * @param {{ count: number, isRemovalRed?: boolean, kept?: string[] }} expected
 */
function assertRuleReasons(paths, lines, { count, isRemovalRed = count > 0, kept }) {
  for (const path of paths)
    for (const line of lines) {
      assert.equal(
        findRuleChangeReasons(path, { added: [line], kept }).length,
        count,
        `${path} adds ${line}`,
      );
      assert.equal(
        findRuleChangeReasons(path, { removed: [line], kept }).length,
        isRemovalRed ? count : 0,
        `${path} removes ${line}`,
      );
    }
}

/**
 * Asserts that each of `lines` is red added to a rule in a stylesheet of each kind, and taken out of
 * one in a shared stylesheet that moves and draws the page.
 * @param {string[]} lines
 * @param {string[]} [kept]
 */
function assertRedInEach(lines, kept) {
  assertRuleReasons([SHARED_STYLESHEET], lines, { count: 1, kept });
  assertRuleReasons([PAGE_STYLESHEET], lines, { count: 1, isRemovalRed: false, kept });
}

/**
 * Asserts that a change to a stylesheet of each kind, from `before` to `after`, is red, with the
 * page stylesheets it leaves as they were.
 * @param {string[]} before
 * @param {string[]} after
 * @param {string} why
 * @param {Record<string, string[]>} [kept]
 */
function assertRedChange(before, after, why, kept = {}) {
  for (const path of EACH_KIND)
    assert.notDeepEqual(
      findChangeReasons({ [path]: { before, after } }, kept),
      [],
      `${path}: ${why}`,
    );
}

test("a stylesheet's change to how text looks, or to its spacing, sizes, and colors, isn't red", () => {
  assertRuleReasons(
    [...SHARED_STYLESHEETS, ...PAGE_STYLESHEETS],
    [
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
    ],
    { count: 0 },
  );
});

test("a stylesheet's comments aren't red, even ones that name what would be", () => {
  const rule = [".part {", "  position: fixed;", "}"];
  const comment = [
    "/* A sheet's title is centered, clear of the close button, so a transform: there,",
    "   or a position: fixed, would move it {",
    "   with the rest. */",
  ];
  for (const path of [...SHARED_STYLESHEETS, ...PAGE_STYLESHEETS]) {
    assert.deepEqual(
      findChangeReasons({ [path]: { before: rule, after: [...comment, ...rule] } }),
      [],
    );
    assert.deepEqual(
      findChangeReasons({ [path]: { before: [...comment, ...rule], after: rule } }),
      [],
    );
  }
});

test("a shared stylesheet's declaration of a property that decides how parts layer, stack, scroll, or show is red whatever its value, added or removed", () => {
  assertRuleReasons(
    SHARED_STYLESHEETS,
    [
      "  transform: translateX(var(--thumb-left, 0));",
      "  transform: none;",
      "  translate: 0 -1px;",
      "  rotate: 45deg;",
      "  scale: 1.02;",
      "  will-change: transform;",
      "  -webkit-backdrop-filter: blur(8px);",
      "  position: relative;",
      "  position: static;",
      "  position: sticky;",
      "  overflow: visible;",
      "  overflow-x: auto;",
      "  overscroll-behavior: none;",
      "  -webkit-overflow-scrolling: touch;",
      "  scroll-snap-type: x mandatory;",
      "  scroll-snap-stop: always;",
      "  touch-action: pan-y;",
      "  pointer-events: auto;",
      "  z-index: auto;",
      "  opacity: 1;",
      "  visibility: visible;",
      "  display: flex;",
      "  display: block;",
      "  display: none !important;",
      "  isolation: isolate;",
      "  mix-blend-mode: multiply;",
      "  contain: paint;",
      "  container-type: inline-size;",
      "  container: card / size;",
      "  offset-path: path('M 0 0');",
      "  view-transition-name: sheet;",
      "  -webkit-box-reflect: below;",
      "  overflow-anchor: none;",
      "  -webkit-touch-callout: none;",
      "  touch-callout: none;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  scroll-behavior: smooth;",
      "  scroll-padding-top: 64px;",
      "  scroll-padding: 8px;",
      "  scroll-margin-inline: 12px;",
      "  scroll-margin-top: 4px;",
      "  zoom: 1.1;",
    ],
    { count: 1 },
  );
  assertRuleReasons(SHARED_STYLESHEETS, ["  overflow-wrap: anywhere;"], { count: 0 });
  assert.deepEqual(
    findRuleChangeReasons("shared/page/pager.css", { added: ["  overflow-x: clip;"] }),
    [
      "shared/page/pager.css changes how parts layer, stack, scroll, or show: adds .part { overflow-x: clip }",
    ],
  );
  assert.deepEqual(
    findRuleChangeReasons("shared/page/pager.css", { removed: ["  display: none;"] }),
    [
      "shared/page/pager.css changes how parts layer, stack, scroll, or show: drops .part { display: none }",
    ],
  );
});

test("a transition is red unless every property it eases only repaints a part", () => {
  assertRuleReasons(
    EACH_KIND,
    [
      "  transition: color 0.15s;",
      "  transition: background-color 0.18s ease-in-out, box-shadow 0.18s ease-in-out, color 0.2s ease-in-out 25ms;",
      "  transition: border-color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), border-top-color 0.2s;",
      "  transition: outline-color 0.1s linear, text-decoration-color 0.1s, caret-color 0.1s;",
      "  transition: fill 0.2s, stroke 0.2s;",
      "  -webkit-transition: color 0.2s;",
      "  transition-property: color, background-color;",
      "  transition: background 0.15s;",
      "  transition: background 0.15s, box-shadow 0.15s;",
    ],
    { count: 0 },
  );
  assertRedInEach([
    "  transition: opacity 0.2s;",
    "  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);",
    "  transition: -webkit-transform 0.3s;",
    "  transition: color 0.2s, translate 0.2s;",
    "  transition: all 0.2s;",
    "  transition: 0.2s ease;",
    "  transition: none;",
    "  transition: inherit;",
    "  transition: initial;",
    "  transition: unset;",
    "  transition: revert;",
    "  transition: revert-layer;",
    "  transition: var(--motion);",
    "  transition: color var(--pace);",
    "  transition-property: var(--eased);",
    "  transition-property: none;",
    "  transition-duration: 0.2s;",
  ]);
});

test("a page's other stylesheets are red where they add what can give a part a layer, lift it over others, or make it scroll", () => {
  assertRuleReasons(
    PAGE_STYLESHEETS,
    [
      "  transform: translateZ(0);",
      "  translate: 0 -1px;",
      "  filter: blur(2px);",
      "  -webkit-backdrop-filter: blur(8px);",
      "  mask-image: linear-gradient(black, transparent);",
      "  clip-path: inset(0);",
      "  will-change: transform;",
      "  animation: spin 1s linear infinite;",
      "  transition: opacity 200ms;",
      "  contain: paint;",
      "  content-visibility: auto;",
      "  perspective-origin: center;",
      "  -webkit-backface-visibility: hidden;",
      "  position: fixed;",
      "  position:sticky;",
      "  position: -webkit-sticky;",
      "  position: absolute;",
      "  position: var(--place);",
      "  z-index: 2;",
      "  overflow: hidden;",
      "  overflow-x: auto;",
      "  overflow-y: clip;",
      "  overflow: var(--scroll);",
      "  -webkit-overflow-scrolling: touch;",
      "  touch-action: pan-y;",
      "  overscroll-behavior: contain;",
      "  scroll-snap-type: x mandatory;",
      "  scroll-snap-align: start;",
      "  scroll-snap-stop: always;",
      "  pointer-events: none;",
      "  isolation: isolate;",
      "  mix-blend-mode: multiply;",
      "  container: card / size;",
      "  container-type: inline-size;",
      "  offset-path: path('M 0 0');",
      "  view-transition-name: sheet;",
      "  -webkit-box-reflect: below;",
      "  -webkit-touch-callout: none;",
      "  touch-callout: none;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  scroll-behavior: smooth;",
      "  scroll-padding-top: 64px;",
      "  scroll-padding: 8px;",
      "  scroll-margin-inline: 12px;",
      "  scroll-margin-top: 4px;",
      "  zoom: 1.1;",
    ],
    { count: 1, isRemovalRed: false },
  );
  assertRuleReasons(
    PAGE_STYLESHEETS,
    [
      "  position: relative;",
      "  position: static;",
      "  overflow: visible;",
      "  overflow-wrap: anywhere;",
      "  opacity: 0.5;",
      "  display: none;",
      "  visibility: hidden;",
    ],
    { count: 0 },
  );
  assert.deepEqual(
    findRuleChangeReasons("apps/wnba/page/styles.css", { added: ["  will-change: transform;"] }),
    [
      "apps/wnba/page/styles.css adds a layer, a stack, or a scroll: .part { will-change: transform }",
    ],
  );
});

test("a custom property a stack declaration reads, itself or through another, is red to change in any page stylesheet", () => {
  const reads = {
    "shared/page/chrome.css": [
      ".a { transform: var(--lift); }",
      ".b { display: var(--logos-for-light); }",
      ":root { --lift: VAR(--rise); }",
    ],
  };
  const registers = (/** @type {string} */ name, /** @type {string} */ start) =>
    `@property ${name} { syntax: '*'; inherits: false; initial-value: ${start}; }`;
  for (const [before, after] of [
    [":root { --rise: translateY(0); }", ":root { --rise: translateZ(0); }"],
    [":root { --logos-for-light: inline; }", ":root { --logos-for-light: none; }"],
    [":root { --logos-for-light: inline; }", ":root {}"],
    [registers("--lift", "none"), registers("--lift", "translateZ(0)")],
    [registers("--rise", "none"), ""],
  ])
    for (const path of EACH_KIND)
      assert.notDeepEqual(
        findChangeReasons({ [path]: { before: [before], after: [after] } }, reads),
        [],
        `${path}: ${after}`,
      );
  for (const [before, after] of [
    [":root { --ink: #111; }", ":root { --ink: #222; }"],
    [registers("--ink", "#111"), registers("--ink", "#222")],
  ])
    for (const path of EACH_KIND)
      assert.deepEqual(
        findChangeReasons({ [path]: { before: [before], after: [after] } }, reads),
        [],
        `${path}: ${after}, a color nothing stacks with`,
      );
});

test("a stylesheet's top-level statements, or a shared stylesheet's stack declarations in another order, are red", () => {
  assertRedChange(["@layer a, b;"], ["@layer b, a;"], "layers in another order");
  assertRedChange([], ['@import url("extra.css");'], "an import");
  for (const [before, after, why] of /** @type {[string[], string[], string][]} */ ([
    [
      [".a {", "  overflow: hidden;", "  overflow-x: auto;", "}"],
      [".a {", "  overflow-x: auto;", "  overflow: hidden;", "}"],
      "a rule's longhand before its shorthand",
    ],
    [
      [".a { display: none; }", ".a.open { display: block; }"],
      [".a.open { display: block; }", ".a { display: none; }"],
      "two rules swapped",
    ],
  ]))
    assert.match(
      findChangeReasons({ [SHARED_STYLESHEET]: { before, after } }).join(),
      /changes how parts layer, stack, scroll, or show: reorders/,
      why,
    );
});

test("a shared stylesheet's selectors and at-rules are red only where they change what reaches a declaration that stacks a part", () => {
  const path = "shared/page/game-cards.css";
  /** @param {string[]} before @param {string[]} after */
  const findSelectorReasons = (before, after) => findChangeReasons({ [path]: { before, after } });
  for (const [before, after] of [
    [
      [".game-card-clock {", "  color: var(--now);", "}"],
      [".game-card-now {", "  color: var(--now);", "}"],
    ],
    [
      [".a,", ".b {", "  position: sticky;", "  color: red;", "}"],
      [".a {", "  color: red;", "  position: sticky;", "}", ".b {", "  position: sticky;", "}"],
    ],
    [
      [".a {", "  position: sticky;", "}", ".a {", "  z-index: 2;", "}"],
      [".a {", "  position: sticky;", "  z-index: 2;", "}"],
    ],
    [
      [".a {", "  z-index: 2;", "}"],
      [".a {", "  z-index: 2;", "}", "@media (hover: hover) {", "  .a:hover { color: red; }", "}"],
    ],
    [
      [".a {", "  z-index: 2;", "}"],
      [
        "@property --cover-end {",
        "  syntax: '<length>';",
        "  inherits: false;",
        "}",
        ".a {",
        "  z-index: 2;",
        "}",
      ],
    ],
  ])
    assert.deepEqual(findSelectorReasons(before, after), [], after.join("\n"));
  for (const [before, after] of [
    [
      [".home-screen-bar {", "  position: fixed;", "}"],
      [".welcome {", "  position: fixed;", "}"],
    ],
    [
      [".a,", ".b {", "  position: sticky;", "}"],
      [".a {", "  position: sticky;", "}"],
    ],
    [
      ["@media (min-width: 780px) {", "  .a { position: sticky; }", "}"],
      ["@media (min-width: 600px) {", "  .a { position: sticky; }", "}"],
    ],
    [
      ["@supports (display: grid) {", "  .a { position: sticky; }", "}"],
      ["@supports (display: flex) {", "  .a { position: sticky; }", "}"],
    ],
    [
      ["@container card (min-width: 300px) {", "  .a { position: sticky; }", "}"],
      ["@container card (min-width: 400px) {", "  .a { position: sticky; }", "}"],
    ],
    [
      [".k {", "  transition: transform 0.2s;", "}"],
      [".k {", "  transition: transform 0.2s;", "  &.on { transform: translateX(4px); }", "}"],
    ],
  ])
    assert.match(
      findSelectorReasons(before, after).join("\n"),
      /shared\/page\/game-cards\.css changes how parts layer, stack, scroll, or show/,
      after.join("\n"),
    );
});

test("a stylesheet the gate can't read is red and says so, and beside one, any custom property is watched", () => {
  for (const path of EACH_KIND)
    assert.deepEqual(
      findChangeReasons({
        [path]: {
          before: [".a {", "  position: fixed;", "}"],
          after: [".a {", "  position: fixed;", "}}}{{"],
        },
      }),
      [`${path} changes in a way the gate can't read, so it may change anything`],
    );
  assertRedChange([":root { --ink: #111; }"], [":root { --ink: #222; }"], "beside one", {
    "shared/page/chrome.css": [".a {", "  position: fixed;", "}}}{{"],
  });
});

const INDEX_HTML = "apps/wnba/page/index.html";

test("a page's markup is red where it changes the stylesheets it links or their order, but not its other links", () => {
  const head = [
    '  <link rel="stylesheet" href="shared/sheet.css" />',
    '  <link rel="stylesheet" href="styles.css" />',
  ];
  assert.deepEqual(
    findChangeReasons({ [INDEX_HTML]: { before: head, after: head.toReversed() } }),
    [`${INDEX_HTML} changes the stylesheets it links`],
    "the app's styles moved above a shared stylesheet",
  );
  for (const link of [
    ['  <link href="extra.css" rel="stylesheet" />'],
    ["  <link rel='stylesheet' href='extra.css'>"],
    ["  <link rel=stylesheet href=extra.css>"],
    ["  <link", '    href="extra.css"', '    rel="alternate stylesheet"', "  />"],
  ])
    assert.deepEqual(
      findChangeReasons({ [INDEX_HTML]: { before: head, after: [...head, ...link] } }),
      [`${INDEX_HTML} changes the stylesheets it links`],
      link.join("\n"),
    );
  for (const link of [
    [
      '  <link rel="preload" href="fonts/barlow-400.woff2" as="font" type="font/woff2" crossorigin />',
    ],
    ['  <link rel="icon" href="icon.svg" type="image/svg+xml" />'],
    ["  <link", '    rel="preload"', '    href="fonts/barlow-500.woff2"', "  />"],
  ])
    assert.deepEqual(
      findChangeReasons({ [INDEX_HTML]: { before: head, after: [...head, ...link] } }),
      [],
      link.join("\n"),
    );
});

test("a page's markup is red where it adds or takes out a line that runs its scripts, or opens a dialog, a popover, or a style of its own", () => {
  for (const line of [
    '  <script src="shared/slow-load.js"></script>',
    '  <dialog id="settings" class="sheet">',
    '  <div id="tip" popover>',
    '  <div style="z-index: 2">',
  ])
    assert.equal(
      findChangeReasons({ [INDEX_HTML]: { before: [], after: [line] } }).length,
      1,
      line,
    );
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: { before: ["  <h2>Standings</h2>"], after: ["  <h2>Table</h2>"] },
    }),
    [],
  );
});

test("a page's markup is red where it changes what an inline script runs, or its order", () => {
  const calls = ["  <script>", "    openLastTab();", "    showLastDrawn();", "  </script>"];
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: { before: calls, after: [calls[0], calls[2], calls[1], calls[3]] },
    }),
    [`${INDEX_HTML} changes what its inline scripts run`],
  );
  const lazy = ['  <script data-src="later.js">', "    openLastTab();", "  </script>"];
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: { before: lazy, after: [lazy[0], "    showLastDrawn();", lazy[2]] },
    }),
    [`${INDEX_HTML} changes what its inline scripts run`],
    "a data-src names no file the script runs instead",
  );
});

test("a page's markup is red where it changes its inline styles, or how it fits the screen or colors the phone's bars", () => {
  const style = ["  <style>", "    body { margin: 0; }", "  </style>"];
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: {
        before: style,
        after: [style[0], "    body { overflow: hidden; }", style[2]],
      },
    }),
    [`${INDEX_HTML} changes its inline styles`],
  );
  assert.equal(findChangeReasons({ [INDEX_HTML]: { before: [], after: style } }).length, 2);
  for (const [before, after] of [
    [
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    ],
    [
      '  <meta content="default" name="apple-mobile-web-app-status-bar-style">',
      '  <meta content="black-translucent" name="apple-mobile-web-app-status-bar-style">',
    ],
  ])
    assert.deepEqual(
      findChangeReasons({ [INDEX_HTML]: { before: [before], after: [after] } }),
      [`${INDEX_HTML} changes how it fits the screen or its bars`],
      after,
    );
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: {
        before: ['  <meta name="description" content="Scores" />'],
        after: ['  <meta name="description" content="Scores and standings" />'],
      },
    }),
    [],
  );
});

test("an inline style in a page's markup or a script's template is red only where a page's stylesheet would be, or the gate can't read it", () => {
  const reads = { "shared/page/chrome.css": [".a { transform: var(--lift); }"] };
  const script = "apps/wnba/page/js/team-view.js";
  /** @param {string} markup */
  const wrapInTemplate = (markup) => `  const part = html\`${markup}\`;`;
  const redStyles = [
    '<div style="position: absolute">',
    '<div style="color: red; z-index: 2">',
    "<div style='overflow: auto'>",
    '<div style="top: ${top}px; position: ${position}">',
    '<div style="--lift: ${lift}">',
    '<div style="--lift: translateZ(0)">',
    '<div style="${style}">',
    "<div style=${style}>",
    '<div style="color: ${isOn ? "red" : "blue"}">',
    '<div style="/* lift */ z-index: 2">',
    '<div style="transition: color 0.2s, transform 0.2s">',
    '<div style="/**/pointer-events: none">',
    '<div style="z\\-index: 2">',
    "<div style=\"--icon: '/*'; z-index: 2\">",
    '<div style="position: f\\69xed">',
    '<div style="position: &#102;ixed">',
    '<div style="position: f&#x69;xed">',
    '<div style="position: &#102ixed">',
    "<div style=\"color: ${open ? '{' : 'b'}; z-index: 2\">",
    "<div style=\"color: ${shut ? '}' : 'b'}; z-index: 2\">",
    '<div style="/* don\'t lift */ color: red; z-index: 2">',
    '<div style="color: red /* ( */; z-index: 2">',
    '<div style="color: red} .other {z-index: 2">',
  ];
  const quietStyles = [
    '<div style="--team-stat-columns: ${columns}">',
    '<div style="--team-stat-columns: ${isWide && columns}">',
    '<div style="--team-stat-columns: ${count({ wide: 1 })}">',
    "<div style=\"--team-stat-columns: ${isOpen ? '}' : '1'}\">",
    "<div style=\"--team-stat-columns: ${isOpen ? 'a\\'}' : '1'}\">",
    '<div style="--team: #f60">',
    '<div style="color: var(--ink)">',
    '<div style="position: relative; overflow: visible">',
    '<div style="display: none; opacity: 0.5">',
    '<div style="">',
    '<div data-style="z-index: 2">',
    '<div style="/* note */ color: red">',
    '<div style="transition: color 0.2s">',
    '<div style="transition: color 0.2s" class="tip">',
    '<div style="transition: color 0.2s" hidden>',
    '<img style="transition: color 0.2s" />',
    '<div style="transition: background-color 0.15s, box-shadow 0.15s; color: red">',
  ];
  for (const markup of redStyles) {
    assert.equal(
      findChangeReasons({ [INDEX_HTML]: { before: [], after: [`  ${markup}`] } }, reads).length,
      1,
      `${INDEX_HTML}: ${markup}`,
    );
    assert.equal(
      findChangeReasons({ [script]: { before: [], after: [wrapInTemplate(markup)] } }, reads)
        .length,
      1,
      `${script}: ${markup}`,
    );
  }
  for (const markup of quietStyles) {
    assert.deepEqual(
      findChangeReasons({ [INDEX_HTML]: { before: [], after: [`  ${markup}`] } }, reads),
      [],
      `${INDEX_HTML}: ${markup}`,
    );
    assert.deepEqual(
      findChangeReasons({ [script]: { before: [], after: [wrapInTemplate(markup)] } }, reads),
      [],
      `${script}: ${markup}`,
    );
  }
  assert.deepEqual(
    findChangeReasons({
      [INDEX_HTML]: { before: ['  <div style="position: absolute">'], after: [] },
    }),
    [
      `${INDEX_HTML} takes out an inline style that sets position: absolute: <div style="position: absolute">`,
    ],
  );
  assert.deepEqual(
    findChangeReasons({ [script]: { before: [], after: [wrapInTemplate(redStyles[1])] } }),
    [
      `${script}:1 adds an inline style that sets z-index: 2: ${wrapInTemplate(redStyles[1]).trim()}`,
    ],
  );
  const commented = '<div style="/* lift */ z-index: 2">';
  assert.deepEqual(
    findChangeReasons({ [script]: { before: [], after: [wrapInTemplate(commented)] } }),
    [`${script}:1 adds an inline style that sets z-index: 2: ${wrapInTemplate(commented).trim()}`],
  );
  for (const [markup, setting] of [
    ['<div style="top: ${top}px; position: ${position}">', "position: ${position}"],
    ["<div style=\"position: ${x ? '$&' : ''}\">", "position: ${x ? '$&' : ''}"],
    ['<div style="color: red; /* note">', "color: red; /* note"],
  ])
    assert.deepEqual(
      findChangeReasons({ [script]: { before: [], after: [wrapInTemplate(markup)] } }),
      [`${script}:1 adds an inline style that sets ${setting}: ${wrapInTemplate(markup).trim()}`],
      markup,
    );
  assert.deepEqual(
    findChangeReasons({ [script]: { before: [], after: ['  // <div style="z-index: 2">'] } }),
    [],
    "a comment",
  );
});

/**
 * A diff of `path` whose content its lines don't show, after its header.
 * @param {string} path
 * @param {string[]} lines
 */
const createHiddenDiff = (path, lines) =>
  [
    `diff --git a/${path} b/${path}`,
    ...lines.map((line) => line.replaceAll("<path>", path)),
    "",
  ].join("\n");

test("a page file whose diff hides its content, as a binary one does, is red", () => {
  for (const path of [
    "apps/wnba/page/styles.css",
    "shared/page/sheet.css",
    "shared/page/stamp.js",
    INDEX_HTML,
    "apps/wnba/page/manifest.webmanifest",
  ]) {
    for (const lines of [
      ["index 1111111..2222222 100644", "Binary files a/<path> and b/<path> differ"],
      [
        "old mode 100644",
        "new mode 100755",
        "index 1111111..2222222",
        "Binary files a/<path> and b/<path> differ",
      ],
      ["index 1111111..2222222 100644"],
    ])
      assert.deepEqual(
        findRedReasons(readDiff(createHiddenDiff(path, lines)), () => "", listNoStylesheets),
        [`${path} changes in a way the gate can't read, so it may change anything`],
        `${path}: ${lines.join(" ")}`,
      );
    assert.deepEqual(
      findRedReasons(
        readDiff(createHiddenDiff(path, ["old mode 100644", "new mode 100755"])),
        () => "",
        listNoStylesheets,
      ),
      path.startsWith("shared/page/sheet.css")
        ? [`${path} is shared code that moves, layers, or draws the page`]
        : [],
      `${path}: only its mode`,
    );
  }
});

test("an empty page file created or deleted hides nothing, so it's red only as a shared file that moves the page", () => {
  for (const path of ["shared/page/stamp.js", "apps/wnba/page/extra.css", INDEX_HTML])
    for (const mode of ["new file mode 100644", "deleted file mode 100644"])
      assert.deepEqual(
        findRedReasons(
          readDiff(createHiddenDiff(path, [mode, "index 0000000..e69de29"])),
          () => "",
          listNoStylesheets,
        ),
        [],
        `${path}: ${mode}`,
      );
  assert.deepEqual(
    findRedReasons(
      readDiff(createHiddenDiff(SHARED_STYLESHEET, ["deleted file mode 100644"])),
      () => "",
      listNoStylesheets,
    ),
    [`${SHARED_STYLESHEET} is shared code that moves, layers, or draws the page`],
  );
});

/**
 * Why a change to the WNBA's index.html is red, from one hunk at its first line, with the page as
 * the change leaves it.
 * @param {string[]} lines the hunk's, as a diff shows them
 * @param {string[]} after
 */
const findMarkupHunkReasons = (lines, after) =>
  findRedReasons(
    readDiff(
      [`diff --git a/${INDEX_HTML} b/${INDEX_HTML}`, "@@ -1,2 +1,2 @@", ...lines, ""].join("\n"),
    ),
    () => after.join("\n"),
    listNoStylesheets,
  );

test("a page's markup is red only for the lines a change adds or takes out, not those it keeps", () => {
  const script = '  <script src="shared/slow-load.js"></script>';
  assert.deepEqual(
    findMarkupHunkReasons(
      [` ${script}`, "-  <h2>Standings</h2>", "+  <h2>Table</h2>"],
      [script, "  <h2>Table</h2>"],
    ),
    [],
  );
});

test("a page's markup that the change's hunks don't fit is red", () => {
  assert.deepEqual(
    findMarkupHunkReasons(
      [" <main>", "-  <h2>Standings</h2>", "+  <h2>Table</h2>"],
      ["<body>", "  <h2>Table</h2>"],
    ),
    [`${INDEX_HTML} changes in a way the gate can't read, so it may change anything`],
  );
});

test("a page's markup is red where it changes whether the Home Screen app opens without the browser's bars", () => {
  for (const name of ["apple-mobile-web-app-capable", "mobile-web-app-capable"])
    assert.deepEqual(
      findChangeReasons({
        [INDEX_HTML]: {
          before: [`  <meta name="${name}" content="yes" />`],
          after: [`  <meta name="${name}" content="no" />`],
        },
      }),
      [`${INDEX_HTML} changes how it fits the screen or its bars`],
      name,
    );
});

test("an app's manifest is red where it changes how the Home Screen app opens, or can't be read", () => {
  const manifest = "apps/wnba/page/manifest.webmanifest";
  /** @param {string[]} lines */
  const wrap = (lines) => ["{", ...lines, '  "name": "WNBA"', "}"];
  /** @param {string[]} before @param {string[]} after */
  const findManifestChange = (before, after) =>
    findChangeReasons({ [manifest]: { before: wrap(before), after: wrap(after) } });
  for (const [before, after] of [
    [['  "display": "standalone",'], ['  "display": "browser",']],
    [['  "display": "standalone",'], []],
    [[], ['  "orientation": "portrait",']],
    [[], ['  "display_override": ["fullscreen"],']],
    [['  "scope": "./",'], ['  "scope": "./games/",']],
  ])
    assert.deepEqual(
      findManifestChange(before, after),
      [`${manifest} changes how the Home Screen app opens`],
      `${before.join()} to ${after.join()}`,
    );
  for (const { key, before, after } of [
    { key: "theme_color", before: "#000", after: "#111" },
    { key: "start_url", before: "./", after: "./?from=home" },
  ])
    assert.deepEqual(
      findManifestChange([`  "${key}": "${before}",`], [`  "${key}": "${after}",`]),
      [],
      `${key}, which Safari's Home Screen app doesn't open by`,
    );
  assert.deepEqual(
    findManifestChange(['  "theme_color": "#000",'], ['  "theme_color": "#111"']),
    [`${manifest} changes in a way the gate can't read, so it may change anything`],
    "a manifest that isn't JSON",
  );
  assert.deepEqual(
    findRedReasons(
      readDiff(
        [
          `diff --git a/${manifest} b/${manifest}`,
          "@@ -1,2 +1,2 @@",
          " {",
          '-  "display": "standalone",',
          '+  "display": "browser",',
          "",
        ].join("\n"),
      ),
      () => ["{", '  "name": "WNBA",', '  "display": "browser"', "}"].join("\n"),
      listNoStylesheets,
    ),
    [`${manifest} changes in a way the gate can't read, so it may change anything`],
    "a manifest the change's hunks don't fit",
  );
});

test("the page stylesheets the gate reads beside a change are every page's, and only those", () => {
  const stylesheets = listPageStylesheets();
  assert.ok(stylesheets.includes("shared/page/sheet.css"));
  assert.ok(stylesheets.includes("apps/wnba/page/styles.css"));
  assert.ok(
    stylesheets.every((path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.+\.css$/.test(path)),
  );
});

const GATE = fileURLToPath(new URL("../worker/red-change.mjs", import.meta.url));

/**
 * The gate's command line run on a diff with no labels, as CI's gate job runs it, with what it
 * wrote to its output file.
 * @param {string} diff
 */
function runGate(diff) {
  const folder = mkdtempSync(join(tmpdir(), "gate-"));
  const output = join(folder, "output");
  writeFileSync(output, "");
  try {
    const result = spawnSync(process.execPath, [GATE, "[]"], {
      input: diff,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return { ...result, written: readFileSync(output, "utf8") };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("the gate's command line writes whether the change is held, and passes either way", () => {
  const red = runGate(createDiff("apps/wnba/page/js/new-view.js", ["  part.style.zIndex = 5;"]));
  assert.equal(red.status, 0);
  assert.equal(red.written, "held=true\n");
  assert.match(red.stdout, /^::notice::A red change/);
  const plain = runGate(createDiff("README.md", ["More words."]));
  assert.equal(plain.status, 0);
  assert.equal(plain.written, "held=false\n");
  assert.equal(plain.stdout, "Not a red change.\n");
});

test("a diff the gate can't read is red", () => {
  for (const diff of [
    'diff --git "a/apps/wnba/page/odd name.css" "b/apps/wnba/page/odd name.css"\n',
    "not a diff at all\n",
  ]) {
    const { isHeld, message } = decideGate(diff, { labels: [] });
    assert.equal(isHeld, true, diff);
    assert.match(message, /The gate can't read the diff, so it may change anything/);
  }
  assert.equal(decideGate("", { labels: [] }).isHeld, false);
});

test("an added line that makes a layer is red in any page's JavaScript", () => {
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
    "  translate: 0 var(--game-side-offset);",
    "  rotate: 45deg;",
    "  scale: 1.2;",
    "  perspective: 800px;",
    "  perspective-origin: center;",
    "  backface-visibility: hidden;",
    "  -webkit-backface-visibility: hidden;",
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
    '  const style = html`<div style="scale: 2"></div>`;',
    "  part.style.translate = offset > 0 ? `0 ${offset}px` : '';",
    "  element.style.rotate = '45deg';",
    "  element.style.scale = '1.1';",
    "  element.style.perspective = '800px';",
    "  element.style.backfaceVisibility = 'hidden';",
    "  element.style.webkitBackfaceVisibility = 'hidden';",
    '  element.style.setProperty("translate", value);',
    "  root.style.setProperty(`--${name}`, value);",
    "  const sheet = html`<dialog open>${body}</dialog>`;",
    "  const tip = html`<div popover>${words}</div>`;",
    '  const dot = html`<span style="${style}"></span>`;',
    "  const rules = html`<style>${css}</style>`;",
    '  const loader = html`<script src="${file}"></script>`;',
  ];
  for (const path of ["shared/page/stamp.js", "apps/mlb/page/js/games-view.js"])
    for (const line of layerLines)
      assert.equal(findReasons(path, [line]).length, 1, `${path}: ${line}`);
});

// As shared/page/strip-slide.js places its lens, with the call above what a hunk shows of it.
const STYLE_SCRIPT = [
  "function placeLens({ lens, left, width }) {",
  "  Object.assign(lens.style, {",
  "    left: `${left}px`,",
  "    top: `${top}px`,",
  "    width: `${width}px`,",
  "    height: `${height}px`,",
  "    scale: 0.98,",
  '    "will-change": "transform",',
  "    willChange: 'transform',",
  "    // scale: 0.98,",
  "  });",
  "  const steps = { scale: 0.98, rotate: 2 };",
  "}",
].join("\n");

test("a key of the object Object.assign hands a part's style sets that style, a number too, wherever the call sits", () => {
  const path = "shared/page/strip-slide-lens.js";
  /** @param {number} number */
  const findLineReasons = (number) =>
    findRedReasons(
      [
        {
          path,
          addedLines: [{ number, text: STYLE_SCRIPT.split("\n")[number - 1] }],
          hunks: [],
          hunkStarts: [],
        },
      ],
      (read) => (read === path ? STYLE_SCRIPT : ""),
    );
  assert.deepEqual(findLineReasons(7), [
    `${path}:7 adds a style property that sets scale: scale: 0.98,`,
  ]);
  assert.equal(findLineReasons(8).length, 1, "a style's quoted name");
  assert.equal(findLineReasons(9).length, 1, "a style's camelCase name");
  for (const quiet of [3, 6, 10, 12])
    assert.deepEqual(findLineReasons(quiet), [], STYLE_SCRIPT.split("\n")[quiet - 1]);
});

test("the lines of each object Object.assign hands a part's style are found, and no others", () => {
  assert.deepEqual([...findStyleObjectLines(STYLE_SCRIPT)], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual([...findStyleObjectLines("Object.assign(session, { scale: 1 });")], []);
  assert.deepEqual(
    [...findStyleObjectLines("Object.assign(style, {\n  zIndex: 5,\n});")],
    [1, 2, 3],
  );
  assert.deepEqual([...findStyleObjectLines("Object.assign(mystyle, { scale: 1 });")], []);
  for (const comment of ["// don't lift it", "/* don't lift it */"]) {
    const commented = [
      "Object.assign(tip.style, {",
      `  ${comment}`,
      "  content: '}',",
      "  zIndex: 5,",
      "});",
      "const after = { offset: 1 };",
    ].join("\n");
    assert.deepEqual([...findStyleObjectLines(commented)], [1, 2, 3, 4, 5], comment);
  }
  for (const comment of ["/* open", "// open"])
    assert.deepEqual(
      [...findStyleObjectLines(`Object.assign(tip.style, {\n  zIndex: 5, ${comment}`)],
      [1, 2],
      comment,
    );
});

// As a page pulses a part, with the call above what a hunk shows of its keyframes.
const KEYFRAMES_SCRIPT = [
  "function pulse(date) {",
  "  date.animate(",
  "    [",
  "      { scale: 1 },",
  "      { scale: 1.1, offset: 0.4 },",
  "      { scale: 1 },",
  "    ],",
  "    { duration: 300, easing: 'ease-out' },",
  "  );",
  "}",
  "const SHRINK = [",
  "  { scale: 0.9 },",
  "  { opacity: 0.6, offset: 0.4, easing: 'ease-in' },",
  "  { cssOffset: \"path('M 0 0 L 10 10')\" },",
  "];",
  "const shrink = (part) => part.animate(SHRINK, { duration: 200 });",
  "const sizes = [{ scale: 2 }];",
].join("\n");

test("a key of the keyframes a part's animate takes sets that style, a number too, inline or by name", () => {
  const path = "apps/wnba/page/js/games-view.js";
  /** @param {number} number */
  const findLineReasons = (number) =>
    findRedReasons(
      [
        {
          path,
          addedLines: [{ number, text: KEYFRAMES_SCRIPT.split("\n")[number - 1] }],
          hunks: [],
          hunkStarts: [],
        },
      ],
      (read) => (read === path ? KEYFRAMES_SCRIPT : ""),
    );
  assert.deepEqual(findLineReasons(5), [
    `${path}:5 adds a style property that sets scale: { scale: 1.1, offset: 0.4 },`,
  ]);
  assert.equal(findLineReasons(12).length, 1, "a keyframe of a named list");
  assert.deepEqual(findLineReasons(14), [
    `${path}:14 adds a style property that sets offset: { cssOffset: "path('M 0 0 L 10 10')" },`,
  ]);
  for (const quiet of [8, 13, 17])
    assert.deepEqual(findLineReasons(quiet), [], KEYFRAMES_SCRIPT.split("\n")[quiet - 1]);
  assert.deepEqual([...findKeyframeLines(KEYFRAMES_SCRIPT)], [3, 4, 5, 6, 7, 11, 12, 13, 14, 15]);
  assert.deepEqual([...findStyleObjectLines(KEYFRAMES_SCRIPT)], []);
});

test("a page's script lines that only read or name those properties aren't red", () => {
  const quietLines = [
    "  const live = games.filter((game) => game.isLive);",
    "  if (list.contains(target)) return;",
    "  item.transformed = true;",
    '  { name: "ABC", file: "abc.png", names: [], scale: 1.22, nudge: 0.02 },',
    "    scale: 0.99,",
    "  const scale = size / (Math.max(...xs) - Math.min(...xs));",
    "  const translated = translate(text);",
    "  position: relative;",
    "  position: absolute;",
    '  const isFixed = element.style.position === "fixed";',
    "  // A transform: here would make a layer.",
    "   * transition: none, so the sheet doesn't slide.",
    "  color: var(--now);",
  ];
  for (const line of quietLines)
    assert.deepEqual(findReasons("apps/wnba/page/js/games-view.js", [line]), [], line);
});

test("a page's script that sets a part's style is red where a page's stylesheet would be, however it sets it", () => {
  const path = "apps/wnba/page/js/games-view.js";
  for (const line of [
    "  part.style.zIndex = 5;",
    '  part.style.touchAction = "none";',
    '  part.style.position = "absolute";',
    '  part.style.position = isFloating ? "absolute" : "";',
    '  part.style.position = "relative" + placeSuffix;',
    '  part.style.overflowY = "auto";',
    '  part.style.webkitUserSelect = "none";',
    '  part.style.scrollPaddingTop = "64px";',
    '  part.style.zoom = "1.1";',
    '  part.style.setProperty("overflow", "auto");',
    "  part.style.setProperty('pointer-events', 'none');",
    '  part.style.setProperty("-webkit-touch-callout", "none");',
    '  part.style.cssText = "color: red; z-index: 2";',
    "  part.style.cssText += `position: ${position}`;",
    "  part.style.cssText = styles;",
    "  style.zIndex = 5;",
    '  style.touchAction = "none";',
    '  style.position = "absolute";',
    "  part.style.zIndex ||= 5;",
    "  style[key] = value;",
    '  part.style.removeProperty("z-index");',
    "  style.removeProperty(property);",
    '  part.removeAttribute("style");',
    '  part.style.cssText = "/**/z-index: 2";',
    '  part.style.cssText = "transition: color 0.2s, translate 0.2s";',
    '  sheet.insertRule(".tip { transition: color 0.2s, transform 0.2s }");',
    '  sheet.insertRule(".tip { transition: " + eased + " }");',
    '  sheet.insertRule(".tip { transition: color 0.2s" + eased + " }");',
    '  const MOTION = "transition: color 0.2s,"',
    '  const MOTION = "transition: color 0.2s".concat(", ", eased);',
    '  part.style.transition = "";',
    '  const MOTION = { transition: "transform 0.2s" };',
    '  part.style.cssText = "transition: color 0.2s, " + eased;',
    '  part.style.cssText = "transition: color 0.2s" + eased;',
    "    transition: color 0.2s,",
    "    transition: color 0.2s",
    "    transition:",
    '  part.style.position = "f\\69xed";',
    '  part.style.setProperty("position", "\\66ixed");',
    '  part.style.cssText = `color: ${a ? "{" : "b"}; z-index: 2`;',
    '  part.style.cssText = `color: ${a ? "}" : "b"}; z-index: 2`;',
    '  part.style.setProperty("\\u007a-index", "2");',
    '  part.style.cssText = "";',
    '  part.style = "";',
    '  part.setAttribute("style", "");',
    '  part.style.removeProperty("color"), part.style.removeProperty("z-index");',
    '  a.setAttribute("style", "color: red"), b.setAttribute("style", "z-index: 2");',
    '  a.style = "color: red", b.style = "z-index: 2";',
    '  part.style = "z-index: 2";',
    '  part.setAttribute("style", "z-index: 2");',
    "  part.setAttribute('style', `position: ${place}`);",
    "  part.style.setProperty(property, value);",
    "  part.style[key] = value;",
    '  const sheet = document.createElement("dialog");',
    "  const rules = document.createElement('style');",
    "  const loader = document.createElement(`script`);",
  ])
    assert.equal(findReasons(path, [line]).length, 1, line);
  assert.deepEqual(
    findReasons(path, ["  const style = part.style;", "  style.zIndex = 5;"]),
    [`${path}:2 adds a style property that sets z-index: style.zIndex = 5;`],
    "a style a script holds by another name",
  );
  assert.deepEqual(findReasons(path, ["  part.style[key] = value;"]), [
    `${path}:1 adds a style property whose name the gate can't read: part.style[key] = value;`,
  ]);
  for (const line of [
    '  part.style.position = "relative";',
    '  part.style.overflow = "visible";',
    '  part.style.opacity = "0";',
    '  part.style.display = "none";',
    "  part.style.left = `${left}px`;",
    '  part.style.setProperty("overflow", "visible");',
    '  part.style.setProperty("color", ink);',
    '  part.style.cssText = "color: red";',
    '  part.style.cssText = "transition: background-color 0.15s";',
    '  const MOTION = "transition: color 0.2s";',
    '  sheet.insertRule(".tip { transition: color 0.2s }");',
    '  part.style.transition = "color 0.2s";',
    '  part.setAttribute("style", "transition: color 0.2s, box-shadow 0.2s");',
    '  if (part.style.zIndex === "2") return;',
    '  part.style = "color: red";',
    '  part.setAttribute("style", "color: red");',
    '  part.setAttribute("class", "z-index-2");',
    "  const value = part.style[key];",
    "  if (part.style.zIndex >= 2) return;",
    '  const cell = document.createElement("div");',
    "  item.position = 3;",
    "  item.position = index;",
    '  holder.position = "fixed";',
    "  this.container = root;",
    "  drag.offsetX = event.clientX;",
    "  view.zoom = 2;",
    '  options.style = "percent";',
    '  part.style.removeProperty("color");',
    '  part.removeAttribute("class");',
  ])
    assert.deepEqual(findReasons(path, [line]), [], line);
  assert.deepEqual(findReasons(path, ["  part.style.zIndex = 5;"]), [
    `${path}:1 adds a style property that sets z-index: part.style.zIndex = 5;`,
  ]);
  for (const line of ['  part.removeAttribute("style");', '  part.style.cssText = "";'])
    assert.deepEqual(findReasons(path, [line]), [
      `${path}:1 adds a style that clears every property: ${line.trim()}`,
    ]);
  for (const line of [
    '  part.style.cssText = "/* note */ color: red";',
    "  part.style.cssText = `color: ${isOn && ink}`;",
    '  part.style.cssText = "background: url(a?x=1&y=2)";',
    '  part.setAttribute("style", "background: url(a?x=1&y=2)");',
  ])
    assert.deepEqual(findReasons(path, [line]), [], line);
  assert.deepEqual(
    findReasons(path, ['  options.style = "";']),
    [`${path}:1 adds a style that clears every property: options.style = "";`],
    "a style emptied on what may not be a part's is held, since part.style = '' clears one",
  );
  assert.deepEqual(findReasons(path, ["  part.style.left = part.style.zIndex = 5;"]), [
    `${path}:1 adds a style property that sets z-index: part.style.left = part.style.zIndex = 5;`,
  ]);
});

test("a key of a style's object is red where a page's stylesheet would be", () => {
  const path = "apps/wnba/page/js/tip.js";
  const script = [
    "Object.assign(tip.style, {",
    '  pointerEvents: "none",',
    '  position: "absolute",',
    '  "z-index": 3,',
    '  position: "relative",',
    "  left: `${left}px`,",
    "  opacity: 0,",
    "  offset: \"path('M 0 0')\",",
    "});",
  ];
  const reasons = findRedReasons(
    [
      {
        path,
        addedLines: script.map((text, index) => ({ number: index + 1, text })),
        hunks: [],
        hunkStarts: [],
      },
    ],
    () => script.join("\n"),
    listNoStylesheets,
  );
  assert.deepEqual(reasons, [
    `${path}:2 adds a style property that sets pointer-events: pointerEvents: "none",`,
    `${path}:3 adds a style property that sets position: position: "absolute",`,
    `${path}:4 adds a style property that sets z-index: "z-index": 3,`,
    `${path}:8 adds a style property that sets offset: offset: "path('M 0 0')",`,
  ]);
});

test("a page's script that sets a custom property is red only where a stack declaration reads it, or its name can't be read", () => {
  const reads = {
    "shared/page/chrome.css": [".a { transform: var(--lift); translate: var(--slideX); }"],
  };
  const path = "apps/wnba/page/js/games-view.js";
  for (const [line, count] of /** @type {[string, number][]} */ ([
    ['  root.style.setProperty("--lift", lift);', 1],
    ["  root.style.setProperty(`--${name}`, value);", 1],
    ['  root.style.setProperty("--team", color);', 0],
  ]))
    assert.equal(
      findChangeReasons({ [path]: { before: [], after: [line] } }, reads).length,
      count,
      line,
    );
  const pulse = [
    "const PULSE = [",
    "  { scale: 1 },",
    "];",
    "part.animate(PULSE, { duration: 200 });",
  ];
  for (const [key, count] of /** @type {[string, number][]} */ ([
    ['  { "--lift": "translateZ(0)" },', 1],
    ['  { "--slideX": "10px" },', 1],
    ['  { "--team": "red" },', 0],
  ]))
    assert.equal(
      findChangeReasons(
        { [path]: { before: pulse, after: [...pulse.slice(0, 2), key, ...pulse.slice(2)] } },
        reads,
      ).length,
      count,
      `a keyframe: ${key}`,
    );
  assert.deepEqual(
    findChangeReasons(
      {
        [path]: { before: [], after: ["Object.assign(part.style, {", '  "--lift": lift,', "});"] },
      },
      reads,
    ),
    [],
    "a style's object sets no custom property, which only setProperty sets",
  );
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
  createDiff("apps/wnba/page/js/games-view.js", ["  part.style.willChange = 'transform';"]);

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
    /apps\/wnba\/page\/js\/games-view\.js:10 adds a style property that sets will-change/,
  );
  assert.match(held.message, /git push -f origin <branch>:beta/);
  assert.match(held.message, /owner adds the phone-ok label after using it on the beta app/);

  const labeled = decideGate(diff, {
    labels: ["phone-ok"],
    labeling: { labeler: "owner", isAfterLastPush: true },
    owner: "owner",
  });
  assert.equal(labeled.isHeld, false);
  assert.match(labeled.message, /labeled phone-ok/);
});

test("a red change labeled phone-ok by anyone but the owner is held, and says the label has to come from the owner", () => {
  /** @param {string | null} labeler @param {string} owner */
  const decideLabeledBy = (labeler, owner) =>
    decideGate(RED_DIFF, {
      labels: ["phone-ok"],
      labeling: { labeler, isAfterLastPush: true },
      owner,
    });
  const held = decideLabeledBy("helper", "owner");
  assert.equal(held.isHeld, true);
  assert.match(held.message, /labeled phone-ok by helper/);
  assert.match(held.message, /has to come from the repository's owner, owner/);

  assert.equal(decideLabeledBy(null, "owner").isHeld, true);
  assert.equal(decideLabeledBy("", "").isHeld, true);
  assert.equal(decideGate(RED_DIFF, { labels: ["phone-ok"], owner: "owner" }).isHeld, true);
});

test("a red change the owner labeled phone-ok before its last push is held until they label it again", () => {
  const held = decideGate(RED_DIFF, {
    labels: ["phone-ok"],
    labeling: { labeler: "owner", isAfterLastPush: false },
    owner: "owner",
  });
  assert.equal(held.isHeld, true);
  assert.match(held.message, /labeled phone-ok before its last push/);
  assert.match(held.message, /git push -f origin <branch>:beta/);
  assert.match(held.message, /takes the label off and adds it again/);
});

const HEAD_PUSHED_AT = Date.parse("2026-10-07T09:00:00Z");

test("the phone-ok label's adder is whoever added it last, whatever else was labeled", () => {
  const events = [
    createEvent("labeled", "phone-ok", "owner", "2026-10-07T10:00:00Z"),
    createEvent("unlabeled", "phone-ok", "owner", "2026-10-07T11:00:00Z"),
    createEvent("labeled", "phone-ok", "helper", "2026-10-07T12:00:00Z"),
    createEvent("labeled", "bug", "owner", "2026-10-07T13:00:00Z"),
  ];
  assert.deepEqual(findLabeling(events, "phone-ok", HEAD_PUSHED_AT), {
    labeler: "helper",
    isAfterLastPush: true,
  });
  assert.deepEqual(findLabeling(events.toReversed(), "phone-ok", HEAD_PUSHED_AT), {
    labeler: "helper",
    isAfterLastPush: true,
  });
  assert.deepEqual(findLabeling(events.slice(3), "phone-ok", HEAD_PUSHED_AT), {
    labeler: null,
    isAfterLastPush: false,
  });
});

test("a head pushed after the phone-ok label leaves it before the last push, whatever its commit's date says", () => {
  const labeled = createEvent("labeled", "phone-ok", "owner", "2026-10-07T10:00:00Z");
  // Committed before the label, so the timeline dates it then, but pushed after it.
  const committedEarlier = { event: "committed", committer: { date: "2026-10-07T09:30:00Z" } };
  assert.deepEqual(
    findLabeling([committedEarlier, labeled], "phone-ok", Date.parse("2026-10-07T11:00:00Z")),
    { labeler: "owner", isAfterLastPush: false },
  );
  const forcePush = {
    event: "head_ref_force_pushed",
    created_at: "2026-10-07T11:00:00Z",
    actor: { login: "owner" },
  };
  assert.equal(
    findLabeling([labeled, forcePush], "phone-ok", HEAD_PUSHED_AT).isAfterLastPush,
    false,
    "a force push back to a commit GitHub saw before the label",
  );
  const labeledAgain = createEvent("labeled", "phone-ok", "owner", "2026-10-07T12:00:00Z");
  assert.equal(
    findLabeling([labeled, forcePush, labeledAgain], "phone-ok", HEAD_PUSHED_AT).isAfterLastPush,
    true,
  );
  assert.equal(
    findLabeling([labeled], "phone-ok", Number.NaN).isAfterLastPush,
    false,
    "a head GitHub can't date may be the last push",
  );
});

test("a head's push time is its earliest check suite's", async () => {
  /** @type {string[]} */
  const urls = [];
  /** @param {{ created_at: string }[]} suites */
  const createFetch = (suites) => async (/** @type {string} */ url) => {
    urls.push(url);
    return Response.json({ total_count: suites.length, check_suites: suites });
  };
  const sha = "a".repeat(40);
  const options = { repository: "owner/repo", sha, env: { GH_TOKEN: "token" } };
  assert.equal(
    await readPushTime({
      ...options,
      fetchImpl: createFetch([
        { created_at: "2026-10-07T11:00:00Z" },
        { created_at: "2026-10-07T09:00:00Z" },
      ]),
    }),
    HEAD_PUSHED_AT,
  );
  assert.deepEqual(urls, [
    `https://api.github.com/repos/owner/repo/commits/${sha}/check-suites?per_page=100`,
  ]);
  assert.ok(Number.isNaN(await readPushTime({ ...options, fetchImpl: createFetch([]) })));
});

test("a pull request's timeline is read page by page, with the token, until a short page", async () => {
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

  const events = await readTimeline({
    repository: "owner/repo",
    pullNumber: "408",
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });

  assert.equal(events.length, 101);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://api.github.com/repos/owner/repo/issues/408/timeline?per_page=100&page=1",
      "https://api.github.com/repos/owner/repo/issues/408/timeline?per_page=100&page=2",
    ],
  );
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer token"));
});

test("a timeline GitHub won't give fails the gate's read", async () => {
  /** @type {typeof fetch} */
  const fetchImpl = async () => new Response("", { status: 403 });
  await assert.rejects(
    readTimeline({
      repository: "owner/repo",
      pullNumber: "408",
      fetchImpl,
      env: { GH_TOKEN: "token" },
    }),
    /GitHub answered 403 for GET \/issues\/408\/timeline/,
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
  assert.match(workflow, /\n {2}check:\n {4}if: always\(\)\n {4}needs:\s*\[[^\]]*\bgate\b/);
  assert.match(
    workflow,
    /github\.event_name == 'pull_request' && needs\.gate\.result != 'success'/,
  );
  assert.match(
    workflow,
    /gate:[\s\S]*?pull-requests: read\n.*\n\s+issues: read\n\s+checks: read[\s\S]*?PR: \$\{\{ github\.event\.pull_request\.number \}\}\n\s+HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
  );
});
