// What the Worker said went wrong, which each of its routes and its store say as
// `{ error: { code, message } }`.

/**
 * The Worker's code and message for a failed answer, or its status in their place when the answer
 * names neither.
 * @param {any} body the answer, or null when it wasn't JSON
 * @param {number} status
 * @param {string} [answerer] what answered, as a message from its status names it
 * @returns {{ code: string, message: string }}
 */
export function readWorkerError(body, status, answerer = "The Worker") {
  const { code, message } = body?.error ?? {};
  return {
    code: typeof code === "string" && code ? code : `http_${status}`,
    message: typeof message === "string" && message ? message : `${answerer} answered ${status}`,
  };
}
