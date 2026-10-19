// Splits a pull request's change into areas by what its files are about, each test with the code
// it tests, so CI's review (the review jobs in ci.yml, and review-area.yml for each area) has a
// reviewer for each kind of problem in KINDS read each area in full. The first review reads the
// whole change. A review after it reads only what the pushes since the last full read changed,
// and the whole change is read once more alongside it, by FINAL_KIND's reviewer, whose findings
// are posted only when that review finishes and posts nothing. A push that changes only what a merge of the base brings in is read by no
// one, and neither is a run on the head the last full read ended on, as a label's is. A test's
// recorded data, the lockfile, a binary file, and a drawing or minified library a tool wrote go
// unread, named in the summary instead.
// Each file's diff is written in parts a reviewer reads whole, which judge-review.mjs checks.
// Usage: node worker/plan-review.mjs <folder>, in a full checkout of the pull request's merge
// commit, whose first parent is the base branch and second the pull request's head, with GH_TOKEN,
// GITHUB_REPOSITORY, and PR set to read the last review's summary. It prints each stage's areas
// and kinds of reviewer, and their counts, for $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestPath } from "./deploy-scope.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { findSummary, readReviewedHead } from "./review-state.mjs";

const AREA_LINES = 2000;
// A smaller area shares its reviewers with the other small ones.
const SMALL_AREA_LINES = 150;
const MOST_AREAS = 12;
// Half the lines one Read returns, and about half the 25,000 tokens it returns at most even for
// prose of long lines, so a part comes back whole.
export const PART_LINES = 1000;
export const PART_BYTES = 48000;
// Read cuts a longer line short, so a part holds a longer line in pieces, each marked as going on.
const LONGEST_READ_LINE = 2000;
const CONTINUED = "(cont.) ";

// From the base to the pull request merged onto it: the whole change, as the merge would make it.
export const WHOLE_CHANGE = ["HEAD^1", "HEAD"];
// The pull request's own head, the second parent of the merge commit CI checks out.
const PULL_HEAD = "HEAD^2";

const RECORDED_DATA = /(^|\/)tests\/fixtures\/.*\.(json|xml)$/;
const GENERATED = /\.(svg|min\.js)$/;

const BUG_ITEMS =
  'REVIEW.md\'s "What to look for" items 1 (Bugs), 4 (Budgets and outside services), 5 (Security), and 6 (Red changes)';

// Each area's reviewers, one for each kind of problem, two for bugs, which matter most and which
// one reader misses most.
export const KINDS = [
  { kind: "bugs", role: "bugs reviewer", focus: `${BUG_ITEMS}.` },
  {
    kind: "bugs-from-end",
    role: "second bugs reviewer",
    focus: `${BUG_ITEMS}. Read your diffs from the last part to the first, and each from its end.`,
  },
  {
    kind: "rules",
    role: "rules reviewer",
    focus:
      'REVIEW.md\'s "What to look for" items 2 (One fact, one rule, one place), 3 (Both apps, every place), 8 (Leftovers), 9 (Search), 10 (Docs and comments the change makes wrong), and 11 (Any other rule in AGENTS.md). For each new helper, constant, rule, or wording, search the repo for one that already does the same. Start from `.review/stale-names.md`, which lists the first places that still name each thing the change removed, and search the repo for the rest.',
  },
  {
    kind: "tests",
    role: "tests reviewer",
    focus:
      'REVIEW.md\'s "What to look for" item 7 (Tests). For each change to behavior, find the test that would fail without it, or report that none does. Also report a test the change makes vacuous, and a browser test that would pass only some of the time.',
  },
];

// The whole change's last read, which finds what the first review missed.
export const FINAL_KIND = {
  kind: "all",
  role: "last reviewer",
  focus: 'Every item in REVIEW.md\'s "What to look for".',
};

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
  if (/^[^/]+\.md$/.test(path)) return "docs";
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
function nameTestArea(test, tested) {
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
 * A file's diff from its first hunk on, without the line numbers in its hunks' headers, so a diff
 * that a merge of the base only moved down the file reads the same, while a block moved within
 * the change, which its context shows, reads as changed. A diff with no hunk, as a binary file's
 * or a change of mode alone, reads as its header, whose blob hashes and modes change with it.
 * @param {string} fileDiff
 */
export function describeChange(fileDiff) {
  const lines = fileDiff.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) return lines.slice(1).join("\n");
  return lines
    .slice(firstHunk)
    .map((line) => line.replace(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/, "@@"))
    .join("\n");
}

/**
 * The files whose change differs between two of a pull request's diffs, as a push changes them.
 * @param {string} earlier the diff from the earlier head's base to the earlier head
 * @param {string} now the diff from the base to the head
 */
export function listChangedSince(earlier, now) {
  const before = splitDiffByFile(earlier);
  const after = splitDiffByFile(now);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.filter(
    (path) => describeChange(before.get(path) ?? "") !== describeChange(after.get(path) ?? ""),
  );
}

/**
 * The files the pushes since a reviewed head changed: those the pushed range changes, the range
 * the push's reviewers read, or, where that range holds the base's edits too, those whose change
 * from that head's base differs from the whole change now.
 * @param {object} review
 * @param {string} review.reviewedHead
 * @param {{ range: string[], hasBase: boolean }} review.pushed
 * @param {(one: string, other: string) => string} review.findMergeBase
 * @param {(range: string[]) => { numstat: string, diff: string }} review.readDiff
 */
export function listPushedFiles({ reviewedHead, pushed, findMergeBase, readDiff }) {
  if (!pushed.hasBase)
    return readChangedFiles(readDiff(pushed.range).numstat).map(({ path }) => path);
  const earlierBase = findMergeBase(WHOLE_CHANGE[0], reviewedHead);
  return listChangedSince(readDiff([earlierBase, reviewedHead]).diff, readDiff(WHOLE_CHANGE).diff);
}

/**
 * Which review this run makes: the first, of the whole change; reviewed, on the head the last
 * full read ended on, as a label's run is, which leaves that read's summary as it is; one of what
 * the pushes since the last full read changed; or none, when they changed only what a merge of the
 * base brings in.
 * @param {object} review
 * @param {string | null} review.reviewedHead the head the last full read ended on
 * @param {string} review.head the pull request's head
 * @param {boolean} review.isOnBranch whether that head is still in the pull request's history
 * @param {() => string[]} review.listChanged the files the pushes since changed
 * @returns {{ stage: "first" | "reviewed" | "none" } | { stage: "push", files: string[] }}
 */
export function chooseStage({ reviewedHead, head, isOnBranch, listChanged }) {
  if (!reviewedHead || !isOnBranch) return { stage: "first" };
  if (reviewedHead === head) return { stage: "reviewed" };
  const files = listChanged();
  return files.length ? { stage: "push", files } : { stage: "none" };
}

// A stale name lists its first places only, enough for the rules reviewer to find the rest, and
// each place its first characters only, enough to show how it names what was removed.
const MOST_STALE_HITS = 15;
const HIT_LENGTH = 220;

/**
 * Text made safe to match word for word in a regular expression.
 * @param {string} text
 */
export const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
const SHARED_PAGE_FOLDER = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).imports["#shared/*"].replace(/^\.\/|\*$/g, "");

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

/**
 * Writes each part of a change's diff for one of the review's stages, and returns its areas with
 * the parts of each file.
 * @param {string} folder
 * @param {string} stage
 * @param {{ numstat: string, diff: string, repoFiles: string[] }} change
 */
export function writeStage(folder, stage, { numstat, diff, repoFiles }) {
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
    return { ...area, partsByFile };
  });
  return { areas, unread: plan.unread };
}

const SHOW_WHOLE_FILE = `\`git diff ${WHOLE_CHANGE.join(" ")} -- <path>\` shows a file's whole change.`;

const STAGE_WORDS = {
  first: "The first review of this pull request: each area's diffs hold its whole change.",
  push: `The diffs hold only what the pushes since the last full review changed. ${SHOW_WHOLE_FILE}`,
  "push-with-base": `The diffs hold what the pushes since the last full review changed, and, where those pushes merged the base and git couldn't set the base's own edits apart, those edits too: judge only what the pull request changed. ${SHOW_WHOLE_FILE}`,
  final: "The last read of the whole change: each area's diffs hold its whole change.",
};

/**
 * The index a reviewer reads first: each area's files with their diff parts, then the files left
 * unread.
 * @param {keyof typeof STAGE_WORDS} words
 * @param {ReturnType<typeof writeStage>} written
 */
function renderIndex(words, { areas, unread }) {
  const areaLines = areas.flatMap(({ area, name, files, partsByFile }) => [
    `## Area ${area}: ${name}`,
    "",
    ...files.map((path) => `- ${path}: ${partsByFile[path].join(", ")}`),
    "",
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

/**
 * The kinds of reviewer a stage's areas each have: all of them for the first review and a push's,
 * one that looks for everything for the last read, and none when nothing is read.
 * @param {string} stage
 */
export function listStageKinds(stage) {
  if (stage === "first" || stage === "push") return KINDS;
  return stage === "final" ? [FINAL_KIND] : [];
}

/**
 * A stage's matrices: its areas, each of which ci.yml reviews and then checks on its own, the
 * kinds of reviewer each area has, and how many reviewers that makes.
 * @param {{ area: number, name: string }[]} areas
 * @param {{ kind: string, focus: string }[]} kinds
 */
export const listJobs = (areas, kinds) => ({
  areas: areas.map(({ area, name }) => ({ area, name })),
  kinds: kinds.map(({ kind, focus }) => ({ kind, focus })),
  count: areas.length * kinds.length,
});

/**
 * A stage's matrices as the lines for $GITHUB_OUTPUT, each named after the prefix its jobs read.
 * @param {string} prefix
 * @param {ReturnType<typeof listJobs>} jobs
 */
export const formatJobOutputs = (prefix, { areas, kinds, count }) =>
  [
    `${prefix}areas=${JSON.stringify(areas)}`,
    `${prefix}area-count=${areas.length}`,
    `${prefix}kinds=${JSON.stringify(kinds)}`,
    `${prefix}count=${count}`,
  ].join("\n");

/**
 * Writes a stage's diffs and index, and returns its areas and files left unread.
 * @param {string} folder
 * @param {"first" | "push" | "final"} stage
 * @param {{ numstat: string, diff: string, repoFiles: string[] }} change
 * @param {keyof typeof STAGE_WORDS} [words]
 */
function writeIndexedStage(folder, stage, change, words = stage) {
  const written = writeStage(folder, stage, change);
  writeFileSync(join(folder, `${stage}.md`), renderIndex(words, written));
  return written;
}

/** @typedef {ReturnType<typeof writeStage>["areas"][number]} PlannedArea */

/**
 * @typedef {object} Plan
 * @property {string} stage
 * @property {string | null} since the head the last full read ended on, which the summary keeps
 *   until this review finishes
 * @property {PlannedArea[]} areas the stage's areas
 * @property {any[]} unread the files the stage leaves unread, and why
 * @property {PlannedArea[]} final the last read's areas, which a push's review reads alongside it
 * @property {any[]} finalUnread the files the last read leaves unread, and why
 */

/**
 * Writes the review's plan, its stages' diffs and indexes, and, for a stage with reviewers, the
 * list of stale names.
 * @param {string} folder
 * @param {object} review
 * @param {ReturnType<typeof chooseStage>} review.choice
 * @param {string | null} review.since the head the last full read ended on
 * @param {{ range: string[], hasBase: boolean } | null} review.pushed the range that holds what
 *   the pushes since it changed, and whether it also holds the base's own edits
 * @param {(range: string[], files?: string[]) => { numstat: string, diff: string }} review.readDiff
 * @param {string[]} review.repoFiles
 * @param {() => { name: string, hits: string[] }[]} review.listStale
 */
export function writeReview(folder, { choice, since, pushed, readDiff, repoFiles, listStale }) {
  mkdirSync(folder, { recursive: true });
  if (listStageKinds(choice.stage).length)
    writeFileSync(join(folder, "stale-names.md"), renderStaleNames(listStale()));
  /** @type {Plan} */
  const plan = {
    stage: choice.stage,
    since,
    areas: [],
    unread: [],
    final: [],
    finalUnread: [],
  };
  if (choice.stage === "first")
    Object.assign(
      plan,
      writeIndexedStage(folder, "first", { ...readDiff(WHOLE_CHANGE), repoFiles }),
    );
  if (choice.stage === "push") {
    const change = { ...readDiff(pushed.range, choice.files), repoFiles };
    const words = pushed.hasBase ? "push-with-base" : "push";
    Object.assign(plan, writeIndexedStage(folder, "push", change, words));
    const last = writeIndexedStage(folder, "final", { ...readDiff(WHOLE_CHANGE), repoFiles });
    Object.assign(plan, { final: last.areas, finalUnread: last.unread });
  }
  writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
  return plan;
}

// Paths as they are, not quoted and escaped, so the two diffs name each file alike.
/** @param {string[]} args */
const runGit = (args) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });

/** @param {string[]} args */
const tryGit = (args) => {
  try {
    return runGit(args);
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

/**
 * The range that holds what the pushes since a head changed: from that head merged onto the base
 * to the pull request merged onto it, which leaves out the base's own edits, or, where that merge
 * conflicts, from the head to the pull request's head, which holds them too.
 * @param {string} since
 * @param {(args: string[]) => string | null} git null where git fails, as merge-tree does on a
 * conflict
 */
export function findPushedRange(since, git) {
  const mergedTree = git(["merge-tree", "--write-tree", WHOLE_CHANGE[0], since])?.split("\n")[0];
  return mergedTree
    ? { range: [mergedTree, "HEAD"], hasBase: false }
    : { range: [since, PULL_HEAD], hasBase: true };
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

/** @param {NodeJS.ProcessEnv} env */
async function readLastReviewedHead(env) {
  const callGitHub = createGitHub({
    repository: env.GITHUB_REPOSITORY ?? "",
    fetchImpl: fetch,
    env,
  });
  const comments = await readAllPages(callGitHub, `/issues/${env.PR}/comments`);
  return readReviewedHead(findSummary(comments)?.body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  const reviewedHead = await readLastReviewedHead(process.env);
  const head = readPullHead(runGit);
  const isOnBranch = isReviewedOnBranch(reviewedHead, head, tryGit);
  /** @type {Map<string, { numstat: string, diff: string }>} */
  const diffs = new Map();
  /** @param {string[]} range @param {string[]} [files] */
  const readDiff = (range, files = []) => {
    const key = JSON.stringify([range, files]);
    const paths = files.length ? ["--", ...files] : [];
    if (!diffs.has(key))
      diffs.set(key, {
        numstat: runGit(["diff", "--numstat", "--no-renames", ...range, ...paths]),
        diff: runGit(["diff", "--no-renames", ...range, ...paths]),
      });
    return /** @type {{ numstat: string, diff: string }} */ (diffs.get(key));
  };
  /** @type {{ range: string[], hasBase: boolean } | undefined} */
  let pushedRange;
  const readPushedRange = () =>
    (pushedRange ??= findPushedRange(/** @type {string} */ (reviewedHead), tryGit));
  const choice = chooseStage({
    reviewedHead,
    head,
    isOnBranch,
    listChanged: () =>
      listPushedFiles({
        reviewedHead: /** @type {string} */ (reviewedHead),
        pushed: readPushedRange(),
        findMergeBase: (one, other) => runGit(["merge-base", one, other]).trim(),
        readDiff,
      }),
  });
  const pushed = choice.stage === "push" ? readPushedRange() : null;
  const plan = writeReview(folder, {
    choice,
    since: reviewedHead,
    pushed,
    readDiff,
    repoFiles: runGit(["ls-files"]).split("\n").filter(Boolean),
    listStale: () =>
      listStaleNames(
        readDiff(WHOLE_CHANGE).diff,
        (pattern, isWord) => grepRepo(pattern, isWord, tryGit),
        listDeletedFiles(runGit),
      ),
  });
  console.log(`stage=${plan.stage}`);
  console.log(formatJobOutputs("", listJobs(plan.areas, listStageKinds(plan.stage))));
  console.log(formatJobOutputs("final-", listJobs(plan.final, listStageKinds("final"))));
}
