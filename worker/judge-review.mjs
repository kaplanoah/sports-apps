// Tells whether CI's review read the whole pull request, from what each reviewer actually read
// rather than what it says it read, and keeps one summary comment on the pull request up to date.
// A share's reviewer has read a diff part once a Read of it returned every line, so a part it
// never opened, or opened only in part, is named for its retry and, still unread then, fails the
// review (plan-review.mjs writes the parts).
// Usage, after each try at a share: node worker/judge-review.mjs share <folder> <share>, with
// EXECUTION_FILE and STRUCTURED_OUTPUT from the try; it prints unread=<parts> for $GITHUB_OUTPUT.
// After the check across shares: node worker/judge-review.mjs across <folder>, with
// STRUCTURED_OUTPUT. Last: node worker/judge-review.mjs summary <folder>, with GH_TOKEN,
// GITHUB_REPOSITORY, PR, and SHA set, which fails when any changed file went unread.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

export const SUMMARY_MARKER = "<!-- claude-review-summary -->";
const WEIGHTS = ["Important", "Nit", "Pre-existing", "Unsure"];
// What Claude Code's Read returns when it's given no limit.
const READ_LINES = 2000;

/**
 * The lines each Read call returned, by the absolute path it read, from a run's messages. A Read
 * that answered with an error read nothing.
 * @param {any[]} messages the Claude Agent SDK's messages, as the action's execution file holds them
 * @returns {Map<string, [number, number][]>} each read's first and last line
 */
export function listReads(messages) {
  const blocks = messages.flatMap((message) => message?.message?.content ?? []);
  const failed = new Set(
    blocks
      .filter((block) => block?.type === "tool_result" && block.is_error)
      .map((block) => block.tool_use_id),
  );
  /** @type {Map<string, [number, number][]>} */
  const reads = new Map();
  for (const block of blocks) {
    if (block?.type !== "tool_use" || block.name !== "Read" || failed.has(block.id)) continue;
    const { file_path: path, offset = 1, limit = READ_LINES } = block.input ?? {};
    if (typeof path !== "string") continue;
    const first = Math.max(1, Number(offset));
    const range = /** @type {[number, number]} */ ([first, first + Number(limit) - 1]);
    reads.set(resolve(path), [...(reads.get(resolve(path)) ?? []), range]);
  }
  return reads;
}

/**
 * Whether the reads cover every line of a file of so many lines.
 * @param {[number, number][]} ranges
 * @param {number} lineCount
 */
export function coversEveryLine(ranges, lineCount) {
  let nextUnread = 1;
  for (const [first, last] of ranges.toSorted((one, other) => one[0] - other[0])) {
    if (first > nextUnread) break;
    nextUnread = Math.max(nextUnread, last + 1);
  }
  return nextUnread > lineCount;
}

/** @param {string} text */
const countLines = (text) => text.replace(/\n$/, "").split("\n").length;

/**
 * The parts a share's reviewer hasn't read every line of, over all its tries.
 * @param {string[]} parts named under the folder
 * @param {[string, [number, number][]][][]} triesReads each try's reads, by absolute path
 * @param {(part: string) => string} readPart
 * @param {string} folder
 */
export function findUnreadParts(parts, triesReads, readPart, folder) {
  return parts.filter((part) => {
    const path = resolve(folder, part);
    const ranges = triesReads.flatMap((reads) =>
      reads.filter(([readPath]) => readPath === path).flatMap(([, pathRanges]) => pathRanges),
    );
    return !coversEveryLine(ranges, countLines(readPart(part)));
  });
}

/**
 * A reviewer's answer, or an empty one when it gave none, as when a try ran out of time.
 * @param {string | undefined} structuredOutput
 * @returns {{ findings: { weight: string, file: string, line?: number, summary: string }[], notes: string[], unjudged: { file: string, why: string }[] }}
 */
export function readAnswer(structuredOutput) {
  try {
    const answer = JSON.parse(structuredOutput || "{}");
    return {
      findings: Array.isArray(answer.findings) ? answer.findings : [],
      notes: Array.isArray(answer.notes) ? answer.notes : [],
      unjudged: Array.isArray(answer.unjudged) ? answer.unjudged : [],
    };
  } catch {
    return { findings: [], notes: [], unjudged: [] };
  }
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} path */
const readExecution = (path) => (path && existsSync(path) ? readJson(path) : []);

/**
 * Adds a try to the share's record and returns the parts still unread.
 * @param {string} folder
 * @param {number} share
 * @param {NodeJS.ProcessEnv} env
 */
export function recordShareTry(folder, share, env) {
  const plan = readJson(join(folder, "plan.json"));
  const { partsByFile } = plan.shares.find((/** @type {any} */ entry) => entry.share === share);
  /** @type {string[]} */
  const parts = Object.values(partsByFile).flat();
  const recordPath = join(folder, `share-${share}.json`);
  const record = existsSync(recordPath) ? readJson(recordPath) : { share, tries: [] };
  record.tries.push({
    reads: [...listReads(readExecution(env.EXECUTION_FILE ?? "")).entries()],
    answer: readAnswer(env.STRUCTURED_OUTPUT),
  });
  record.unread = findUnreadParts(
    parts,
    record.tries.map((/** @type {any} */ attempt) => attempt.reads),
    (part) => readFileSync(join(folder, part), "utf8"),
    folder,
  );
  writeFileSync(recordPath, JSON.stringify(record));
  return record.unread;
}

/**
 * @param {{ weight: string }[]} findings
 */
const countByWeight = (findings) =>
  WEIGHTS.map((weight) => [weight, findings.filter((finding) => finding.weight === weight).length])
    .filter(([, count]) => count)
    .map(([weight, count]) => `${count} ${weight}`)
    .join(", ");

/** @param {{ path: string, why: string }} file */
const listUnread = ({ path, why }) => `- \`${path}\`: ${why}`;

/** @param {number} count @param {string} noun */
const pluralize = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the review found and read, and whether it read the whole pull request.
 * @param {object} review
 * @param {string} review.sha
 * @param {{ shares: { share: number, files: string[], partsByFile: Record<string, string[]> }[], unread: { path: string, why: string }[] }} review.plan
 * @param {Map<number, any>} review.records each share's record, missing for a share that never finished
 * @param {any | null} review.across the check across shares, or null when it didn't finish
 */
export function judgeReview({ sha, plan, records, across }) {
  const isAcrossDue = plan.shares.length > 1;
  const answers = [...records.values()].flatMap((record) =>
    record.tries.map((/** @type {any} */ attempt) => attempt.answer),
  );
  if (across) answers.push(across);
  const findings = answers.flatMap((answer) => answer.findings);
  const unjudged = answers.flatMap((answer) => answer.unjudged);
  const missedShares = plan.shares.filter(({ share }) => !records.has(share));
  const unreadFiles = plan.shares.flatMap(({ share, files, partsByFile }) => {
    const record = records.get(share);
    if (!record) return files;
    return files.filter((path) => partsByFile[path].some((part) => record.unread.includes(part)));
  });
  const changedCount = plan.shares.flatMap((share) => share.files).length;
  const isComplete = !unreadFiles.length && (!isAcrossDue || Boolean(across));
  const found = findings.length
    ? `${pluralize(findings.length, "finding")} (${countByWeight(findings)})`
    : "no findings";
  const lines = plan.shares.length
    ? [
        SUMMARY_MARKER,
        `Claude reviewed ${sha} in ${pluralize(plan.shares.length, "share")}: ${found}, each on the line it's about.`,
        "",
        `Read in full: ${changedCount - unreadFiles.length} of ${pluralize(changedCount, "changed file")} to read.`,
      ]
    : [SUMMARY_MARKER, `Claude had nothing to read in ${sha}.`];
  if (plan.unread.length)
    lines.push("", "Left unread, as nothing to review:", ...plan.unread.map(listUnread));
  if (unreadFiles.length) {
    const why = missedShares.length
      ? `${pluralize(missedShares.length, "share")} didn't finish`
      : "a reviewer didn't read every line of them";
    lines.push(
      "",
      `**Not read, since ${why}, so the review fails until a re-run reads them:**`,
      ...unreadFiles.map((path) => `- \`${path}\``),
    );
  }
  if (isAcrossDue && !across)
    lines.push("", "**The check across shares didn't finish, so the review fails.**");
  if (unjudged.length)
    lines.push(
      "",
      "Read but couldn't be judged from the code:",
      ...unjudged.map(({ file, why }) => `- \`${file}\`: ${why}`),
    );
  return { isComplete, body: lines.join("\n") };
}

/**
 * Posts the summary, or updates the one an earlier review posted.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {string} pullNumber
 * @param {string} body
 */
export async function postSummary(callGitHub, pullNumber, body) {
  const comments = await readAllPages(callGitHub, `/issues/${pullNumber}/comments`);
  const earlier = comments.find((comment) => comment.body?.startsWith(SUMMARY_MARKER));
  if (earlier)
    await callGitHub(`/issues/comments/${earlier.id}`, { method: "PATCH", body: { body } });
  else await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
}

/** @param {string} folder */
function readRecords(folder) {
  /** @type {Map<number, any>} */
  const records = new Map();
  for (const name of readdirSync(folder)) {
    const match = name.match(/^share-(\d+)\.json$/);
    if (match) records.set(Number(match[1]), readJson(join(folder, name)));
  }
  return records;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, folder, share] = process.argv.slice(2);
  const { env } = process;
  if (command === "share") {
    console.log(`unread=${recordShareTry(folder, Number(share), env).join(" ")}`);
  } else if (command === "across") {
    writeFileSync(join(folder, "across.json"), JSON.stringify(readAnswer(env.STRUCTURED_OUTPUT)));
  } else if (command === "summary") {
    const acrossPath = join(folder, "across.json");
    const { isComplete, body } = judgeReview({
      sha: env.SHA ?? "",
      plan: readJson(join(folder, "plan.json")),
      records: readRecords(folder),
      across: existsSync(acrossPath) ? readJson(acrossPath) : null,
    });
    const callGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY ?? "",
      fetchImpl: fetch,
      env,
    });
    await postSummary(callGitHub, env.PR ?? "", body);
    console.log(body);
    if (!isComplete) {
      console.log("::error::The review didn't read every changed file.");
      process.exit(1);
    }
  } else {
    console.error("Usage: node worker/judge-review.mjs share|across|summary <folder> [share]");
    process.exit(1);
  }
}
