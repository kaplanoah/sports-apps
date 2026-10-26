// Tells whether CI's review read everything it was due, from what each reviewer actually read
// rather than what it says it read, gathers the reviewers' candidates for the check across areas,
// and keeps one summary comment on the pull request up to date. A reviewer has read a diff part
// once a Read of it returned every line, so a part it never opened, or opened only in part, is
// named for its retry and, still unread then, fails the review, as does a rule file its area calls
// for (plan-review.mjs writes the parts and the rule files' copies).
// A reviewer that gave no answer, as one that ran out of turns, is tried again too, and a check
// across areas that left any of the reviewers' problems unnamed hasn't finished.
// Usage, after each try of an area's reviewer: node worker/judge-review.mjs find <folder> <area>,
// with EXECUTION_FILE and STRUCTURED_OUTPUT from the try; it prints unread=<parts> and
// answered=<true|false> for $GITHUB_OUTPUT. Before the check across areas: node
// worker/judge-review.mjs candidates <folder>. After it: node worker/judge-review.mjs across
// <folder>, with STRUCTURED_OUTPUT; it prints unchecked=<count of problems it left unnamed> for
// $GITHUB_OUTPUT. Last: node worker/judge-review.mjs summary <folder>, with GH_TOKEN,
// GITHUB_REPOSITORY, PR, and SHA set, which fails when anything due went unread or unchecked.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import {
  SUMMARY_MARKER,
  WEIGHTS,
  findSummary,
  writeReviewedHead,
  escapeReviewText,
} from "./review-state.mjs";

// What Claude Code's Read returns when it's given no limit.
const READ_LINES = 2000;

/**
 * The lines each Read call returned, by the absolute path it read, from a run's messages. A Read
 * that answered with an error read nothing.
 * @param {any[]} messages the Claude Agent SDK's messages, as the action's execution file holds
 * them
 * @returns {Map<string, [number, number][]>} each read's first and last line
 */
export function listReads(messages) {
  const blocks = messages.flatMap((message) => message?.message?.content ?? []);
  const returned = new Set(
    blocks
      .filter((block) => block?.type === "tool_result" && !block.is_error)
      .map((block) => block.tool_use_id),
  );
  /** @type {Map<string, [number, number][]>} */
  const reads = new Map();
  for (const block of blocks) {
    if (block?.type !== "tool_use" || block.name !== "Read" || !returned.has(block.id)) continue;
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
 * The parts a reviewer hasn't read every line of, over all its tries.
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

/** @param {unknown} item */
const isObject = (item) => typeof item === "object" && item !== null;

/**
 * A Claude step's structured answer, its list by the key it must hold and what it couldn't
 * judge, or null when it gave none, as when it ran out of turns, or gave one of another shape.
 * The list keeps only its entries that are objects, and what it couldn't judge only those that
 * name a file and why, so every later step reads the same lists however Claude shaped them.
 * @param {string | undefined} structuredOutput
 * @param {"candidates" | "findings"} key
 * @returns {{ items: any[], unjudged: { file: string, why: string }[] } | null}
 */
export function readAnswer(structuredOutput, key) {
  try {
    const answer = JSON.parse(structuredOutput || "null");
    if (!Array.isArray(answer?.[key])) return null;
    const unjudged = Array.isArray(answer.unjudged) ? answer.unjudged : [];
    return {
      items: answer[key].filter(isObject),
      unjudged: unjudged.filter(
        (item) => isObject(item) && typeof item.file === "string" && typeof item.why === "string",
      ),
    };
  } catch {
    return null;
  }
}

/** @param {string} path */
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} path */
const readExecution = (path) => (path && existsSync(path) ? readJson(path) : []);

/** @typedef {import('./plan-review.mjs').PlannedArea} PlannedArea */

/** @typedef {import('./plan-review.mjs').Plan} Plan */

/**
 * The review's plan, as plan-review.mjs leaves it in the folder.
 * @param {string} folder
 * @returns {Plan}
 */
const readPlan = (folder) => readJson(join(folder, "plan.json"));

// Each job's record, by the name it's saved under in the review's folder: its job, then the area
// it covers, so the judge reads back each job's records, and only theirs, by the job alone. An
// area can be the expression a workflow names it by, so a test can check the workflows' paths
// against these.
const RECORD_JOBS = Object.freeze({
  find: "find",
  candidates: "candidates",
  across: "across",
  post: "post",
});
/** @param {number | string} area */
export const nameFindRecord = (area) => `${RECORD_JOBS.find}-${area}.json`;
export const CANDIDATES_RECORD = `${RECORD_JOBS.candidates}.json`;
export const ACROSS_RECORD = `${RECORD_JOBS.across}.json`;
export const POST_RECORD = `${RECORD_JOBS.post}.json`;
const RECORD_NAME = new RegExp(`^(${Object.values(RECORD_JOBS).join("|")})(-\\d+)?\\.json$`);

/**
 * A reviewer's try as the lines for $GITHUB_OUTPUT: its unread parts and whether it answered.
 * @param {{ unread: string[], isAnswered: boolean }} kept
 */
export const formatFindOutputs = ({ unread, isAnswered }) =>
  `unread=${unread.join(" ")}\nanswered=${isAnswered}`;

/**
 * Adds a try to an area's reviewer's record, and returns the parts it still hasn't read and
 * whether its last try answered.
 * @param {string} folder
 * @param {number} area
 * @param {NodeJS.ProcessEnv} env
 */
export function recordFindTry(folder, area, env) {
  const planned = readPlan(folder).areas.find((entry) => entry.area === area);
  if (!planned) throw new Error(`The plan has no area ${area}.`);
  const parts = [...Object.values(planned.partsByFile).flat(), ...planned.rules];
  const recordPath = join(folder, nameFindRecord(area));
  const record = existsSync(recordPath) ? readJson(recordPath) : { area, tries: [] };
  record.tries.push({
    reads: [...listReads(readExecution(env.EXECUTION_FILE ?? "")).entries()].map(
      ([path, ranges]) => {
        const part = env.REVIEW_DATA ? relative(env.REVIEW_DATA, path) : null;
        return [part !== null && !part.startsWith("..") ? resolve(folder, part) : path, ranges];
      },
    ),
    answer: readAnswer(env.STRUCTURED_OUTPUT, "candidates"),
  });
  record.unread = findUnreadParts(
    parts,
    record.tries.map((/** @type {any} */ attempt) => attempt.reads),
    (part) => readFileSync(join(folder, part), "utf8"),
    folder,
  );
  record.isAnswered = record.tries.at(-1).answer !== null;
  writeFileSync(recordPath, JSON.stringify(record));
  return { unread: record.unread, isAnswered: record.isAnswered };
}

/**
 * Every candidate the areas' reviewers listed over their tries, each with an id the check across
 * areas names it by.
 * @param {any[]} records the reviewers' records
 */
export const gatherCandidates = (records) =>
  records.flatMap((record) =>
    record.tries
      .flatMap((/** @type {any} */ attempt) => attempt.answer?.items ?? [])
      .map((/** @type {any} */ candidate, /** @type {number} */ index) => ({
        id: `${record.area}.${index + 1}`,
        ...candidate,
      })),
  );

/**
 * The records the review's jobs leave in the folder, by file name.
 * @param {string} folder
 */
export function readRecords(folder) {
  /** @type {Map<string, any>} */
  const records = new Map();
  for (const name of readdirSync(folder))
    if (RECORD_NAME.test(name)) records.set(name, readJson(join(folder, name)));
  return records;
}

/**
 * The records of the planned areas' reviewers, in area order, leaving out an area whose reviewer
 * left none, which the summary names.
 * @param {Map<string, any>} records by file name
 * @param {PlannedArea[]} areas
 */
const listReviewerRecords = (records, areas) =>
  areas.flatMap(({ area }) => records.get(nameFindRecord(area)) ?? []);

/** @param {string[]} weights */
const countByWeight = (weights) =>
  WEIGHTS.map((weight) => [weight, weights.filter((posted) => posted === weight).length])
    .filter(([, count]) => count)
    .map(([weight, count]) => `${count} ${weight}`)
    .join(", ");

/** @param {{ path: string, why: string }} file */
const listUnread = ({ path, why }) => `- \`${path}\`: ${why}`;

/** @param {string} path */
const listFile = (path) => `- \`${path}\``;

/** @param {number} count @param {string} noun */
const pluralize = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** @param {string[]} weights */
const describeFound = (weights) =>
  weights.length
    ? `${pluralize(weights.length, "finding")} (${countByWeight(weights)})`
    : "no findings";

/**
 * The ids of the candidates that no finding of the check across areas names.
 * @param {{ id: string }[]} candidates
 * @param {{ ids: string[] }[]} findings
 */
export function listUnchecked(candidates, findings) {
  const named = new Set(findings.flatMap((finding) => finding.ids ?? []));
  return candidates.map((candidate) => candidate.id).filter((id) => !named.has(id));
}

/**
 * Keeps every area's candidates, every try's, for the check across areas, and returns how many
 * there are.
 * @param {string} folder
 */
export function keepCandidates(folder) {
  const reviewers = listReviewerRecords(readRecords(folder), readPlan(folder).areas);
  const candidates = gatherCandidates(reviewers);
  writeFileSync(join(folder, CANDIDATES_RECORD), JSON.stringify(candidates, null, 1));
  return candidates.length;
}

/**
 * Keeps the check across areas' answer as its record, and returns the candidates it left
 * unchecked, which the judge counts the same way, so the job fails where the judge would.
 * @param {string} folder
 * @param {string | undefined} structuredOutput
 */
export function keepAcross(folder, structuredOutput) {
  const candidates = readJson(join(folder, CANDIDATES_RECORD));
  const answer = readAnswer(structuredOutput, "findings");
  if (!answer) throw new Error("The check across areas gave no answer.");
  writeFileSync(join(folder, ACROSS_RECORD), JSON.stringify(answer));
  return listUnchecked(candidates, answer.items);
}

/**
 * Whether a finding of the check across areas stands for candidates the reviewers listed, rather
 * than one the check added itself.
 * @param {{ ids?: unknown }} finding
 */
const isFromReviewers = (finding) => Array.isArray(finding.ids) && finding.ids.length > 0;

/**
 * The files an area's reviewer left unread, and whether it didn't finish, as one that left a rule
 * file unread hasn't.
 * @param {PlannedArea} area
 * @param {Map<string, any>} records
 */
function judgeArea({ area, name, files, partsByFile, rules }, records) {
  const record = records.get(nameFindRecord(area));
  const unreadRules = record ? rules.filter((rule) => record.unread.includes(rule)) : [];
  const unreadFiles = files.filter(
    (path) => !record || partsByFile[path].some((part) => record.unread.includes(part)),
  );
  if (!record || !record.isAnswered) return { unreadFiles, missing: [`the reviewer of ${name}`] };
  if (unreadRules.length)
    return {
      unreadFiles,
      missing: [`the reviewer of ${name}, which left ${unreadRules.join(", ")} unread`],
    };
  return { unreadFiles, missing: [] };
}

/**
 * What the review read, checked, and posted, and what it left undone.
 * @param {PlannedArea[]} areas
 * @param {Map<string, any>} records
 */
function judgeAreas(areas, records) {
  const judged = areas.map((area) => judgeArea(area, records));
  const across = records.get(ACROSS_RECORD) ?? null;
  const post = records.get(POST_RECORD) ?? null;
  const missing = judged.flatMap((area) => area.missing);
  const unchecked = across ? listUnchecked(records.get(CANDIDATES_RECORD) ?? [], across.items) : [];
  if (!across) missing.push("the check across areas");
  else if (unchecked.length)
    missing.push(
      `the check across areas, which left ${pluralize(unchecked.length, "problem")} unchecked`,
    );
  if (!post) missing.push("the step that posts the findings");
  const verdicts = (across?.items ?? [])
    .filter(isFromReviewers)
    .map((/** @type {any} */ item) => item.verdict);
  const unjudged = [
    ...listReviewerRecords(records, areas).flatMap((record) =>
      record.tries.flatMap((/** @type {any} */ attempt) => attempt.answer?.unjudged ?? []),
    ),
    ...(across?.unjudged ?? []),
  ];
  return {
    unreadFiles: [...new Set(judged.flatMap((area) => area.unreadFiles))],
    missing,
    weights: post?.weights ?? [],
    repeated: post?.repeated ?? 0,
    rejected: verdicts.filter((verdict) => verdict === "rejected").length,
    checked: verdicts.length,
    unjudged,
    fileCount: areas.flatMap((area) => area.files).length,
  };
}

const LEADS = {
  first: (/** @type {number} */ areaCount) =>
    `read the whole change in ${pluralize(areaCount, "area")}`,
  push: (/** @type {number} */ areaCount, /** @type {string} */ since) =>
    `read what the pushes since ${since.slice(0, 7)} changed in files the pull request still changes, in ${pluralize(areaCount, "area")}`,
};

/**
 * The summary's lines on what the review read, checked, and posted.
 * @param {ReturnType<typeof judgeAreas>} judged
 * @param {{ plan: Plan, sha: string }} context
 */
function describeReview(judged, { plan, sha }) {
  const repeated = judged.repeated
    ? `, and found ${pluralize(judged.repeated, "finding")} already on it`
    : "";
  const lead = LEADS[/** @type {"first" | "push"} */ (plan.stage)];
  const verification =
    plan.provider === "codex"
      ? plan.areas.length === 1
        ? "the contained session"
        : "the integration pass"
      : "the check across areas";
  const lines = [
    `${plan.provider === "codex" ? "Codex" : "Claude"} reviewed ${sha}: it ${lead(plan.areas.length, plan.since ?? "")}, and posted ${describeFound(judged.weights)}${repeated}.`,
    "",
    `Checked: ${verification} turned down ${judged.rejected} of ${pluralize(judged.checked, "candidate")} ${plan.provider === "codex" ? "listed during investigation" : "the reviewers listed"}, after merging repeats.`,
    `${plan.provider === "codex" ? "Supplied in full" : "Read in full"}: ${judged.fileCount - judged.unreadFiles.length} of ${pluralize(judged.fileCount, "changed file")} to read.`,
  ];
  if (judged.unreadFiles.length)
    lines.push(
      "",
      "**Not read in full, since a reviewer didn't read every line of them or didn't finish, so the review fails until a re-run reads them:**",
      ...judged.unreadFiles.map(listFile),
    );
  if (judged.missing.length)
    lines.push(
      "",
      "**Didn't finish, so the review fails until a re-run:**",
      ...judged.missing.map((what) => `- ${what}`),
    );
  if (judged.unjudged.length)
    lines.push(
      "",
      "Read but couldn't be judged from the code:",
      ...judged.unjudged.map(({ file, why }) => `- \`${file}\`: ${why}`),
    );
  return [...lines, ""];
}

/**
 * The summary's opening when there was nothing to read.
 * @param {Plan} plan
 * @param {string} sha
 */
const describeNothingDue = (plan, sha) =>
  plan.stage === "none"
    ? `${plan.provider === "codex" ? "Codex" : "Claude"} read nothing new in ${sha}: the pushes since ${(plan.since ?? "").slice(0, 7)} leave no new changes to review in files the pull request still changes.`
    : `${plan.provider === "codex" ? "Codex" : "Claude"} had nothing to read in ${sha}.`;

/**
 * What the review read, found, and checked, whether it did everything it was due, and the head
 * the next review reads since, which moves on only once it did. A run on the head the last full
 * read ended on has no summary of its own, so that read's stands.
 * @param {object} review
 * @param {string} review.sha the pull request's head
 * @param {string} [review.base] the immutable base of a trusted review
 * @param {Plan} review.plan
 * @param {Map<string, any>} review.records the reviewers', the check across areas', and the
 *   posting step's records
 */
export function judgeReview({ sha, base, plan, records }) {
  if (plan.stage === "reviewed") return { isComplete: true, body: null };
  const judged = plan.areas.length ? judgeAreas(plan.areas, records) : null;
  const isComplete = !judged || (!judged.unreadFiles.length && !judged.missing.length);
  const reviewedHead = isComplete ? sha : plan.since;
  const lines = [
    SUMMARY_MARKER,
    writeReviewedHead(reviewedHead, base, plan.provider, plan.selection),
    ...(judged ? describeReview(judged, { plan, sha }) : [describeNothingDue(plan, sha), ""]),
    ...(plan.unread.length
      ? ["Left unread, as nothing to review:", ...plan.unread.map(listUnread)]
      : []),
  ];
  return {
    isComplete,
    body: [...lines.slice(0, 2), ...lines.slice(2).map(escapeReviewText)].join("\n").trimEnd(),
  };
}

/**
 * Posts the summary, or updates the one an earlier review posted, or, with no summary of this
 * run's own, leaves the earlier one as it is.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ pullNumber: string, earlier: any | null, body: string | null }} summary
 */
export async function settleSummary(callGitHub, { pullNumber, earlier, body }) {
  if (body) await postSummary(callGitHub, pullNumber, earlier, body);
}

/**
 * Posts the summary, or updates the one an earlier review posted.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {string} pullNumber
 * @param {any | null} earlier the earlier summary
 * @param {string} body
 */
async function postSummary(callGitHub, pullNumber, earlier, body) {
  if (earlier)
    await callGitHub(`/issues/comments/${earlier.id}`, { method: "PATCH", body: { body } });
  else await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, folder, area] = process.argv.slice(2);
  const { env } = process;
  if (command === "find") {
    console.log(formatFindOutputs(recordFindTry(folder, Number(area), env)));
  } else if (command === "candidates") {
    console.log(`The reviewers listed ${pluralize(keepCandidates(folder), "candidate")}.`);
  } else if (command === "across") {
    console.log(`unchecked=${keepAcross(folder, env.STRUCTURED_OUTPUT).length}`);
  } else if (command === "summary") {
    const callGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY ?? "",
      fetchImpl: fetch,
      env,
    });
    const earlier = findSummary(await readAllPages(callGitHub, `/issues/${env.PR}/comments`));
    const { isComplete, body } = judgeReview({
      sha: env.SHA ?? "",
      base: env.REVIEW_BASE,
      plan: readPlan(folder),
      records: readRecords(folder),
    });
    await settleSummary(callGitHub, { pullNumber: env.PR ?? "", earlier, body });
    console.log(body ?? "This head was already reviewed in full, so its summary stands.");
    if (!isComplete) {
      console.log("::error::The review didn't read and check everything it was due.");
      process.exit(1);
    }
  } else {
    console.error(
      "Usage: node worker/judge-review.mjs find|candidates|across|summary <folder> ...",
    );
    process.exit(1);
  }
}
