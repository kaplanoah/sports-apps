// Checks an answer a Worker route made with `respondError` in shared/worker/responses.js.
import assert from "node:assert/strict";

/**
 * Asserts the answer has the status, and an error with the code and a message, and returns the
 * message.
 * @param {Response | { status: number, body: any }} answer a route's response, or its status and
 * body once read
 * @param {number} status
 * @param {string} code
 */
export async function assertErrorAnswer(answer, status, code) {
  const body = answer instanceof Response ? await answer.json() : answer.body;
  assert.equal(answer.status, status);
  assert.equal(body.error?.code, code);
  assert.equal(typeof body.error.message, "string");
  return /** @type {string} */ (body.error.message);
}
