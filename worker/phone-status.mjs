// A red change waits for the owner's phone on a commit status of its own, which CI's phone job
// sets on the pull request's head: pending until the owner labels it phone-ok, so check can pass
// on its tests and review alone. That holds the merge only while main's rules require the status,
// so check holds a red change itself whenever they don't.
// Usage: node worker/phone-status.mjs, with GH_TOKEN and GITHUB_REPOSITORY set. It writes
// whether main's rules require the status to $GITHUB_OUTPUT as required=true or required=false.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub } from "./github-api.mjs";

export const PHONE_CONTEXT = "phone";

/**
 * Whether a branch's rules require the phone status before a merge.
 * @param {{ type: string, parameters?: { required_status_checks?: { context: string }[] } }[]} rules
 */
export const isPhoneRequired = (rules) =>
  rules.some(
    ({ type, parameters }) =>
      type === "required_status_checks" &&
      (parameters?.required_status_checks ?? []).some(({ context }) => context === PHONE_CONTEXT),
  );

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const readJson = createGitHub({
    repository: String(process.env.GITHUB_REPOSITORY),
    fetchImpl: fetch,
    env: process.env,
  });
  const required = isPhoneRequired(await readJson("/rules/branches/main"));
  console.log(
    required
      ? "Main's rules require the phone status, which holds the merge."
      : "Main's rules don't require the phone status, so check holds the red change.",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
}
