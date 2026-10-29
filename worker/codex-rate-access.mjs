import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createGitHub, readPages } from "./github-api.mjs";
import { readVerifiedArtifactArchive } from "./review-artifact.mjs";

/** @param {any} expected @param {any} [options] */
export async function proveNativeQuotaAccess(expected, { fetchImpl = fetch } = {}) {
  let metadataRead = false;
  const api = createGitHub({
    repository: expected.repository,
    fetchImpl,
    env: { GH_TOKEN: expected.token },
  });
  try {
    for await (const artifacts of readPages(
      api,
      "/actions/artifacts",
      (answer) => answer.artifacts,
    )) {
      metadataRead = true;
      const artifact = artifacts.find(
        (item) =>
          !item.expired &&
          item.workflow_run?.id !== expected.run &&
          item.size_in_bytes <= 1024 * 1024 &&
          /^(?:codex-rate-isolation-proof|production-checked-[a-f0-9]{40}|codex-rate-handoff-[1-9]\d*)$/.test(
            item.name,
          ),
      );
      if (!artifact) continue;
      await readVerifiedArtifactArchive(artifact, {
        repository: expected.repository,
        repositoryId: expected.repositoryId,
        run: artifact.workflow_run.id,
        token: expected.token,
        names: [],
        fetchImpl,
      });
      return {
        passed: true,
        metadataRead: true,
        archiveRead: true,
        status: 200,
        artifact: artifact.id,
        digest: artifact.digest,
      };
    }
    return { passed: false, metadataRead, archiveRead: false, status: 404 };
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 0;
    if (![401, 403, 404].includes(status)) throw error;
    return { passed: false, metadataRead, archiveRead: false, status };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = process.env;
  const access = await proveNativeQuotaAccess({
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    run: Number(env.GITHUB_RUN_ID),
    token: env.GH_TOKEN,
  });
  writeFileSync(
    join(env.RUNNER_TEMP, "codex-rate-access.json"),
    JSON.stringify({
      version: 1,
      source: env.GITHUB_SHA,
      run: env.GITHUB_RUN_ID,
      attempt: env.GITHUB_RUN_ATTEMPT,
      nativeModelStarted: false,
      realOpenAICredentialUsed: false,
      ...access,
    }),
  );
  console.log(
    `Native quota metadata access: ${access.passed ? "verified" : `unavailable (${access.status})`}.`,
  );
}
