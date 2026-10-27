// Splits a pull request's change into areas by what its files are about, each test with the code
// it tests, so trusted review (review.yml and trusted-review-area.yml) has one reviewer read
// each area in full. The first review reads the whole change. A review after it reads only
// files the pull request still changes and the pushes since the last full read changed.
// A push that only merges the base is read by no one, but for how it resolved conflicts in files
// the pull request still changes. Neither is a run on the head the last full read ended on.
// A test's recorded data, the lockfile, a binary file, and a drawing or minified library a tool
// wrote go unread, named in the summary instead.
// Each file's diff is written in parts a reviewer reads whole, as is each rule file whose paths
// match a file of its area, which judge-review.mjs checks.
// Usage: node worker/plan-review.mjs <folder>, in a full checkout of the pull request's merge
// commit, whose first parent is the base branch and second the pull request's head, with GH_TOKEN,
// GITHUB_REPOSITORY, and PR set to read the last review's summary. It prints the stage, its areas,
// and their count for $GITHUB_OUTPUT. REVIEW_RULE_ROOT selects preserved trusted rules;
// REVIEW_BASE binds completion reuse, while the reviewed head selects the incremental range.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapePattern } from "../shared/page/escape-pattern.js";
import { isTestPath } from "./deploy-scope.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { resolvePackageImport } from "./package-imports.mjs";
import { readReviewGit } from "./review-repository.mjs";
import { findSummary, readReviewedState, matchesReviewProvider } from "./review-state.mjs";
import { RULES_FOLDER, listRulesFor, readRuleFiles, readRulePaths } from "./rule-files.mjs";

const AREA_LINES = 2000;
// A smaller area shares its reviewer with the other small ones.
const SMALL_AREA_LINES = 150;
const MOST_AREAS = 12;
// Half the lines one Read returns, and about half the 25,000 tokens it returns at most even for
// prose of long lines, so a part comes back whole.
export const PART_LINES = 1000;
export const PART_BYTES = 48000;
// Read cuts a longer line short, so a part holds a longer line in pieces, each marked as going on.
export const LONGEST_READ_LINE = 2000;
const CONTINUED = "(cont.) ";

// From the base to the pull request merged onto it: the whole change, as the merge would make it.
export const WHOLE_CHANGE = ["HEAD^1", "HEAD"];
// The pull request's own head, the second parent of the merge commit CI checks out.
const PULL_HEAD = "HEAD^2";

const RECORDED_DATA = /(^|\/)tests\/fixtures\/.*\.(json|xml)$/;
const GENERATED = /\.(svg|min\.js)$/;

/**
 * Each changed file and its changed lines, from `git diff --numstat`, which counts a binary file's
 * lines as -.
 * @param {string} numstat
 * @returns {{ path: string, lines: number | null }[]}
 */
export function readChangedFiles(numstat) {
  return numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split("\t");
      const isBinary = added === "-" || removed === "-";
      return { path, lines: isBinary ? null : Number(added) + Number(removed) };
    });
}

/**
 * Why a changed file goes unread, or null when it's read.
 * @param {{ path: string, lines: number | null }} file
 */
export function explainUnread({ path, lines }) {
  if (lines === null) return "a binary file";
  if (path === "package-lock.json") return "the lockfile, which npm writes";
  if (RECORDED_DATA.test(path)) return "a test's recorded data";
  if (GENERATED.test(path)) return "a drawing or a minified library, written by a tool";
  return null;
}

/**
 * The area a file of code belongs to, by what it's about.
 * @param {string} path
 */
export function nameCodeArea(path) {
  const app = path.match(/^apps\/([^/]+)\/(page|worker)\//);
  if (app) return `${app[1]} ${app[2] === "page" ? "page" : "Worker"}`;
  if (path.startsWith("shared/page/")) return "shared page";
  if (path.startsWith("shared/worker/")) return "shared Worker";
  if (path.endsWith(".md")) return "docs";
  return "tooling";
}

/** @param {string} path */
const nameTested = (path) => basename(path).replace(/\.(test|spec)\.m?js$|\.m?js$/, "");

/**
 * The relative paths a test imports, as it writes them, or none when it can't be read.
 * @param {string} test
 */
function readTestImports(test) {
  try {
    return [...readFileSync(test, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map(
      (match) => match[1],
    );
  } catch {
    return [];
  }
}

/**
 * The file of code a test tests, by its name, in the test's own app or, for a root test, outside
 * every app, preferring the one it imports where more than one has its name, then one the change
 * changes, or null when no file of code has its name.
 * @param {string} test
 * @param {string[]} changed
 * @param {string[]} repoFiles
 * @param {(test: string) => string[]} [readImports] the relative paths the test imports
 */
export function findTestedFile(test, changed, repoFiles, readImports = readTestImports) {
  const name = nameTested(test);
  const app = test.match(/^apps\/([^/]+)\//)?.[1];
  /** @param {string} path */
  const isInScope = (path) => (app ? path.startsWith(`apps/${app}/`) : !path.startsWith("apps/"));
  /** @param {string} path */
  const isCandidate = (path) =>
    !isTestPath(path) &&
    isInScope(path) &&
    /\.m?js$/.test(path) &&
    basename(path).replace(/\.m?js$/, "") === name;
  const candidates = [...changed, ...repoFiles].filter(isCandidate);
  if (candidates.length < 2) return candidates[0] ?? null;
  const imported = new Set(readImports(test).map((path) => join(dirname(test), path)));
  return candidates.find((path) => imported.has(path)) ?? candidates[0];
}

/**
 * The area a test belongs to: its code's, or else its app's page, or the tooling's.
 * @param {string} test
 * @param {string | null} tested
 */
export function nameTestArea(test, tested) {
  if (tested) return nameCodeArea(tested);
  const app = test.match(/^apps\/([^/]+)\//)?.[1];
  return app ? `${app} page` : "tooling";
}

/**
 * Items split in order into at most so many groups, each closing where its size comes closest to
 * an even share.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} measure
 * @param {number} count
 * @returns {T[][]}
 */
export function splitEvenly(items, measure, count) {
  const share = items.reduce((total, item) => total + measure(item), 0) / count;
  /** @type {T[][]} */
  const groups = [[]];
  let size = 0;
  for (const item of items) {
    const itemSize = measure(item);
    const current = /** @type {T[]} */ (groups.at(-1));
    const isCloserWithout = Math.abs(size - share) < Math.abs(size + itemSize - share);
    if (current.length && isCloserWithout && groups.length < count) {
      groups.push([item]);
      size = itemSize;
    } else {
      current.push(item);
      size += itemSize;
    }
  }
  return groups;
}

// By code point, since a locale's collation ignores some characters, like the NUL in a test's
// order.
/** @param {string} one @param {string} other */
const compareText = (one, other) => Number(one > other) - Number(one < other);

/**
 * Files in order grouped into units, each code file with the tests beside it, so a split between
 * parts never falls between them.
 * @template {{ unit: string }} T
 * @param {T[]} files
 * @returns {T[][]}
 */
function groupInUnits(files) {
  /** @type {T[][]} */
  const units = [];
  for (const file of files) {
    const last = units.at(-1);
    if (last?.[0].unit === file.unit) last.push(file);
    else units.push([file]);
  }
  return units;
}

/**
 * The areas of the files to read, each test beside its code, an area bigger than so many lines
 * split in even parts in path order, never between a file and its tests, and the small ones read
 * together.
 * @param {{ path: string, lines: number }[]} files
 * @param {string[]} repoFiles
 * @param {number} areaLines
 */
function groupInAreas(files, repoFiles, areaLines) {
  const changed = files.map((file) => file.path);
  const placed = files.map((file) => {
    const tested = isTestPath(file.path) ? findTestedFile(file.path, changed, repoFiles) : null;
    const name = isTestPath(file.path) ? nameTestArea(file.path, tested) : nameCodeArea(file.path);
    const unit = tested ?? file.path;
    return { ...file, name, unit, order: tested ? `${tested}\u0000${file.path}` : file.path };
  });
  const names = [...new Set(placed.map((file) => file.name))].sort();
  /** @param {{ lines: number }[]} group */
  const sum = (group) => group.reduce((total, file) => total + file.lines, 0);
  const byName = names.map((name) => ({
    name,
    files: placed
      .filter((file) => file.name === name)
      .toSorted((one, other) => compareText(one.order, other.order)),
  }));
  const isSmall = (/** @type {{ files: { lines: number }[] }} */ area) =>
    sum(area.files) < SMALL_AREA_LINES;
  const small = byName.filter(isSmall);
  const pooled =
    small.length > 1
      ? [{ name: "small changes", files: small.flatMap((area) => area.files) }]
      : small;
  return [...byName.filter((area) => !isSmall(area)), ...pooled].flatMap(
    ({ name, files: areaFiles }) => {
      const partCount = Math.max(1, Math.ceil(sum(areaFiles) / areaLines));
      const units = groupInUnits(areaFiles);
      const parts = splitEvenly(units, (unit) => sum(unit), partCount).map((group) => group.flat());
      return parts.map((part, index) => ({
        name: parts.length > 1 ? `${name}, part ${index + 1}` : name,
        files: part.map((file) => file.path),
      }));
    },
  );
}

/**
 * The areas of the files to read, each up to an area's worth of changed lines, raised as far as it
 * takes to keep to the most areas, or until no area is split, as when more areas each have their
 * own name.
 * @param {{ path: string, lines: number }[]} files
 * @param {string[]} repoFiles
 * @returns {{ area: number, name: string, files: string[] }[]}
 */
export function listAreas(files, repoFiles) {
  const total = files.reduce((sum, file) => sum + file.lines, 0);
  let areaLines = Math.max(AREA_LINES, Math.ceil(total / MOST_AREAS));
  let areas = groupInAreas(files, repoFiles, areaLines);
  while (areas.length > MOST_AREAS && areaLines < total) {
    areaLines = Math.ceil(areaLines * 1.1);
    areas = groupInAreas(files, repoFiles, areaLines);
  }
  return areas.map((area, index) => ({ area: index + 1, ...area }));
}

/**
 * A change's review: the areas to read, and the files left unread with why.
 * @param {string} numstat
 * @param {string[]} repoFiles
 */
export function planReview(numstat, repoFiles) {
  const changed = readChangedFiles(numstat);
  const unread = changed.flatMap((file) => {
    const why = explainUnread(file);
    return why ? [{ path: file.path, why }] : [];
  });
  const toRead = /** @type {{ path: string, lines: number }[]} */ (
    changed.filter((file) => !explainUnread(file))
  );
  return { areas: listAreas(toRead, repoFiles), unread };
}

/**
 * A whole diff split into each file's diff, by its path as the pull request leaves it, or as it
 * was for a deleted file.
 * @param {string} diff
 * @returns {Map<string, string>}
 */
export function splitDiffByFile(diff) {
  /** @type {Map<string, string>} */
  const byPath = new Map();
  for (const fileDiff of diff.split(/^(?=diff --git )/m).filter(Boolean)) {
    const path =
      fileDiff.match(/^\+\+\+ b\/(.+?)\t?$/m)?.[1] ??
      fileDiff.match(/^--- a\/(.+?)\t?$/m)?.[1] ??
      fileDiff.match(/^diff --git a\/(.+) b\//)?.[1];
    if (path) byPath.set(path, fileDiff);
  }
  return byPath;
}

/**
 * The files the pushes since a reviewed head changed that the pull request still changes, so
 * accepting the base's copy leaves no diff for the push's reviewers to read.
 * @param {string[]} pushed
 * @param {(range: string[]) => { numstat: string }} readDiff
 */
export function listPushedFiles(pushed, readDiff) {
  const changed = new Set(readChangedFiles(readDiff(WHOLE_CHANGE).numstat).map(({ path }) => path));
  return readChangedFiles(readDiff(pushed).numstat)
    .map(({ path }) => path)
    .filter((path) => changed.has(path));
}

/**
 * Which review this run makes: the first, of the whole change; reviewed, on the head the last
 * full read ended on, as a label's run is, which leaves that read's summary as it is; one of what
 * the pushes since the last full read changed; or none, when the pushes leave no new changes in
 * files the pull request still changes.
 * @param {object} review
 * @param {string | null} review.reviewedHead the head the last full read ended on
 * @param {string} review.head the pull request's head
 * @param {boolean} [review.isSameBase] whether a trusted review completed on the current base
 * @param {boolean} review.isOnBranch whether that head is still in the pull request's history
 * @param {() => string[]} review.listChanged the files both the pull request and the pushes since changed
 * @returns {{ stage: "first" | "reviewed" | "none" } | { stage: "push", files: string[] }}
 */
export function chooseStage({ reviewedHead, head, isSameBase = true, isOnBranch, listChanged }) {
  if (!reviewedHead || !isOnBranch) return { stage: "first" };
  if (reviewedHead === head && isSameBase) return { stage: "reviewed" };
  const files = listChanged();
  return files.length ? { stage: "push", files } : { stage: "none" };
}

// A stale name lists its first places only, enough for a reviewer to find the rest, and
// each place its first characters only, enough to show how it names what was removed.
const MOST_STALE_HITS = 15;
const HIT_LENGTH = 220;

/**
 * The first places in the repo that still name each function, constant, or file the change
 * removed, a deleted file's places that may name it ahead of those that name only another file
 * of its name.
 * @param {string} diff
 * @param {(pattern: string, isWord: boolean) => string[]} grep every matching line in the repo, as
 * path:line:text
 * @param {string[]} deletedFiles
 */
export function listStaleNames(diff, grep, deletedFiles) {
  const declared =
    /^([-+])\s*export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/;
  /** @type {Set<string>} */
  const removed = new Set();
  /** @type {Set<string>} */
  const added = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(declared);
    if (match) (match[1] === "-" ? removed : added).add(match[2]);
  }
  const isGone = (/** @type {string} */ name) =>
    !grep(
      `(function\\s*\\*?\\s*|const\\s+|let\\s+|class\\s+)${escapePattern(name)}([^A-Za-z0-9_$]|$)`,
      false,
    ).some((hit) => /^[^:]*\.m?js:/.test(hit));
  const names = [...removed]
    .filter((name) => !added.has(name) && isGone(name))
    .map((name) => ({ name, hits: grep(name, true) }));
  const files = deletedFiles.map((path) => ({
    name: basename(path),
    hits: grep(basename(path), true).toSorted(
      (one, other) => Number(mayNameFile(other, path)) - Number(mayNameFile(one, path)),
    ),
  }));
  return [...names, ...files].flatMap(({ name, hits }) =>
    hits.length
      ? [{ name, hits: hits.slice(0, MOST_STALE_HITS).map((hit) => hit.slice(0, HIT_LENGTH)) }]
      : [],
  );
}

// Where the pages' `#shared/` imports and `shared/` links lead, by package.json's imports.
const SHARED_PAGE_FOLDER = String(resolvePackageImport("#shared/"));

/**
 * Whether a place the search found may name a deleted file: some path in its text that the
 * file's path ends with, as written or with a leading `shared/` read as the pages read it, rather
 * than only another file's of the same name.
 * @param {string} hit path:line:text
 * @param {string} path the deleted file's
 */
function mayNameFile(hit, path) {
  const text = hit.replace(/^[^:]*:\d+:/, "");
  const name = escapePattern(basename(path));
  const mentions = text.match(new RegExp(`[\\w./-]*${name}(?!\\w)`, "g")) ?? [];
  return mentions.some((mention) => {
    const tail = mention.replace(/^(?:\.{0,2}\/)+/, "");
    return [tail, tail.replace(/^shared\//, SHARED_PAGE_FOLDER)].some(
      (written) => path === written || path.endsWith(`/${written}`),
    );
  });
}

/** @param {{ name: string, hits: string[] }[]} stale */
const renderStaleNames = (stale) =>
  [
    "# What the change removed that the repo still names",
    "",
    stale.length ? "" : "Nothing the change removed is still named.",
    ...stale.flatMap(({ name, hits }) => [`## ${name}`, "", ...hits.map((hit) => `- ${hit}`), ""]),
  ].join("\n");

/** @param {string[]} lines */
const measureBytes = (lines) => lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);

/**
 * Whether these lines fit in one part.
 * @param {string[]} lines
 */
const fitsInPart = (lines) => lines.length <= PART_LINES && measureBytes(lines) <= PART_BYTES;

/**
 * Lines gathered in order into as few groups as fit in a part each, a line too long for a part
 * alone in its group.
 * @param {string[][]} pieces
 * @returns {string[][]}
 */
function packIntoParts(pieces) {
  /** @type {{ lines: string[], bytes: number }[]} */
  const parts = [];
  for (const piece of pieces) {
    const bytes = measureBytes(piece);
    const last = parts.at(-1);
    const fits =
      last && last.lines.length + piece.length <= PART_LINES && last.bytes + bytes <= PART_BYTES;
    if (last && fits) {
      last.lines.push(...piece);
      last.bytes += bytes;
    } else {
      parts.push({ lines: [...piece], bytes });
    }
  }
  return parts.map((part) => part.lines);
}

/**
 * A diff's line as lines Read returns whole, each piece after the first with the line's own sign
 * and a mark that it goes on.
 * @param {string} line
 * @returns {string[]}
 */
export function wrapLongLine(line) {
  if (line.length <= LONGEST_READ_LINE) return [line];
  const sign = line[0];
  const pieceLength = LONGEST_READ_LINE - sign.length - CONTINUED.length;
  const rest = line.slice(LONGEST_READ_LINE);
  const pieces = Array.from({ length: Math.ceil(rest.length / pieceLength) }, (_, index) =>
    rest.slice(index * pieceLength, (index + 1) * pieceLength),
  );
  return [line.slice(0, LONGEST_READ_LINE), ...pieces.map((piece) => sign + CONTINUED + piece)];
}

/**
 * A file's diff as its hunks, the first with the file's header, a hunk too big for a part cut
 * into pieces that each fit.
 * @param {string} fileDiff
 * @returns {string[][]}
 */
function listPieces(fileDiff) {
  const lines = fileDiff.replace(/\n$/, "").split("\n").flatMap(wrapLongLine);
  /** @type {string[][]} */
  const blocks = [[]];
  let hasHunk = false;
  for (const line of lines) {
    const startsHunk = line.startsWith("@@ ");
    if (startsHunk && hasHunk) blocks.push([]);
    hasHunk ||= startsHunk;
    /** @type {string[]} */ (blocks.at(-1)).push(line);
  }
  return blocks.flatMap((block) =>
    fitsInPart(block) ? [block] : packIntoParts(block.map((line) => [line])),
  );
}

/**
 * A file's diff in parts that each fit, each part whole hunks where a hunk fits.
 * @param {string} fileDiff
 * @returns {string[]}
 */
export const splitIntoParts = (fileDiff) =>
  packIntoParts(listPieces(fileDiff)).map((part) => `${part.join("\n")}\n`);

/**
 * Where each part of a file's diff is written, under the folder.
 * @param {string} stage
 * @param {string} path
 * @param {number} partCount
 * @returns {string[]}
 */
const nameParts = (stage, path, partCount) =>
  partCount === 1
    ? [`${stage}/${path}.diff`]
    : Array.from({ length: partCount }, (_, index) => `${stage}/${path}.part-${index + 1}.diff`);

/** @typedef {{ copy: string, paths: string[] }} RuleCopy a rule file's copy under the folder */

/**
 * @typedef {object} StageChange
 * @property {string} numstat
 * @property {string} diff
 * @property {string[]} repoFiles
 * @property {RuleCopy[]} rules
 */

/**
 * Writes each part of a change's diff for one of the review's stages, and returns its areas with
 * the parts of each file and the rule files their files call for.
 * @param {string} folder
 * @param {string} stage
 * @param {StageChange} change
 */
export function writeStage(folder, stage, { numstat, diff, repoFiles, rules }) {
  const plan = planReview(numstat, repoFiles);
  const diffs = splitDiffByFile(diff);
  const areas = plan.areas.map((area) => {
    /** @type {Record<string, string[]>} */
    const partsByFile = {};
    for (const path of area.files) {
      const fileDiff = diffs.get(path);
      if (fileDiff === undefined)
        throw new Error(`The diff has no part for ${path}, so it can't be read.`);
      const parts = splitIntoParts(fileDiff);
      const names = nameParts(stage, path, parts.length);
      names.forEach((name, index) => {
        mkdirSync(dirname(join(folder, name)), { recursive: true });
        writeFileSync(join(folder, name), parts[index]);
      });
      partsByFile[path] = names;
    }
    return { ...area, partsByFile, rules: listRulesFor(area.files, rules).map(({ copy }) => copy) };
  });
  return { areas, unread: plan.unread };
}

/**
 * Writes a copy of each rule file under the folder, for reviewers to read, and returns where each
 * went with its globs.
 * @param {string} folder
 * @param {{ path: string, text: string }[]} rules
 * @returns {RuleCopy[]}
 */
export function writeRuleCopies(folder, rules) {
  return rules.map(({ path, text }) => {
    const copy = `rules/${path.slice(RULES_FOLDER.length)}`;
    mkdirSync(dirname(join(folder, copy)), { recursive: true });
    writeFileSync(join(folder, copy), text);
    return { copy, paths: readRulePaths(text) };
  });
}

const SHOW_WHOLE_FILE = `\`node worker/review-git.mjs show --diff-merges=first-parent ${WHOLE_CHANGE[1]} -- <path>\` shows a file's whole change.`;

const STAGE_WORDS = {
  first: "The first review of this pull request: each area's diffs hold its whole change.",
  push: `The diffs hold only what the pushes since the last full review changed, in files the pull request still changes. Where they merged the base and git couldn't settle a conflict on its own, a file's diff starts from git's conflict markers, so it shows how the conflict was resolved. ${SHOW_WHOLE_FILE}`,
};

/**
 * The index a reviewer reads first: each area's files with their diff parts and the rule files
 * they call for, then the files left unread.
 * @param {keyof typeof STAGE_WORDS} words
 * @param {ReturnType<typeof writeStage>} written
 */
function renderIndex(words, { areas, unread }) {
  const areaLines = areas.flatMap(({ area, name, files, partsByFile, rules }) => [
    `## Area ${area}: ${name}`,
    "",
    ...files.map((path) => `- ${path}: ${partsByFile[path].join(", ")}`),
    "",
    ...(rules.length ? [`Rule files: ${rules.join(", ")}`, ""] : []),
  ]);
  const unreadLines = unread.length
    ? ["## Not read", "", ...unread.map(({ path, why }) => `- ${path}: ${why}`), ""]
    : [];
  return [
    "# The pull request's changed files",
    "",
    STAGE_WORDS[words],
    `A diff line longer than ${LONGEST_READ_LINE} characters goes on in the lines after it,`,
    `each starting with the line's sign and \`${CONTINUED.trim()}\`.`,
    "",
    ...areaLines,
    ...unreadLines,
  ].join("\n");
}

// GitHub names a matrix's job by its values, and a skipped one, whose matrix it never reads, by
// the job alone, so each area holds only the name its job shows, and the job looks up its number.
/**
 * The review's matrix: its areas, each of which trusted-review-area.yml reviews on its own, each area's
 * number by its name, and how many there are.
 * @param {{ area: number, name: string }[]} areas
 */
export function listJobs(areas) {
  const names = areas.map(({ name }) => name);
  if (new Set(names).size < names.length)
    throw new Error(
      `Two areas share a name, so a job can't look up its area: ${names.join(", ")}.`,
    );
  return {
    areas: names.map((name) => ({ name })),
    areaNumbers: Object.fromEntries(areas.map(({ area, name }) => [name, area])),
    count: areas.length,
  };
}

/**
 * The review's matrix as the lines for $GITHUB_OUTPUT.
 * @param {ReturnType<typeof listJobs>} jobs
 */
export const formatJobOutputs = ({ areas, areaNumbers, count }) =>
  [
    `areas=${JSON.stringify(areas)}`,
    `area-numbers=${JSON.stringify(areaNumbers)}`,
    `count=${count}`,
  ].join("\n");

/** @typedef {ReturnType<typeof writeStage>["areas"][number]} PlannedArea */

/**
 * @typedef {object} Plan
 * @property {string} stage
 * @property {string} [provider]
 * @property {string} [selection]
 * @property {string | null} since the head the last full read ended on, which the summary keeps
 *   until this review finishes
 * @property {PlannedArea[]} areas the stage's areas
 * @property {any[]} unread the files the stage leaves unread, and why
 */

/**
 * The change a stage's reviewers read, with the words its index opens with, or null for a stage
 * with none.
 * @param {ReturnType<typeof chooseStage>} choice
 * @param {string[] | null} pushed
 * @param {(range: string[], files?: string[]) => { numstat: string, diff: string }} readDiff
 * @returns {{ numstat: string, diff: string, words: keyof typeof STAGE_WORDS } | null}
 */
function readStageChange(choice, pushed, readDiff) {
  if (choice.stage === "first") return { ...readDiff(WHOLE_CHANGE), words: "first" };
  if (choice.stage !== "push" || !pushed) return null;
  return { ...readDiff(pushed, choice.files), words: "push" };
}

/**
 * Writes the review's plan, and, for a stage with reviewers, its diffs and index, the list of
 * stale names, and a copy of each rule file.
 * @param {string} folder
 * @param {object} review
 * @param {ReturnType<typeof chooseStage>} review.choice
 * @param {string | null} review.since the head the last full read ended on
 * @param {string[] | null} review.pushed the range that holds what the pushes since it changed
 * @param {(range: string[], files?: string[]) => { numstat: string, diff: string }} review.readDiff
 * @param {string[]} review.repoFiles
 * @param {() => { name: string, hits: string[] }[]} review.listStale
 * @param {{ path: string, text: string }[]} review.rules the rule files as the change leaves them
 */
export function writeReview(
  folder,
  { choice, since, pushed, readDiff, repoFiles, listStale, rules: ruleFiles },
) {
  mkdirSync(folder, { recursive: true });
  /** @type {Plan} */
  const plan = { stage: choice.stage, since, areas: [], unread: [] };
  const change = readStageChange(choice, pushed, readDiff);
  if (change) {
    writeFileSync(join(folder, "stale-names.md"), renderStaleNames(listStale()));
    const rules = writeRuleCopies(folder, ruleFiles);
    const written = writeStage(folder, choice.stage, { ...change, repoFiles, rules });
    writeFileSync(join(folder, `${choice.stage}.md`), renderIndex(change.words, written));
    Object.assign(plan, written);
  }
  writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
  return plan;
}

/** @param {string[]} args */
const readPlanningGit = (args) =>
  readReviewGit(process.cwd(), args, "utf8", { maxBuffer: 1 << 30 });

/** @param {string[]} args */
const tryGit = (args) => {
  try {
    return readPlanningGit(args);
  } catch {
    return null;
  }
};

/**
 * Every line in the repo that matches a pattern, as path:line:text.
 * @param {string} pattern
 * @param {boolean} isWord whether the pattern is a whole word rather than a regular expression
 * @param {(args: string[]) => string | null} git null where git fails, as grep does with no match
 */
export const grepRepo = (pattern, isWord, git) =>
  (git(["grep", "-n", "-I", isWord ? "-wF" : "-E", "-e", pattern, "HEAD"]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((hit) => hit.replace(/^HEAD:/, ""));

// merge-tree's exit code when the merge conflicts, having still written the merged tree.
const MERGE_CONFLICTS = 1;

/**
 * The range that holds what the pushes since a head changed: from that head merged onto the base
 * to the pull request merged onto it, which leaves out the base's own edits. Where that merge
 * conflicts, git writes each conflicted file with its markers, so the range holds how each
 * conflict was resolved, and nothing else the base brought in.
 * @param {string} since
 * @param {(args: string[]) => string} git throws as execFileSync does where git exits with an error
 */
export function findPushedRange(since, git) {
  const args = ["merge-tree", "--write-tree", WHOLE_CHANGE[0], since];
  let output;
  try {
    output = git(args);
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string }} */ (error);
    if (failure.status !== MERGE_CONFLICTS || !failure.stdout) throw error;
    output = failure.stdout;
  }
  return [output.split("\n")[0], "HEAD"];
}

/**
 * The files the change deletes, and the old path of each file git finds renamed, so the name it
 * had is looked for too, but not a file git finds only moved under the same name, which is still
 * named so.
 * @param {(args: string[]) => string} git
 */
export function listDeletedFiles(git) {
  return git(["diff", "--name-status", "--find-renames", ...WHOLE_CHANGE])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(
      ([status, path, movedTo]) =>
        status === "D" || (status.startsWith("R") && basename(path) !== basename(movedTo)),
    )
    .map(([, path]) => path);
}

/**
 * Whether the head the last review read in full is still on the pull request's branch, which a
 * force-push that drops it leaves it off.
 * @param {string | null} reviewedHead
 * @param {string} head
 * @param {(args: string[]) => string | null} git null where git fails, as merge-base does when it
 * isn't
 */
export const isReviewedOnBranch = (reviewedHead, head, git) =>
  reviewedHead !== null && git(["merge-base", "--is-ancestor", reviewedHead, head]) !== null;

/**
 * The pull request's own head, as a commit.
 * @param {(args: string[]) => string} git
 */
export const readPullHead = (git) => git(["rev-parse", PULL_HEAD]).trim();

/** @param {NodeJS.ProcessEnv} env @param {(path:string)=>Promise<any>} [callGitHub] */
export async function readLastReview(
  env,
  callGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY ?? "", fetchImpl: fetch, env }),
) {
  const comments = await readAllPages(callGitHub, `/issues/${env.PR}/comments`);
  const state = readReviewedState(findSummary(comments)?.body);
  if (
    env.REVIEW_PROVIDER &&
    !matchesReviewProvider(state, env.REVIEW_PROVIDER, env.REVIEW_SELECTION)
  )
    return null;
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  const reviewed = await readLastReview(process.env);
  const reviewedHead = reviewed?.head ?? null;
  const head = readPullHead(readPlanningGit);
  const isOnBranch = isReviewedOnBranch(reviewedHead, head, tryGit);
  /** @type {Map<string, { numstat: string, diff: string }>} */
  const diffs = new Map();
  /** @param {string[]} range @param {string[]} [files] */
  const readDiff = (range, files = []) => {
    const key = JSON.stringify([range, files]);
    const paths = files.length ? ["--", ...files] : [];
    if (!diffs.has(key))
      diffs.set(key, {
        numstat: readPlanningGit([
          "diff",
          "--numstat",
          "--text",
          "--no-textconv",
          "--no-ext-diff",
          "--no-renames",
          ...range,
          ...paths,
        ]),
        diff: readPlanningGit([
          "diff",
          "--text",
          "--no-textconv",
          "--no-ext-diff",
          "--no-renames",
          ...range,
          ...paths,
        ]),
      });
    return /** @type {{ numstat: string, diff: string }} */ (diffs.get(key));
  };
  /** @type {string[] | undefined} */
  let pushedRange;
  const readPushedRange = () =>
    (pushedRange ??= findPushedRange(/** @type {string} */ (reviewedHead), readPlanningGit));
  const choice = chooseStage({
    reviewedHead,
    head,
    isSameBase: !process.env.REVIEW_BASE || reviewed?.base === process.env.REVIEW_BASE,
    isOnBranch,
    listChanged: () => listPushedFiles(readPushedRange(), readDiff),
  });
  const pushed = choice.stage === "push" ? readPushedRange() : null;
  const repoFiles = readPlanningGit(["ls-files"]).split("\n").filter(Boolean);
  const plan = writeReview(folder, {
    choice,
    since: reviewedHead,
    pushed,
    readDiff,
    repoFiles,
    listStale: () =>
      listStaleNames(
        readDiff(WHOLE_CHANGE).diff,
        (pattern, isWord) => grepRepo(pattern, isWord, tryGit),
        listDeletedFiles(readPlanningGit),
      ),
    rules: readRuleFiles(
      process.env.REVIEW_RULE_ROOT
        ? readdirSync(join(process.env.REVIEW_RULE_ROOT, RULES_FOLDER)).map(
            (name) => `${RULES_FOLDER}${name}`,
          )
        : repoFiles,
      (path) =>
        readFileSync(
          process.env.REVIEW_RULE_ROOT ? join(process.env.REVIEW_RULE_ROOT, path) : path,
          "utf8",
        ),
    ),
  });
  console.log(`stage=${plan.stage}`);
  console.log(formatJobOutputs(listJobs(plan.areas)));
}
