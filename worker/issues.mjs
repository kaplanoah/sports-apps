// Keeps one open issue for a problem the workflows watch, found by its title, and closes it once
// the problem is gone.
import { createGitHub } from "./github-api.mjs";

/**
 * @param {any[]} openIssues
 * @param {string} title
 */
export const findOpenIssue = (openIssues, title) =>
  openIssues.find((issue) => issue.title === title && !issue.pull_request);

/**
 * @param {ReturnType<typeof createGitHub>} github
 * @param {string} title
 * @param {string} body
 * @returns {Promise<number>} the new issue's number
 */
export async function openIssue(github, title, body) {
  const created = await github("/issues", { method: "POST", body: { title, body } });
  return created.number;
}

/**
 * @param {ReturnType<typeof createGitHub>} github
 * @param {number} number
 * @param {string} comment
 */
export async function closeIssue(github, number, comment) {
  await github(`/issues/${number}/comments`, { method: "POST", body: { body: comment } });
  await github(`/issues/${number}`, {
    method: "PATCH",
    body: { state: "closed", state_reason: "completed" },
  });
}
