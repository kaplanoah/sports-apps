import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { PHONE_OK_LABEL } from "./labeling.mjs";
import { readRedApproval, readCommitChange } from "./red-change.mjs";

/**
 * Recheck existing approvals after main or its deploy changes, using only trusted code.
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, cwd?: string }} [options]
 */
export async function refreshRedApprovals({
  env = process.env,
  fetchImpl = fetch,
  cwd = process.cwd(),
} = {}) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const github = createGitHub({ repository, fetchImpl, env });
  const pulls = await readAllPages(github, "/pulls?state=open&base=main");
  for (const pull of pulls) {
    if (
      pull.head?.repo?.full_name !== repository ||
      !pull.labels?.some((label) => label.name === PHONE_OK_LABEL)
    )
      continue;
    const head = pull.head.sha;
    if (!/^[a-f0-9]{40}$/.test(head))
      throw new Error("Pull request returned no valid head commit.");
    /** @param {string} state @param {string} description */
    const publish = (state, description) =>
      github(`/statuses/${head}`, {
        method: "POST",
        body: { context: "phone", state, description },
      });
    // If evidence cannot be read, an earlier success must not survive this refresh.
    await publish("pending", "Rechecking phone approval against main and its deploy");
    try {
      execFileSync("git", ["fetch", "--no-tags", "origin", head], {
        cwd,
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const base = execFileSync("git", ["merge-base", "origin/main", head], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const files = readCommitChange(base, head, cwd);
      const verdict = await readRedApproval({
        diff: files.diff,
        labels: pull.labels.map((label) => label.name),
        files,
        env: { ...env, PR: String(pull.number), HEAD_SHA: head },
        fetchImpl,
        cwd,
      });
      console.log(`#${pull.number}: ${verdict.message}`);
      if (!verdict.isHeld)
        await publish("success", "Phone approval is current; no red deploy is pending");
    } catch (error) {
      console.error(
        `#${pull.number}: phone approval stays pending: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await refreshRedApprovals();
