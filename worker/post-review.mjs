// Posts what a stage of CI's review confirmed, each finding on the line it's about, so no
// reviewer or checker needs a token that writes to the pull request. A finding on a line the
// diff doesn't show goes on its file, and one on a file the diff doesn't show goes in one comment
// on the pull request. A finding already posted word for word, as by an earlier try of this
// step, isn't posted again.
// Usage: node worker/post-review.mjs <folder> <stage>, after the stage's checkers, with GH_TOKEN,
// GITHUB_REPOSITORY, PR, and SHA set, and STRUCTURED_OUTPUT from the check across areas when one
// ran. It prints posted=<count> for $GITHUB_OUTPUT.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { REVIEWER } from "./review-state.mjs";

const ORDER = ["Important", "Unsure", "Nit", "Pre-existing"];

/**
 * @typedef {{ weight: string, path: string, line: number, body: string }} Finding
 */

/**
 * What a stage posts: what the check across areas kept when one ran, or else what each area's
 * checker confirmed or left unsure, most weighty first.
 * @param {{ items: any[] }[]} checks
 * @param {{ items: any[] } | null} across
 * @returns {Finding[]}
 */
export function listToPost(checks, across) {
  const kept = across
    ? across.items
    : checks
        .flatMap((check) => check.items)
        .filter((item) => item.verdict === "confirmed" || item.verdict === "unsure")
        .map((item) => ({ ...item, weight: item.verdict === "unsure" ? "Unsure" : item.weight }));
  return kept
    .filter((item) => ORDER.includes(item.weight) && item.path && item.body)
    .toSorted((one, other) => ORDER.indexOf(one.weight) - ORDER.indexOf(other.weight));
}

/** @param {Finding} finding */
const writeBody = ({ weight, body }) => `**${weight}** ${body}`;

/**
 * Posts each finding not already on the pull request, and returns the weight of each finding, as
 * each is on the pull request once it returns.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} callGitHub
 * @param {{ pullNumber: string, sha: string, findings: Finding[], posted: string[] }} review
 */
export async function postFindings(callGitHub, { pullNumber, sha, findings, posted }) {
  const already = new Set(posted);
  const fresh = findings.filter((finding) => !already.has(writeBody(finding)));
  /** @type {Finding[]} */
  const offDiff = [];
  for (const finding of fresh) {
    const body = writeBody(finding);
    const comments = `/pulls/${pullNumber}/comments`;
    try {
      await callGitHub(comments, {
        method: "POST",
        body: { body, commit_id: sha, path: finding.path, line: finding.line, side: "RIGHT" },
      });
    } catch {
      try {
        await callGitHub(comments, {
          method: "POST",
          body: {
            body: `**${finding.weight}** (about line ${finding.line}) ${finding.body}`,
            commit_id: sha,
            path: finding.path,
            subject_type: "file",
          },
        });
      } catch {
        offDiff.push(finding);
      }
    }
  }
  if (offDiff.length) {
    const body = [
      "Findings on files this pull request doesn't change:",
      "",
      ...offDiff.map((finding) => `- \`${finding.path}:${finding.line}\`: ${writeBody(finding)}`),
    ].join("\n");
    await callGitHub(`/issues/${pullNumber}/comments`, { method: "POST", body: { body } });
  }
  return findings.map((finding) => finding.weight);
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder, stage] = process.argv.slice(2);
  const { env } = process;
  const checks = readdirSync(folder)
    .filter((name) => name.startsWith(`check-${stage}-`))
    .map((name) => readJson(join(folder, name)));
  const across = env.STRUCTURED_OUTPUT ? JSON.parse(env.STRUCTURED_OUTPUT) : null;
  const callGitHub = createGitHub({
    repository: env.GITHUB_REPOSITORY ?? "",
    fetchImpl: fetch,
    env,
  });
  const comments = await readAllPages(callGitHub, `/pulls/${env.PR}/comments`);
  const weights = await postFindings(callGitHub, {
    pullNumber: env.PR ?? "",
    sha: env.SHA ?? "",
    findings: listToPost(checks, across && { items: across.findings ?? [] }),
    posted: comments
      .filter((comment) => comment.user?.login === REVIEWER)
      .map((comment) => comment.body),
  });
  writeFileSync(
    join(folder, `post-${stage}.json`),
    JSON.stringify({ weights, unjudged: across?.unjudged ?? [] }),
  );
  console.log(`posted=${weights.length}`);
}
