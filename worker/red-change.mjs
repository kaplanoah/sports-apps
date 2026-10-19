// Says whether a pull request is a red change: one whose bugs no CI browser would show, since none
// touches, scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong
// before. That's any change to the code, not the comments, blank lines, or formatting, of the
// shared JavaScript that moves and draws the page; a change to its shared stylesheets in what
// decides how parts layer, stack, scroll, and show, and anything a page's other stylesheets add
// that gives a part a layer of its own, lifts it over others, or makes it scroll
// (worker/red-change-styles.mjs); a line a page's other scripts add that draws a part on a layer
// of its own; a line a page's markup adds or takes out that loads, runs, or layers its parts; and
// a diff the gate can't read. A red change merges only once the owner has used it on the beta app
// and labeled it phone-ok. Anyone who can label a pull request could add the label, so the gate
// reads who last added it and lets the change through only from the repository's owner, and only
// when the label came after the pull request's head commit reached GitHub, which the owner hasn't
// used on the phone otherwise.
// Usage: git diff --no-renames <base> | node worker/red-change.mjs '<labels as JSON>'
// with PR, HEAD_SHA, GH_TOKEN, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_OWNER set, as Actions sets
// the last two. The diff ends at the files on disk, as CI's `<base> HEAD` in a clean checkout
// does, since a changed file before the change is rebuilt from the file and the hunks. It writes
// whether the change is held to $GITHUB_OUTPUT as held=true or held=false.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { LAYER_PROPERTIES, describeUnreadable, findStyleReasons } from "./red-change-styles.mjs";

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
    "pull-to-refresh.js",
    "spring-scroll.js",
    "chrome.css",
    "team-sheet.css",
    "game-cards.css",
    "day-strip.css",
  ].map((file) => `shared/page/${file}`),
);

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

// A line of a page's markup that runs its scripts, in their order, or opens a dialog, a popover,
// or a style of its own, each of which can stack its parts.
const PAGE_MARKUP_LAYER = /<script\b|<dialog\b|\bpopover\b|\bstyle=/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi;
// A link, its attributes on as many lines as it takes, and whether it links a stylesheet, whose
// order sets the cascade, rather than a preload or an icon, which sets nothing.
const LINK_TAG = /<link\b[^>]*>/gi;
const STYLESHEET_REL =
  /\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i;
const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

// Tests live outside every page's folder, so they're never red.
const isPageCode = (path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.+\.(?:css|js)$/.test(path);
const isPageStylesheet = (path) => isPageCode(path) && path.endsWith(".css");
const isPageMarkup = (path) => /^apps\/[^/]+\/page\/[^/]+\.html$/.test(path);
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
    const header = line.match(DIFF_HEADER);
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
 * Why the gate can't read a diff, as with a file whose header it can't tell the paths of, or a
 * diff that names no file at all, or null when it can.
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
  if (isComment(text)) return null;
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
  const code = readScriptCode(after);
  return code === null || code !== readScriptCode(before);
}

/** @param {ChangedFile} file */
const describeSharedCode = ({ path }) =>
  `${path} is shared code that moves, layers, or draws the page`;

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
 * The inline scripts of a page's markup, as it holds them, which run as the page loads, in its
 * order.
 * @param {string} markup
 */
const listInlineScripts = (markup) => markup.match(INLINE_SCRIPT) ?? [];

/**
 * The stylesheets a page's markup links, each link's attributes on one line, in its order.
 * @param {string} markup
 */
const listStylesheetLinks = (markup) =>
  (markup.match(LINK_TAG) ?? [])
    .filter((link) => STYLESHEET_REL.test(link))
    .map((link) => link.replace(/\s+/g, " "));

/**
 * Why a change to a page's markup is red: each line it adds or takes out that runs the page's
 * scripts, whose order it decides too, or opens a dialog, a popover, or a style of its own, and
 * any change to the stylesheets it links, their order too, or to what its inline scripts run.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function findPageMarkupReasons(file, readPageFile) {
  const lineReasons = file.hunks
    .flat()
    .filter(({ kind, text }) => kind !== "kept" && PAGE_MARKUP_LAYER.test(text))
    .map(
      ({ kind, text }) =>
        `${file.path} ${kind === "added" ? "adds" : "takes out"} a line that runs or layers the page: ${text.trim()}`,
    );
  const after = readPageFile(file.path);
  const before = readFileBefore(after, file);
  if (before === null) return [...lineReasons, describeUnreadable(file.path)];
  /** @param {(markup: string) => string[]} listParts */
  const isKept = (listParts) => listParts(before).join("\n") === listParts(after).join("\n");
  return [
    ...lineReasons,
    ...(isKept(listStylesheetLinks) ? [] : [`${file.path} changes the stylesheets it links`]),
    ...(isKept(listInlineScripts) ? [] : [`${file.path} changes what its inline scripts run`]),
  ];
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
const listPageStylesheets = () =>
  execFileSync("git", ["ls-files", "--", "shared/page", "apps"], { encoding: "utf8" })
    .split("\n")
    .filter(isPageStylesheet);

/**
 * Why each page stylesheet the change touches is red, by its path, judged with every other page
 * stylesheet as the change leaves it.
 * @param {ChangedFile[]} files
 * @param {ReadPageFile} readPageFile
 * @param {() => string[]} listStylesheets
 */
function findChangedStyleReasons(files, readPageFile, listStylesheets) {
  const stylesheets = files.filter(({ path }) => isPageStylesheet(path));
  if (!stylesheets.length) return new Map();
  const changedPaths = new Set(stylesheets.map(({ path }) => path));
  const changed = stylesheets.map((file) => {
    const after = readPageFile(file.path);
    const before = readFileBefore(after, file);
    return {
      path: file.path,
      isShared: RED_FILES.has(file.path),
      sides: before === null ? null : { before, after },
    };
  });
  const unchanged = listStylesheets()
    .filter((path) => !changedPaths.has(path))
    .map(readPageFile);
  return findStyleReasons(changed, unchanged);
}

/**
 * @param {ChangedFile} file
 * @param {Map<string, string[]>} styleReasons why each page stylesheet is red, by its path
 * @param {ReadPageFile} readPageFile
 * @returns {string[]}
 */
function findFileReasons(file, styleReasons, readPageFile) {
  const { path } = file;
  if (RED_FILES.has(path) && !file.hunks.length) return [describeSharedCode(file)];
  if (isPageStylesheet(path)) return styleReasons.get(path) ?? [];
  if (RED_FILES.has(path))
    return changesScriptCode(file, readPageFile) ? [describeSharedCode(file)] : [];
  if (isPageMarkup(path)) return findPageMarkupReasons(file, readPageFile);
  return isPageCode(path) ? findPageScriptReasons(file, readPageFile) : [];
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
  const styleReasons = findChangedStyleReasons(files, readPageFile, listStylesheets);
  return files.flatMap((file) => findFileReasons(file, styleReasons, readPageFile));
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
