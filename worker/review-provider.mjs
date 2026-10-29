import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACTIONS_LOGIN, createGitHub, readAllPages } from "./github-api.mjs";
import { isRepositoryName, isRunId } from "./review-run.mjs";
import { readTimeline } from "./labeling.mjs";
import { isLegacyReviewSelection, isReviewSelection } from "./review-selection.mjs";

export const PROVIDER_MARKER = "<!-- trusted-review-provider ";
const PROVIDERS = ["claude", "codex"];

/** @param {NodeJS.ProcessEnv} env @param {string} provider @param {number | string} portion */
export function writeReviewModelQueue(env, provider, portion) {
  if (
    !PROVIDERS.includes(provider) ||
    !isRepositoryName(env.GITHUB_REPOSITORY) ||
    (provider === "claude" &&
      (!isRunId(env.GITHUB_RUN_ID) || !/^(integration|[1-9]\d*)$/.test(String(portion))))
  )
    throw new Error("Invalid review model queue identity.");
  const group =
    provider === "codex"
      ? `trusted-codex-api-${env.GITHUB_REPOSITORY}`
      : `trusted-claude-trial-${env.GITHUB_REPOSITORY}-${env.GITHUB_RUN_ID}-${portion}`;
  appendFileSync(env.GITHUB_OUTPUT, `model-queue=${group}\n`);
}

/** @param {any[]} comments */
function findProviderComment(comments) {
  const matching = comments.filter(
    (comment) => comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(PROVIDER_MARKER),
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
    !isReviewSelection(state.selection) ||
    Object.keys(state).sort().join(",") !== "provider,selection"
  )
    throw new Error("Malformed review provider state.");
  return state;
}

/** @param {{ comments: any[], events: any[], owner: string, defaultProvider?: string, legacySelectionNode?: string }} context */
export function selectReviewProvider({
  comments,
  events,
  owner,
  defaultProvider = "claude",
  legacySelectionNode,
}) {
  const previous = readProviderComment(findProviderComment(comments)?.body);
  if (!PROVIDERS.includes(defaultProvider)) throw new Error("Unknown default review provider.");
  const overrides = events.filter(
    (event) =>
      event.event === "labeled" &&
      event.actor?.login === owner &&
      /^review-provider:(claude|codex)$/.test(event.label?.name ?? ""),
  );
  const identifiers = overrides.map((event) => event.id);
  if (
    identifiers.some((id) => typeof id !== "string" || !isReviewSelection(`node:${id}`)) ||
    new Set(identifiers).size !== identifiers.length
  )
    throw new Error("Invalid provider selection history.");
  const anchor =
    previous?.selection === "initial" || !previous
      ? null
      : isLegacyReviewSelection(previous.selection)
        ? legacySelectionNode
        : previous.selection.slice("node:".length);
  if (
    previous &&
    previous.selection !== "initial" &&
    !overrides.some(
      (event) => event.id === anchor && event.label.name === `review-provider:${previous.provider}`,
    )
  )
    throw new Error("The persisted provider selection is missing from authoritative history.");
  const latest = overrides.at(-1);
  if (latest) {
    if (latest.id === anchor) return previous;
    return { provider: latest.label.name.split(":")[1], selection: `node:${latest.id}` };
  }
  return previous ?? { provider: defaultProvider, selection: "initial" };
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string, request?:any)=>Promise<any>} readGitHub @param {typeof fetch} [fetchImpl] */
export async function readReviewProvider(env, readGitHub, fetchImpl = fetch) {
  const comments = await readAllPages(readGitHub, `/issues/${env.PR}/comments`);
  const previous = readProviderComment(findProviderComment(comments)?.body);
  const events = await readTimeline({
    repository: env.GITHUB_REPOSITORY,
    pullNumber: env.PR,
    env,
    fetchImpl,
  });
  const legacySelectionNode =
    previous && isLegacyReviewSelection(previous.selection)
      ? await readLegacySelectionNode(env, readGitHub, previous)
      : undefined;
  const choice = selectReviewProvider({
    comments,
    events,
    owner: env.GITHUB_REPOSITORY.split("/")[0],
    defaultProvider: env.REVIEW_DEFAULT_PROVIDER || undefined,
    legacySelectionNode,
  });
  return { choice, comment: findProviderComment(comments) };
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string, request?:any)=>Promise<any>} readGitHub @param {{provider:string,selection:string}} previous */
async function readLegacySelectionNode(env, readGitHub, previous) {
  const event = await readGitHub(`/issues/events/${previous.selection}`);
  if (
    String(event.id) !== previous.selection ||
    typeof event.node_id !== "string" ||
    !isReviewSelection(`node:${event.node_id}`) ||
    event.event !== "labeled" ||
    event.actor?.login !== env.GITHUB_REPOSITORY.split("/")[0] ||
    event.label?.name !== `review-provider:${previous.provider}` ||
    event.issue?.number !== Number(env.PR) ||
    event.issue?.url !== `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues/${env.PR}`
  )
    throw new Error("The legacy provider selection could not be authenticated.");
  return event.node_id;
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string, request?:any)=>Promise<any>} readGitHub @param {typeof fetch} [fetchImpl] */
export async function verifyReviewProvider(env, readGitHub, fetchImpl = fetch) {
  if (!env.REVIEW_PROVIDER) return;
  const { choice } = await readReviewProvider(env, readGitHub, fetchImpl);
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
