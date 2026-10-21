// Comments on each open pull request into main that a merge to main left in conflict, since
// GitHub runs no CI on a conflicted pull request and says nothing of it, so whoever drives it
// would wait on checks that never start. One comment for each of its head commits is enough: the
// push that resolves the conflict brings a new head.
import { fileURLToPath } from "node:url";
import { waitFor } from "./check-timing.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";

// GitHub works out whether a pull request merges cleanly only once asked, a moment later.
const MERGEABLE_TRIES = 6;
const MERGEABLE_WAIT_MS = 5000;

/** @param {string} head */
export const nameConflictMarker = (head) => `<!-- merge-conflict:${head} -->`;

/**
 * @param {string} head
 * @param {string} mainCommit
 */
const renderConflictComment = (head, mainCommit) =>
  [
    `This pull request conflicts with \`main\` as of ${mainCommit.slice(0, 7)}, so GitHub runs no CI on it.`,
    "Merge `main` into its branch and resolve the conflicts to run its checks again.",
    "",
    nameConflictMarker(head),
  ].join("\n");

/**
 * Whether the pull request merges cleanly, once GitHub has worked it out, or null if it hasn't.
 * @param {(path: string) => Promise<any>} readJson
 * @param {number} number
 * @param {(ms: number) => Promise<void>} wait
 */
async function readMergeable(readJson, number, wait) {
  for (let attempt = 1; ; attempt += 1) {
    const pull = await readJson(`/pulls/${number}`);
    if (pull.mergeable !== null || attempt === MERGEABLE_TRIES) return pull;
    await wait(MERGEABLE_WAIT_MS);
  }
}

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.mainCommit the commit main is now at
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(ms: number) => Promise<void>} [options.wait]
 * @returns {Promise<number[]>} the pull requests it commented on
 */
export async function flagConflicts({
  repository,
  mainCommit,
  fetchImpl = fetch,
  env = process.env,
  wait = waitFor,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const pulls = await readAllPages(github, "/pulls?state=open&base=main");
  const flagged = [];
  for (const { number } of pulls) {
    const pull = await readMergeable(github, number, wait);
    if (pull.mergeable !== false) continue;
    const comments = await readAllPages(github, `/issues/${number}/comments`);
    const marker = nameConflictMarker(pull.head.sha);
    if (comments.some((comment) => comment.body?.includes(marker))) continue;
    await github(`/issues/${number}/comments`, {
      method: "POST",
      body: { body: renderConflictComment(pull.head.sha, mainCommit) },
    });
    flagged.push(number);
  }
  return flagged;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flagged = await flagConflicts({
    repository: String(process.env.GITHUB_REPOSITORY),
    mainCommit: String(process.env.GITHUB_SHA),
  });
  console.log(
    flagged.length
      ? `Flagged ${flagged.map((number) => `#${number}`).join(", ")} as in conflict with main.`
      : "No open pull request into main is newly in conflict.",
  );
}
