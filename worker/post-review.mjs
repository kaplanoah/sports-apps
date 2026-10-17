// Posts what a stage of CI's review confirmed, each finding on the line it's about, so no
// reviewer or checker holds a token that writes to the pull request. The check across areas
// names only the repeats to merge and what it adds, so no finding a checker confirmed can drop
// out of its answer. A finding on a line the diff doesn't show goes on its file, and one on a file
// the diff doesn't show goes in one comment on the pull request. Each finding's comment carries a
// mark, so a finding already posted in any form, as by an earlier try of this step, isn't posted
// again, and only new findings count as posted.
// Usage: node worker/post-review.mjs list <folder> <stage>, after the stage's checkers, writes
// what they confirmed for the check across areas. node worker/post-review.mjs across <folder>
// <stage>, with STRUCTURED_OUTPUT from that check, keeps its answer. node worker/post-review.mjs
// post <folder> <stage>, with GH_TOKEN, GITHUB_REPOSITORY, PR, SHA, and AREAS set, posts and
// prints posted=<count of new findings> for $GITHUB_OUTPUT.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
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
export const listConfirmed = (checks) =>
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
 * What a stage posts: every confirmed finding but the later ones of each group of repeats the
 * check across areas named, with what it added, weightiest first.
 * @param {(Finding & { ref?: string })[]} confirmed
 * @param {Across | null} across
 * @returns {Finding[]}
 */
export function listToPost(confirmed, across) {
  const repeats = new Set(across?.duplicates.flatMap((group) => group.slice(1)) ?? []);
  return [
    ...confirmed.filter((finding) => !repeats.has(finding.ref ?? "")),
    ...(across?.added ?? []),
  ]
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

/** @param {Finding} finding */
const writeBody = (finding) =>
  `**${finding.weight}** ${finding.body}\n\n${writeFindingMark(nameFinding(finding))}`;

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
      body: { body: writeBody(finding), commit_id: sha, path, line, side: "RIGHT" },
    });
    return true;
  } catch (error) {
    if (!isRefusedLine(error)) throw error;
  }
  try {
    const body = writeBody({ ...finding, body: `(about line ${line}) ${finding.body}` });
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
 * Posts each finding not already on the pull request, and returns the weight of each it posted
 * and how many were already there.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ pullNumber: string, sha: string, findings: Finding[], posted: Set<string> }} review
 */
export async function postFindings(callGitHub, { pullNumber, sha, findings, posted }) {
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
      ...offDiff.map((finding) => `- \`${finding.path}:${finding.line}\`: ${writeBody(finding)}`),
    ].join("\n");
    await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
  }
  return {
    weights: fresh.map((finding) => finding.weight),
    repeated: findings.length - fresh.length,
  };
}

/**
 * The findings the review already posted, in any form, by their marks.
 * @param {any[]} comments the pull request's review comments and issue comments
 */
export const listPosted = (comments) =>
  new Set(
    comments
      .filter((comment) => comment.user?.login === REVIEWER)
      .flatMap((comment) => listFindingMarks(comment.body)),
  );

/**
 * A check across areas' answer, or null when it gave none, as when it ran out of turns.
 * @param {string | undefined} structuredOutput
 * @returns {Across | null}
 */
export function readAcross(structuredOutput) {
  try {
    const answer = JSON.parse(structuredOutput || "null");
    return Array.isArray(answer?.duplicates) && Array.isArray(answer?.added)
      ? { duplicates: answer.duplicates, added: answer.added, unjudged: answer.unjudged ?? [] }
      : null;
  } catch {
    return null;
  }
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * A stage's checkers' records, each with its area.
 * @param {string} folder
 * @param {string} stage
 */
const readChecks = (folder, stage) =>
  readdirSync(folder).flatMap((name) => {
    const area = name.match(new RegExp(`^check-${stage}-(\\d+)\\.json$`))?.[1];
    return area ? [{ area: Number(area), ...readJson(join(folder, name)) }] : [];
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, folder, stage] = process.argv.slice(2);
  const { env } = process;
  const acrossPath = join(folder, `across-${stage}.json`);
  if (command === "list") {
    writeFileSync(
      join(folder, `confirmed-${stage}.json`),
      JSON.stringify(listConfirmed(readChecks(folder, stage)), null, 1),
    );
  } else if (command === "across") {
    const across = readAcross(env.STRUCTURED_OUTPUT);
    if (!across) throw new Error("The check across areas gave no answer.");
    writeFileSync(acrossPath, JSON.stringify(across));
  } else if (command === "post") {
    const across = existsSync(acrossPath) ? readJson(acrossPath) : null;
    if (Number(env.AREAS) > 1 && !across)
      throw new Error("The check across areas didn't leave its answer, so nothing was posted.");
    const callGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY ?? "",
      fetchImpl: fetch,
      env,
    });
    const comments = [
      ...(await readAllPages(callGitHub, `/pulls/${env.PR}/comments`)),
      ...(await readAllPages(callGitHub, `/issues/${env.PR}/comments`)),
    ];
    const { weights, repeated } = await postFindings(callGitHub, {
      pullNumber: env.PR ?? "",
      sha: env.SHA ?? "",
      findings: listToPost(listConfirmed(readChecks(folder, stage)), across),
      posted: listPosted(comments),
    });
    writeFileSync(
      join(folder, `post-${stage}.json`),
      JSON.stringify({ weights, repeated, unjudged: across?.unjudged ?? [] }),
    );
    console.log(`posted=${weights.length}`);
  } else {
    console.error("Usage: node worker/post-review.mjs list|across|post <folder> <stage>");
    process.exit(1);
  }
}
