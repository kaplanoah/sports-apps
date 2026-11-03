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

const MISSING_BINDING = "No CLAUDE binding to the claude service";

/** @param {Claude | undefined} claude */
function findService(claude) {
  if (!claude) throw new Error(MISSING_BINDING);
  return claude;
}

/**
 * The service's calls, each counted as it goes out. Without the binding, each call fails, as a
 * service that doesn't answer does.
 * @param {Claude | undefined} claude
 * @param {() => void} count
 * @returns {Claude}
 */
export const countClaudeCalls = (claude, count) => ({
  readConfig: async () => {
    const service = findService(claude);
    count();
    return await service.readConfig();
  },
  requestClaude: async (options) => {
    const service = findService(claude);
    count();
    return await service.requestClaude(options);
  },
});

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
