// The files a unified diff changes, and each one as it was before the change, rebuilt from the
// file as the change leaves it and the change's hunks.

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
export function readBothSides(file, readPageFile) {
  const after = readPageFile(file.path);
  const before = readFileBefore(after, file);
  return before === null ? null : { before, after };
}

/**
 * The items of `items` that `taken` doesn't account for, each item of `taken` taking away the
 * first copy left of an item with the same key.
 * @template T
 * @param {T[]} items
 * @param {T[]} taken
 * @param {(item: T) => string} [readKey]
 */
export function subtractEach(items, taken, readKey = String) {
  const counts = new Map();
  for (const item of taken) counts.set(readKey(item), (counts.get(readKey(item)) ?? 0) + 1);
  return items.filter((item) => {
    const count = counts.get(readKey(item)) ?? 0;
    counts.set(readKey(item), count - 1);
    return count <= 0;
  });
}

/**
 * The items of `items` that `other` holds too, in the order `items` has them, each item of `other`
 * matching the first copy left of an item with the same key.
 * @template T
 * @param {T[]} items
 * @param {T[]} other
 * @param {(item: T) => string} [readKey]
 */
function keepShared(items, other, readKey = String) {
  const counts = new Map();
  for (const item of other) counts.set(readKey(item), (counts.get(readKey(item)) ?? 0) + 1);
  return items.filter((item) => {
    const count = counts.get(readKey(item)) ?? 0;
    counts.set(readKey(item), count - 1);
    return count > 0;
  });
}

/**
 * Whether the items both lists hold stand in the same order in each.
 * @template T
 * @param {T[]} first
 * @param {T[]} second
 * @param {(item: T) => string} [readKey]
 */
export function isSharedOrderKept(first, second, readKey = String) {
  const firstShared = keepShared(first, second, readKey).map(readKey);
  const secondShared = keepShared(second, first, readKey).map(readKey);
  return firstShared.every((key, index) => key === secondShared[index]);
}
