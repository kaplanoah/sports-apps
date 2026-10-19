// Says whether a pull request is a red change: one whose bugs no CI browser would show, since none
// touches, scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong
// before. That's a change to the code of the shared JavaScript that moves and draws the page,
// beyond its comments, formatting, and imports and the code it moves unchanged among those scripts
// and the shared ones they import; a change to what its shared stylesheets' rules set, selector by
// selector, in what decides how parts layer, stack, scroll, and show; and anything else a page
// adds that draws a part on a layer of its own or, in its CSS, lifts it over others or makes it
// scroll. A red change merges only once the owner has used it on the beta app and labeled it
// phone-ok. Anyone who can label a pull request could add the label, so the gate reads who last
// added it and lets the change through only from the repository's owner, and only when the label
// came after the pull request's head commit reached GitHub, which the owner hasn't used on the
// phone otherwise.
// Usage: git diff --no-renames <base> | node worker/red-change.mjs '<labels as JSON>'
// with PR, HEAD_SHA, GH_TOKEN, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_OWNER set, as Actions sets
// the last two. The diff ends at the files on disk, as CI's `<base> HEAD` in a clean checkout
// does, since a changed file before the change is rebuilt from the file and the hunks.
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { createGitHub, readAllPages } from "./github-api.mjs";

export const PHONE_OK_LABEL = "phone-ok";

const RED_FILES = new Set(
  [
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
  ].map((file) => `shared/page/${file}`),
);

const LAYER_PROPERTIES = [
  "transform",
  "translate",
  "rotate",
  "scale",
  "perspective",
  "backface-visibility",
  "filter",
  "backdrop-filter",
  "mask",
  "mask-image",
  "clip-path",
  "will-change",
  "animation",
  "transition",
  "contain",
  "content-visibility",
];

const toCamelCase = (property) =>
  property.replace(/-([a-z])/g, (_dash, letter) => letter.toUpperCase());
const PROPERTY_NAMES = LAYER_PROPERTIES.join("|");
// After a prefix, as in webkitBackdropFilter, a style property's name starts with a capital.
const CAMEL_PROPERTY_NAMES = LAYER_PROPERTIES.map(toCamelCase)
  .flatMap((name) => [name, name[0].toUpperCase() + name.slice(1)])
  .join("|");

// A property's longhands set it too, as transition-duration and -webkit-mask-image do. A number an
// object keys by one of their names, as in { scale: 1.2 }, sets no style, since Prettier ends each
// of a stylesheet's declarations with a semicolon, unless the object is a style's or an
// animation's keyframes, which findStyleObjectLines finds.
const LAYER_SETTINGS = [
  {
    name: "a CSS declaration",
    pattern: new RegExp(
      `(?:^|[\\s{;"'\`])(?:-webkit-)?(${PROPERTY_NAMES})(?:-[a-z]+)*\\s*:(?!:)(?!\\s*-?[\\d.]+\\s*(?:[,}]|$))`,
    ),
  },
  {
    name: "a style property",
    pattern: new RegExp(`\\.(?:webkit|Webkit)?(${CAMEL_PROPERTY_NAMES})(?:[A-Z][a-z]+)*\\s*=(?!=)`),
  },
  {
    name: "a style property",
    pattern: new RegExp(`setProperty\\(\\s*["'](?:-webkit-)?(${PROPERTY_NAMES})\\b`),
  },
  { name: "an animation", pattern: /\.(animate)\(/ },
  { name: "a fixed or sticky position", pattern: /\b(position\s*:\s*(?:fixed|sticky))\b/ },
  {
    name: "a fixed or sticky position",
    pattern: /\b(position\s*=\s*["'`](?:fixed|sticky))\b/,
  },
  {
    name: "a fixed or sticky position",
    pattern: /(setProperty\(\s*["']position["']\s*,\s*["'`](?:fixed|sticky))\b/,
  },
];

// Each key sets a style, a number too, in the object Object.assign(<part>.style, { ... }) hands a
// part's style, and in the keyframes <part>.animate([ ... ]) or <part>.animate({ ... }) takes.
const STYLE_OBJECTS = [/Object\.assign\(\s*[\w$.]+\.style\s*,\s*\{/g, /\.animate\(\s*[[{]/g];
// The keyframes <part>.animate(<name>, ...) takes, from where the script names them.
const KEYFRAMES_NAME = /\.animate\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
const STYLE_KEY = new RegExp(
  `(?:^|[\\s{,])["']?(?:-webkit-|webkit|Webkit)?(${PROPERTY_NAMES}|${CAMEL_PROPERTY_NAMES})(?:-[a-z]+|[A-Z][a-z]+)*["']?\\s*:`,
);

// Beside the layers, what in the shared stylesheets decides how iOS stacks, scrolls, and shows
// the page's parts: where a part sits over others, what scrolls and takes a touch, and whether a
// part draws at all. Their fonts, colors, spacing, and sizes CI checks as an iPhone shows them.
const STACK_PROPERTIES = [
  ...LAYER_PROPERTIES,
  "position",
  "overflow",
  "overscroll-behavior",
  "scroll-snap",
  "touch-action",
  "pointer-events",
  "z-index",
  "opacity",
  "visibility",
  "display",
  "isolation",
  "mix-blend-mode",
];

// What a transition's list holds beside the property it eases: its times, its easing, and how it
// treats a property that can't ease.
const TRANSITION_TIMING =
  /^(?:-?[\d.]+m?s|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$|\(/i;

// The transform functions, and the most values each transform property holds, that stay in two
// dimensions, which WebKit paints with the rest of the page unless something moves them.
const FLAT_TRANSFORM_FUNCTION = /^(?:translate[xy]?|rotate|scale[xy]?)\(/i;
const FLAT_TRANSFORM_VALUES = new Map([
  ["translate", 2],
  ["rotate", 1],
  ["scale", 2],
]);

// Tests live outside every page's folder, so they're never red.
const isPageCode = (path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.+\.(?:css|js)$/.test(path);
const isSharedScript = (path) => /^shared\/page\/.+\.js$/.test(path);
const isComment = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

/** @typedef {{ number: number, text: string }} AddedLine */
/** @typedef {{ kind: "kept" | "added" | "removed", text: string }} HunkLine */
/**
 * @typedef {object} ChangedFile
 * @property {string} path
 * @property {AddedLine[]} addedLines
 * @property {HunkLine[][]} hunks
 * @property {number[]} hunkStarts the line, from 1, each hunk starts at in the new file
 */
/** @typedef {(path: string) => string} ReadPageFile a page's file as the change leaves it */

/**
 * The files a unified diff changes, each with the lines it adds, numbered as the new file has
 * them, and each of its hunks, with where it starts. A file moved or deleted is listed under each
 * path it had.
 * @param {string} diff
 * @returns {ChangedFile[]}
 */
export function readDiff(diff) {
  /** @type {ChangedFile[]} */
  const files = [];
  /** @type {ChangedFile | null} */
  let current = null;
  /** @type {HunkLine[] | null} */
  let hunk = null;
  let lineNumber = 0;
  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      const [, oldPath, newPath] = header;
      current = { path: newPath, addedLines: [], hunks: [], hunkStarts: [] };
      hunk = null;
      files.push(current);
      if (oldPath !== newPath)
        files.push({ path: oldPath, addedLines: [], hunks: [], hunkStarts: [] });
      continue;
    }
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader && current) {
      lineNumber = Number(hunkHeader[1]);
      hunk = [];
      current.hunks.push(hunk);
      // A hunk that leaves no line in the new file names the line before it.
      current.hunkStarts.push(hunkHeader[2] === "0" ? lineNumber + 1 : lineNumber);
      continue;
    }
    if (!current || !hunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      current.addedLines.push({ number: lineNumber, text: line.slice(1) });
      hunk.push({ kind: "added", text: line.slice(1) });
      lineNumber += 1;
    } else if (line.startsWith("-")) {
      hunk.push({ kind: "removed", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      hunk.push({ kind: "kept", text: line.slice(1) });
      lineNumber += 1;
    }
  }
  return files;
}

/**
 * A file as it was before a change, from the file as the change leaves it and the change's hunks,
 * or null when the hunks don't fit the file.
 * @param {string} after
 * @param {ChangedFile} file
 */
function readFileBefore(after, { hunks, hunkStarts }) {
  const afterLines = after.split("\n");
  /** @type {string[]} */
  const before = [];
  let next = 0;
  for (const [index, hunk] of hunks.entries()) {
    const start = hunkStarts[index] - 1;
    before.push(...afterLines.slice(next, start));
    next = start;
    for (const { kind, text } of hunk) {
      if (kind !== "added") before.push(text);
      if (kind === "removed") continue;
      if (afterLines[next] !== text) return null;
      next += 1;
    }
  }
  return [...before, ...afterLines.slice(next)].join("\n");
}

/**
 * A changed file as it was before the change and as the change leaves it, or null when the
 * change's hunks don't fit it.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function readBothSides(file, readPageFile) {
  const after = readPageFile(file.path);
  const before = readFileBefore(after, file);
  return before === null ? null : { before, after };
}

/**
 * The items of `items` that `taken` doesn't account for, each item of `taken` taking one copy
 * away.
 * @param {string[]} items
 * @param {string[]} taken
 */
function subtractEach(items, taken) {
  const counts = new Map();
  for (const item of taken) counts.set(item, (counts.get(item) ?? 0) + 1);
  return items.filter((item) => {
    const count = counts.get(item) ?? 0;
    counts.set(item, count - 1);
    return count <= 0;
  });
}

/**
 * The indexes of each of `marks` in CSS that lie outside its strings and parentheses.
 * @param {string} text
 * @param {string} marks
 */
function findTopLevelMarks(text, marks) {
  const found = [];
  let quote = "";
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0 && marks.includes(character)) found.push(at);
  }
  return found;
}

/**
 * CSS cut at each `separator` outside its strings and parentheses, with each part trimmed and the
 * empty ones left out.
 * @param {string} text
 * @param {string} separator
 */
function splitTopLevel(text, separator) {
  const ends = [...findTopLevelMarks(text, separator), text.length];
  return ends
    .map((end, index) => text.slice(index ? ends[index - 1] + 1 : 0, end).trim())
    .filter(Boolean);
}

/** @typedef {{ property: string, value: string }} Declaration */
/**
 * @typedef {object} StyleRule
 * @property {string[]} reaches each selector the rule reaches, after the at-rules around it
 * @property {Declaration[]} declarations
 * @property {boolean} isKeyframe whether it's a step of an animation's keyframes
 */

/** @param {string} text */
function readDeclaration(text) {
  const [property, ...value] = text.split(":");
  return { property: property.trim().toLowerCase(), value: value.join(":").trim() };
}

/**
 * @param {string[]} context the at-rules and selectors around the rule, from the outside in
 * @param {Declaration[]} declarations
 * @returns {StyleRule}
 */
function createStyleRule(context, declarations) {
  const prelude = context.at(-1) ?? "";
  const around = context.slice(0, -1);
  const selectors = prelude.startsWith("@") ? [prelude] : splitTopLevel(prelude, ",");
  return {
    reaches: selectors.map((selector) => [...around, selector].join(" ")),
    declarations,
    isKeyframe: around.some((rule) => /^@(?:-webkit-)?keyframes\b/i.test(rule)),
  };
}

/**
 * A stylesheet's rules as esbuild reads it, without its comments and formatting, or null when
 * esbuild can't.
 * @param {string} sheet
 */
function readStyleRules(sheet) {
  let code;
  try {
    code = transformSync(sheet, {
      loader: "css",
      legalComments: "none",
      minifyWhitespace: true,
    }).code;
  } catch {
    return null;
  }
  /** @type {StyleRule[]} */
  const rules = [];
  /** @type {string[]} */
  const context = [];
  /** @type {Declaration[][]} */
  const openBlocks = [[]];
  let start = 0;
  for (const at of findTopLevelMarks(code, "{;}")) {
    const text = code.slice(start, at).trim();
    start = at + 1;
    if (code[at] === "{") {
      context.push(text);
      openBlocks.push([]);
      continue;
    }
    const declarations = /** @type {Declaration[]} */ (openBlocks.at(-1));
    if (text) declarations.push(readDeclaration(text));
    if (code[at] !== "}") continue;
    if (declarations.length) rules.push(createStyleRule(context, declarations));
    context.pop();
    openBlocks.pop();
  }
  return rules;
}

/** @param {string} property */
const readBareName = (property) => property.replace(/^-webkit-/, "");

/**
 * Whether a property is one of `families` or one of their longhands, as overflow-x is overflow's,
 * with or without the -webkit- prefix.
 * @param {string} property
 * @param {string[]} families
 */
function isInFamily(property, families) {
  const name = readBareName(property);
  return families.some((family) => name === family || name.startsWith(`${family}-`));
}

/** @param {Declaration} declaration */
const readValue = ({ value }) => value.replace(/\s*!important$/i, "");

/**
 * The property an item of a transition's list eases, or all of them when it names none.
 * @param {string} item
 */
const readTransitionedProperty = (item) =>
  splitTopLevel(item, " ").find((part) => !TRANSITION_TIMING.test(part)) ?? "all";

/**
 * The properties a rule's transitions ease, which are all of them when it times a transition
 * without naming what it eases.
 * @param {Declaration[]} declarations
 */
function listTransitioned(declarations) {
  const named = declarations.flatMap(({ property, value }) => {
    const name = readBareName(property);
    if (name === "transition") return splitTopLevel(value, ",").map(readTransitionedProperty);
    return name === "transition-property" ? splitTopLevel(value, ",") : [];
  });
  const isTimed = declarations.some(({ property }) => isInFamily(property, ["transition"]));
  return named.length || !isTimed ? named : ["all"];
}

/**
 * Whether a rule's transitions move, fade, or show a part, rather than only recolor it.
 * @param {Declaration[]} declarations
 */
const isTransitionMoving = (declarations) =>
  listTransitioned(declarations)
    .map((name) => name.toLowerCase())
    .some((name) => name === "all" || isInFamily(name, STACK_PROPERTIES));

/**
 * Whether a rule moves what it reaches: a step of keyframes, an animation, a will-change, or a
 * transition that moves.
 * @param {StyleRule} rule
 */
const isMovingRule = ({ declarations, isKeyframe }) =>
  isKeyframe ||
  declarations.some(({ property }) => isInFamily(property, ["animation", "will-change"])) ||
  isTransitionMoving(declarations);

/**
 * Whether a transform, translate, rotate, or scale declaration stays in two dimensions.
 * @param {Declaration} declaration
 */
function isFlatTransform(declaration) {
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  const parts = splitTopLevel(value, " ");
  if (name === "transform")
    return (
      value.toLowerCase() === "none" || parts.every((part) => FLAT_TRANSFORM_FUNCTION.test(part))
    );
  const most = FLAT_TRANSFORM_VALUES.get(name);
  return most !== undefined && parts.length <= most;
}

/**
 * Whether a declaration gives a part a layer of its own: any of the layer properties, but a
 * transition only when it moves something, and a transform in two dimensions only in a rule that
 * moves it, since WebKit composites only a transform in three dimensions or on the move.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 */
function isLayerDeclaration(declaration, rule) {
  const name = readBareName(declaration.property);
  if (isInFamily(name, ["transition"])) return isTransitionMoving(rule.declarations);
  if (name === "transform" || FLAT_TRANSFORM_VALUES.has(name))
    return !isFlatTransform(declaration) || isMovingRule(rule);
  return isInFamily(name, LAYER_PROPERTIES);
}

/**
 * Whether a declaration in a shared stylesheet decides how iOS layers, stacks, scrolls, or shows a
 * part: any of the stack properties, but a display only when it hides a part or its box, and a
 * relative or static position only beside a z-index, which stacks it.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 */
function isStackDeclaration(declaration, rule) {
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  if (name === "display") return /^(?:none|contents)$/i.test(value);
  if (name === "position")
    return (
      !/^(?:relative|static)$/i.test(value) ||
      rule.declarations.some(({ property }) => property === "z-index")
    );
  if (isInFamily(name, LAYER_PROPERTIES)) return isLayerDeclaration(declaration, rule);
  return isInFamily(name, STACK_PROPERTIES);
}

/**
 * Whether a declaration in any other stylesheet of a page gives a part a layer of its own, or lifts it
 * over others or makes it scroll: a fixed, sticky, or absolute position, a z-index, or an overflow
 * that isn't visible.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 */
function isPageLayerDeclaration(declaration, rule) {
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  if (name === "position") return /^(?:fixed|sticky|absolute)$/i.test(value);
  if (/^overflow(?:-x|-y|-inline|-block)?$/.test(name)) return !/^visible$/i.test(value);
  return name === "z-index" || isLayerDeclaration(declaration, rule);
}

/**
 * Each declaration of a stylesheet's rules that `isKept` keeps, under each selector it reaches,
 * as `@media (min-width:780px) .tabs { position: sticky }`.
 * @param {StyleRule[]} rules
 * @param {(declaration: Declaration, rule: StyleRule) => boolean} isKept
 */
const listKeptDeclarations = (rules, isKept) =>
  rules.flatMap((rule) =>
    rule.declarations
      .filter((declaration) => isKept(declaration, rule))
      .flatMap(({ property, value }) =>
        rule.reaches.map((reach) => `${reach} { ${property}: ${value} }`),
      ),
  );

/**
 * A changed stylesheet's rules before the change and after it, or null when either can't be
 * read.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function readStyleSides(file, readPageFile) {
  const sides = readBothSides(file, readPageFile);
  const before = sides && readStyleRules(sides.before);
  const after = sides && readStyleRules(sides.after);
  return before && after ? { before, after } : null;
}

/** @param {ChangedFile} file */
const describeSharedCode = ({ path }) =>
  `${path} is shared code that moves, layers, or draws the page`;

/**
 * Why a change to a shared stylesheet is red: each declaration that decides how parts layer,
 * stack, scroll, or show that a selector gains or loses. A rule renamed, split, or merged that
 * sets each selector the same isn't red. One that's moved, or can't be read, is red whatever it
 * held.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function findSharedStyleReasons(file, readPageFile) {
  const rules = file.hunks.length ? readStyleSides(file, readPageFile) : null;
  if (!rules) return [describeSharedCode(file)];
  const before = listKeptDeclarations(rules.before, isStackDeclaration);
  const after = listKeptDeclarations(rules.after, isStackDeclaration);
  const changes = `${file.path} changes how parts layer, stack, scroll, or show:`;
  return [
    ...subtractEach(after, before).map((declaration) => `${changes} adds ${declaration}`),
    ...subtractEach(before, after).map((declaration) => `${changes} drops ${declaration}`),
  ];
}

/**
 * Why a change to any other stylesheet of a page is red: each declaration it adds that gives a
 * part a layer of its own, lifts it over others, or makes it scroll.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function findPageStyleReasons(file, readPageFile) {
  const rules = readStyleSides(file, readPageFile);
  if (!rules) return [`${file.path} changes in a way the gate can't read`];
  const before = listKeptDeclarations(rules.before, isPageLayerDeclaration);
  return subtractEach(listKeptDeclarations(rules.after, isPageLayerDeclaration), before).map(
    (declaration) => `${file.path} adds a layer, a stack, or a scroll: ${declaration}`,
  );
}

/**
 * A script's code with its comments, blank lines, and formatting taken out, as esbuild parses it,
 * or null when it doesn't parse.
 * @param {string} script
 */
function readScriptCode(script) {
  try {
    return transformSync(script, { loader: "js", legalComments: "none", minifyWhitespace: true })
      .code;
  } catch {
    return null;
  }
}

/**
 * A script's top-level code, each declaration or statement as esbuild prints it without comments
 * or formatting, leaving out its imports and re-exports and taking `export` off what it exports by
 * name, with the paths of the scripts it imports, or null when it doesn't parse.
 * @param {string} script
 * @param {string} path from the repository's root
 */
function readTopLevelCode(script, path) {
  const code = readScriptCode(script);
  if (code === null) return null;
  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  /** @type {string[]} */
  const statements = [];
  /** @type {string[]} */
  const imports = [];
  /** @param {import("acorn").Node} node */
  const addStatement = (node) =>
    statements.push(code.slice(node.start, node.end).replace(/;$/, ""));
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" &&
      statement.type !== "ExportAllDeclaration" &&
      statement.type !== "ExportNamedDeclaration"
    ) {
      addStatement(statement);
      continue;
    }
    const source = String(statement.source?.value ?? "");
    if (source.startsWith(".")) imports.push(posix.join(posix.dirname(path), source));
    if (statement.type === "ExportNamedDeclaration" && statement.declaration)
      addStatement(statement.declaration);
  }
  return { statements, imports };
}

/**
 * A changed script's top-level code before the change and after it, or null when it's gone or
 * either can't be read.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function readScriptSides(file, readPageFile) {
  const sides = readBothSides(file, readPageFile);
  if (!sides?.after) return null;
  const before = readTopLevelCode(sides.before, file.path);
  const after = readTopLevelCode(sides.after, file.path);
  return before && after ? { before, after } : null;
}

/** @typedef {NonNullable<ReturnType<typeof readScriptSides>>} ScriptSides */

/**
 * Each shared script the given red scripts import, before the change or after it, as it was and
 * as the change leaves it, or null for one that can't be read.
 * @param {Map<ChangedFile, ScriptSides | null>} redSides
 * @param {ChangedFile[]} files every file the change touches
 * @param {ReadPageFile} readPageFile
 */
function readImportedSides(redSides, files, readPageFile) {
  const changed = new Map(files.map((file) => [file.path, file]));
  const redPaths = new Set([...redSides.keys()].map(({ path }) => path));
  const imported = new Set(
    [...redSides.values()].flatMap((side) =>
      side ? [...side.before.imports, ...side.after.imports] : [],
    ),
  );
  return [...imported]
    .filter((path) => isSharedScript(path) && !redPaths.has(path))
    .map((path) =>
      readScriptSides(
        changed.get(path) ?? { path, addedLines: [], hunks: [], hunkStarts: [] },
        readPageFile,
      ),
    );
}

/**
 * Whether a red script's change goes beyond moving code: whether a declaration or statement it
 * takes out or puts in shows up, across the scripts `isMoved` counts, a different number of times
 * after the change than before it. One that's gone, moved, or can't be read changes whatever it
 * held.
 * @param {ChangedFile} file
 * @param {ScriptSides | null | undefined} sides
 * @param {(statement: string) => boolean} isMoved
 */
function changesScriptCode(file, sides, isMoved) {
  if (!file.hunks.length || !sides) return true;
  const { statements: was } = sides.before;
  const { statements: is } = sides.after;
  return [...subtractEach(is, was), ...subtractEach(was, is)].some(
    (statement) => !isMoved(statement),
  );
}

/**
 * The shared scripts that move and draw the page whose change is red: each whose code changes,
 * beyond its comments, formatting, and imports and the code that moves, unchanged, among those
 * scripts and the shared scripts they import.
 * @param {ChangedFile[]} files
 * @param {ReadPageFile} readPageFile
 */
function findRedSharedScripts(files, readPageFile) {
  const redScripts = files.filter(({ path }) => RED_FILES.has(path) && path.endsWith(".js"));
  const redSides = new Map(redScripts.map((file) => [file, readScriptSides(file, readPageFile)]));
  const group = [...redSides.values(), ...readImportedSides(redSides, files, readPageFile)].filter(
    (sides) => sides !== null,
  );
  const before = group.flatMap((sides) => sides.before.statements);
  const after = group.flatMap((sides) => sides.after.statements);
  /** @param {string[]} statements @param {string} statement */
  const count = (statements, statement) => statements.filter((code) => code === statement).length;
  /** @param {string} statement */
  const isMoved = (statement) => count(before, statement) === count(after, statement);
  return new Set(redScripts.filter((file) => changesScriptCode(file, redSides.get(file), isMoved)));
}

/**
 * What a line sets that makes a layer, or null when it sets nothing that does.
 * @param {string} text
 */
function findLayerSetting(text) {
  if (isComment(text)) return null;
  for (const { name, pattern } of LAYER_SETTINGS) {
    const match = text.match(pattern);
    if (match) return `${name} that sets ${match[1]}`;
  }
  return null;
}

const CLOSING_BRACKETS = { "{": "}", "[": "]" };

/**
 * The index of the brace or bracket that closes the one at `open`, or the text's end when none
 * does.
 * @param {string} text
 * @param {number} open
 */
function findClosingBracket(text, open) {
  const opening = text[open];
  const closing = CLOSING_BRACKETS[/** @type {"{" | "["} */ (opening)];
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === opening) depth += 1;
    if (text[at] === closing) depth -= 1;
    if (depth === 0) return at;
  }
  return text.length;
}

/**
 * @param {string} text
 * @param {number} index
 */
const findLineNumber = (text, index) => text.slice(0, index).split("\n").length;

/**
 * Where each object or array of keyframes opens that a script hands `.animate` by its name.
 * @param {string} text
 */
function findNamedKeyframes(text) {
  const names = new Set([...text.matchAll(KEYFRAMES_NAME)].map((match) => match[1]));
  return [...names].flatMap((name) => {
    const named = new RegExp(
      `\\b(?:const|let|var)\\s+${name.replaceAll("$", "\\$")}\\s*=\\s*[[{]`,
      "g",
    );
    return [...text.matchAll(named)].map((match) => (match.index ?? 0) + match[0].length - 1);
  });
}

/**
 * The line numbers, from 1, that lie in a style's object or an animation's keyframes, whose keys
 * a hunk's lines can't show as styles when the call sits above them.
 * @param {string} text a script as the change leaves it
 */
export function findStyleObjectLines(text) {
  const opens = [
    ...STYLE_OBJECTS.flatMap((pattern) =>
      [...text.matchAll(pattern)].map((match) => (match.index ?? 0) + match[0].length - 1),
    ),
    ...findNamedKeyframes(text),
  ];
  const lines = new Set();
  for (const open of opens) {
    const last = findLineNumber(text, findClosingBracket(text, open));
    for (let line = findLineNumber(text, open); line <= last; line += 1) lines.add(line);
  }
  return lines;
}

/**
 * What an added line sets that makes a layer, given whether it lies in a style's object.
 * @param {AddedLine} line
 * @param {Set<number>} styleLines
 */
function findAddedSetting({ number, text }, styleLines) {
  const setting = findLayerSetting(text);
  if (setting || isComment(text) || !styleLines.has(number)) return setting;
  const key = text.match(STYLE_KEY);
  return key ? `a style property that sets ${key[1]}` : null;
}

/**
 * Why a change to any other script of a page is red: each line it adds that makes a layer.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function findPageScriptReasons({ path, addedLines }, readPageFile) {
  const styleLines = findStyleObjectLines(readPageFile(path));
  return addedLines.flatMap((line) => {
    const setting = findAddedSetting(line, styleLines);
    return setting ? [`${path}:${line.number} adds ${setting}: ${line.text.trim()}`] : [];
  });
}

/**
 * The file a path names as the change leaves it, or nothing when there's none to read.
 * @param {string} path from the repository's root
 */
function readChangedFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 * @param {Set<ChangedFile>} redSharedScripts
 * @returns {string[]}
 */
function findFileReasons(file, readPageFile, redSharedScripts) {
  const { path } = file;
  if (redSharedScripts.has(file)) return [describeSharedCode(file)];
  if (RED_FILES.has(path))
    return path.endsWith(".css") ? findSharedStyleReasons(file, readPageFile) : [];
  if (!isPageCode(path)) return [];
  if (path.endsWith(".css")) return findPageStyleReasons(file, readPageFile);
  return findPageScriptReasons(file, readPageFile);
}

/**
 * Why a change is red, one reason per file, declaration, or line, or none when it isn't.
 * @param {ChangedFile[]} files
 * @param {ReadPageFile} [readPageFile]
 */
export function findRedReasons(files, readPageFile = readChangedFile) {
  const redSharedScripts = findRedSharedScripts(files, readPageFile);
  return files.flatMap((file) => findFileReasons(file, readPageFile, redSharedScripts));
}

/**
 * @typedef {object} TimelineEvent
 * @property {string} event
 * @property {string} [created_at] when GitHub recorded it
 * @property {{ name: string }} [label]
 * @property {{ login: string } | null} [actor]
 */

/** @typedef {{ labeler: string | null, isAfterLastPush: boolean }} Labeling */

/** @param {TimelineEvent} event */
const readEventTime = (event) => Date.parse(event.created_at ?? "");

/**
 * Who last added `label` to a pull request, and whether they added it after its head commit
 * reached GitHub and after its last force push, from its timeline. A commit's own date is when it
 * was made, which can be long before it was pushed, so the head's arrival comes from GitHub.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @param {number} headPushedAt when GitHub first saw the head commit, or NaN when it can't say
 * @returns {Labeling}
 */
export function findLabeling(events, label, headPushedAt) {
  const lastAdded = events
    .filter((event) => event.event === "labeled" && event.label?.name === label)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);
  if (!lastAdded) return { labeler: null, isAfterLastPush: false };
  const forcePushes = events.filter((event) => event.event === "head_ref_force_pushed");
  const lastPush = Math.max(headPushedAt, ...forcePushes.map(readEventTime));
  return {
    labeler: lastAdded.actor?.login ?? null,
    isAfterLastPush: readEventTime(lastAdded) > lastPush,
  };
}

/**
 * Every event on a pull request's timeline, page by page.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.pullNumber
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 * @returns {Promise<TimelineEvent[]>}
 */
export const readTimeline = ({ repository, pullNumber, fetchImpl = fetch, env = process.env }) =>
  readAllPages(createGitHub({ repository, fetchImpl, env }), `/issues/${pullNumber}/timeline`);

/**
 * When GitHub first saw a commit: its earliest check suite, which GitHub makes as the push that
 * brings the commit arrives, or NaN when it has none.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.sha
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 */
export async function readPushTime({ repository, sha, fetchImpl = fetch, env = process.env }) {
  const github = createGitHub({ repository, fetchImpl, env });
  const { check_suites: suites } = await github(`/commits/${sha}/check-suites?per_page=100`);
  const times = suites.map((/** @type {{ created_at: string }} */ suite) =>
    Date.parse(suite.created_at),
  );
  return times.length ? Math.min(...times) : Number.NaN;
}

/**
 * Why a red change labeled phone-ok is still held, or null when the label lets it through.
 * @param {Labeling} labeling
 * @param {string} owner
 */
function findLabelProblem({ labeler, isAfterLastPush }, owner) {
  if (!owner || labeler !== owner)
    return (
      `A red change labeled ${PHONE_OK_LABEL} by ${labeler ?? "someone GitHub doesn't name"}, but the label ` +
      `has to come from the repository's owner, ${owner}, after using it on the beta app.`
    );
  if (!isAfterLastPush)
    return (
      `A red change labeled ${PHONE_OK_LABEL} before its last push, which the owner hasn't used on the ` +
      `phone. Deploy it to beta (git push -f origin <branch>:beta). The owner takes the label off and adds ` +
      "it again after using it on the beta app."
    );
  return null;
}

/**
 * The gate's verdict on a pull request, given its diff, its labels, who last added the phone-ok
 * label and whether that came after its last push, and the repository's owner.
 * @param {string} diff
 * @param {{ labels: string[], labeling?: Labeling, owner?: string }} pullRequest
 * @returns {{ isHeld: boolean, message: string }}
 */
export function decideGate(
  diff,
  { labels, labeling = { labeler: null, isAfterLastPush: false }, owner = "" },
) {
  const reasons = findRedReasons(readDiff(diff));
  if (!reasons.length) return { isHeld: false, message: "Not a red change." };
  const listed = reasons.map((reason) => `- ${reason}`).join("\n");
  if (!labels.includes(PHONE_OK_LABEL))
    return {
      isHeld: true,
      message:
        `A red change: it needs the owner's iPhone, which no CI browser stands in for.\n${listed}\n` +
        `Deploy it to beta (git push -f origin <branch>:beta). The owner adds the ${PHONE_OK_LABEL} ` +
        "label after using it on the beta app, which runs this check again.",
    };
  const problem = findLabelProblem(labeling, owner);
  if (problem) return { isHeld: true, message: `${problem}\n${listed}` };
  return {
    isHeld: false,
    message: `A red change, labeled ${PHONE_OK_LABEL} by the owner after using it on beta:\n${listed}`,
  };
}

/**
 * Who last added the phone-ok label and when, read only when the pull request has it.
 * @param {string[]} labels
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<Labeling | undefined>}
 */
async function readPhoneOkLabeling(labels, env) {
  if (!labels.includes(PHONE_OK_LABEL)) return undefined;
  const repository = env.GITHUB_REPOSITORY ?? "";
  const [events, headPushedAt] = await Promise.all([
    readTimeline({ repository, pullNumber: env.PR ?? "", env }),
    readPushTime({ repository, sha: env.HEAD_SHA ?? "", env }),
  ]);
  return findLabeling(events, PHONE_OK_LABEL, headPushedAt);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labels = JSON.parse(process.argv[2] || "[]");
  const labeling = await readPhoneOkLabeling(labels, process.env);
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "";
  const { isHeld, message } = decideGate(readFileSync(0, "utf8"), { labels, labeling, owner });
  console.log(isHeld ? `::error::${message.split("\n")[0]}\n${message}` : message);
  if (isHeld) process.exit(1);
}
