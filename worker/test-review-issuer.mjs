import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createGitHub, createGitHubRoot, GitHubError, readAllPages } from "./github-api.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { REVIEW_CHECK_NAME } from "./review-run.mjs";

const BASE = "issue-809-issuer-base";
const HEAD = "issue-809-issuer-head";
const MARKER = ".github/issue-809-issuer-proof.md";
const TEXT = "Issue #809 isolated issuer proof only.\n";
const SCHEMA = "issue-809-issuer-proof/v1";
const PHASES = /** @type {Record<string, {previous:string|null, conclusion:string}>} */ ({
  fail: { previous: null, conclusion: "failure" },
  pass: { previous: "fail", conclusion: "success" },
  reset: { previous: "pass", conclusion: "failure" },
});

class IssuerProofError extends Error {}

/** @param {unknown} value */
function isPositiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value));
}

/** @param {NodeJS.ProcessEnv} env */
function requireIssuerAuthority(env) {
  const repository = env.GITHUB_REPOSITORY;
  const owner = env.GITHUB_REPOSITORY_OWNER;
  const phase = env.ISSUER_PHASE;
  if (
    !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? "") ||
    repository.split("/")[0] !== owner ||
    env.GITHUB_ACTOR !== owner ||
    env.GITHUB_TRIGGERING_ACTOR !== owner ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !==
      `${repository}/.github/workflows/trusted-review-issuer-test.yml@refs/heads/main` ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.GITHUB_SHA !== env.ISSUER_SOURCE ||
    !isGitObjectId(env.ISSUER_SOURCE) ||
    !isGitObjectId(env.ISSUER_HEAD) ||
    env.ISSUER_HEAD === env.ISSUER_SOURCE ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !isPositiveId(env.GITHUB_RUN_ID) ||
    !isPositiveId(env.ISSUER_PULL) ||
    !isPositiveId(env.ISSUER_RULESET) ||
    !phase ||
    !Object.hasOwn(PHASES, phase) ||
    env.ISSUER_APPROVAL !== "APPROVE_ISOLATED_ISSUER_PROTOCOL" ||
    (env.TRUSTED_REVIEW_PUBLISHER_ENABLED ?? "") !== "" ||
    (env.TRUSTED_CODEX_REVIEW_ENABLED ?? "") !== "" ||
    !isPositiveId(env.TRUSTED_REVIEW_APP_ID) ||
    env.TRUSTED_REVIEW_APP_ID !== env.ISSUER_EXPECTED_APP ||
    (phase === "fail" ? env.ISSUER_CHECK !== "0" : !isPositiveId(env.ISSUER_CHECK)) ||
    (phase === "fail" ? env.ISSUER_ACTIONS_CHECK !== "0" : !isPositiveId(env.ISSUER_ACTIONS_CHECK))
  )
    throw new IssuerProofError(
      "Issuer proof requires approved owner/main authority, exact source, first attempt and unset activation flags.",
    );
  const proof = {
    repository,
    source: env.ISSUER_SOURCE,
    head: env.ISSUER_HEAD,
    phase,
    pull: Number(env.ISSUER_PULL),
    ruleset: Number(env.ISSUER_RULESET),
    app: Number(env.TRUSTED_REVIEW_APP_ID),
    check: Number(env.ISSUER_CHECK),
    actionsCheck: Number(env.ISSUER_ACTIONS_CHECK),
    run: env.GITHUB_RUN_ID,
  };
  const rulesetSnapshot = readApprovedRuleset(env, proof);
  return {
    ...proof,
    rulesetSnapshot,
    rulesetDigest: createHash("sha256").update(JSON.stringify(rulesetSnapshot)).digest("hex"),
  };
}

/** @param {any} value @returns {any[]} */
function requireProofList(value) {
  if (!Array.isArray(value)) throw new IssuerProofError("Malformed issuer proof listing.");
  return value;
}

/** @param {any} rule @param {number} app */
function isPinnedRule(rule, app) {
  const parameters = rule?.parameters;
  return (
    rule?.type === "required_status_checks" &&
    parameters?.strict_required_status_checks_policy === false &&
    parameters.do_not_enforce_on_create !== true &&
    parameters.required_status_checks?.length === 1 &&
    parameters.required_status_checks[0].context === REVIEW_CHECK_NAME &&
    parameters.required_status_checks[0].integration_id === app
  );
}

/** @param {any} ruleset @param {any} proof */
function isIsolatedConfiguration(ruleset, proof) {
  return (
    ruleset?.id === proof.ruleset &&
    ruleset.name === "Issue 809 issuer proof" &&
    ruleset.target === "branch" &&
    ruleset.enforcement === "active" &&
    ruleset.source_type === "Repository" &&
    ruleset.source === proof.repository &&
    ruleset.conditions?.ref_name?.include?.length === 1 &&
    ruleset.conditions.ref_name.include[0] === `refs/heads/${BASE}` &&
    ruleset.conditions.ref_name.exclude?.length === 0 &&
    ruleset.rules?.length === 1 &&
    isPinnedRule(ruleset.rules[0], proof.app)
  );
}

/** @param {NodeJS.ProcessEnv} env @param {any} proof */
function readApprovedRuleset(env, proof) {
  let snapshot;
  try {
    snapshot = JSON.parse(env.ISSUER_RULESET_SNAPSHOT ?? "");
  } catch {
    throw new IssuerProofError("Missing approved owner ruleset snapshot.");
  }
  if (
    !isIsolatedConfiguration(snapshot, proof) ||
    !Array.isArray(snapshot.bypass_actors) ||
    snapshot.bypass_actors.length !== 0 ||
    snapshot.current_user_can_bypass !== "never" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      snapshot.updated_at,
    )
  )
    throw new IssuerProofError(
      "Approved owner snapshot must pin the isolated rule, its version and no bypass actors.",
    );
  return snapshot;
}

/** @param {any} ruleset */
function hasVisibleBypass(ruleset) {
  return (
    Object.hasOwn(ruleset, "bypass_actors") &&
    (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0)
  );
}

/** @param {any} ruleset @param {any[]} effective @param {any} proof */
function requireIsolatedRule(ruleset, effective, proof) {
  if (
    !isIsolatedConfiguration(ruleset, proof) ||
    ruleset.updated_at !== proof.rulesetSnapshot.updated_at ||
    ruleset.current_user_can_bypass !== "never" ||
    hasVisibleBypass(ruleset) ||
    effective.length !== 1 ||
    !isPinnedRule(effective[0], proof.app)
  )
    throw new IssuerProofError(
      "Issuer rule must require only the expected App on the exact disposable base, without bypass or additional effective rules.",
    );
}

/** @param {any} check @param {any} proof */
function requireOwnedProofCheck(check, proof) {
  if (
    !isPositiveId(check?.id) ||
    check.app?.id !== proof.app ||
    check.name !== REVIEW_CHECK_NAME ||
    check.head_sha !== proof.head ||
    check.status !== "completed" ||
    check.external_id !== `issue-809-issuer:${proof.source}:${proof.head}`
  )
    throw new IssuerProofError("Unexpected issuer proof check identity.");
}

/** @param {any[]} checks @param {any} proof */
function requireProofTransition(checks, proof) {
  const named = checks.filter((check) => check.name === REVIEW_CHECK_NAME);
  const owned = named.filter((check) => check.app?.id === proof.app);
  if (proof.phase === "fail") {
    if (named.length)
      throw new IssuerProofError("Initial issuer target already has a trusted-review check.");
    return;
  }
  if (owned.length !== 1 || owned[0].id !== proof.check)
    throw new IssuerProofError(
      "Issuer proof requires one exact owned check; duplicates cannot be selected away.",
    );
  requireOwnedProofCheck(owned[0], proof);
  let record;
  try {
    record = JSON.parse(owned[0].output?.text ?? "");
  } catch {
    throw new IssuerProofError("Missing issuer proof phase record.");
  }
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new IssuerProofError("Missing issuer proof phase record.");
  const previous = PHASES[proof.phase].previous;
  if (
    !previous ||
    record.schema !== SCHEMA ||
    record.phase !== previous ||
    record.source !== proof.source ||
    record.head !== proof.head ||
    record.pull !== proof.pull ||
    record.ruleset !== proof.ruleset ||
    record.rulesetDigest !== proof.rulesetDigest ||
    !isPositiveId(record.run) ||
    record.run === proof.run ||
    owned[0].conclusion !== PHASES[previous].conclusion
  )
    throw new IssuerProofError(
      "Issuer phases must advance once from failure to success to failure on the same recorded target.",
    );
  const actions = named.find((check) => check.id === proof.actionsCheck);
  if (
    actions?.app?.id !== 15368 ||
    actions.head_sha !== proof.head ||
    actions.status !== "completed" ||
    actions.conclusion !== "success"
  )
    throw new IssuerProofError("Missing exact same-head successful Actions lookalike check.");
}

/** @param {any} pull @param {any} proof */
function isIssuerPull(pull, proof) {
  return (
    pull?.number === proof.pull &&
    pull.base?.repo?.full_name === proof.repository &&
    pull.head?.repo?.full_name === proof.repository &&
    pull.base.ref === BASE &&
    pull.base.sha === proof.source &&
    pull.head.ref === HEAD &&
    pull.head.sha === proof.head &&
    (proof.phase === "reset" || pull.state === "open")
  );
}

/** @param {any} proof @param {{main:any,base:any,head:any,pull:any}} pointers */
function requireCurrentIssuerTarget(proof, { main, base, head, pull }) {
  if (
    main.ref !== "refs/heads/main" ||
    main.object?.type !== "commit" ||
    main.object.sha !== proof.source ||
    base.ref !== `refs/heads/${BASE}` ||
    base.object?.type !== "commit" ||
    base.object.sha !== proof.source ||
    head.ref !== `refs/heads/${HEAD}` ||
    head.object?.type !== "commit" ||
    head.object.sha !== proof.head ||
    !isIssuerPull(pull, proof)
  )
    throw new IssuerProofError(
      "Issuer proof requires the exact isolated marker-only PR above current main.",
    );
  requireReadyIssuerHold(pull, proof);
}

/** @param {any} pull @param {any} proof */
function requireReadyIssuerHold(pull, proof) {
  if (proof.phase !== "pass") return;
  if (pull.mergeable === null)
    throw new IssuerProofError(
      "PR mergeability is not computed yet; confirm settled native state before the approved pass dispatch.",
    );
  if (pull.draft !== false || pull.mergeable !== true || pull.mergeable_state !== "blocked")
    throw new IssuerProofError("Issuer success requires a ready conflict-free blocked PR.");
}

/** @param {any} repository @param {any} commit @param {any} comparison @param {any} marker @param {any} proof */
function requireMarkerOnlyChild(repository, commit, comparison, marker, proof) {
  if (
    repository.full_name !== proof.repository ||
    repository.default_branch !== "main" ||
    repository.fork !== false ||
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
    comparison.files[0].filename !== MARKER ||
    comparison.files[0].status !== "added" ||
    marker.type !== "file" ||
    marker.path !== MARKER ||
    marker.encoding !== "base64" ||
    Buffer.from(marker.content ?? "", "base64").toString("utf8") !== TEXT
  )
    throw new IssuerProofError(
      "Issuer target must be one marker-only child of the approved source in the expected repository.",
    );
}

/** @param {NodeJS.ProcessEnv} env @param {(path:string)=>Promise<any>} readMetadata */
export async function validateIssuerProof(env, readMetadata) {
  const proof = requireIssuerAuthority(env);
  const repository = await readMetadata("");
  const main = await readMetadata("/git/ref/heads/main");
  const base = await readMetadata(`/git/ref/heads/${BASE}`);
  const head = await readMetadata(`/git/ref/heads/${HEAD}`);
  const commit = await readMetadata(`/git/commits/${proof.head}`);
  const comparison = await readMetadata(`/compare/${proof.source}...${proof.head}`);
  const marker = await readMetadata(`/contents/${MARKER}?ref=${proof.head}`);
  const pull = await readMetadata(`/pulls/${proof.pull}`);
  requireCurrentIssuerTarget(proof, { main, base, head, pull });
  requireMarkerOnlyChild(repository, commit, comparison, marker, proof);
  const pulls = await readAllPages(readMetadata, "/pulls?state=open", requireProofList);
  if (
    pulls.some((candidate) => candidate.head?.sha === proof.head && !isIssuerPull(candidate, proof))
  )
    throw new IssuerProofError("Issuer target collides with another open PR.");
  const ruleset = await readMetadata(`/rulesets/${proof.ruleset}`);
  const effective = requireProofList(await readMetadata(`/rules/branches/${BASE}`));
  requireIsolatedRule(ruleset, effective, proof);
  const checks = await readAllPages(
    readMetadata,
    `/commits/${proof.head}/check-runs?filter=all`,
    (answer) => requireProofList(answer.check_runs),
  );
  requireProofTransition(checks, proof);
  const [latestMain, latestBase, latestHead, latestPull, latestRuleset, latestEffective] =
    await Promise.all([
      readMetadata("/git/ref/heads/main"),
      readMetadata(`/git/ref/heads/${BASE}`),
      readMetadata(`/git/ref/heads/${HEAD}`),
      readMetadata(`/pulls/${proof.pull}`),
      readMetadata(`/rulesets/${proof.ruleset}`),
      readMetadata(`/rules/branches/${BASE}`),
    ]);
  requireIsolatedRule(latestRuleset, requireProofList(latestEffective), proof);
  requireCurrentIssuerTarget(proof, {
    main: latestMain,
    base: latestBase,
    head: latestHead,
    pull: latestPull,
  });
  return proof;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {(path:string)=>Promise<any>} readMetadata
 * @param {(path:string,request?:{method?:string,body?:unknown})=>Promise<any>} writeChecks
 * @param {()=>Promise<any>} readInstallation
 */
export async function publishIssuerProof(env, readMetadata, writeChecks, readInstallation) {
  requireIssuerAuthority(env);
  const scope = await readInstallation();
  if (
    scope.total_count !== 1 ||
    scope.repositories?.length !== 1 ||
    scope.repositories[0].full_name !== env.GITHUB_REPOSITORY
  )
    throw new IssuerProofError("Issuer token must expose exactly this repository.");
  const proof = await validateIssuerProof(env, readMetadata);
  const record = {
    schema: SCHEMA,
    phase: proof.phase,
    source: proof.source,
    head: proof.head,
    pull: proof.pull,
    ruleset: proof.ruleset,
    rulesetDigest: proof.rulesetDigest,
    run: proof.run,
  };
  const conclusion = PHASES[proof.phase].conclusion;
  const body = {
    name: REVIEW_CHECK_NAME,
    ...(proof.phase === "fail" ? { head_sha: proof.head } : {}),
    external_id: `issue-809-issuer:${proof.source}:${proof.head}`,
    status: "completed",
    conclusion,
    output: {
      title: "Issue #809 synthetic isolated issuer proof",
      summary:
        "No review approval. This synthetic result is restricted to the disposable issuer PR and must end as failure.",
      text: JSON.stringify(record),
    },
  };
  const path = proof.phase === "fail" ? "/check-runs" : `/check-runs/${proof.check}`;
  const created = await writeChecks(path, {
    method: proof.phase === "fail" ? "POST" : "PATCH",
    body,
  });
  requireOwnedProofCheck(created, proof);
  const observed = await writeChecks(`/check-runs/${created.id}`);
  requireOwnedProofCheck(observed, proof);
  if (
    (proof.phase !== "fail" && observed.id !== proof.check) ||
    observed.id !== created.id ||
    created.conclusion !== conclusion ||
    observed.conclusion !== conclusion ||
    created.output?.text !== body.output.text ||
    observed.output?.text !== body.output.text
  )
    throw new IssuerProofError("GitHub did not confirm the exact issuer phase result.");
  return {
    ...record,
    app: proof.app,
    check: observed.id,
    actionsCheck: proof.actionsCheck,
    conclusion,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env;
    requireIssuerAuthority(env);
    if (!env.GH_TOKEN) throw new IssuerProofError("Missing read-only issuer metadata token.");
    const readMetadata = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
    if (process.argv[2] === "validate") {
      await validateIssuerProof(env, readMetadata);
      console.log("Exact issuer source, isolated rule/PR and phase verified before key use.");
    } else if (process.argv[2] === "publish") {
      if (!env.APP_TOKEN) throw new IssuerProofError("Missing issuer App token.");
      const options = {
        repository: env.GITHUB_REPOSITORY,
        fetchImpl: fetch,
        env: { GH_TOKEN: env.APP_TOKEN },
      };
      const writeChecks = createGitHub(options);
      const readRoot = createGitHubRoot(options);
      const evidence = await publishIssuerProof(env, readMetadata, writeChecks, () =>
        readRoot("/installation/repositories?per_page=100"),
      );
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `Isolated synthetic issuer phase:\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n\nObserve GitHub merge eligibility and post-job token revocation separately.\n`,
      );
      console.log(
        "Isolated issuer phase readback verified; merge eligibility and token revocation require separate observations.",
      );
    } else throw new IssuerProofError("Unknown issuer proof command.");
  } catch (error) {
    console.error(
      `::error::${error instanceof IssuerProofError || error instanceof GitHubError ? error.message : "Unexpected issuer proof failure; stop for reviewed recovery."}`,
    );
    process.exitCode = 1;
  }
}
