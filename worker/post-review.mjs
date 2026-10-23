// Posts what CI's check across areas confirmed or left unsure, so no job that runs Claude holds a
// token that writes to the pull request: each Important or Unsure finding on the line it's about,
// a thread of its own, and the review's Nits and Pre-existing findings together in a checklist,
// one comment, or more only past GitHub's limit for one, each on the first of its items' files
// GitHub takes and each a thread of its own.
// A finding on a line the diff doesn't show goes on its file, and one on a file the diff doesn't
// show, or a checklist's comment GitHub takes on none of its files, goes in a comment on the pull
// request, where it's no thread to resolve. Each finding carries a mark, so a finding already
// posted in any form, as by an earlier try of this step, isn't posted again. A finding counts as
// posted when this head's review posted it, in this try or an earlier one, and as already on the
// pull request when an earlier head's review did.
// Usage: node worker/post-review.mjs <folder>, with GH_TOKEN, GITHUB_REPOSITORY, PR, and SHA set,
// after the check across areas.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub } from "./github-api.mjs";
import { ACROSS_RECORD, POST_RECORD, readJson } from "./judge-review.mjs";
import {
  OFF_DIFF_HEADING,
  escapeReviewText,
  UNSURE,
  WEIGHTS,
  listFindingMarks,
  readReviewComments,
  writeFindingMark,
} from "./review-state.mjs";

/**
 * @typedef {{ weight: string, path: string, line: number, body: string }} Finding
 */

/** @typedef {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} CallGitHub */

// The weights posted together in one comment, rather than a thread each.
const LISTED_WEIGHTS = new Set(["Nit", "Pre-existing"]);
export const LIST_HEADING =
  "Nits and Pre-existing findings, each to fix, or to answer in a reply on this thread:";
// GitHub refuses a comment longer than 65,536 characters, so a long list goes in several.
const LONGEST_COMMENT = 60000;

/** @param {string} one @param {string} other */
const compareWeights = (one, other) => WEIGHTS.indexOf(one) - WEIGHTS.indexOf(other);

/**
 * Whether a finding can be posted: it has a weight the review knows, and a file and a body as
 * text, however Claude's answer shaped it.
 * @param {Finding} finding
 */
const isPostable = (finding) =>
  WEIGHTS.includes(finding.weight) &&
  typeof finding.path === "string" &&
  typeof finding.body === "string" &&
  Boolean(finding.path) &&
  Boolean(finding.body);

/**
 * Whether a finding names a line it can be posted on, which one about a whole file, or of
 * another shape, doesn't.
 * @param {Finding} finding
 */
const hasLine = (finding) => Number.isInteger(finding.line) && finding.line > 0;

/**
 * Where a finding is, as its file and line, or its file alone when it names no line.
 * @param {Finding} finding
 */
const nameSpot = (finding) => (hasLine(finding) ? `${finding.path}:${finding.line}` : finding.path);

/**
 * The weight a finding takes for itself and its copies: the heaviest the check settled, or unsure
 * when it settled none, since unsure is its verdict rather than a weight.
 * @param {string[]} weights
 */
function pickGroupWeight(weights) {
  const settled = weights.filter((weight) => weight !== UNSURE);
  return settled.length ? settled.toSorted(compareWeights)[0] : UNSURE;
}

/**
 * What the review posts: every postable finding the check across areas confirmed, and each it
 * left unsure as Unsure, weightiest first. One said word for word in the same file more than once
 * is listed once, at the heaviest weight the check settled among its copies.
 * @param {any[]} judged the findings with their verdicts, in whatever shape Claude gave them
 * @returns {Finding[]}
 */
export function listToPost(judged) {
  const kept = judged
    .filter((finding) => finding.verdict === "confirmed" || finding.verdict === "unsure")
    .map((finding) => ({
      ...finding,
      weight: finding.verdict === "unsure" ? UNSURE : finding.weight,
    }))
    .filter(isPostable);
  return mergeSameFindings(kept)
    .toSorted((one, other) => compareWeights(one.weight, other.weight))
    .map(({ weight, path, line, body }) => ({ weight, path, line, body }));
}

/**
 * The findings with each that says the same thing in the same file once, where it first comes,
 * at the heaviest weight the check settled among its copies.
 * @param {Finding[]} findings
 */
function mergeSameFindings(findings) {
  /** @type {Map<string, Finding[]>} */
  const copiesByKey = new Map();
  for (const finding of findings) {
    const key = nameFinding(finding);
    copiesByKey.set(key, [...(copiesByKey.get(key) ?? []), finding]);
  }
  return [...copiesByKey.values()].map((copies) => ({
    ...copies[0],
    weight: pickGroupWeight(copies.map((copy) => copy.weight)),
  }));
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
  `**${finding.weight}** ${escapeReviewText(shown)}\n\n${writeFindingMark(nameFinding(finding), head)}`;

/**
 * A finding as an item of the checklist of a review's Nits, naming where it is, each line after
 * its first but a blank one indented to stay in the item, as a code block in it must.
 * @param {Finding} finding
 * @param {string} head
 */
const writeItem = (finding, head) =>
  [
    escapeReviewText(`- [ ] \`${nameSpot(finding)}\`: **${finding.weight}** ${finding.body}`),
    writeFindingMark(nameFinding(finding), head),
  ]
    .join("\n")
    .replace(/\n(?=.)/g, "\n  ");

/**
 * A finding as an entry of the comment that lists the findings on files the diff doesn't show.
 * @param {Finding} finding
 * @param {string} head
 */
const writeOffDiffEntry = (finding, head) =>
  `- \`${escapeReviewText(nameSpot(finding))}\`: ${writeBody(finding, head)}`;

/**
 * Findings in order, gathered under a heading into as few comments as keep each under GitHub's
 * limit, a finding too long for one alone in its own.
 * @param {string} heading
 * @param {Finding[]} findings
 * @param {(finding: Finding) => string} writeEntry
 * @returns {{ findings: Finding[], body: string }[]}
 */
function splitIntoComments(heading, findings, writeEntry) {
  /** @type {{ findings: Finding[], body: string }[]} */
  const comments = [];
  for (const finding of findings) {
    const entry = writeEntry(finding);
    const last = comments.at(-1);
    if (last && last.body.length + entry.length + 1 <= LONGEST_COMMENT) {
      last.findings.push(finding);
      last.body += `\n${entry}`;
    } else {
      comments.push({ findings: [finding], body: `${heading}\n\n${entry}` });
    }
  }
  return comments;
}

/** @param {unknown} error */
const isRefusedLine = (error) => /** @type {{ status?: number }} */ (error)?.status === 422;

/**
 * Posts a comment on a file, and returns false when GitHub won't take it there, as for a file the
 * diff doesn't show.
 * @param {CallGitHub} callGitHub
 * @param {{ pullNumber: string, sha: string, path: string, body: string }} post
 */
async function postOnFile(callGitHub, { pullNumber, sha, path, body }) {
  try {
    await callGitHub(`/pulls/${pullNumber}/comments`, {
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
 * Posts a finding on its line, or on its file when it names no line or GitHub won't take it, and
 * returns false when GitHub won't take the file either.
 * @param {CallGitHub} callGitHub
 * @param {{ pullNumber: string, sha: string, finding: Finding }} post
 */
async function postOnDiff(callGitHub, { pullNumber, sha, finding }) {
  const { path, line } = finding;
  if (hasLine(finding)) {
    try {
      await callGitHub(`/pulls/${pullNumber}/comments`, {
        method: "POST",
        body: { body: writeBody(finding, sha), commit_id: sha, path, line, side: "RIGHT" },
      });
      return true;
    } catch (error) {
      if (!isRefusedLine(error)) throw error;
    }
  }
  const shown = hasLine(finding) ? `(about line ${line}) ${finding.body}` : finding.body;
  return postOnFile(callGitHub, { pullNumber, sha, path, body: writeBody(finding, sha, shown) });
}

/**
 * Posts a comment on the first of these files GitHub takes it on, and returns false when it takes
 * it on none.
 * @param {CallGitHub} callGitHub
 * @param {{ pullNumber: string, sha: string, paths: Iterable<string>, body: string }} post
 */
async function postOnFirstFile(callGitHub, { pullNumber, sha, paths, body }) {
  for (const path of paths)
    if (await postOnFile(callGitHub, { pullNumber, sha, path, body })) return true;
  return false;
}

/**
 * Posts findings as a checklist, in as few comments as GitHub's limit allows, each on the first of
 * its findings' files GitHub takes, and returns the findings of those it took on none.
 * @param {CallGitHub} callGitHub
 * @param {{ pullNumber: string, sha: string, findings: Finding[] }} post
 */
async function postLists(callGitHub, { pullNumber, sha, findings }) {
  /** @type {Finding[]} */
  const unposted = [];
  for (const list of splitIntoComments(LIST_HEADING, findings, (each) => writeItem(each, sha))) {
    const paths = new Set(list.findings.map((finding) => finding.path));
    const isPosted = await postOnFirstFile(callGitHub, { pullNumber, sha, paths, body: list.body });
    if (!isPosted) unposted.push(...list.findings);
  }
  return unposted;
}

/**
 * Posts each finding not already on the pull request, the Nits and Pre-existing ones as a
 * checklist, and returns the weight of each this head's review posted, an earlier try's too, and
 * how many an earlier head's review had posted.
 * @param {CallGitHub} callGitHub
 * @param {object} review
 * @param {string} review.pullNumber
 * @param {string} review.sha
 * @param {Finding[]} review.findings
 * @param {Map<string, Set<string>>} review.posted
 */
export async function postFindings(callGitHub, { pullNumber, sha, findings, posted }) {
  /** @param {Finding} finding */
  const isFromEarlierHead = (finding) => {
    const heads = posted.get(nameFinding(finding));
    return Boolean(heads) && !heads?.has(sha);
  };
  const fresh = findings.filter((finding) => !posted.has(nameFinding(finding)));
  /** @param {Finding} finding */
  const isListed = (finding) => LISTED_WEIGHTS.has(finding.weight);
  const listed = fresh.filter(isListed);
  /** @type {Finding[]} */
  const offDiff = [];
  for (const finding of fresh.filter((each) => !isListed(each))) {
    const isOnDiff = await postOnDiff(callGitHub, { pullNumber, sha, finding });
    if (!isOnDiff) offDiff.push(finding);
  }
  offDiff.push(...(await postLists(callGitHub, { pullNumber, sha, findings: listed })));
  const offDiffComments = splitIntoComments(OFF_DIFF_HEADING, offDiff, (each) =>
    writeOffDiffEntry(each, sha),
  );
  for (const { body } of offDiffComments)
    await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
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
 * @param {any[]} comments the review's own, as readReviewComments reads them
 * @returns {Map<string, Set<string>>}
 */
export function listPosted(comments) {
  /** @type {Map<string, Set<string>>} */
  const posted = new Map();
  const marks = comments.flatMap((comment) => listFindingMarks(comment.body));
  for (const { key, head } of marks) posted.set(key, new Set([...(posted.get(key) ?? []), head]));
  return posted;
}

/**
 * What the posting step reads: what the check across areas confirmed or left unsure, and every
 * finding already on the pull request, in a review comment, a checklist, or a comment for files it
 * doesn't change. It posts nothing until the check across areas has left its answer.
 * @param {CallGitHub} callGitHub
 * @param {{ folder: string, pullNumber: string }} options
 */
export async function readPostInputs(callGitHub, { folder, pullNumber }) {
  const acrossPath = join(folder, ACROSS_RECORD);
  if (!existsSync(acrossPath))
    throw new Error("The check across areas didn't leave its answer, so nothing was posted.");
  return {
    findings: listToPost(readJson(acrossPath).items),
    posted: listPosted(await readReviewComments(callGitHub, pullNumber)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder] = process.argv.slice(2);
  const { env } = process;
  const callGitHub = createGitHub({
    repository: env.GITHUB_REPOSITORY ?? "",
    fetchImpl: fetch,
    env,
  });
  const pullNumber = env.PR ?? "";
  const { findings, posted } = await readPostInputs(callGitHub, { folder, pullNumber });
  const { weights, repeated } = await postFindings(callGitHub, {
    pullNumber,
    sha: env.SHA ?? "",
    findings,
    posted,
  });
  writeFileSync(join(folder, POST_RECORD), JSON.stringify({ weights, repeated }));
  console.log(`Posted ${weights.length} of this head's findings.`);
}
