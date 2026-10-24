import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { readReviewRun } from "./review-run.mjs";
import { readReviewArtifact } from "./review-artifact.mjs";
import { verifyTrustedReviewResult } from "./find-trusted-review.mjs";
import {
  isPublicationExempt,
  selectPublicationPull,
  selectPublicationRun,
  validatePublicationEvidence,
  validatePublicationJobs,
  createPublicationStamp,
  validatePublicationAttestation,
} from "./review-publication.mjs";

const CHECK_NAME = "trusted-review";

/** @param {NodeJS.ProcessEnv} env */
export function requirePublisherAuthority(env) {
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    !["pull_request_target", "workflow_run"].includes(env.GITHUB_EVENT_NAME) ||
    !["review.yml", "trusted-review-publisher.yml"].some(
      (name) =>
        env.GITHUB_WORKFLOW_REF ===
        `${env.GITHUB_REPOSITORY}/.github/workflows/${name}@refs/heads/main`,
    )
  )
    throw new Error("Publisher requires trusted main workflow authority.");
}

/** @param {any} event @param {NodeJS.ProcessEnv} env @param {(path:string)=>Promise<any>} readGitHub */
export async function discoverPublicationHeads(event, env, readGitHub) {
  requirePublisherAuthority(env);
  if (env.GITHUB_EVENT_NAME === "workflow_run") {
    if (!Number.isSafeInteger(event.workflow_run?.id)) throw new Error("Missing workflow run.");
    const run = await readGitHub(`/actions/runs/${event.workflow_run.id}`);
    const identity = readReviewRun(run);
    if (!identity?.intent || run.repository.full_name !== env.GITHUB_REPOSITORY)
      throw new Error("Untrusted review lifecycle event.");
    return [identity.head];
  }
  const heads = [event.pull_request?.head?.sha];
  if (event.action === "synchronize") heads.push(event.before);
  if (heads.some((head) => !isGitObjectId(head))) throw new Error("Missing affected PR head.");
  return [...new Set(heads)];
}

/** @param {(path:string)=>Promise<any>} readGitHub @param {any} run */
async function readProducerJobs(readGitHub, run) {
  const jobs = await readAllPages(
    readGitHub,
    `/actions/runs/${run.id}/jobs?filter=all`,
    (answer) => answer.jobs,
  );
  if (jobs.some((job) => job.run_id !== run.id)) throw new Error("Foreign producer job.");
  return jobs;
}

/** @param {any} options @param {any} artifact @param {number} run @param {string[]} names @param {string} [digest] */
async function withArtifact(options, artifact, run, names, digest) {
  return readReviewArtifact(artifact, {
    repository: options.env.GITHUB_REPOSITORY,
    token: options.env.GH_TOKEN,
    repositoryId: Number(options.env.GITHUB_REPOSITORY_ID),
    run,
    names,
    digest,
    fetchImpl: options.fetchImpl,
  });
}

/** @param {any} options @param {any} run @param {any} needs @param {any} identity */
async function validateResultArtifact(options, run, needs, identity) {
  const outputs = needs.review?.outputs;
  const artifactId = Number(outputs?.artifact);
  if (!Number.isSafeInteger(artifactId) || !/^[a-f0-9]{64}$/.test(outputs?.digest ?? ""))
    throw new Error("Missing authenticated review upload outputs.");
  const artifact = await options.readGitHub(`/actions/artifacts/${artifactId}`);
  if (artifact.name !== `trusted-review-passed-${outputs.tree}`)
    throw new Error("Unexpected review result artifact.");
  const folder = await withArtifact(
    options,
    artifact,
    run.id,
    ["result.json", "provenance.json"],
    outputs.digest,
  );
  try {
    const result = verifyTrustedReviewResult(folder, {
      GITHUB_REPOSITORY: options.env.GITHUB_REPOSITORY,
      REVIEW_RUN: String(run.id),
      REVIEW_HEAD: identity.head,
      REVIEW_BASE: identity.base,
      REVIEW_TRUSTED: identity.source,
      REVIEW_TREE: outputs.tree,
    });
    const commit = await options.readGitHub(`/git/commits/${result.merge}`);
    if (
      commit.sha !== result.merge ||
      commit.tree?.sha !== result.tree ||
      JSON.stringify(commit.parents?.map((parent) => parent.sha)) !==
        JSON.stringify([identity.base, identity.head])
    )
      throw new Error("Reviewed merge parents or tree changed.");
    return { artifact: artifactId, digest: outputs.digest, merge: result.merge, tree: result.tree };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** @param {any} options @param {any} run @param {any} pull @param {any[]} jobs */
async function readTerminalEvidence(options, run, pull, jobs) {
  const terminal = jobs.filter(
    (job) =>
      ["review-publish", "review-publish / publish"].includes(job.name) &&
      job.run_attempt === run.run_attempt,
  );
  if (
    terminal.length !== 1 ||
    terminal[0].status !== "completed" ||
    terminal[0].conclusion !== "success"
  )
    throw new Error("No successful current terminal publisher.");
  const artifacts = await readAllPages(
    options.readGitHub,
    `/actions/runs/${run.id}/artifacts`,
    (answer) => answer.artifacts,
  );
  const matching = artifacts.filter(
    (artifact) => artifact.name === `trusted-review-publication-${run.run_attempt}`,
  );
  if (matching.length !== 1) throw new Error("Missing or ambiguous terminal publication evidence.");
  const folder = await withArtifact(options, matching[0], run.id, ["decision.json"]);
  try {
    const evidence = JSON.parse(readFileSync(join(folder, "decision.json"), "utf8"));
    const checks = await readOwnedChecks(options, pull.head.sha);
    if (checks.length !== 1) throw new Error("Ambiguous App publication attestation.");
    validatePublicationAttestation(checks[0], evidence, Number(options.env.TRUSTED_REVIEW_APP_ID));
    validatePublicationEvidence(pull, run, evidence, jobs);
    const result = await validateResultArtifact(options, run, evidence.needs, readReviewRun(run));
    if (["artifact", "digest", "merge", "tree"].some((key) => evidence[key] !== result[key]))
      throw new Error("Terminal result evidence changed.");
    return evidence;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** @param {any} options @param {string} head @param {any} repository */
async function readPublicationContext(options, head, repository) {
  const pulls = await readAllPages(options.readGitHub, "/pulls?state=open");
  const candidate = selectPublicationPull(pulls, head, repository.full_name);
  if (!candidate) return { pull: null, run: null };
  const pull = await options.readGitHub(`/pulls/${candidate.number}`);
  if (!selectPublicationPull([pull], head, repository.full_name)) return { pull: null, run: null };
  if (pull.base.repo.id !== repository.id) throw new Error("Foreign PR base repository.");
  const runs = await readAllPages(
    options.readGitHub,
    `/actions/workflows/review.yml/runs?event=pull_request_target&head_sha=${head}`,
    (answer) => answer.workflow_runs,
  );
  const run = selectPublicationRun(runs, pull, { name: repository.full_name, id: repository.id });
  return { pull, run };
}

/** @param {any} options @param {string} head */
async function readOwnedChecks(options, head) {
  const appId = Number(options.env.TRUSTED_REVIEW_APP_ID);
  if (!Number.isSafeInteger(appId) || appId < 1) throw new Error("Missing publisher App ID.");
  const suites = await readAllPages(
    options.writeGitHub,
    `/commits/${head}/check-suites?app_id=${appId}`,
    (answer) => answer.check_suites,
  );
  const checks = [];
  for (const suite of suites) {
    if (suite.app?.id !== appId || suite.head_sha !== head || !Number.isSafeInteger(suite.id))
      throw new Error("Foreign publisher check suite.");
    const entries = await readAllPages(
      options.writeGitHub,
      `/check-suites/${suite.id}/check-runs?filter=all`,
      (answer) => answer.check_runs,
    );
    for (const check of entries) {
      if (check.app?.id !== appId || check.head_sha !== head)
        throw new Error("Foreign publisher check.");
      if (!Number.isSafeInteger(check.id)) throw new Error("Invalid publisher check ID.");
      if (check.name === CHECK_NAME) checks.push(check);
    }
  }
  return checks;
}

/** @param {any} options @param {string} head @param {any} decision @param {any} repository */
async function publishDecision(options, head, decision, repository) {
  const checks = await readOwnedChecks(options, head);
  if (checks.length > 1) {
    for (const check of checks)
      await options.writeGitHub(`/check-runs/${check.id}`, {
        method: "PATCH",
        body: {
          status: "completed",
          conclusion: "failure",
          output: {
            title: "Conflicting publisher checks",
            summary: "Publisher checks need repair; review remains required.",
          },
        },
      });
    throw new Error("Multiple App-owned trusted-review checks; success withheld.");
  }
  const body = {
    name: CHECK_NAME,
    head_sha: head,
    external_id: `trusted-review:${repository.id}:${head}`,
    status: "completed",
    conclusion: decision.success ? "success" : "failure",
    output: {
      title: decision.title,
      summary: decision.summary,
      text: decision.stamp ?? checks[0]?.output?.text ?? "",
    },
  };
  const { head_sha, ...update } = body;
  const answer = await options.writeGitHub(
    checks.length ? `/check-runs/${checks[0].id}` : "/check-runs",
    {
      method: checks.length ? "PATCH" : "POST",
      body: checks.length ? update : { ...update, head_sha },
    },
  );
  if (
    answer.app?.id !== Number(options.env.TRUSTED_REVIEW_APP_ID) ||
    answer.head_sha !== head ||
    answer.name !== CHECK_NAME ||
    answer.conclusion !== body.conclusion
  )
    throw new Error("GitHub did not confirm the expected publisher identity/result.");
  return answer.id;
}

/** @param {any} options @param {any} repository @param {any} previous */
async function requireFreshContext(options, repository, previous) {
  const current = await readPublicationContext(options, previous.pull.head.sha, repository);
  if (
    !current.pull ||
    current.pull.number !== previous.pull.number ||
    current.pull.base.sha !== previous.pull.base.sha ||
    current.pull.base.ref !== previous.pull.base.ref ||
    current.run?.id !== previous.run?.id ||
    current.run?.run_attempt !== previous.run?.run_attempt ||
    (current.run?.status === "completed" && current.run.conclusion !== "success") ||
    isPublicationExempt(current.pull) !== isPublicationExempt(previous.pull)
  )
    throw new Error("PR authorization context changed before publication.");
}

/** @param {any} options */
export async function reconcileReviewPublication(options) {
  const { env } = options;
  requirePublisherAuthority(env);
  const head = env.PUBLISH_HEAD;
  const phase = env.PUBLISH_PHASE;
  if (!isGitObjectId(head) || !["begin", "finish", "observe"].includes(phase))
    throw new Error("Invalid publication request.");
  const repository = await options.readGitHub("");
  if (repository.full_name !== env.GITHUB_REPOSITORY || !Number.isSafeInteger(repository.id))
    throw new Error("Unexpected publisher repository.");
  const context = await readPublicationContext(options, head, repository);
  const { pull, run } = context;
  const hold = (title, summary) =>
    publishDecision(options, head, { success: false, title, summary }, repository);
  if (!pull) {
    await hold(
      "Review context is unavailable or conflicting",
      "Exactly one open, ready PR targeting main must own this commit.",
    );
    return { success: false };
  }
  if (isPublicationExempt(pull)) {
    await requireFreshContext(options, repository, context);
    await publishDecision(
      options,
      head,
      {
        success: true,
        title: "Review not required for Dependabot",
        summary:
          "The trusted publisher verified the existing Dependabot exemption. This is not reviewed evidence.",
      },
      repository,
    );
    return { success: true, exempt: true };
  }
  if (!run) {
    await hold(
      "Trusted review is owed",
      "No authorized trusted review covers this PR head and base.",
    );
    return { success: false };
  }
  const ownsRequest =
    run.id === Number(env.GITHUB_RUN_ID) && run.run_attempt === Number(env.GITHUB_RUN_ATTEMPT);
  if (
    ownsRequest &&
    phase !== "observe" &&
    (env.GITHUB_WORKFLOW_REF !==
      `${env.GITHUB_REPOSITORY}/.github/workflows/review.yml@refs/heads/main` ||
      readReviewRun(run).source !== env.GITHUB_SHA)
  )
    throw new Error("Publisher source does not match native trusted workflow authority.");
  if (phase === "begin" && ownsRequest) {
    await hold(
      "Trusted review is in progress",
      "A new authorized review attempt owns this check; earlier success has been invalidated.",
    );
    return { success: false };
  }
  if (phase === "finish" && ownsRequest) {
    const check = await hold(
      "Validating trusted review",
      "Earlier success is invalid until this attempt's result is verified.",
    );
    const needs = JSON.parse(env.PUBLISH_NEEDS);
    const jobs = await readProducerJobs(options.readGitHub, run);
    const producers = validatePublicationJobs(jobs, run.run_attempt, needs);
    const identity = readReviewRun(run);
    const result = await validateResultArtifact(options, run, needs, identity);
    const evidence = {
      version: 1,
      repository: repository.full_name,
      repositoryId: repository.id,
      pull: pull.number,
      head,
      base: pull.base.sha,
      target: pull.base.ref,
      source: identity.source,
      run: run.id,
      attempt: run.run_attempt,
      needs,
      producers,
      ...result,
      check,
    };
    await requireFreshContext(options, repository, context);
    await publishDecision(
      options,
      head,
      {
        success: true,
        title: "Validated trusted review passed",
        summary: `Trusted run ${run.id}, attempt ${run.run_attempt}, PR #${pull.number}. Reviewed head ${head}, base ${pull.base.sha}, tree ${result.tree}.`,
        stamp: createPublicationStamp(evidence),
      },
      repository,
    );
    const folder = join(env.RUNNER_TEMP, "review-publication-evidence");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "decision.json"), JSON.stringify(evidence));
    return { success: true };
  }
  if (
    phase === "begin" &&
    readReviewRun(await options.readGitHub(`/actions/runs/${env.GITHUB_RUN_ID}`))?.intent ===
      "review"
  )
    throw new Error("Superseded review request cannot reclaim publication.");
  if (run.status !== "completed" || run.conclusion !== "success") {
    await hold(
      "Trusted review has not passed",
      "The latest authorized request is pending, failed, or cancelled; earlier success cannot authorize this attempt.",
    );
    return { success: false };
  }
  const jobs = await readProducerJobs(options.readGitHub, run);
  try {
    await readTerminalEvidence(options, run, pull, jobs);
    await requireFreshContext(options, repository, context);
  } catch (error) {
    await hold(
      "Trusted publication evidence is unavailable",
      "The current attempt has no valid terminal decision. Inspect the publisher workflow before retrying.",
    );
    throw error;
  }
  await publishDecision(
    options,
    head,
    {
      success: true,
      title: "Validated trusted review passed",
      summary: `Revalidated trusted run ${run.id}, attempt ${run.run_attempt}, PR #${pull.number}.`,
    },
    repository,
  );
  return { success: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
  if (process.argv[2] === "discover") {
    const heads = await discoverPublicationHeads(
      JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")),
      env,
      readGitHub,
    );
    appendFileSync(env.GITHUB_OUTPUT, `heads=${JSON.stringify(heads)}\n`);
  } else {
    const writeGitHub = createGitHub({
      repository: env.GITHUB_REPOSITORY,
      fetchImpl: fetch,
      env: { ...env, GH_TOKEN: env.APP_TOKEN },
    });
    await reconcileReviewPublication({ env, readGitHub, writeGitHub, fetchImpl: fetch });
  }
}
