import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideGate,
  findLabeling,
  findRedReasons,
  findStyleObjectLines,
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
  );

/** @param {string} diff */
const findDiffReasons = (diff) => findRedReasons(readDiff(diff), readPlainScript);

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
    "  pointer-events: none;",
    "  translate: 0 -1px;",
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
  for (const quiet of [8, 15])
    assert.deepEqual(findLineReasons(quiet), [], KEYFRAMES_SCRIPT.split("\n")[quiet - 1]);
  assert.deepEqual([...findStyleObjectLines(KEYFRAMES_SCRIPT)], [3, 4, 5, 6, 7, 11, 12, 13]);
});

test("lines that only read or name those properties aren't red", () => {
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
    /git diff --no-renames HEAD\^1 HEAD \| node worker\/red-change\.mjs "\$LABELS"/,
  );
  assert.match(
    workflow,
    /gate:[\s\S]*?pull-requests: read\n.*\n\s+issues: read\n\s+checks: read[\s\S]*?PR: \$\{\{ github\.event\.pull_request\.number \}\}\n\s+HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
  );
});
