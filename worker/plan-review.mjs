// Splits a pull request's change into shares small enough for one reviewer to read in full, so CI
// reviews a change of any size with one reviewer per share at once (the review jobs in ci.yml). A
// share holds changed files in path order, so a folder's files stay together, up to a share's
// worth of changed lines; a file bigger than that is a share of its own. Recorded data, like a
// test's fixture, the lockfile, and a binary file, goes unread, named in the summary instead.
// Each file's diff is written in parts a reviewer reads whole, which judge-review.mjs checks.
// Usage: node worker/plan-review.mjs <folder>, in a checkout of the pull request's merge commit,
// whose first parent is the base branch. It prints shares=<JSON> and count=<shares> for
// $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHARE_LINES = 800;
const MOST_SHARES = 20;
// Half the lines one Read returns, and about half the 25,000 tokens it returns at most even for
// prose of long lines, so a part comes back whole.
export const PART_LINES = 1000;
export const PART_BYTES = 48000;
// Read cuts a longer line short.
const LONGEST_READ_LINE = 2000;

const RECORDED_DATA = /(^|\/)tests\/fixtures\/.*\.(json|xml)$/;

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

/** @param {string} fileDiff */
const hasLineTooLongToRead = (fileDiff) =>
  fileDiff.split("\n").some((line) => line.length > LONGEST_READ_LINE);

/**
 * Why a changed file goes unread, or null when it's read.
 * @param {{ path: string, lines: number | null }} file
 * @param {string} fileDiff
 */
export function explainUnread({ path, lines }, fileDiff) {
  if (lines === null) return "a binary file";
  if (path === "package-lock.json") return "the lockfile, which npm writes";
  if (RECORDED_DATA.test(path)) return "a test's recorded data";
  if (hasLineTooLongToRead(fileDiff)) return "a line too long to read whole, like an image's data";
  return null;
}

/**
 * The shares of the files to read in path order, each up to so many changed lines.
 * @param {{ path: string, lines: number }[]} files
 * @param {number} shareLines
 * @returns {{ share: number, files: string[], lines: number }[]}
 */
function packInOrder(files, shareLines) {
  /** @type {{ share: number, files: string[], lines: number }[]} */
  const shares = [];
  for (const file of files.toSorted((first, second) => first.path.localeCompare(second.path))) {
    const last = shares.at(-1);
    if (last && last.lines + file.lines <= shareLines) {
      last.files.push(file.path);
      last.lines += file.lines;
    } else {
      shares.push({ share: shares.length + 1, files: [file.path], lines: file.lines });
    }
  }
  return shares;
}

/**
 * The shares of the files to read, each up to a share's worth of changed lines, raised as far as
 * it takes to keep to the most shares.
 * @param {{ path: string, lines: number }[]} files
 */
export function packShares(files) {
  const total = files.reduce((sum, file) => sum + file.lines, 0);
  let shareLines = Math.max(SHARE_LINES, Math.ceil(total / MOST_SHARES));
  let shares = packInOrder(files, shareLines);
  while (shares.length > MOST_SHARES) {
    shareLines = Math.ceil(shareLines * 1.1);
    shares = packInOrder(files, shareLines);
  }
  return shares;
}

/**
 * A pull request's review: the shares to read, and the files left unread with why.
 * @param {string} numstat
 * @param {Map<string, string>} diffs each file's diff, by its path
 */
export function planReview(numstat, diffs) {
  const changed = readChangedFiles(numstat);
  const explain = (/** @type {{ path: string, lines: number | null }} */ file) =>
    explainUnread(file, diffs.get(file.path) ?? "");
  const unread = changed.flatMap((file) => {
    const why = explain(file);
    return why ? [{ path: file.path, why }] : [];
  });
  const toRead = changed.filter((file) => !explain(file));
  return {
    shares: packShares(/** @type {{ path: string, lines: number }[]} */ (toRead)),
    unread,
  };
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
      fileDiff.match(/^\+\+\+ b\/(.+)$/m)?.[1] ??
      fileDiff.match(/^--- a\/(.+)$/m)?.[1] ??
      fileDiff.match(/^diff --git a\/(.+) b\//)?.[1];
    if (path) byPath.set(path, fileDiff);
  }
  return byPath;
}

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
 * A file's diff as its hunks, the first with the file's header, a hunk too big for a part cut
 * into pieces that each fit.
 * @param {string} fileDiff
 * @returns {string[][]}
 */
function listPieces(fileDiff) {
  const lines = fileDiff.replace(/\n$/, "").split("\n");
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
 * @param {string} path
 * @param {number} partCount
 * @returns {string[]}
 */
export const nameParts = (path, partCount) =>
  partCount === 1
    ? [`diffs/${path}.diff`]
    : Array.from({ length: partCount }, (_, index) => `diffs/${path}.part-${index + 1}.diff`);

/**
 * The index a reviewer reads first: each share's files with their diff parts, then the files left
 * unread.
 * @param {ReturnType<typeof planReview>} plan
 * @param {Map<string, string[]>} partsByPath
 */
export function renderIndex({ shares, unread }, partsByPath) {
  const shareLines = shares.flatMap(({ share, files }) => [
    `## Share ${share}`,
    "",
    ...files.map((path) => `- ${path}: ${(partsByPath.get(path) ?? []).join(", ")}`),
    "",
  ]);
  const unreadLines = unread.length
    ? ["## Not read", "", ...unread.map(({ path, why }) => `- ${path}: ${why}`), ""]
    : [];
  return [
    "# The pull request's changed files",
    "",
    `${shares.length} shares, each read in full by its own reviewer.`,
    "",
    ...shareLines,
    ...unreadLines,
  ].join("\n");
}

/**
 * Writes the plan, the index, and each file's diff parts under the folder.
 * @param {string} folder
 * @param {{ numstat: string, diff: string }} change
 */
export function writeReview(folder, { numstat, diff }) {
  const diffs = splitDiffByFile(diff);
  const plan = planReview(numstat, diffs);
  /** @type {Map<string, string[]>} */
  const partsByPath = new Map();
  for (const path of plan.shares.flatMap((share) => share.files)) {
    const parts = splitIntoParts(diffs.get(path) ?? "");
    const names = nameParts(path, parts.length);
    names.forEach((name, index) => {
      mkdirSync(dirname(join(folder, name)), { recursive: true });
      writeFileSync(join(folder, name), parts[index]);
    });
    partsByPath.set(path, names);
  }
  const shares = plan.shares.map((share) => ({
    ...share,
    partsByFile: Object.fromEntries(share.files.map((path) => [path, partsByPath.get(path)])),
  }));
  writeFileSync(join(folder, "plan.json"), JSON.stringify({ shares, unread: plan.unread }));
  writeFileSync(join(folder, "files.md"), renderIndex(plan, partsByPath));
  return { shares, unread: plan.unread };
}

/** @param {string[]} args */
const runGit = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  const { shares } = writeReview(folder, {
    numstat: runGit(["diff", "--numstat", "--no-renames", "HEAD^1", "HEAD"]),
    diff: runGit(["diff", "--no-renames", "HEAD^1", "HEAD"]),
  });
  const matrix = shares.map(({ share, lines }) => ({ share, lines }));
  console.log(`shares=${JSON.stringify(matrix)}`);
  console.log(`count=${shares.length}`);
}
