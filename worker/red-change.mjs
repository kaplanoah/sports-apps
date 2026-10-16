// Says whether a pull request is a red change: one whose bugs no CI browser would show, since none
// touches, scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong
// before. That's any change to the shared JavaScript that moves and draws the page, a change to
// its shared stylesheets in what decides how parts layer, stack, scroll, and show, and an added
// line anywhere in a page that makes the browser draw a part on a layer of its own. A red change
// merges only once the owner has used it on the beta app and labeled it phone-ok. Anyone who can
// label a pull request could add the label, so the gate reads who last added it and lets the
// change through only from the repository's owner, and only when the label came after the pull
// request's last commit, which the owner hasn't used on the phone otherwise.
// Usage: git diff --no-renames <base> <head> | node worker/red-change.mjs '<labels as JSON>'
// with PR, GH_TOKEN, GITHUB_REPOSITORY, and GITHUB_REPOSITORY_OWNER set, as Actions sets the last two.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
// of a stylesheet's declarations with a semicolon.
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

// Beside the layers, what in the shared stylesheets decides how iOS stacks, scrolls, and shows
// the page's parts: where a part sits over others, what scrolls and takes a touch, and whether a
// part draws at all. Their fonts, colors, spacing, and sizes CI checks as an iPhone shows them.
const STACK_PROPERTIES = [
  ...LAYER_PROPERTIES,
  "position",
  "overflow",
  "overscroll-behavior",
  "-webkit-overflow-scrolling",
  "scroll-snap-type",
  "scroll-snap-align",
  "scroll-snap-stop",
  "touch-action",
  "pointer-events",
  "z-index",
  "opacity",
  "visibility",
  "display",
  "isolation",
  "mix-blend-mode",
];
const STACK_DECLARATION = new RegExp(
  `(?:^|[\\s{;])(?:-webkit-)?(${STACK_PROPERTIES.join("|")})(?:-[a-z]+)*\\s*:(?!:)`,
);
// A selector or an at-rule says which parts a stylesheet's rules reach, so it can carry a layer
// to a part that had none.
const SELECTOR_OR_AT_RULE = /\{|,\s*$|^\s*@/;

// Tests live outside every page's folder, so they're never red.
const isPageCode = (path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.+\.(?:css|js)$/.test(path);
const isComment = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

/** @typedef {{ number: number, text: string }} AddedLine */
/** @typedef {{ kind: "kept" | "added" | "removed", text: string }} HunkLine */
/** @typedef {{ path: string, addedLines: AddedLine[], hunks: HunkLine[][] }} ChangedFile */

/**
 * The files a unified diff changes, each with the lines it adds, numbered as the new file has
 * them, and each of its hunks. A file moved or deleted is listed under each path it had.
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
      current = { path: newPath, addedLines: [], hunks: [] };
      hunk = null;
      files.push(current);
      if (oldPath !== newPath) files.push({ path: oldPath, addedLines: [], hunks: [] });
      continue;
    }
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkHeader && current) {
      lineNumber = Number(hunkHeader[1]);
      hunk = [];
      current.hunks.push(hunk);
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
 * Each line with its comments blanked out. The lines may start inside a comment, as a hunk can,
 * which shows as a comment's close before any open.
 * @param {string[]} texts
 */
function removeComments(texts) {
  const joined = texts.join("\n");
  const firstOpen = joined.indexOf("/*");
  const firstClose = joined.indexOf("*/");
  const startsInComment = firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen);
  const code = `${startsInComment ? "/*" : ""}${joined}`.replace(
    /\/\*[\s\S]*?(?:\*\/|$)/g,
    (comment) => comment.replace(/[^\n]/g, ""),
  );
  return code.split("\n");
}

/**
 * The code each side of a hunk changes, with its comments taken out: what the old file had that
 * the new one doesn't, and what the new one adds.
 * @param {HunkLine[]} hunk
 */
function listChangedCode(hunk) {
  return ["removed", "added"].flatMap((changed) => {
    const side = hunk.filter(({ kind }) => kind === "kept" || kind === changed);
    const code = removeComments(side.map(({ text }) => text));
    return side.flatMap(({ kind }, index) => (kind === changed ? [code[index]] : []));
  });
}

/**
 * Each changed line of a shared stylesheet that decides how parts layer, stack, scroll, or show.
 * @param {ChangedFile} file
 */
const findStackLines = ({ hunks }) =>
  hunks
    .flatMap(listChangedCode)
    .filter((code) => STACK_DECLARATION.test(code) || SELECTOR_OR_AT_RULE.test(code));

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
 * Why a change to the shared code that moves and draws the page is red: any change to its
 * JavaScript, and a change to its stylesheets in what decides how parts layer, stack, scroll, or
 * show. A file moved or deleted is red whatever it held.
 * @param {ChangedFile} file
 * @returns {string[]}
 */
function findSharedReasons(file) {
  if (!file.path.endsWith(".css") || !file.hunks.length)
    return [`${file.path} is shared code that moves, layers, or draws the page`];
  return findStackLines(file).map(
    (code) => `${file.path} changes how parts layer, stack, scroll, or show: ${code.trim()}`,
  );
}

/**
 * @param {ChangedFile} file
 * @returns {string[]}
 */
function findFileReasons(file) {
  const { path, addedLines } = file;
  if (RED_FILES.has(path)) return findSharedReasons(file);
  if (!isPageCode(path)) return [];
  return addedLines.flatMap(({ number, text }) => {
    const setting = findLayerSetting(text);
    return setting ? [`${path}:${number} adds ${setting}: ${text.trim()}`] : [];
  });
}

/**
 * Why a change is red, one reason per file or line, or none when it isn't.
 * @param {ChangedFile[]} files
 */
export const findRedReasons = (files) => files.flatMap(findFileReasons);

/**
 * @typedef {object} TimelineEvent
 * @property {string} event
 * @property {string} [created_at] when GitHub recorded it, which a commit has no field for
 * @property {{ date?: string }} [committer] a commit's
 * @property {{ name: string }} [label]
 * @property {{ login: string } | null} [actor]
 */

/** @typedef {{ labeler: string | null, isAfterLastCommit: boolean }} Labeling */

/** @param {TimelineEvent} event */
const readEventTime = (event) => Date.parse(event.committer?.date ?? event.created_at ?? "");

/** @param {TimelineEvent} event */
const isCodeChange = (event) =>
  event.event === "committed" || event.event === "head_ref_force_pushed";

/**
 * Who last added `label` to a pull request, and whether they added it after its last commit or
 * force push, from its timeline.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @returns {Labeling}
 */
export function findLabeling(events, label) {
  const lastAdded = events
    .filter((event) => event.event === "labeled" && event.label?.name === label)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);
  if (!lastAdded) return { labeler: null, isAfterLastCommit: false };
  const lastCodeChange = Math.max(...events.filter(isCodeChange).map(readEventTime));
  return {
    labeler: lastAdded.actor?.login ?? null,
    isAfterLastCommit: readEventTime(lastAdded) > lastCodeChange,
  };
}

/**
 * Every event on a pull request's timeline, its commits among them, page by page.
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
 * Why a red change labeled phone-ok is still held, or null when the label lets it through.
 * @param {Labeling} labeling
 * @param {string} owner
 */
function findLabelProblem({ labeler, isAfterLastCommit }, owner) {
  if (!owner || labeler !== owner)
    return (
      `A red change labeled ${PHONE_OK_LABEL} by ${labeler ?? "someone GitHub doesn't name"}, but the label ` +
      `has to come from the repository's owner, ${owner}, after using it on the beta app.`
    );
  if (!isAfterLastCommit)
    return (
      `A red change labeled ${PHONE_OK_LABEL} before its last commit, which the owner hasn't used on the ` +
      `phone. Deploy it to beta (git push -f origin <branch>:beta). The owner takes the label off and adds ` +
      "it again after using it on the beta app."
    );
  return null;
}

/**
 * The gate's verdict on a pull request, given its diff, its labels, who last added the phone-ok
 * label and whether that came after its last commit, and the repository's owner.
 * @param {string} diff
 * @param {{ labels: string[], labeling?: Labeling, owner?: string }} pullRequest
 * @returns {{ isHeld: boolean, message: string }}
 */
export function decideGate(
  diff,
  { labels, labeling = { labeler: null, isAfterLastCommit: false }, owner = "" },
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
  const events = await readTimeline({
    repository: env.GITHUB_REPOSITORY ?? "",
    pullNumber: env.PR ?? "",
    env,
  });
  return findLabeling(events, PHONE_OK_LABEL);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labels = JSON.parse(process.argv[2] || "[]");
  const labeling = await readPhoneOkLabeling(labels, process.env);
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "";
  const { isHeld, message } = decideGate(readFileSync(0, "utf8"), { labels, labeling, owner });
  console.log(isHeld ? `::error::${message.split("\n")[0]}\n${message}` : message);
  if (isHeld) process.exit(1);
}
