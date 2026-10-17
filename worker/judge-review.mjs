// Tells whether CI's review read everything it was due, from what each reviewer actually read
// rather than what it says it read, gathers each area's candidates for its checker, and keeps one
// summary comment on the pull request up to date. A reviewer has read a diff part once a Read of
// it returned every line, so a part it never opened, or opened only in part, is named for its
// retry and, still unread then, fails the review (plan-review.mjs writes the parts).
// A reviewer that gave no answer, as one that ran out of turns, is tried again too, and a checker
// that left any of its reviewers' cases unnamed hasn't finished.
// Usage, after each try of a reviewer: node worker/judge-review.mjs find <folder> <stage> <area>
// <kind>, with EXECUTION_FILE and STRUCTURED_OUTPUT from the try; it prints unread=<parts> and
// answered=<true|false> for $GITHUB_OUTPUT. Before an area's checker: node
// worker/judge-review.mjs candidates <folder> <stage> <area>. After it: node
// worker/judge-review.mjs check <folder> <stage> <area>, with STRUCTURED_OUTPUT; it prints
// unchecked=<count of cases it left unnamed> for $GITHUB_OUTPUT. Last: node
// worker/judge-review.mjs summary <folder>, with GH_TOKEN, GITHUB_REPOSITORY, PR, and SHA set,
// which fails when anything due went unread or unchecked.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { listStageKinds } from "./plan-review.mjs";
import {
  SUMMARY_MARKER,
  WEIGHTS,
  findSummary,
  readReviewedHead,
  writeReviewedHead,
} from "./review-state.mjs";

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

/**
 * A Claude step's structured answer, its lists by the keys it must hold and what it couldn't
 * judge, or null when it gave none, as when it ran out of turns, or gave one of another shape.
 * @param {string | undefined} structuredOutput
 * @param {string[]} keys
 * @returns {({ unjudged: { file: string, why: string }[] } & Record<string, any[]>) | null}
 */
export function readAnswer(structuredOutput, keys) {
  try {
    const answer = JSON.parse(structuredOutput || "null");
    if (!keys.every((key) => Array.isArray(answer?.[key]))) return null;
    return {
      ...Object.fromEntries(keys.map((key) => [key, answer[key]])),
      unjudged: Array.isArray(answer.unjudged) ? answer.unjudged : [],
    };
  } catch {
    return null;
  }
}

/**
 * A reviewer's or checker's answer as its record keeps it: the cases or findings it listed, and
 * what it couldn't judge, or null when it gave none.
 * @param {string | undefined} structuredOutput
 * @param {"candidates" | "findings"} key
 */
const readListAnswer = (structuredOutput, key) => {
  const answer = readAnswer(structuredOutput, [key]);
  return answer && { items: answer[key], unjudged: answer.unjudged };
};

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} path */
const readExecution = (path) => (path && existsSync(path) ? readJson(path) : []);

/**
 * The areas of a stage, from the plan.
 * @param {any} plan
 * @param {string} stage
 * @returns {{ area: number, name: string, files: string[], partsByFile: Record<string, string[]> }[]}
 */
const listStageAreas = (plan, stage) => (stage === "final" ? plan.final : plan.areas);

// Each job's record, by the name it's saved under in the review's folder: its job, then what it
// covers, so the judge reads back each job's records, and only theirs, by the job alone.
const RECORD_JOBS = ["find", "candidates", "check", "across", "post"];
/** @param {(string | number)[]} parts */
const joinRecordName = (...parts) => parts.join("-");
/** @param {string} stage @param {number} area @param {string} kind */
const nameFindRecord = (stage, area, kind) => `${joinRecordName("find", stage, area, kind)}.json`;
/** @param {string} stage @param {number} area */
const nameCandidatesRecord = (stage, area) => `${joinRecordName("candidates", stage, area)}.json`;
/** @param {string} stage @param {number} area */
export const nameCheckRecord = (stage, area) => `${joinRecordName("check", stage, area)}.json`;
/** @param {string} stage */
export const nameAcrossRecord = (stage) => `${joinRecordName("across", stage)}.json`;
/** @param {string} stage */
export const namePostRecord = (stage) => `${joinRecordName("post", stage)}.json`;
/** @param {string} stage */
export const nameConfirmedRecord = (stage) => `${joinRecordName("confirmed", stage)}.json`;

/**
 * Adds a try to a reviewer's record, and returns the parts it still hasn't read and whether its
 * last try answered.
 * @param {string} folder
 * @param {{ stage: string, area: number, kind: string }} reviewer
 * @param {NodeJS.ProcessEnv} env
 */
export function recordFindTry(folder, { stage, area, kind }, env) {
  const plan = readJson(join(folder, "plan.json"));
  const { partsByFile } = listStageAreas(plan, stage).find((entry) => entry.area === area) ?? {};
  /** @type {string[]} */
  const parts = Object.values(partsByFile ?? {}).flat();
  const recordPath = join(folder, nameFindRecord(stage, area, kind));
  const record = existsSync(recordPath) ? readJson(recordPath) : { stage, area, kind, tries: [] };
  record.tries.push({
    reads: [...listReads(readExecution(env.EXECUTION_FILE ?? "")).entries()],
    answer: readListAnswer(env.STRUCTURED_OUTPUT, "candidates"),
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
 * Every candidate an area's reviewers listed over their tries, each with an id its checker names
 * it by.
 * @param {any[]} records the area's reviewers' records
 */
export const gatherCandidates = (records) =>
  records.flatMap((record) =>
    record.tries
      .flatMap((/** @type {any} */ attempt) => attempt.answer?.items ?? [])
      .map((/** @type {any} */ candidate, /** @type {number} */ index) => ({
        id: `${record.kind}-${index + 1}`,
        ...candidate,
      })),
  );

/**
 * The records of one area's reviewers, never another area's whose number starts the same.
 * @param {Map<string, any>} records by file name
 * @param {string} stage
 * @param {number} area
 */
export const listAreaRecords = (records, stage, area) =>
  [...records.entries()]
    .filter(([name]) => name.startsWith(`${joinRecordName("find", stage, area)}-`))
    .map(([, record]) => record);

/**
 * The records the review's jobs leave in the folder, by file name.
 * @param {string} folder
 */
export function readRecords(folder) {
  /** @type {Map<string, any>} */
  const records = new Map();
  for (const name of readdirSync(folder)) {
    const isRecord =
      RECORD_JOBS.some((job) => name.startsWith(`${job}-`)) && name.endsWith(".json");
    if (isRecord) records.set(name, readJson(join(folder, name)));
  }
  return records;
}

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
 * The ids of an area's candidates that no finding of its checker names.
 * @param {{ id: string }[]} candidates
 * @param {{ ids: string[] }[]} findings
 */
export function listUnchecked(candidates, findings) {
  const named = new Set(findings.flatMap((finding) => finding.ids ?? []));
  return candidates.map((candidate) => candidate.id).filter((id) => !named.has(id));
}

/**
 * Keeps a checker's answer as its area's record, and returns the candidates it left unchecked,
 * which the judge counts the same way, so the job fails where the judge would.
 * @param {string} folder
 * @param {{ stage: string, area: number }} checker
 * @param {string | undefined} structuredOutput
 */
export function keepCheck(folder, { stage, area }, structuredOutput) {
  const answer = readListAnswer(structuredOutput, "findings");
  if (!answer) throw new Error("The checker gave no answer.");
  writeFileSync(join(folder, nameCheckRecord(stage, area)), JSON.stringify(answer));
  return listUnchecked(readJson(join(folder, nameCandidatesRecord(stage, area))), answer.items);
}

/**
 * The files an area's reviewers left unread, and the reviewers and checker that didn't finish.
 * @param {string} stage
 * @param {{ area: number, name: string, files: string[], partsByFile: Record<string, string[]> }} area
 * @param {Map<string, any>} records
 */
function judgeArea(stage, { area, name, files, partsByFile }, records) {
  /** @type {string[]} */
  const unreadFiles = [];
  /** @type {string[]} */
  const missing = [];
  for (const { kind, role } of listStageKinds(stage)) {
    const record = records.get(nameFindRecord(stage, area, kind));
    if (!record || !record.isAnswered) missing.push(`the ${role} of ${name}`);
    unreadFiles.push(
      ...files.filter(
        (path) => !record || partsByFile[path].some((part) => record.unread.includes(part)),
      ),
    );
  }
  const check = records.get(nameCheckRecord(stage, area));
  const unchecked = check
    ? listUnchecked(records.get(nameCandidatesRecord(stage, area)) ?? [], check.items)
    : [];
  if (!check) missing.push(`the checker of ${name}`);
  else if (unchecked.length)
    missing.push(
      `the checker of ${name}, which left ${pluralize(unchecked.length, "case")} unchecked`,
    );
  return { unreadFiles, missing };
}

/**
 * What one stage read, checked, and posted, and what it left undone.
 * @param {string} stage
 * @param {any[]} areas
 * @param {Map<string, any>} records
 */
function judgeStage(stage, areas, records) {
  const judged = areas.map((area) => judgeArea(stage, area, records));
  const post = records.get(namePostRecord(stage)) ?? null;
  const missing = judged.flatMap((area) => area.missing);
  if (areas.length > 1 && !records.has(nameAcrossRecord(stage)))
    missing.push("the check across areas");
  if (!post) missing.push("the step that posts the findings");
  const checks = areas.flatMap(({ area }) => records.get(nameCheckRecord(stage, area)) ?? []);
  const verdicts = checks.flatMap((check) =>
    check.items.map((/** @type {any} */ item) => item.verdict),
  );
  const reviewers = areas.flatMap(({ area }) => listAreaRecords(records, stage, area));
  const unjudged = [
    ...reviewers.flatMap((record) =>
      record.tries.flatMap((/** @type {any} */ attempt) => attempt.answer?.unjudged ?? []),
    ),
    ...checks.flatMap((check) => check.unjudged),
    ...(post?.unjudged ?? []),
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
    `read the whole change in ${pluralize(areaCount, "area")}, ${listStageKinds("first").length} reviewers an area`,
  push: (/** @type {number} */ areaCount, /** @type {string} */ since) =>
    `read what the pushes since ${since.slice(0, 7)} changed, in ${pluralize(areaCount, "area")}`,
};

/**
 * Whether a stage read every file and finished every job.
 * @param {ReturnType<typeof judgeStage>} judged
 */
const isStageFinished = (judged) => !judged.unreadFiles.length && !judged.missing.length;

/**
 * The stages the review was due to finish: the one the plan chose, and the last read of the
 * whole change when a review of the pushes since finished and posted nothing.
 * @param {any} plan
 * @param {Map<string, any>} records
 * @returns {{ stage: string, areas: any[] }[]}
 */
export function listDueStages(plan, records) {
  if (!plan.areas.length) return [];
  const stages = [{ stage: plan.stage, areas: plan.areas }];
  const isFinalDue =
    plan.stage === "push" &&
    plan.final.length > 0 &&
    isStageFinished(judgeStage(plan.stage, plan.areas, records)) &&
    records.get(namePostRecord(plan.stage))?.weights.length === 0;
  return isFinalDue ? [...stages, { stage: "final", areas: plan.final }] : stages;
}

/**
 * The summary's lines on what one stage read, checked, and posted.
 * @param {ReturnType<typeof judgeStage>} judged
 * @param {{ stage: string, areas: any[], sha: string, since: string | null }} context
 */
function describeStage(judged, { stage, areas, sha, since }) {
  const repeated = judged.repeated
    ? `, and found ${pluralize(judged.repeated, "finding")} already on it`
    : "";
  const found = `${describeFound(judged.weights)}${repeated}`;
  const lines = [
    stage === "final"
      ? `Then it read the whole change once more, one reviewer an area, to find what the earlier reads missed: ${found}.`
      : `Claude reviewed ${sha}: it ${LEADS[/** @type {"first" | "push"} */ (stage)](areas.length, since ?? "")}, and posted ${found}.`,
    "",
    `Checked: the checkers turned down ${judged.rejected} of ${pluralize(judged.checked, "candidate")} the reviewers listed, after merging repeats.`,
    `Read in full: ${judged.fileCount - judged.unreadFiles.length} of ${pluralize(judged.fileCount, "changed file")} to read.`,
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
 * The summary's opening when no stage was due.
 * @param {any} plan
 * @param {string} sha
 * @param {string | null} earlierHead
 */
const describeNothingDue = (plan, sha, earlierHead) =>
  plan.stage === "none"
    ? `Claude read nothing new in ${sha}: the pushes since ${(earlierHead ?? "").slice(0, 7)} change only what a merge of the base brings in.`
    : `Claude had nothing to read in ${sha}.`;

/**
 * What the review read, found, and checked, whether it did everything it was due, and the head
 * the next push's review reads since, which moves on only once it did.
 * @param {object} review
 * @param {string} review.sha the pull request's head
 * @param {string | null} review.earlierHead the head the last full read ended on
 * @param {any} review.plan
 * @param {Map<string, any>} review.records the reviewers', checkers', and posting steps' records
 */
export function judgeReview({ sha, earlierHead, plan, records }) {
  const stages = listDueStages(plan, records);
  const judged = stages.map(({ stage, areas }) => judgeStage(stage, areas, records));
  const isComplete = judged.every(isStageFinished);
  const reviewedHead = isComplete ? sha : earlierHead;
  const lines = [
    SUMMARY_MARKER,
    ...(reviewedHead ? [writeReviewedHead(reviewedHead)] : []),
    ...(stages.length
      ? stages.flatMap(({ stage, areas }, index) =>
          describeStage(judged[index], { stage, areas, sha, since: plan.since }),
        )
      : [describeNothingDue(plan, sha, earlierHead), ""]),
    ...(plan.unread.length
      ? ["Left unread, as nothing to review:", ...plan.unread.map(listUnread)]
      : []),
  ];
  return { isComplete, body: lines.join("\n").trimEnd() };
}

/**
 * Posts the summary, or updates the one an earlier review posted.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {string} pullNumber
 * @param {any | null} earlier the earlier summary
 * @param {string} body
 */
export async function postSummary(callGitHub, pullNumber, earlier, body) {
  if (earlier)
    await callGitHub(`/issues/comments/${earlier.id}`, { method: "PATCH", body: { body } });
  else await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, folder, stage, area, kind] = process.argv.slice(2);
  const { env } = process;
  if (command === "find") {
    const { unread, isAnswered } = recordFindTry(folder, { stage, area: Number(area), kind }, env);
    console.log(`unread=${unread.join(" ")}`);
    console.log(`answered=${isAnswered}`);
  } else if (command === "candidates") {
    const records = listAreaRecords(readRecords(folder), stage, Number(area));
    writeFileSync(
      join(folder, nameCandidatesRecord(stage, Number(area))),
      JSON.stringify(gatherCandidates(records), null, 1),
    );
  } else if (command === "check") {
    const unchecked = keepCheck(folder, { stage, area: Number(area) }, env.STRUCTURED_OUTPUT);
    console.log(`unchecked=${unchecked.length}`);
  } else if (command === "summary") {
    const callGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY ?? "",
      fetchImpl: fetch,
      env,
    });
    const earlier = findSummary(await readAllPages(callGitHub, `/issues/${env.PR}/comments`));
    const { isComplete, body } = judgeReview({
      sha: env.SHA ?? "",
      earlierHead: readReviewedHead(earlier?.body),
      plan: readJson(join(folder, "plan.json")),
      records: readRecords(folder),
    });
    await postSummary(callGitHub, env.PR ?? "", earlier, body);
    console.log(body);
    if (!isComplete) {
      console.log("::error::The review didn't read and check everything it was due.");
      process.exit(1);
    }
  } else {
    console.error("Usage: node worker/judge-review.mjs find|candidates|check|summary <folder> ...");
    process.exit(1);
  }
}
