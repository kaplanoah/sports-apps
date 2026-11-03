// Asking Claude, through the claude service that holds the API key, for an answer in the shape a
// JSON schema sets. Each call to the service is one of a run's requests, as a fetch is, so the
// store's request budget and each job's status count it.

/**
 * @typedef {object} ClaudeRequest
 * @property {number} timeoutMs how long a call takes before it has stalled
 * @property {{ output_config?: object } & Record<string, unknown>} request the Messages API's request body
 * @property {object} schema the JSON schema Claude's answer follows
 */

/**
 * What the service answers. A call over a binding drops an error's own fields, like its HTTP
 * status, so a failure comes back as a problem.
 * @typedef {{ answer: any, usage: Record<string, number> }
 *   | { problem: string, status?: number }} ClaudeResult
 */

/**
 * The claude service's calls, as its binding takes them.
 * @typedef {object} Claude
 * @property {() => Promise<{ configured: boolean }>} readConfig
 * @property {(options: ClaudeRequest) => Promise<ClaudeResult>} requestClaude
 */

/** The service's own words for its missing API key, which the news status repeats. */
export const MISSING_CLAUDE_KEY = "no ANTHROPIC_API_KEY secret";

/** A Worker without the claude service's binding, which says nothing about what it asked. */
export class MissingClaudeBinding extends Error {
  constructor() {
    super("No CLAUDE binding to the claude service");
  }
}

// Claude turning the claude service's key away, which says nothing about what it asked.
const REFUSED_KEY_STATUSES = new Set([401, 403]);

/**
 * Whether a call failed for the binding or the key rather than for what it asked, so the ask
 * shouldn't count against what it was about.
 * @param {unknown} error
 */
export const isClaudeRefusal = (error) =>
  error instanceof MissingClaudeBinding ||
  REFUSED_KEY_STATUSES.has(/** @type {{ status?: number }} */ (error)?.status);

const failUnbound = async () => {
  throw new MissingClaudeBinding();
};

/**
 * A Worker without the binding, whose every call fails, as a service that doesn't answer does,
 * and is never counted, since nothing goes out.
 * @type {Claude}
 */
const UNBOUND_CLAUDE = { readConfig: failUnbound, requestClaude: failUnbound };

/**
 * The service's calls, each counted as it goes out.
 * @param {Claude | undefined} claude
 * @param {() => void} count
 * @returns {Claude}
 */
export function countClaudeCalls(claude, count) {
  if (!claude || claude === UNBOUND_CLAUDE) return UNBOUND_CLAUDE;
  return {
    readConfig: async () => {
      count();
      return await claude.readConfig();
    },
    requestClaude: async (options) => {
      count();
      return await claude.requestClaude(options);
    },
  };
}

/**
 * The service's calls, with its config read once, since it holds for a run.
 * @param {Claude} claude
 * @returns {Claude}
 */
export function rememberClaudeConfig(claude) {
  /** @type {Promise<{ configured: boolean }> | undefined} */
  let config;
  return {
    readConfig: () => {
      config ??= claude.readConfig().catch((error) => {
        config = undefined;
        throw error;
      });
      return config;
    },
    requestClaude: (options) => claude.requestClaude(options),
  };
}

/**
 * Whether the service says it has no API key, so nothing asks it. A service that doesn't answer
 * isn't one without a key: its asks go on, and fail where a run's failures show them.
 * @param {Claude} claude
 */
export async function lacksClaudeKey(claude) {
  try {
    return (await claude.readConfig()).configured === false;
  } catch {
    return false;
  }
}

/**
 * Claude's answer and the tokens it took, or an error with the API's HTTP status when it gave one.
 * @param {Claude} claude
 * @param {ClaudeRequest} options
 * @returns {Promise<{ answer: any, usage: Record<string, number> }>}
 */
export async function requestClaude(claude, options) {
  const result = await claude.requestClaude(options);
  if (!("problem" in result)) return result;
  const status = result.status === undefined ? {} : { status: result.status };
  throw Object.assign(new Error(result.problem), status);
}
