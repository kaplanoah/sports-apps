// Says whether a pull request is a red change: one whose bugs no CI browser would show, since none
// touches, scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong
// before. That's any change to the code, not the comments, blank lines, or formatting, of the
// shared JavaScript that moves and draws the page; a change to its shared stylesheets in what
// decides how parts layer, stack, scroll, and show, and anything a page's other stylesheets add
// that gives a part a layer of its own, lifts it over others, or decides how it scrolls or takes a
// touch (worker/red-change-styles.mjs); a line a page's other scripts add that draws a part on a
// layer of its own, sets or clears what those stylesheets would be red for or a custom property
// they stack with, or holds or creates markup that runs or layers the page; a line a page's markup
// adds or takes out that loads, runs, or layers its parts, and any change to the stylesheets it
// links or their order, to how it fits the screen, opens from the Home Screen without the browser's
// bars, and colors the phone's own, or to its inline scripts and styles; a change to how an app's
// manifest opens its Home Screen app, or to a manifest the gate can't read; and a diff the gate
// can't read. A red change merges only once the owner has used it on the beta app and labeled it
// phone-ok. Anyone who can label a pull request could add the label, so the gate reads who last
// added it and lets the change through only from the repository's owner, and only when the label
// came after the pull request's head commit reached GitHub, which the owner hasn't used on the
// phone otherwise.
// Usage: git diff --text --no-textconv --no-ext-diff --no-renames <base> |
//   node worker/red-change.mjs '<labels as JSON>'
// with PR, HEAD_SHA, GH_TOKEN, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_OWNER set, as Actions sets
// the last two. The diff shows every file's text, whatever .gitattributes says of it, and ends at
// the files on disk, as CI's `<base> HEAD` in a clean checkout does, since a changed file before
// the change is rebuilt from the file and the hunks. It writes whether the change is held to
// $GITHUB_OUTPUT as held=true or held=false.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import {
  LAYER_PROPERTIES,
  createWatchCheck,
  describeUnreadable,
  findClosingBracket,
  findInlineStyleSettings,
  findStyleReasons,
  isEncoded,
  isEncodedOutsideHoles,
  isPageLayerDeclaration,
  isTransition,
  readMinifiedCode,
} from "./red-change-styles.mjs";

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
    "season-header.js",
    "rider-taps.js",
    "held-bar.js",
    "day-strip.js",
    "strip-slide.js",
    "pull-to-refresh.js",
    "spring-scroll.js",
    "chrome.css",
    "team-sheet.css",
    "game-cards.css",
    "day-strip.css",
  ].map((file) => `shared/page/${file}`),
);

const PROPERTY_NAMES = LAYER_PROPERTIES.join("|");

// A property's longhands set it too, as transition-duration and -webkit-mask-image do. A number an
// object keys by one of their names, as in { scale: 1.2 }, sets no style, since CSS in a script's
// template ends a declaration with a semicolon or its string's end, unless the object is a
// style's or an animation's keyframes, which findStyleObjectLines and findKeyframeLines find. A
// transition in a script's CSS text, or keyed in a style's object or keyframes, counts whatever it
// eases, since the script can add to it past where the gate reads it.
const LAYER_SETTINGS = [
  {
    name: "a CSS declaration",
    pattern: new RegExp(
      `(?:^|[\\s{;"'\`])(?:-webkit-)?(${PROPERTY_NAMES})(?:-[a-z]+)*\\s*:(?!:)(?!\\s*-?[\\d.]+\\s*(?:[,}]|$))`,
    ),
  },
  { name: "an animation", pattern: /\.(animate)\(/ },
  { name: "a fixed or sticky position", pattern: /\b(position\s*:\s*(?:fixed|sticky))\b/ },
];

// Where a style's text comes from: markup, a page's or a script's template, decodes entities,
// while what a script writes into a style reaches it as it is.
const IN_MARKUP = { isMarkup: true };
const IN_SCRIPT = { isMarkup: false };

// An assignment, plain or compound, as `=`, `+=`, or `||=`, but not a comparison.
const ASSIGNS = String.raw`\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?!=)`;
// A part's style, as `part.style`, or as a script holds it by that name, as
// `const style = part.style` does, since a property's name, like position or container, names
// other things too.
const STYLE = String.raw`\bstyle`;
// A property a script sets by its name on a part's style, and the style's whole text, as its
// cssText, as the style itself, or as its attribute, each with the rest of the line, where the
// value it writes starts.
const STYLE_PROPERTY_ASSIGNMENT = new RegExp(`${STYLE}\\.([A-Za-z]+)${ASSIGNS}(?=(.*))`, "g");
const STYLE_TEXT_ASSIGNMENT = new RegExp(`\\.style${ASSIGNS}(?=(.*))`, "g");
const STYLE_ATTRIBUTE_CHANGE = /\.(set|remove)Attribute\(\s*["'`]style["'`]\s*(?:,(?=(.*)))?/g;
// A property a style's own methods set or clear, on whatever holds the style, by its CSS name,
// quoted, with any value where it clears it, or by a name the gate can't read, as a variable
// holds it or an index into the style names it.
const STYLE_PROPERTY_CALL =
  /\.(?:set|remove)Property\(\s*(?:(["'`])((?:(?!\1).)*)\1)?\s*(?:,(?=(.*)))?/g;
const STYLE_INDEX = new RegExp(`${STYLE}\\s*\\[`, "g");
const STARTS_ASSIGNMENT = new RegExp(`^${ASSIGNS}`);
// A value as a script writes it: a string or a number, which ends where its expression does.
const SCRIPT_LITERAL = /^\s*(?:(["'`])((?:\\.|(?!\1)[^\\])*)\1|(-?[\d.]+))(?=\s*(?:[;,)}\]]|$))/;

// Each key sets a style, a number too, in the object Object.assign(<part>.style, { ... }) or
// Object.assign(style, { ... }) hands a part's style, and in the keyframes
// <part>.animate([ ... ]) or <part>.animate({ ... }) takes, but for a keyframe's own keys, which
// place it in the animation rather than style the part.
const STYLE_OBJECT = /Object\.assign\(\s*(?:[\w$.]+\.)?style\s*,\s*\{/g;
const KEYFRAMES = /\.animate\(\s*[[{]/g;
const KEYFRAME_TIMING_KEYS = new Set(["offset", "easing", "composite"]);
// A keyframe names the CSS offset property cssOffset, since offset is its place.
const KEYFRAME_CSS_NAMES = new Map([["cssOffset", "offset"]]);
// The keyframes <part>.animate(<name>, ...) takes, from where the script names them.
const KEYFRAMES_NAME = /\.animate\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
const STYLE_KEY = /(?:^|[\s{,])(["']?)(-{0,2}[A-Za-z][\w-]*)\1\s*:(?!:)/g;

// A line of a page's markup, or of a script's, that runs scripts, in their order, or opens a
// dialog, a popover, or a style element, or creates a script, a dialog, or a style element, each
// of which can stack its parts.
const PAGE_MARKUP_LAYER =
  /<script\b|<style\b|<dialog\b|\bpopover\b|createElement\(\s*["'`](?:script|dialog|style)["'`]/i;
// A style attribute and its value, which is missing where a template fills it in whole.
const STYLE_ATTRIBUTE = /(?<![\w-])style=(?:"([^"]*)"|'([^']*)')?/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*(?<![\w-])src=)[^>]*>[\s\S]*?<\/script>/gi;
const INLINE_STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
// How the page fits the screen, opens from the Home Screen without the browser's bars, and colors
// the phone's own, which no CI browser draws.
const META_TAG = /<meta\b[^>]*>/gi;
const SCREEN_META_NAME =
  /\bname\s*=\s*["']?(?:viewport|apple-mobile-web-app-status-bar-style|(?:apple-)?mobile-web-app-capable)(?![\w-])/i;
// A link, its attributes on as many lines as it takes, and whether it links a stylesheet, whose
// order sets the cascade, rather than a preload or an icon, which sets nothing.
const LINK_TAG = /<link\b[^>]*>/gi;
const STYLESHEET_REL =
  /\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i;
// The gate reads a diff without renames, whose header names one path twice, however many " b/"
// it holds.
const DIFF_HEADER = /^diff --git a\/(.+) b\/\1$/;

// Tests live outside every page's folder, so they're never red.
const isPageCode = (path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.+\.(?:css|js)$/.test(path);
const isPageStylesheet = (path) => isPageCode(path) && path.endsWith(".css");
const isPageMarkup = (path) => /^apps\/[^/]+\/page\/[^/]+\.html$/.test(path);
const isPageManifest = (path) => /^apps\/[^/]+\/page\/[^/]+\.webmanifest$/.test(path);
// What a Home Screen app takes from its manifest on how it opens: without the browser's bars,
// which way it turns, and which pages it keeps without them, which no CI browser draws. Its
// start_url isn't one, since the Worker leaves it out of the manifest it hands Safari.
const MANIFEST_SCREEN_KEYS = ["display", "display_override", "orientation", "scope"];
const isComment = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

/** @typedef {{ number: number, text: string }} AddedLine */
/** @typedef {{ kind: "kept" | "added" | "removed", text: string }} HunkLine */
/**
 * @typedef {object} ChangedFile
 * @property {string} path
 * @property {AddedLine[]} addedLines
 * @property {HunkLine[][]} hunks
 * @property {number[]} hunkStarts the line, from 1, each hunk starts at in the new file
 * @property {boolean} [isUnreadable] whether the diff hides how its content changed, as it does
 *   for a file it takes as binary, or one it shows no hunks for that it neither creates, deletes,
 *   nor changes the mode of, as it does for an empty file
 */
/** @typedef {(path: string) => string} ReadPageFile a page's file as the change leaves it */

/**
 * The files a unified diff without renames changes, each with the lines it adds, numbered as the
 * new file has them, and each of its hunks, with where it starts.
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
  const modeChanges = new Set();
  const binaries = new Set();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.match(DIFF_HEADER)?.[1];
      current = path ? { path, addedLines: [], hunks: [], hunkStarts: [] } : null;
      hunk = null;
      if (current) files.push(current);
      continue;
    }
    if (current && !hunk && /^(?:old|new|new file|deleted file) mode /.test(line))
      modeChanges.add(current);
    if (current && !hunk && /^(?:Binary files |GIT binary patch)/.test(line)) binaries.add(current);
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
  return files.map((file) => ({
    ...file,
    isUnreadable: binaries.has(file) || (!file.hunks.length && !modeChanges.has(file)),
  }));
}

/**
 * Why the gate can't read a diff, as with a file whose header doesn't name one path twice, as a
 * rename's or a quoted path's doesn't, or a diff that names no file at all, or null when it can.
 * @param {string} diff
 */
function findDiffProblem(diff) {
  const headers = diff.split("\n").filter((line) => line.startsWith("diff --git "));
  const isUnreadable = headers.some((line) => !DIFF_HEADER.test(line));
  if (isUnreadable || (diff.trim() && !headers.length))
    return "The gate can't read the diff, so it may change anything";
  return null;
}

/**
 * What a line sets that makes a layer, or null when it sets nothing that does.
 * @param {string} text
 */
function findLayerSetting(text) {
  for (const { name, pattern } of LAYER_SETTINGS) {
    const match = text.match(pattern);
    if (match) return `${name} that sets ${match[1]}`;
  }
  return null;
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
 * Whether a change to a script changes its code, rather than only its comments, blank lines, or
 * formatting, which draw nothing. A script that's gone, or that the change's hunks don't fit,
 * counts as changed.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function changesScriptCode(file, readPageFile) {
  const after = readPageFile(file.path);
  const before = after ? readFileBefore(after, file) : null;
  if (before === null) return true;
  const code = readMinifiedCode(after, "js");
  return code === null || code !== readMinifiedCode(before, "js");
}

/** @param {ChangedFile} file */
const describeSharedCode = ({ path }) =>
  `${path} is shared code that moves, layers, or draws the page`;

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
 * Where each bracket opens that ends a match of `pattern`.
 * @param {string} text
 * @param {RegExp} pattern global
 */
const findOpenings = (text, pattern) =>
  [...text.matchAll(pattern)].map((match) => (match.index ?? 0) + match[0].length - 1);

/**
 * The line numbers, from 1, that lie in a style's object, whose keys a hunk's lines can't show as
 * styles when the call sits above them.
 * @param {string} text a script as the change leaves it
 */
export const findStyleObjectLines = (text) =>
  listBracketLines(text, findOpenings(text, STYLE_OBJECT));

/**
 * The line numbers, from 1, that lie in an animation's keyframes, inline or named, whose keys a
 * hunk's lines can't show as styles when the call sits above them.
 * @param {string} text a script as the change leaves it
 */
export const findKeyframeLines = (text) =>
  listBracketLines(text, [...findOpenings(text, KEYFRAMES), ...findNamedKeyframes(text)]);

/**
 * The line numbers, from 1, from each opening bracket to the one that closes it.
 * @param {string} text
 * @param {number[]} opens
 */
function listBracketLines(text, opens) {
  /** @type {Set<number>} */
  const lines = new Set();
  for (const open of opens) {
    const last = findLineNumber(text, findClosingBracket(text, open));
    for (let line = findLineNumber(text, open); line <= last; line += 1) lines.add(line);
  }
  return lines;
}

/**
 * A style property's CSS name, from its name in a script, as -webkit-backdrop-filter's is
 * webkitBackdropFilter, and a custom property's as it is, since its case is its own.
 * @param {string} name
 */
const toKebabCase = (name) =>
  name.startsWith("--")
    ? name
    : name
        .replace(/^webkit(?=[A-Z])/, "Webkit")
        .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The value a script writes, as its string or number holds it, or as a template's hole for one
 * it works out or one whose escapes, outside the holes its own template fills in, the gate
 * doesn't decode, either of which can hold any value.
 * @param {string} text from where the value starts
 */
function readScriptValue(text) {
  const literal = text.match(SCRIPT_LITERAL);
  const value = literal?.[2] ?? literal?.[3];
  return value === undefined || isEncodedOutsideHoles(value, IN_SCRIPT)
    ? `\${${text.trim()}}`
    : value;
}

/**
 * What a script sets a style property to that a page's stylesheet would be red for, or a custom
 * property a stack declaration reads, or one whose name the gate can't read, or null when it
 * sets neither.
 * @param {string} property its CSS name
 * @param {string} value
 * @param {(property: string) => boolean} isWatched
 */
function describeStyleProperty(property, value, isWatched) {
  const counts =
    property.includes("${") ||
    isEncoded(property, IN_SCRIPT) ||
    (property.startsWith("--") ? isWatched(property) : isPageLayerDeclaration({ property, value }));
  return counts ? `a style property that sets ${property}` : null;
}

/**
 * What a script sets or clears a style's whole text to that a page's stylesheet would be red
 * for, or null when it sets nothing that is.
 * @param {string} value
 * @param {(property: string) => boolean} isWatched
 */
function describeStyleText(value, isWatched) {
  if (!value.trim()) return "a style that clears every property";
  const settings = findInlineStyleSettings(value, isWatched, IN_SCRIPT);
  return settings.length ? `a style that sets ${settings.join("; ")}` : null;
}

const UNREADABLE_PROPERTY = "a style property whose name the gate can't read";

/**
 * The first of a line's writes that sets something red, past any that don't.
 * @param {string} text
 * @param {RegExp} pattern global, one match for each write
 * @param {(match: RegExpMatchArray) => string | null} describe
 */
function findFirstSetting(text, pattern, describe) {
  for (const match of text.matchAll(pattern)) {
    const setting = describe(match);
    if (setting) return setting;
  }
  return null;
}

/**
 * What a line sets or clears by a property's name on a part's style that a page's stylesheet
 * would be red for, or null when it sets nothing that is.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
const findAssignedSetting = (text, isWatched) =>
  findFirstSetting(text, STYLE_PROPERTY_ASSIGNMENT, ([, name, written]) => {
    const value = readScriptValue(written);
    return name === "cssText"
      ? describeStyleText(value, isWatched)
      : describeStyleProperty(toKebabCase(name), value, isWatched);
  });

/**
 * What a line sets or clears a part's whole style to, as the style itself or its attribute, that a
 * page's stylesheet would be red for, or null when it sets nothing that is.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
const findStyleTextSetting = (text, isWatched) =>
  findFirstSetting(text, STYLE_TEXT_ASSIGNMENT, ([, written]) =>
    describeStyleText(readScriptValue(written), isWatched),
  ) ??
  findFirstSetting(text, STYLE_ATTRIBUTE_CHANGE, ([, change, written]) =>
    describeStyleText(change === "remove" ? "" : readScriptValue(written ?? ""), isWatched),
  );

/**
 * What a line sets or clears with a style's own methods that a page's stylesheet would be red
 * for, or a property whose name the gate can't read, or null when it sets nothing that is.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
const findPropertyCallSetting = (text, isWatched) =>
  findFirstSetting(text, STYLE_PROPERTY_CALL, ([, quote, name, written]) =>
    quote
      ? describeStyleProperty(name, readScriptValue(written ?? ""), isWatched)
      : UNREADABLE_PROPERTY,
  );

/**
 * Whether a line writes through an index into a style, as `style[key] = value` does, up to the
 * index's own closing bracket, however many it holds.
 * @param {string} text
 */
const isStyleIndexAssignment = (text) =>
  [...text.matchAll(STYLE_INDEX)].some((match) => {
    const close = findClosingBracket(text, match.index + match[0].length - 1);
    return STARTS_ASSIGNMENT.test(text.slice(close + 1));
  });

/**
 * What a line sets or clears on a part's style, by a property's name, its CSS name, or its whole
 * text, that a page's stylesheet would be red for, or a property whose name the gate can't read,
 * or null when it sets nothing that is.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
const findStyleSetting = (text, isWatched) =>
  (isStyleIndexAssignment(text) ? UNREADABLE_PROPERTY : null) ??
  findAssignedSetting(text, isWatched) ??
  findStyleTextSetting(text, isWatched) ??
  findPropertyCallSetting(text, isWatched);

/**
 * What a line of a style's object, or of an animation's keyframes, sets by its keys that a
 * page's stylesheet would be red for, or a transition, whatever it eases, or a custom property a
 * stack declaration reads, or null when it sets none of those.
 * @param {string} text
 * @param {(key: string) => string | null} readProperty the CSS name a key sets where the line
 *   lies, or null for one that sets no style there
 * @param {(property: string) => boolean} isWatched
 */
function findStyleKey(text, readProperty, isWatched) {
  for (const match of text.matchAll(STYLE_KEY)) {
    const property = readProperty(match[2]);
    if (property === null) continue;
    if (isTransition(property)) return `a style property that sets ${property}`;
    const value = readScriptValue(text.slice((match.index ?? 0) + match[0].length));
    const setting = describeStyleProperty(property, value, isWatched);
    if (setting) return setting;
  }
  return null;
}

/**
 * The lines of a script that lie in a style's object, and those that lie in an animation's
 * keyframes.
 * @typedef {{ styleLines: Set<number>, keyframeLines: Set<number> }} StyleObjectLines
 */

/**
 * What a line of a style's object or of keyframes sets by its keys, or null for any other line.
 * @param {AddedLine} line
 * @param {StyleObjectLines} objectLines
 * @param {(property: string) => boolean} isWatched
 */
function findObjectKeySetting({ number, text }, { styleLines, keyframeLines }, isWatched) {
  if (styleLines.has(number)) return findStyleKey(text, readStyleObjectProperty, isWatched);
  return keyframeLines.has(number) ? findStyleKey(text, readKeyframeProperty, isWatched) : null;
}

/**
 * The CSS name a key of a style's object sets, or null for a custom property's, which a style sets
 * only through its setProperty.
 * @param {string} key
 */
const readStyleObjectProperty = (key) => (key.startsWith("--") ? null : toKebabCase(key));

/**
 * The CSS name a keyframe's key sets, or null for one that places the keyframe in its animation.
 * @param {string} key
 */
const readKeyframeProperty = (key) =>
  KEYFRAME_TIMING_KEYS.has(key) ? null : (KEYFRAME_CSS_NAMES.get(key) ?? toKebabCase(key));

/**
 * What an added line sets that makes a layer, or sets or clears that a page's stylesheet would be
 * red for, or a transition, whatever it eases, in its CSS text or keyed in a style's object or
 * keyframes, given whether it lies in a style's object or in keyframes.
 * @param {AddedLine} line
 * @param {StyleObjectLines} objectLines
 * @param {(property: string) => boolean} isWatched
 */
const findAddedSetting = (line, objectLines, isWatched) =>
  findLayerSetting(line.text) ??
  findStyleSetting(line.text, isWatched) ??
  findObjectKeySetting(line, objectLines, isWatched);

/**
 * What each style attribute a line of markup holds sets that a page's stylesheet would be red
 * for, or the whole attribute where the gate can't read its value, as where a template fills in
 * all of it or a value it holds runs on past the line.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
const findAttributeSettings = (text, isWatched) =>
  [...text.matchAll(STYLE_ATTRIBUTE)].flatMap((match) => {
    const style = match[1] ?? match[2];
    if (style === undefined || /\$\{[^}]*$/.test(style)) return [match[0]];
    return findInlineStyleSettings(style, isWatched, IN_MARKUP);
  });

/**
 * What a line of markup, or of a script's template, holds that runs or layers the page, as a
 * dialog does, or an inline style that stacks a part, or null when it holds none.
 * @param {string} text
 * @param {(property: string) => boolean} isWatched
 */
function findMarkupLayer(text, isWatched) {
  if (PAGE_MARKUP_LAYER.test(text)) return "markup that runs or layers the page";
  const settings = findAttributeSettings(text, isWatched);
  return settings.length ? `an inline style that sets ${settings.join("; ")}` : null;
}

/**
 * Why a change to any other script of a page is red: each line it adds that makes a layer, sets
 * or clears what a page's stylesheet would be red for or a custom property a stack declaration
 * reads, or holds or creates markup that runs or layers the page.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 * @param {(property: string) => boolean} isWatched
 */
function findPageScriptReasons({ path, addedLines }, readPageFile, isWatched) {
  const script = readPageFile(path);
  const objectLines = {
    styleLines: findStyleObjectLines(script),
    keyframeLines: findKeyframeLines(script),
  };
  return addedLines.flatMap((line) => {
    if (isComment(line.text)) return [];
    const setting =
      findAddedSetting(line, objectLines, isWatched) ?? findMarkupLayer(line.text, isWatched);
    return setting ? [`${path}:${line.number} adds ${setting}: ${line.text.trim()}`] : [];
  });
}

/**
 * The inline scripts of a page's markup, as it holds them, which run as the page loads, in its
 * order.
 * @param {string} markup
 */
const listInlineScripts = (markup) => markup.match(INLINE_SCRIPT) ?? [];

/**
 * The styles a page's markup holds in its own style elements, in its order.
 * @param {string} markup
 */
const listInlineStyles = (markup) => markup.match(INLINE_STYLE) ?? [];

/**
 * Each of `tagPattern`'s tags in a page's markup that `keptPattern` matches, its attributes on one
 * line, in its order.
 * @param {string} markup
 * @param {RegExp} tagPattern
 * @param {RegExp} keptPattern
 */
const listTags = (markup, tagPattern, keptPattern) =>
  (markup.match(tagPattern) ?? [])
    .filter((tag) => keptPattern.test(tag))
    .map((tag) => tag.replace(/\s+/g, " "));

/** @param {string} markup */
const listStylesheetLinks = (markup) => listTags(markup, LINK_TAG, STYLESHEET_REL);

/** @param {string} markup */
const listScreenMetas = (markup) => listTags(markup, META_TAG, SCREEN_META_NAME);

/**
 * Why a change to a page's markup is red: each line it adds or takes out that runs the page's
 * scripts, whose order it decides too, or opens a dialog, a popover, or a style element, or holds
 * an inline style that stacks a part, and any change to the stylesheets it links, their order
 * too, to how it fits the screen, opens from the Home Screen without the browser's bars, and
 * colors the phone's own, or to its inline scripts and styles.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 * @param {(property: string) => boolean} isWatched
 */
function findPageMarkupReasons(file, readPageFile, isWatched) {
  const lineReasons = file.hunks.flat().flatMap(({ kind, text }) => {
    const layer = kind === "kept" ? null : findMarkupLayer(text, isWatched);
    const change = kind === "added" ? "adds" : "takes out";
    return layer ? [`${file.path} ${change} ${layer}: ${text.trim()}`] : [];
  });
  const after = readPageFile(file.path);
  const before = readFileBefore(after, file);
  if (before === null) return [...lineReasons, describeUnreadable(file.path)];
  /** @param {(markup: string) => string[]} listParts */
  const isKept = (listParts) => listParts(before).join("\n") === listParts(after).join("\n");
  return [
    ...lineReasons,
    ...(isKept(listStylesheetLinks) ? [] : [`${file.path} changes the stylesheets it links`]),
    ...(isKept(listScreenMetas) ? [] : [`${file.path} changes how it fits the screen or its bars`]),
    ...(isKept(listInlineScripts) ? [] : [`${file.path} changes what its inline scripts run`]),
    ...(isKept(listInlineStyles) ? [] : [`${file.path} changes its inline styles`]),
  ];
}

/**
 * What a manifest says about how its Home Screen app opens, as one text to compare, or null when
 * it isn't JSON.
 * @param {string} text the manifest, or nothing for one that's gone
 */
function readManifestScreen(text) {
  try {
    const manifest = JSON.parse(text || "{}");
    return JSON.stringify(MANIFEST_SCREEN_KEYS.map((key) => manifest[key] ?? null));
  } catch {
    return null;
  }
}

/**
 * Why a change to an app's manifest is red: it changes how the Home Screen app opens, or the gate
 * can't read the manifest before or after it.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function findManifestReasons(file, readPageFile) {
  const after = readPageFile(file.path);
  const before = readFileBefore(after, file);
  const [screenBefore, screenAfter] = [before, after].map((text) =>
    text === null ? null : readManifestScreen(text),
  );
  if (screenBefore === null || screenAfter === null) return [describeUnreadable(file.path)];
  return screenBefore === screenAfter ? [] : [`${file.path} changes how the Home Screen app opens`];
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

/** Every stylesheet of a page that git tracks, from the repository's root. */
export const listPageStylesheets = () =>
  execFileSync("git", ["ls-files", "--", "shared/page", "apps"], { encoding: "utf8" })
    .split("\n")
    .filter(isPageStylesheet);

/**
 * Every stylesheet of a page: each one the change touches, before it and after, and each other
 * one as it is.
 * @param {ChangedFile[]} files
 * @param {ReadPageFile} readPageFile
 * @param {() => string[]} listStylesheets
 */
function readStylesheets(files, readPageFile, listStylesheets) {
  const stylesheets = files.filter(({ path }) => isPageStylesheet(path));
  const changedPaths = new Set(stylesheets.map(({ path }) => path));
  const changed = stylesheets.map((file) => {
    const after = readPageFile(file.path);
    const before = file.isUnreadable ? null : readFileBefore(after, file);
    return {
      path: file.path,
      isShared: RED_FILES.has(file.path),
      sides: before === null ? null : { before, after },
    };
  });
  const unchanged = listStylesheets()
    .filter((path) => !changedPaths.has(path))
    .map(readPageFile);
  return { changed, unchanged };
}

/**
 * A read that runs only once it's first asked for, and only once.
 * @template T
 * @param {() => T} read
 * @returns {() => T}
 */
function readWhenAsked(read) {
  /** @type {{ value: T } | null} */
  let kept = null;
  return () => {
    kept ??= { value: read() };
    return kept.value;
  };
}

/**
 * @typedef {object} PageStyles
 * @property {ReadPageFile} readPageFile
 * @property {Map<string, string[]>} styleReasons why each page stylesheet is red, by its path
 * @property {(property: string) => boolean} isWatched whether a custom property is watched
 */

/**
 * @param {ChangedFile} file
 * @param {PageStyles} styles
 * @returns {string[]}
 */
function findFileReasons(file, { readPageFile, styleReasons, isWatched }) {
  const { path } = file;
  if (file.isUnreadable && (isPageCode(path) || isPageMarkup(path) || isPageManifest(path)))
    return [describeUnreadable(path)];
  if (isPageManifest(path)) return findManifestReasons(file, readPageFile);
  if (RED_FILES.has(path) && !file.hunks.length) return [describeSharedCode(file)];
  if (isPageStylesheet(path)) return styleReasons.get(path) ?? [];
  if (RED_FILES.has(path))
    return changesScriptCode(file, readPageFile) ? [describeSharedCode(file)] : [];
  if (isPageMarkup(path)) return findPageMarkupReasons(file, readPageFile, isWatched);
  return isPageCode(path) ? findPageScriptReasons(file, readPageFile, isWatched) : [];
}

/**
 * Why a change is red, one reason per file, declaration, or line, or none when it isn't.
 * @param {ChangedFile[]} files
 * @param {ReadPageFile} [readPageFile]
 * @param {() => string[]} [listStylesheets] every stylesheet of a page
 */
export function findRedReasons(
  files,
  readPageFile = readChangedFile,
  listStylesheets = listPageStylesheets,
) {
  const readSheets = readWhenAsked(() => readStylesheets(files, readPageFile, listStylesheets));
  const readWatchCheck = readWhenAsked(() => createWatchCheck(readSheets()));
  /** @param {string} property */
  const isWatched = (property) => readWatchCheck()(property);
  const styleReasons = files.some(({ path }) => isPageStylesheet(path))
    ? findStyleReasons(readSheets().changed, isWatched)
    : new Map();
  const styles = { readPageFile, styleReasons, isWatched };
  return files.flatMap((file) => findFileReasons(file, styles));
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
  const diffProblem = findDiffProblem(diff);
  const reasons = [...(diffProblem ? [diffProblem] : []), ...findRedReasons(readDiff(diff))];
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
  console.log(isHeld ? `::notice::${message.split("\n")[0]}\n${message}` : message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `held=${isHeld}\n`);
}
