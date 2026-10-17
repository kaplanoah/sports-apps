// Writes what CI's reviewers and checkers read besides the code: the pull request's title and
// description, and every review thread on it so far, each with its replies and whether it's
// resolved or outdated, so a finding that was answered or fixed isn't raised again unless the
// answer is wrong or the fix didn't hold.
// Usage: node worker/review-context.mjs <folder>, with GH_TOKEN, GITHUB_REPOSITORY, PR, TITLE,
// and DESCRIPTION set.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPHQL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 10000;
const THREADS_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 50) { nodes { author { login } body } }
        }
      }
    }
  }
}`;

/**
 * Every review thread on the pull request, page by page until GitHub says there are no more.
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} callGraphQL
 * @param {{ owner: string, name: string, number: number }} pullRequest
 */
export async function readThreads(callGraphQL, pullRequest) {
  const threads = [];
  /** @type {string | null} */
  let after = null;
  for (;;) {
    const data = await callGraphQL(THREADS_QUERY, { ...pullRequest, after });
    const page = data.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
}

/** @param {any} thread */
const describeState = (thread) =>
  [thread.isResolved ? "resolved" : "open", thread.isOutdated ? "outdated" : ""]
    .filter(Boolean)
    .join(", ");

/**
 * The pull request's description and threads as one page a reviewer reads.
 * @param {{ title: string, description: string, threads: any[] }} context
 */
export function renderContext({ title, description, threads }) {
  const threadLines = threads.flatMap((thread) => [
    `## ${thread.path}:${thread.line ?? thread.originalLine ?? "file"} (${describeState(thread)})`,
    "",
    ...thread.comments.nodes.flatMap((/** @type {any} */ comment) => [
      `**${comment.author?.login ?? "someone"}:**`,
      "",
      comment.body,
      "",
    ]),
  ]);
  return [
    `# ${title}`,
    "",
    description.trim() || "(No description.)",
    "",
    `# Review threads (${threads.length})`,
    "",
    ...(threads.length ? threadLines : ["None yet."]),
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  const { env } = process;
  const [owner, name] = (env.GITHUB_REPOSITORY ?? "").split("/");
  /** @param {string} query @param {Record<string, unknown>} variables */
  const callGraphQL = async (query, variables) => {
    const response = await fetch(GRAPHQL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const answer = await response.json();
    if (!response.ok || answer.errors)
      throw new Error(`GitHub answered ${response.status} for the review threads`);
    return answer.data;
  };
  const threads = await readThreads(callGraphQL, { owner, name, number: Number(env.PR) });
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "pull-request.md"),
    renderContext({ title: env.TITLE ?? "", description: env.DESCRIPTION ?? "", threads }),
  );
}
