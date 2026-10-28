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
// came after the head's last tested change reached GitHub, which the owner hasn't used on the
// phone otherwise. An empty commit is no new change, and neither is a clean merge of main that
// brings in no red commit. It also requires the tested head to contain every red main commit and
// preceding red changes to have verified production coverage. Red approvals refreshes the phone
// status as main or its deployment changes; this remains asynchronous.
// Usage: git diff --text --no-textconv --no-ext-diff --no-renames <base> |
//   node worker/red-change.mjs '<labels as JSON>'
// with PR, HEAD_SHA, GH_TOKEN, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_OWNER set, as Actions sets
// the last two. The diff shows every file's text, whatever .gitattributes says of it, and ends at
// the files on disk, as CI's `<base> HEAD` in a clean checkout does, since a changed file before
// the change is rebuilt from the file and the hunks. It writes whether the change is held to
// $GITHUB_OUTPUT as held=true or held=false. Approval checks require full history with origin/main
// and GitHub actions: read in addition to the label/check-suite permissions.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findChannel } from "./channels.mjs";
import { PHONE_OK_LABEL, findLabeling, readPushTime, readTimeline } from "./labeling.mjs";
import { createGitHub } from "./github-api.mjs";
import { readDeployedMain } from "./production-coverage.mjs";
import { isGitObjectId } from "./git-object.mjs";
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
  readPropertyName,
} from "./red-change-styles.mjs";

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
      "i",
    ),
  },
  { name: "an animation", pattern: /\.(animate)\(/ },
  {
    name: "a fixed or sticky position",
    pattern: /\b(position\s*:\s*(?:-webkit-)?(?:fixed|sticky))\b/i,
  },
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
// The attribute's name in any case, as the browser lowercases it.
const STYLE_ATTRIBUTE_CHANGE = /\.(set|remove)Attribute\(\s*["'`]style["'`]\s*(?:,(?=(.*)))?/gi;
// A property a style's own methods set or clear, on whatever holds the style, by its CSS name,
// quoted, in any case but a custom property's, as the browser lowercases it, with any value where
// it clears it, or by a name the gate can't read, as a variable holds it or an index into the
// style names it.
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
      ? describeStyleProperty(readPropertyName(name), readScriptValue(written ?? ""), isWatched)
      : UNREADABLE_PROPERTY,
  );

/**
 * Whether a line writes through an index into a style, as `style[key] = value` does, up to the
 * index's own closing bracket, however many it holds, or holds an index the gate can't find the
 * end of, as where a quote in it never closes.
 * @param {string} text
 */
const isStyleIndexAssignment = (text) =>
  [...text.matchAll(STYLE_INDEX)].some((match) => {
    const close = findClosingBracket(text, match.index + match[0].length - 1);
    return close === text.length || STARTS_ASSIGNMENT.test(text.slice(close + 1));
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

/** @typedef {import('./labeling.mjs').Labeling} Labeling */

const TO_BETA = `${findChannel("beta").howToShip}.`;

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
      `A red change labeled ${PHONE_OK_LABEL} before the push of its last change, which the owner hasn't ` +
      `used on the phone. ${TO_BETA} The owner takes the label off and adds it again after using it on ` +
      "the beta app."
    );
  return null;
}

// git merge-tree's exit status when the merge conflicts; any other failure is git's own error.
const MERGE_TREE_CONFLICT = 1;

/** @param {string} cwd */
function createGateGit(cwd) {
  /** @param {string[]} arguments_ */
  return (arguments_) =>
    execFileSync("git", arguments_, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
}

/**
 * Red commits on main that the tested head does not contain.
 * Read every commit's own tree: later styles or scripts must not change its classification.
 * @param {{ main?: string, head: string, cwd?: string }} options
 */
export function findMissingRedCommits({ main = "origin/main", head, cwd = process.cwd() }) {
  const readGit = createGateGit(cwd);
  // Resolve caller-supplied revisions before putting them in other git argument positions.
  const mainSha = readGit(["rev-parse", "--verify", "--end-of-options", `${main}^{commit}`]).trim();
  const headSha = readGit(["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`]).trim();
  const commits = readGit(["log", "--first-parent", "--format=%H", mainSha, "--not", headSha, "--"])
    .trim()
    .split("\n")
    .filter(Boolean);
  return commits.filter((commit) => {
    const { diff, readPageFile, listStylesheets } = readCommitChange(`${commit}^1`, commit, cwd);
    return (
      Boolean(findDiffProblem(diff)) ||
      findRedReasons(readDiff(diff), readPageFile, listStylesheets).length > 0
    );
  });
}

/**
 * The head's last tested change and each commit after it, oldest first. A phone-ok label has to come
 * after that change reached GitHub. An empty commit changes nothing the owner tests, and neither
 * does a clean merge of main that brings in no red commit, since main merging the commit before it
 * makes the same code.
 * @param {{ main?: string, head: string, cwd?: string }} options
 */
export function listCommitsFromTestedChange({ main = "origin/main", head, cwd = process.cwd() }) {
  const readGit = createGateGit(cwd);
  const mainSha = readGit(["rev-parse", "--verify", "--end-of-options", `${main}^{commit}`]).trim();
  const commits = [
    readGit(["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`]).trim(),
  ];
  for (;;) {
    const commit = commits[0];
    const [, ...parents] = readGit(["rev-list", "--parents", "-n", "1", commit]).trim().split(" ");
    if (!changesNothingTested({ readGit, commit, parents, mainSha, cwd })) return commits;
    commits.unshift(parents[0]);
  }
}

/**
 * @param {{ readGit: ReturnType<typeof createGateGit>, commit: string, parents: string[], mainSha: string, cwd: string }} options
 */
function changesNothingTested({ readGit, commit, parents, mainSha, cwd }) {
  const tree = readGit(["rev-parse", `${commit}^{tree}`]).trim();
  if (parents.length === 1) return readGit(["rev-parse", `${parents[0]}^{tree}`]).trim() === tree;
  if (parents.length !== 2) return false;
  const [branch, merged] = parents;
  return (
    isAncestor(readGit, merged, mainSha) &&
    readCleanMergeTree(readGit, branch, merged) === tree &&
    !findMissingRedCommits({ main: merged, head: branch, cwd }).length
  );
}

/** @param {ReturnType<typeof createGateGit>} readGit @param {string} commit @param {string} descendant */
function isAncestor(readGit, commit, descendant) {
  try {
    readGit(["merge-base", "--is-ancestor", commit, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The tree git makes merging two commits, or an empty string when they conflict.
 * @param {ReturnType<typeof createGateGit>} readGit @param {string} first @param {string} second
 */
function readCleanMergeTree(readGit, first, second) {
  try {
    return readGit([
      "-c",
      "merge.renormalize=false",
      "merge-tree",
      "--write-tree",
      first,
      second,
    ]).trim();
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === MERGE_TREE_CONFLICT) return "";
    throw error;
  }
}

/** @param {string} base @param {string} head @param {string} [cwd] */
export function readCommitChange(base, head, cwd = process.cwd()) {
  const readGit = createGateGit(cwd);
  const baseSha = readGit(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
  const headSha = readGit(["rev-parse", "--verify", "--end-of-options", `${head}^{tree}`]).trim();
  const diff = readGit([
    "diff",
    "--text",
    "--no-textconv",
    "--no-ext-diff",
    "--no-renames",
    baseSha,
    headSha,
    "--",
  ]);
  const paths = new Set(
    readGit(["ls-tree", "-rz", "--name-only", headSha, "--", "shared/page", "apps"])
      .split("\0")
      .filter(Boolean),
  );
  /** @param {string} path */
  const readPageFile = (path) => (paths.has(path) ? readGit(["show", `${headSha}:${path}`]) : "");
  return { diff, readPageFile, listStylesheets: () => [...paths].filter(isPageStylesheet) };
}

/** @param {string} main @param {string} head @param {string} [cwd] */
export function readMergedChange(main, head, cwd = process.cwd()) {
  const readGit = createGateGit(cwd);
  const mainSha = readGit(["rev-parse", "--verify", "--end-of-options", `${main}^{commit}`]).trim();
  const headSha = readGit(["rev-parse", "--verify", "--end-of-options", `${head}^{commit}`]).trim();
  const tree = readCleanMergeTree(readGit, mainSha, headSha);
  if (!tree) throw new Error(`${head} conflicts with ${main}.`);
  if (!isGitObjectId(tree)) throw new Error("The current merge tree could not be read.");
  return readCommitChange(mainSha, tree, cwd);
}

/**
 * The gate's verdict on a pull request, given its diff, its labels, who last added the phone-ok
 * label and whether that came after the push of its last tested change, and the repository's owner.
 * @param {string} diff
 * @param {{ labels: string[], labeling?: Labeling, owner?: string, missingRedCommits?: string[], pendingRedCommits?: string[] }} pullRequest
 * @param {ReadPageFile} [readPageFile]
 * @param {() => string[]} [listStylesheets]
 * @returns {{ isHeld: boolean, message: string }}
 */
export function decideGate(
  diff,
  {
    labels,
    labeling = { labeler: null, addedAt: Number.NaN, isAfterLastPush: false },
    owner = "",
    missingRedCommits = [],
    pendingRedCommits = [],
  },
  readPageFile = readChangedFile,
  listStylesheets = listPageStylesheets,
) {
  const diffProblem = findDiffProblem(diff);
  const reasons = [
    ...(diffProblem ? [diffProblem] : []),
    ...findRedReasons(readDiff(diff), readPageFile, listStylesheets),
  ];
  if (!reasons.length) return { isHeld: false, message: "Not a red change." };
  const listed = reasons.map((reason) => `- ${reason}`).join("\n");
  if (!labels.includes(PHONE_OK_LABEL))
    return {
      isHeld: true,
      message:
        `A red change: it needs the owner's iPhone, which no CI browser stands in for.\n${listed}\n` +
        `${TO_BETA} The owner adds the ${PHONE_OK_LABEL} label after using it on the beta app, ` +
        "which runs this check again.",
    };
  const problem = findLabelProblem(labeling, owner);
  if (problem) return { isHeld: true, message: `${problem}\n${listed}` };
  if (missingRedCommits.length)
    return {
      isHeld: true,
      message:
        `A red change labeled ${PHONE_OK_LABEL} whose phone-tested head lacks a red change already merged to main: ` +
        `${missingRedCommits.join(", ")}. Merge main into the branch. ${TO_BETA} ` +
        `The owner takes the label off and adds it again after using it on the beta app.\n${listed}`,
    };
  if (pendingRedCommits.length)
    return {
      isHeld: true,
      message: `A red change waiting for main's red deploy to finish successfully: ${pendingRedCommits.join(", ")}.\n${listed}`,
    };
  return {
    isHeld: false,
    message: `A red change, labeled ${PHONE_OK_LABEL} by the owner after using it on beta:\n${listed}`,
  };
}

/**
 * When GitHub first saw the head's last tested change. GitHub records only each push's head, so a
 * change pushed under later commits arrived with the first of them it records.
 * @param {{ repository: string, head: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, cwd: string }} options
 */
async function readTestedPushTime({ repository, head, env, fetchImpl, cwd }) {
  for (const sha of listCommitsFromTestedChange({ head, cwd })) {
    const pushedAt = await readPushTime({ repository, sha, env, fetchImpl });
    if (!Number.isNaN(pushedAt)) return pushedAt;
  }
  return Number.NaN;
}

/**
 * Read approval evidence only for an owner-approved red change.
 * @param {object} options
 * @param {string} options.diff
 * @param {string[]} options.labels
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.cwd]
 * @param {ReturnType<typeof readCommitChange>} [options.files]
 */
export async function readRedApproval({
  diff,
  labels,
  env = process.env,
  fetchImpl = fetch,
  cwd = process.cwd(),
  files,
}) {
  const owner = env.GITHUB_REPOSITORY_OWNER ?? "";
  /** @param {Parameters<typeof decideGate>[1]} pull */
  const decide = (pull) => decideGate(diff, pull, files?.readPageFile, files?.listStylesheets);
  const initial = decide({ labels, owner });
  if (!initial.isHeld || !labels.includes(PHONE_OK_LABEL)) return initial;
  const repository = env.GITHUB_REPOSITORY ?? "";
  const head = env.HEAD_SHA ?? "";
  try {
    const [events, testedPushedAt] = await Promise.all([
      readTimeline({ repository, pullNumber: env.PR ?? "", env, fetchImpl }),
      readTestedPushTime({ repository, head, env, fetchImpl, cwd }),
    ]);
    const labeling = findLabeling(events, PHONE_OK_LABEL, testedPushedAt);
    const labeled = decide({ labels, owner, labeling });
    if (labeled.isHeld) return labeled;
    const missingRedCommits = findMissingRedCommits({ head, cwd });
    const fresh = decide({ labels, owner, labeling, missingRedCommits });
    if (fresh.isHeld) return fresh;
    const deployed = await readDeployedMain(createGitHub({ repository, fetchImpl, env }));
    const pendingRedCommits = findMissingRedCommits({ head: deployed, cwd });
    return decide({ labels, owner, labeling, pendingRedCommits });
  } catch (error) {
    return {
      isHeld: true,
      message: `A red change whose phone approval cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labels = JSON.parse(process.argv[2] || "[]");
  const { isHeld, message } = await readRedApproval({ diff: readFileSync(0, "utf8"), labels });
  console.log(isHeld ? `::notice::${message.split("\n")[0]}\n${message}` : message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `held=${isHeld}\n`);
}
