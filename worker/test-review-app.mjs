import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub, createGitHubRoot, GitHubError, readAllPages } from "./github-api.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { REVIEW_CHECK_NAME } from "./review-run.mjs";

const PROOF_REF = "refs/heads/issue-809-app-identity-proof";
const PROOF_PATH = ".github/issue-809-app-identity-proof.md";
const PROOF_TEXT = "Issue #809 App identity proof only.\n";

class AppProofError extends Error {}

/** @param {NodeJS.ProcessEnv} env */
function requireAppProofAuthority(env) {
  const repository = env.GITHUB_REPOSITORY;
  const owner = env.GITHUB_REPOSITORY_OWNER;
  const app = Number(env.TRUSTED_REVIEW_APP_ID);
  if (
    !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? "") ||
    repository.split("/")[0] !== owner ||
    env.GITHUB_ACTOR !== owner ||
    env.GITHUB_TRIGGERING_ACTOR !== owner ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_WORKFLOW_REF !==
      `${repository}/.github/workflows/trusted-review-app-test.yml@refs/heads/main` ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") ||
    !isGitObjectId(env.GITHUB_SHA) ||
    !isGitObjectId(env.APP_PROOF_HEAD) ||
    env.APP_PROOF_HEAD === env.GITHUB_SHA ||
    env.APP_PROOF_APPROVAL !== "APPROVE_ONE_APP_IDENTITY_TEST" ||
    (env.TRUSTED_REVIEW_PUBLISHER_ENABLED ?? "") !== "" ||
    (env.TRUSTED_CODEX_REVIEW_ENABLED ?? "") !== "" ||
    !Number.isSafeInteger(app) ||
    app < 1 ||
    String(app) !== env.TRUSTED_REVIEW_APP_ID ||
    env.TRUSTED_REVIEW_APP_ID !== env.APP_PROOF_EXPECTED_ID
  )
    throw new AppProofError(
      "App proof requires owner dispatch from main, attempt one, and unset activation flags.",
    );
  return { repository, head: env.APP_PROOF_HEAD, source: env.GITHUB_SHA, app };
}

/** @param {any} answer @returns {any[]} */
function requireProofList(answer) {
  if (!Array.isArray(answer)) throw new AppProofError("Malformed proof metadata listing.");
  return answer;
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string)=>Promise<any>} readMetadata */
export async function validateAppProofTarget(env, readMetadata) {
  const proof = requireAppProofAuthority(env);
  const repository = await readMetadata("");
  const main = await readMetadata("/git/ref/heads/main");
  const ref = await readMetadata(`/git/ref/${PROOF_REF.slice("refs/".length)}`);
  const commit = await readMetadata(`/git/commits/${proof.head}`);
  const comparison = await readMetadata(`/compare/${proof.source}...${proof.head}`);
  const marker = await readMetadata(`/contents/${PROOF_PATH}?ref=${proof.head}`);
  if (
    repository.full_name !== proof.repository ||
    repository.default_branch !== "main" ||
    repository.fork !== false ||
    main.ref !== "refs/heads/main" ||
    main.object?.type !== "commit" ||
    main.object.sha !== proof.source ||
    ref.ref !== PROOF_REF ||
    ref.object?.type !== "commit" ||
    ref.object.sha !== proof.head ||
    commit.sha !== proof.head ||
    commit.parents?.length !== 1 ||
    commit.parents[0].sha !== proof.source ||
    comparison.status !== "ahead" ||
    comparison.ahead_by !== 1 ||
    comparison.behind_by !== 0 ||
    comparison.commits?.length !== 1 ||
    comparison.commits[0].sha !== proof.head ||
    comparison.merge_base_commit?.sha !== proof.source ||
    comparison.files?.length !== 1 ||
    comparison.files[0].filename !== PROOF_PATH ||
    comparison.files[0].status !== "added" ||
    marker.type !== "file" ||
    marker.path !== PROOF_PATH ||
    marker.encoding !== "base64" ||
    Buffer.from(marker.content ?? "", "base64").toString("utf8") !== PROOF_TEXT
  )
    throw new AppProofError(
      "Proof target must be one marker-only commit above the current trusted main source.",
    );
  const pulls = await readAllPages(readMetadata, "/pulls?state=open", requireProofList);
  if (pulls.some((pull) => pull.head?.sha === proof.head || pull.merge_commit_sha === proof.head))
    throw new AppProofError("Proof target belongs to an open pull request.");
  const checks = await readAllPages(
    readMetadata,
    `/commits/${proof.head}/check-runs?filter=all`,
    (answer) => requireProofList(answer.check_runs),
  );
  if (checks.some((check) => check.name === REVIEW_CHECK_NAME))
    throw new AppProofError(
      `Proof target already has a ${REVIEW_CHECK_NAME} check; no replacement is allowed.`,
    );
  return proof;
}

/** @param {any} check @param {any} proof @param {string} external */
function requireFailingProofCheck(check, proof, external) {
  if (
    !Number.isSafeInteger(check.id) ||
    check.id < 1 ||
    check.app?.id !== proof.app ||
    check.head_sha !== proof.head ||
    check.name !== REVIEW_CHECK_NAME ||
    check.external_id !== external ||
    check.status !== "completed" ||
    check.conclusion !== "failure"
  )
    throw new AppProofError("GitHub did not confirm the expected App-owned failing proof check.");
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {(path:string)=>Promise<any>} readMetadata
 * @param {(path:string,request?:{method?:string,body?:unknown})=>Promise<any>} writeChecks
 * @param {()=>Promise<any>} readInstallation
 */
export async function publishAppIdentityProof(env, readMetadata, writeChecks, readInstallation) {
  const proof = requireAppProofAuthority(env);
  const installation = Number(env.APP_PROOF_INSTALLATION);
  if (!Number.isSafeInteger(installation) || installation < 1)
    throw new AppProofError("Missing proof installation identity.");
  const scope = await readInstallation();
  if (
    scope.total_count !== 1 ||
    scope.repositories?.length !== 1 ||
    scope.repositories[0].full_name !== proof.repository
  )
    throw new AppProofError("Proof App token is not scoped to this repository alone.");
  await validateAppProofTarget(env, readMetadata);
  const external = `issue-809-app-identity:${env.GITHUB_RUN_ID}`;
  const created = await writeChecks("/check-runs", {
    method: "POST",
    body: {
      name: REVIEW_CHECK_NAME,
      head_sha: proof.head,
      external_id: external,
      status: "completed",
      conclusion: "failure",
      output: {
        title: "Issue #809 synthetic App identity proof",
        summary:
          "No review was performed. This disposable proof check deliberately fails and cannot approve a pull request.",
      },
    },
  });
  requireFailingProofCheck(created, proof, external);
  const observed = await writeChecks(`/check-runs/${created.id}`);
  requireFailingProofCheck(observed, proof, external);
  return {
    repository: proof.repository,
    source: proof.source,
    head: proof.head,
    app: proof.app,
    installation,
    check: observed.id,
    run: env.GITHUB_RUN_ID,
    conclusion: "failure",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env;
    requireAppProofAuthority(env);
    if (!env.GH_TOKEN) throw new AppProofError("Missing read-only proof metadata token.");
    const readMetadata = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
    if (process.argv[2] === "validate") {
      await validateAppProofTarget(env, readMetadata);
      console.log("Owner/main authority and unused disposable target verified before key use.");
    } else if (process.argv[2] === "publish") {
      if (!env.APP_TOKEN) throw new AppProofError("Missing proof App token.");
      const appOptions = {
        repository: env.GITHUB_REPOSITORY,
        fetchImpl: fetch,
        env: { GH_TOKEN: env.APP_TOKEN },
      };
      const writeChecks = createGitHub(appOptions);
      const readRoot = createGitHubRoot(appOptions);
      const evidence = await publishAppIdentityProof(env, readMetadata, writeChecks, () =>
        readRoot("/installation/repositories?per_page=100"),
      );
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `App identity proof (deliberate failure):\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n\nCheck the token action's post-job revocation result separately.\n`,
      );
      console.log(
        "App-owned failing check and repository-only token scope verified. Token revocation is a separate post-job result.",
      );
    } else {
      throw new AppProofError("Unknown App proof phase.");
    }
  } catch (error) {
    console.error(
      `::error::${error instanceof AppProofError || error instanceof GitHubError ? error.message : "Unexpected App proof failure; no passing check is permitted."}`,
    );
    process.exitCode = 1;
  }
}
