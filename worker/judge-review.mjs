// Tells whether CI's review read everything it was due, from what each reviewer actually read
// rather than what it says it read, gathers each area's candidates for its checker, and keeps one
// summary comment on the pull request up to date. A reviewer has read a diff part once a Read of
// it returned every line, so a part it never opened, or opened only in part, is named for its
// retry and, still unread then, fails the review (plan-review.mjs writes the parts).
// Usage, after each try of a reviewer: node worker/judge-review.mjs find <folder> <stage> <area>
// <kind>, with EXECUTION_FILE and STRUCTURED_OUTPUT from the try; it prints unread=<parts> for
// $GITHUB_OUTPUT. Before an area's checker: node worker/judge-review.mjs candidates <folder>
// <stage> <area>. After it: node worker/judge-review.mjs check <folder> <stage> <area>, with
// STRUCTURED_OUTPUT. Last: node worker/judge-review.mjs summary <folder>, with GH_TOKEN,
// GITHUB_REPOSITORY, PR, and SHA set, which fails when anything due went unread or unchecked.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { FINAL_KIND, KINDS } from "./plan-review.mjs";
import {
  SUMMARY_MARKER,
  findSummary,
  readReviewedHead,
  writeReviewedHead,
} from "./review-state.mjs";

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
 * A reviewer's or checker's answer, or an empty one when it gave none, as when a try ran out of
 * turns.
 * @param {string | undefined} structuredOutput
 * @param {"candidates" | "findings"} list
 * @returns {{ items: any[], unjudged: { file: string, why: string }[] }}
 */
export function readAnswer(structuredOutput, list) {
  try {
    const answer = JSON.parse(structuredOutput || "{}");
    return {
      items: Array.isArray(answer[list]) ? answer[list] : [],
      unjudged: Array.isArray(answer.unjudged) ? answer.unjudged : [],
    };
  } catch {
    return { items: [], unjudged: [] };
  }
}

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

/** @param {string} stage @param {number} area @param {string} kind */
const nameFindRecord = (stage, area, kind) => `find-${stage}-${area}-${kind}.json`;

/**
 * Adds a try to a reviewer's record and returns the parts it still hasn't read.
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
    answer: readAnswer(env.STRUCTURED_OUTPUT, "candidates"),
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
 * Every candidate an area's reviewers listed over their tries, each with an id its checker names
 * it by.
 * @param {any[]} records the area's reviewers' records
 */
export const gatherCandidates = (records) =>
  records.flatMap((record) =>
    record.tries
      .flatMap((/** @type {any} */ attempt) => attempt.answer.items)
      .map((/** @type {any} */ candidate, /** @type {number} */ index) => ({
        id: `${record.kind}-${index + 1}`,
        ...candidate,
      })),
  );

/** @param {string} folder */
function readRecords(folder) {
  /** @type {Map<string, any>} */
  const records = new Map();
  for (const name of readdirSync(folder)) {
    if (/^(find|check|post)-.+\.json$/.test(name)) records.set(name, readJson(join(folder, name)));
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
 * What one stage read, checked, and posted, and what it left undone.
 * @param {string} stage
 * @param {any[]} areas
 * @param {Map<string, any>} records
 */
function judgeStage(stage, areas, records) {
  const kinds = stage === "final" ? [FINAL_KIND] : KINDS;
  /** @type {string[]} */
  const unreadFiles = [];
  /** @type {string[]} */
  const missing = [];
  for (const { area, name, files, partsByFile } of areas) {
    for (const { kind } of kinds) {
      const record = records.get(nameFindRecord(stage, area, kind));
      if (!record) {
        missing.push(`the ${kind} reviewer of ${name}`);
        unreadFiles.push(...files);
      } else
        unreadFiles.push(
          ...files.filter((path) => partsByFile[path].some((part) => record.unread.includes(part))),
        );
    }
    if (!records.has(`check-${stage}-${area}.json`)) missing.push(`the checker of ${name}`);
  }
  const post = records.get(`post-${stage}.json`) ?? null;
  if (!post) missing.push("the step that posts the findings");
  const checks = areas.flatMap(({ area }) => records.get(`check-${stage}-${area}.json`) ?? []);
  const verdicts = checks.flatMap((check) =>
    check.items.map((/** @type {any} */ item) => item.verdict),
  );
  const findAnswers = [...records.values()].filter(
    (record) => record.stage === stage && record.tries,
  );
  const unjudged = [
    ...findAnswers.flatMap((record) =>
      record.tries.flatMap((/** @type {any} */ attempt) => attempt.answer.unjudged),
    ),
    ...checks.flatMap((check) => check.unjudged),
    ...(post?.unjudged ?? []),
  ];
  return {
    unreadFiles: [...new Set(unreadFiles)],
    missing,
    weights: post?.weights ?? [],
    rejected: verdicts.filter((verdict) => verdict === "rejected").length,
    checked: verdicts.length,
    unjudged,
    fileCount: areas.flatMap((area) => area.files).length,
  };
}

const LEADS = {
  first: (/** @type {number} */ areaCount) =>
    `read the whole change in ${pluralize(areaCount, "area")}, four reviewers an area`,
  push: (/** @type {number} */ areaCount, /** @type {string} */ since) =>
    `read what the pushes since ${since.slice(0, 7)} changed, in ${pluralize(areaCount, "area")}`,
};

/**
 * The stages the review was due to finish: the one the plan chose, and the last read of the
 * whole change when a review of the pushes since posted nothing.
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
    records.get(`post-${plan.stage}.json`)?.weights.length === 0;
  return isFinalDue ? [...stages, { stage: "final", areas: plan.final }] : stages;
}

/**
 * The summary's lines on what one stage read, checked, and posted.
 * @param {ReturnType<typeof judgeStage>} judged
 * @param {{ stage: string, areas: any[], sha: string, since: string | null }} context
 */
function describeStage(judged, { stage, areas, sha, since }) {
  const found = describeFound(judged.weights);
  const lines = [
    stage === "final"
      ? `Then it read the whole change once more, one reviewer an area, to find what the earlier reads missed: ${found}.`
      : `Claude reviewed ${sha}: it ${LEADS[/** @type {"first" | "push"} */ (stage)](areas.length, since ?? "")}, and posted ${found}, each on the line it's about.`,
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
  const isComplete = judged.every((stage) => !stage.unreadFiles.length && !stage.missing.length);
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
    const unread = recordFindTry(folder, { stage, area: Number(area), kind }, env);
    console.log(`unread=${unread.join(" ")}`);
  } else if (command === "candidates") {
    const records = [...readRecords(folder).entries()]
      .filter(([name]) => name.startsWith(`find-${stage}-${area}-`))
      .map(([, record]) => record);
    writeFileSync(
      join(folder, `candidates-${stage}-${area}.json`),
      JSON.stringify(gatherCandidates(records), null, 1),
    );
  } else if (command === "check") {
    writeFileSync(
      join(folder, `check-${stage}-${area}.json`),
      JSON.stringify(readAnswer(env.STRUCTURED_OUTPUT, "findings")),
    );
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
