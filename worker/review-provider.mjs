import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

export const PROVIDER_MARKER = "<!-- trusted-review-provider ";
const PROVIDERS = ["claude", "codex"];

/** @param {any[]} comments */
function findProviderComment(comments) {
  const matching = comments.filter(
    (comment) =>
      comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(PROVIDER_MARKER),
  );
  if (matching.length > 1) throw new Error("Ambiguous review provider state.");
  return matching[0] ?? null;
}

/** @param {string | undefined} body */
function readProviderComment(body) {
  if (!body) return null;
  const match = body.match(/^<!-- trusted-review-provider (\{[^\n]+\}) -->\n/);
  const state = JSON.parse(match?.[1] ?? "null");
  if (
    !state ||
    !PROVIDERS.includes(state.provider) ||
    !/^(initial|\d+)$/.test(state.selection) ||
    Object.keys(state).sort().join(",") !== "provider,selection"
  )
    throw new Error("Malformed review provider state.");
  return state;
}

/** @param {{ comments: any[], events: any[], owner: string, defaultProvider?: string }} context */
export function selectReviewProvider({ comments, events, owner, defaultProvider = "claude" }) {
  const previous = readProviderComment(findProviderComment(comments)?.body);
  if (!PROVIDERS.includes(defaultProvider)) throw new Error("Unknown default review provider.");
  const overrides = events.filter(
    (event) =>
      event.event === "labeled" &&
      event.actor?.login === owner &&
      /^review-provider:(claude|codex)$/.test(event.label?.name ?? ""),
  );
  overrides.sort((first, second) => second.id - first.id);
  const latest = overrides[0];
  if (latest) {
    if (!Number.isSafeInteger(latest.id) || latest.id <= 0)
      throw new Error("Invalid provider selection event.");
    return { provider: latest.label.name.split(":")[1], selection: String(latest.id) };
  }
  return previous ?? { provider: defaultProvider, selection: "initial" };
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string, request?:any)=>Promise<any>} readGitHub */
export async function readReviewProvider(env, readGitHub) {
  const comments = await readAllPages(readGitHub, `/issues/${env.PR}/comments`);
  const events = await readAllPages(readGitHub, `/issues/${env.PR}/timeline`);
  const choice = selectReviewProvider({
    comments,
    events,
    owner: env.GITHUB_REPOSITORY.split("/")[0],
    defaultProvider: env.REVIEW_DEFAULT_PROVIDER || "claude",
  });
  return { choice, comment: findProviderComment(comments) };
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string, request?:any)=>Promise<any>} readGitHub */
export async function verifyReviewProvider(env, readGitHub) {
  if (!env.REVIEW_PROVIDER) return;
  const { choice } = await readReviewProvider(env, readGitHub);
  if (choice.provider !== env.REVIEW_PROVIDER || choice.selection !== env.REVIEW_SELECTION)
    throw new Error("The owner changed the review provider; a complete new review is required.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env } = process;
  const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, env, fetchImpl: fetch });
  const { choice, comment } = await readReviewProvider(env, readGitHub);
  const body = `${PROVIDER_MARKER}${JSON.stringify(choice)} -->\nTrusted review provider: ${choice.provider}. Only an owner-added review-provider label changes this PR's choice.`;
  if (comment?.body !== body)
    await readGitHub(comment ? `/issues/comments/${comment.id}` : `/issues/${env.PR}/comments`, {
      method: comment ? "PATCH" : "POST",
      body: { body },
    });
  appendFileSync(env.GITHUB_OUTPUT, `provider=${choice.provider}\nselection=${choice.selection}\n`);
}
