// Writes what CI's reviewers and its check across areas read besides the code: the pull request's
// title and description, every review thread on it so far, each with its first comment and latest
// replies from people with a say in the repo and whether it's resolved or outdated, and the
// findings the review posted on files the pull request doesn't change, so a finding that was
// answered or fixed isn't raised again unless the answer is wrong or the fix didn't hold.
// Usage: node worker/review-context.mjs <folder>, with GH_TOKEN, GITHUB_REPOSITORY, PR, TITLE,
// and DESCRIPTION set.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, createGraphQL, readAllPages } from "./github-api.mjs";
import { OFF_DIFF_HEADING, REVIEWER } from "./review-state.mjs";

// A thread's first comment, which holds what it raised, as every item of a checklist of Nits, and
// its last ones, since its newest replies hold its answer.
const LAST_COMMENTS = 49;
const COMMENT_FIELDS = "author { __typename login } authorAssociation body";
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
          first: comments(first: 1) { nodes { ${COMMENT_FIELDS} } }
          comments(last: ${LAST_COMMENTS}) { totalCount nodes { ${COMMENT_FIELDS} } }
        }
      }
    }
  }
}`;

/**
 * A thread as GitHub answers it with its first comment and its last ones, as one list of its
 * comments, the first never twice.
 * @param {any} thread
 */
const joinComments = ({ first, comments, ...thread }) => ({
  ...thread,
  comments: {
    nodes:
      comments.totalCount > comments.nodes.length
        ? [...first.nodes, ...comments.nodes]
        : comments.nodes,
  },
});

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
    threads.push(...page.nodes.map(joinComments));
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
}

/**
 * The comments in which the review posted findings on files the pull request doesn't change.
 * @param {any[]} comments as GitHub lists an issue's comments
 */
export const listOffDiffFindings = (comments) =>
  comments.filter(
    (comment) => comment.user?.login === REVIEWER && comment.body?.startsWith(OFF_DIFF_HEADING),
  );

/**
 * What a review reads of a pull request's conversation: every review thread, and the review's
 * comments of findings off the pull request's files.
 * @param {object} reads
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} reads.callGraphQL
 * @param {(path: string) => Promise<any>} reads.callGitHub
 * @param {{ owner: string, name: string, number: number }} reads.pullRequest
 */
export async function readConversation({ callGraphQL, callGitHub, pullRequest }) {
  const threads = await readThreads(callGraphQL, pullRequest);
  const comments = await readAllPages(callGitHub, `/issues/${pullRequest.number}/comments`);
  return { threads, offDiff: listOffDiffFindings(comments) };
}

// The repo is public, so anyone can comment on a thread; a reviewer reads only what people with a
// say in the repo wrote, and the review's own findings, whose bot has no say of its own.
const REPO_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// GraphQL names a bot without the "[bot]" the REST API adds to its login.
const REVIEWER_BOT = REVIEWER.replace(/\[bot\]$/, "");
const LEFT_OUT_COMMENT = "*A comment from someone outside the repo was left out.*";

/**
 * Whether a comment is one a reviewer reads: from someone with a say in the repo, or the review's.
 * @param {any} comment
 */
const isFromRepo = (comment) =>
  REPO_ASSOCIATIONS.has(comment.authorAssociation) ||
  (comment.author?.__typename === "Bot" && comment.author.login === REVIEWER_BOT);

/** @param {any} comment */
const renderComment = (comment) =>
  isFromRepo(comment)
    ? [`**${comment.author?.login ?? "someone"}:**`, "", comment.body, ""]
    : [LEFT_OUT_COMMENT, ""];

/** @param {any} thread */
const describeState = (thread) =>
  [thread.isResolved ? "resolved" : "open", thread.isOutdated ? "outdated" : ""]
    .filter(Boolean)
    .join(", ");

/**
 * The pull request's description, threads, and findings off its files as one page a reviewer
 * reads.
 * @param {{ title: string, description: string, threads: any[], offDiff: any[] }} context
 */
export function renderContext({ title, description, threads, offDiff }) {
  const threadLines = threads.flatMap((thread) => [
    `## ${thread.path}:${thread.line ?? thread.originalLine ?? "file"} (${describeState(thread)})`,
    "",
    ...thread.comments.nodes.flatMap(renderComment),
  ]);
  return [
    `# ${title}`,
    "",
    description.trim() || "(No description.)",
    "",
    `# Review threads (${threads.length})`,
    "",
    ...(threads.length ? threadLines : ["None yet.", ""]),
    ...(offDiff.length
      ? [
          "# Findings posted on files the pull request doesn't change",
          "",
          ...offDiff.map((comment) => comment.body),
        ]
      : []),
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  const { env } = process;
  const [owner, name] = (env.GITHUB_REPOSITORY ?? "").split("/");
  const { threads, offDiff } = await readConversation({
    callGraphQL: createGraphQL({ fetchImpl: fetch, env }),
    callGitHub: createGitHub({ repository: env.GITHUB_REPOSITORY ?? "", fetchImpl: fetch, env }),
    pullRequest: { owner, name, number: Number(env.PR) },
  });
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "pull-request.md"),
    renderContext({
      title: env.TITLE ?? "",
      description: env.DESCRIPTION ?? "",
      threads,
      offDiff,
    }),
  );
}
