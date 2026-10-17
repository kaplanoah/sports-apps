// Posts what a stage of CI's checkers confirmed or left unsure, each finding on the line it's
// about, so no reviewer or checker holds a token that writes to the pull request. The check across
// areas names only the repeats to merge and what it adds, so no finding a checker kept can drop
// out of its answer. A finding on a line the diff doesn't show goes on its file, and one on a
// file the diff doesn't show goes in one comment on the pull request. Each finding's comment
// carries a mark, so a finding already posted in any form, as by an earlier try of this step, isn't
// posted again. A finding counts as posted when this head's review posted it, in this try or an
// earlier one, and as already on the pull request when an earlier head's review did.
// Usage: node worker/post-review.mjs list <folder> <stage>, with AREAS set, after the stage's
// checkers, writes what they confirmed or left unsure for the check across areas. node
// worker/post-review.mjs across <folder> <stage>, with STRUCTURED_OUTPUT from that check, keeps its
// answer. node worker/post-review.mjs post <folder> <stage>, with GH_TOKEN, GITHUB_REPOSITORY, PR,
// SHA, and AREAS set, posts and prints posted=<count of this head's findings> for $GITHUB_OUTPUT.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import {
  nameAcrossRecord,
  nameCheckRecord,
  nameConfirmedRecord,
  namePostRecord,
  readAnswer,
} from "./judge-review.mjs";
import {
  OFF_DIFF_HEADING,
  REVIEWER,
  WEIGHTS,
  listFindingMarks,
  writeFindingMark,
} from "./review-state.mjs";

/**
 * @typedef {{ weight: string, path: string, line: number, body: string }} Finding
 * @typedef {{ duplicates: string[][], added: Finding[], unjudged: { file: string, why: string }[] }} Across
 */

/**
 * What each area's checker confirmed or left unsure, in area order, each with the ref the check
 * across areas names it by.
 * @param {{ area: number, items: any[] }[]} checks
 * @returns {(Finding & { ref: string })[]}
 */
export const listCheckedFindings = (checks) =>
  checks
    .toSorted((one, other) => one.area - other.area)
    .flatMap(({ area, items }) =>
      items
        .filter((item) => item.verdict === "confirmed" || item.verdict === "unsure")
        .map((item, index) => ({
          ref: `${area}.${index + 1}`,
          weight: item.verdict === "unsure" ? "Unsure" : item.weight,
          path: item.path,
          line: item.line,
          body: item.body,
        })),
    );

/**
 * The checkers' refs the check across areas named as repeats of another. Each group keeps its
 * first known ref that no earlier group dropped, and drops its other known refs but any an earlier
 * group kept, so a ref it got wrong, repeated, or crossed with another group never drops a finding
 * that nothing else stands in for.
 * @param {string[][]} groups
 * @param {Set<string>} knownRefs the refs of the checkers' findings
 */
function listRepeats(groups, knownRefs) {
  /** @type {Set<string>} */
  const kept = new Set();
  /** @type {Set<string>} */
  const dropped = new Set();
  for (const group of groups) {
    const [lead, ...rest] = group.filter((ref) => knownRefs.has(ref) && !dropped.has(ref));
    if (!lead) continue;
    kept.add(lead);
    for (const ref of rest) if (!kept.has(ref)) dropped.add(ref);
  }
  return dropped;
}

/**
 * What a stage posts: every finding its checkers kept but the repeats the check across areas
 * named, with what it added, weightiest first.
 * @param {(Finding & { ref?: string })[]} checked
 * @param {Across | null} across
 * @returns {Finding[]}
 */
export function listToPost(checked, across) {
  const knownRefs = new Set(checked.flatMap((finding) => finding.ref ?? []));
  const repeats = listRepeats(across?.duplicates ?? [], knownRefs);
  return [...checked.filter((finding) => !repeats.has(finding.ref ?? "")), ...(across?.added ?? [])]
    .filter((finding) => WEIGHTS.includes(finding.weight) && finding.path && finding.body)
    .toSorted((one, other) => WEIGHTS.indexOf(one.weight) - WEIGHTS.indexOf(other.weight))
    .map(({ weight, path, line, body }) => ({ weight, path, line, body }));
}

/**
 * The key a finding's mark holds, from where it is and what it says.
 * @param {Finding} finding
 */
export const nameFinding = ({ path, body }) =>
  createHash("sha256").update(`${path}\n${body}`).digest("hex").slice(0, 16);

/**
 * A finding's comment: its weight, what it says, shown with any words a form adds, and its mark,
 * which holds what it says alone, in every form.
 * @param {Finding} finding
 * @param {string} head
 * @param {string} [shown]
 */
const writeBody = (finding, head, shown = finding.body) =>
  `**${finding.weight}** ${shown}\n\n${writeFindingMark(nameFinding(finding), head)}`;

/** @param {unknown} error */
const isRefusedLine = (error) => /** @type {{ status?: number }} */ (error)?.status === 422;

/**
 * Posts a finding on its line, or on its file when GitHub won't take the line, and returns false
 * when GitHub won't take the file either.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ pullNumber: string, sha: string, finding: Finding }} post
 */
async function postOnDiff(callGitHub, { pullNumber, sha, finding }) {
  const comments = `/pulls/${pullNumber}/comments`;
  const { path, line } = finding;
  try {
    await callGitHub(comments, {
      method: "POST",
      body: { body: writeBody(finding, sha), commit_id: sha, path, line, side: "RIGHT" },
    });
    return true;
  } catch (error) {
    if (!isRefusedLine(error)) throw error;
  }
  try {
    const body = writeBody(finding, sha, `(about line ${line}) ${finding.body}`);
    await callGitHub(comments, {
      method: "POST",
      body: { body, commit_id: sha, path, subject_type: "file" },
    });
    return true;
  } catch (error) {
    if (!isRefusedLine(error)) throw error;
    return false;
  }
}

/**
 * Posts each finding not already on the pull request, and returns the weight of each this head's
 * review posted, an earlier try's too, and how many an earlier head's review had posted.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ pullNumber: string, sha: string, findings: Finding[], posted: Map<string, Set<string>> }} review
 */
export async function postFindings(callGitHub, { pullNumber, sha, findings, posted }) {
  /** @param {Finding} finding */
  const isFromEarlierHead = (finding) => {
    const heads = posted.get(nameFinding(finding));
    return Boolean(heads) && !heads?.has(sha);
  };
  const fresh = findings.filter((finding) => !posted.has(nameFinding(finding)));
  /** @type {Finding[]} */
  const offDiff = [];
  for (const finding of fresh) {
    const isOnDiff = await postOnDiff(callGitHub, { pullNumber, sha, finding });
    if (!isOnDiff) offDiff.push(finding);
  }
  if (offDiff.length) {
    const body = [
      OFF_DIFF_HEADING,
      "",
      ...offDiff.map(
        (finding) => `- \`${finding.path}:${finding.line}\`: ${writeBody(finding, sha)}`,
      ),
    ].join("\n");
    await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
  }
  const repeated = findings.filter(isFromEarlierHead);
  return {
    weights: findings
      .filter((finding) => !isFromEarlierHead(finding))
      .map((finding) => finding.weight),
    repeated: repeated.length,
  };
}

/**
 * The findings the review already posted, in any form, each with the heads it was posted on.
 * @param {any[]} comments the pull request's review comments and issue comments
 * @returns {Map<string, Set<string>>}
 */
export function listPosted(comments) {
  /** @type {Map<string, Set<string>>} */
  const posted = new Map();
  const marks = comments
    .filter((comment) => comment.user?.login === REVIEWER)
    .flatMap((comment) => listFindingMarks(comment.body));
  for (const { key, head } of marks) posted.set(key, new Set([...(posted.get(key) ?? []), head]));
  return posted;
}

/**
 * A check across areas' answer, or null when it gave none, as when it ran out of turns.
 * @param {string | undefined} structuredOutput
 * @returns {Across | null}
 */
export function readAcross(structuredOutput) {
  const answer = readAnswer(structuredOutput, ["duplicates", "added"]);
  if (!answer) return null;
  const isGroup = (/** @type {unknown} */ group) =>
    Array.isArray(group) && group.every((ref) => typeof ref === "string");
  return {
    duplicates: answer.duplicates.filter(isGroup),
    added: answer.added,
    unjudged: answer.unjudged,
  };
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * How many areas a stage has, from the job's AREAS, which must name it, so a job that lost it
 * stops rather than posting nothing and passing as a review that found nothing.
 * @param {string | undefined} areas
 */
export function readAreaCount(areas) {
  const count = Number(areas);
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`AREAS must name how many areas the stage has, not "${areas}".`);
  return count;
}

/**
 * A stage's checkers' records, each with its area, as the checkers leave them in the folder; an
 * area whose checker left none has none.
 * @param {string} folder
 * @param {string} stage
 * @param {number} areaCount
 */
export const readChecks = (folder, stage, areaCount) =>
  Array.from({ length: areaCount }, (_, index) => index + 1).flatMap((area) => {
    const path = join(folder, nameCheckRecord(stage, area));
    return existsSync(path) ? [{ area, ...readJson(path) }] : [];
  });

/**
 * What a stage's posting step reads: what its checkers confirmed or left unsure, less the repeats
 * the check across areas named, and every finding already on the pull request, in a review
 * comment or in the one comment for files it doesn't change. A stage of more than one area posts
 * nothing until the check across areas has left its answer.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ folder: string, stage: string, areaCount: number, pullNumber: string }} options
 */
export async function readPostInputs(callGitHub, { folder, stage, areaCount, pullNumber }) {
  const acrossPath = join(folder, nameAcrossRecord(stage));
  /** @type {Across | null} */
  const across = existsSync(acrossPath) ? readJson(acrossPath) : null;
  if (areaCount > 1 && !across)
    throw new Error("The check across areas didn't leave its answer, so nothing was posted.");
  const comments = [
    ...(await readAllPages(callGitHub, `/pulls/${pullNumber}/comments`)),
    ...(await readAllPages(callGitHub, `/issues/${pullNumber}/comments`)),
  ];
  return {
    findings: listToPost(listCheckedFindings(readChecks(folder, stage, areaCount)), across),
    posted: listPosted(comments),
    across,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, folder, stage] = process.argv.slice(2);
  const { env } = process;
  const areaCount = readAreaCount(env.AREAS);
  if (command === "list") {
    writeFileSync(
      join(folder, nameConfirmedRecord(stage)),
      JSON.stringify(listCheckedFindings(readChecks(folder, stage, areaCount)), null, 1),
    );
  } else if (command === "across") {
    const across = readAcross(env.STRUCTURED_OUTPUT);
    if (!across) throw new Error("The check across areas gave no answer.");
    writeFileSync(join(folder, nameAcrossRecord(stage)), JSON.stringify(across));
  } else if (command === "post") {
    const callGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY ?? "",
      fetchImpl: fetch,
      env,
    });
    const pullNumber = env.PR ?? "";
    const { findings, posted, across } = await readPostInputs(callGitHub, {
      folder,
      stage,
      areaCount,
      pullNumber,
    });
    const { weights, repeated } = await postFindings(callGitHub, {
      pullNumber,
      sha: env.SHA ?? "",
      findings,
      posted,
    });
    writeFileSync(
      join(folder, namePostRecord(stage)),
      JSON.stringify({ weights, repeated, unjudged: across?.unjudged ?? [] }),
    );
    console.log(`posted=${weights.length}`);
  } else {
    console.error("Usage: node worker/post-review.mjs list|across|post <folder> <stage>");
    process.exit(1);
  }
}
