import { readAllPages } from "./github-api.mjs";
import { isGitObjectId } from "./git-object.mjs";

/**
 * A receipt records confirmed production coverage. Workflow success alone can also mean the
 * deploy was superseded without uploading, so it never establishes coverage on its own.
 * @param {(path: string) => Promise<any>} github
 */
export async function readDeployedMain(github) {
  const prefix = "production-checked-";
  const { workflow_runs: runs } = await github(
    "/actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=10",
  );
  for (const run of runs) {
    if (
      run.path !== ".github/workflows/deploy.yml" ||
      run.head_branch !== "main" ||
      run.conclusion !== "success"
    )
      continue;
    const artifacts = await readAllPages(
      github,
      `/actions/runs/${run.id}/artifacts`,
      (answer) => answer.artifacts,
    );
    const commits = [
      ...new Set(
        artifacts
          .filter((artifact) => artifact.expired === false)
          .map((artifact) =>
            typeof artifact.name === "string" && artifact.name.startsWith(prefix)
              ? artifact.name.slice(prefix.length)
              : null,
          )
          .filter(isGitObjectId),
      ),
    ];
    if (commits.length === 1) return commits[0];
    if (commits.length > 1) throw new Error("Deploy returned conflicting checked commits.");
  }
  throw new Error(
    "No successful production deploy with an unexpired checked-commit receipt found in the last ten successful main Deploy runs.",
  );
}
