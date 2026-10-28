// Executes trusted review controls from their preserved default-branch source.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPullMerge } from "./pull-merge.mjs";
import { verifyReviewProvider } from "./review-provider.mjs";
import { arrangeCodexPortions, buildCodexRequest } from "./review-codex.mjs";
import { formatJobOutputs, listJobs } from "./plan-review.mjs";
import { isContainedCodexReview, needsCodexIntegration } from "./review-supplied.mjs";
import { WEIGHTS } from "./review-state.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { runReviewGit } from "./review-repository.mjs";
import { isGitObjectId } from "./git-object.mjs";
import {
  readJson,
  nameFindRecord,
  recordFindTry,
  formatFindOutputs,
  keepCandidates,
  keepAcross,
  gatherCandidates,
  ACROSS_RECORD,
  CANDIDATES_RECORD,
  POST_RECORD,
} from "./judge-review.mjs";
import {
  copyReviewFiles,
  listPlanFiles,
  listReviewFiles,
  listReviewArtifactFolders,
  readReviewIdentity,
  readReviewAnswer,
  recomputeReviewCoverage,
  normalizeClaudeReadEvidence,
  sealReviewArtifact,
  validateAcrossCandidates,
  validateReviewArtifact,
  validateReviewPlan,
} from "./review-data.mjs";

/** @param {string} stage */
const stageRecords = (stage) =>
  stage === "across"
    ? [ACROSS_RECORD, CANDIDATES_RECORD]
    : stage === "post"
      ? [POST_RECORD]
      : [`${stage}.json`];

const SOURCE = fileURLToPath(new URL("..", import.meta.url));

const REVIEW_OWED_NOTICE =
  "::notice::No matching merge is available; review remains owed. Re-add the review label when the PR can merge.";

/** @param {NodeJS.ProcessEnv} env */
function requireReviewAuthority(env) {
  if (env.GITHUB_EVENT_NAME !== "pull_request_target")
    throw new Error("Trusted review requires default-branch workflow authority.");
}

/** @param {string} merge @param {NodeJS.ProcessEnv} env */
function readReviewMergeParents(merge, env) {
  if (!isGitObjectId(merge)) throw new Error("Review requires an immutable merge revision.");
  runReviewGit(env.GITHUB_WORKSPACE, ["fetch", "--no-tags", "origin", merge]);
  return runReviewGit(env.GITHUB_WORKSPACE, ["show", "--no-patch", "--format=%P", merge]).split(
    " ",
  );
}

/** @param {string | undefined | null} merge @param {NodeJS.ProcessEnv} env */
function matchesReviewMerge(merge, env) {
  return Boolean(
    merge &&
    readReviewMergeParents(merge, env).join(" ") === `${env.REVIEW_BASE} ${env.REVIEW_HEAD}`,
  );
}

/** @param {string | undefined | null} merge @param {NodeJS.ProcessEnv} env */
function readAvailableReviewParents(merge, env) {
  try {
    return merge ? readReviewMergeParents(merge, env) : null;
  } catch (error) {
    const failure = /** @type {{ status?: number, stderr?: string | Buffer }} */ (error);
    const unavailable =
      isGitObjectId(merge) &&
      failure.status === 128 &&
      new RegExp(
        `(?:not our ref|couldn't find remote ref|unadvertised object) ${merge}(?:\\s|$)`,
      ).test(String(failure.stderr ?? ""));
    if (!unavailable) throw error;
    return null;
  }
}

/** @param {any} pull @param {NodeJS.ProcessEnv} env */
const isCurrentReviewPull = (pull, env) =>
  pull.state === "open" && pull.head.sha === env.REVIEW_HEAD && pull.base.ref === env.REVIEW_TARGET;

/** @param {string} branch @param {NodeJS.ProcessEnv} env */
function readBranchTip(branch, env) {
  const ref = `refs/heads/${branch}`;
  const tips = runReviewGit(env.GITHUB_WORKSPACE, ["ls-remote", "origin", ref])
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, name]) => name === ref)
    .map(([sha]) => sha);
  if (tips.length !== 1 || !isGitObjectId(tips[0]))
    throw new Error("Review requires the base branch's current tip.");
  return tips[0];
}

/** @param {string} ancestor @param {string} descendant @param {NodeJS.ProcessEnv} env */
function isReviewAncestor(ancestor, descendant, env) {
  try {
    runReviewGit(env.GITHUB_WORKSPACE, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 1) return false;
    throw error;
  }
}

/** @param {NodeJS.ProcessEnv} env */
function pinReviewTarget(env) {
  const tip = readBranchTip(env.REVIEW_TARGET, env);
  const shallow = runReviewGit(env.GITHUB_WORKSPACE, ["rev-parse", "--is-shallow-repository"]);
  runReviewGit(env.GITHUB_WORKSPACE, [
    "fetch",
    "--no-tags",
    ...(shallow === "true" ? ["--unshallow"] : []),
    "origin",
    tip,
  ]);
  return tip;
}

/**
 * The cached merge's first parent must belong to the target branch's observed history. Later
 * jobs verify the exact selected pair and tree without resolving the moving target again.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ readPull?: (path: string) => Promise<any>, wait?: (ms: number) => Promise<unknown> }} [options]
 * @returns {Promise<{ merge: string, base: string } | null>}
 */
export async function resolveReviewMerge(
  env,
  {
    readPull = createGitHub({ repository: env.GITHUB_REPOSITORY, env, fetchImpl: fetch }),
    wait,
  } = {},
) {
  requireReviewAuthority(env);
  const rejected = new Set();
  /** @type {{ merge: string, base: string } | null} */
  let selected = null;
  /** @param {any} pull */
  const isReviewMergeReady = (pull) => {
    if (!isCurrentReviewPull(pull, env) || pull.mergeable === false) return true;
    const merge = pull.merge_commit_sha;
    if (!merge || rejected.has(merge)) return false;
    const parents = readAvailableReviewParents(merge, env);
    if (!parents) {
      rejected.add(merge);
      return false;
    }
    const [base, head, ...others] = parents;
    const target = pinReviewTarget(env);
    if (
      head === env.REVIEW_HEAD &&
      others.length === 0 &&
      isGitObjectId(base) &&
      isReviewAncestor(base, target, env)
    ) {
      selected = { merge, base };
      return true;
    }
    rejected.add(merge);
    return false;
  };
  await readPullMerge(readPull, env.PR, { isReady: isReviewMergeReady, wait });
  return selected;
}

/** @param {NodeJS.ProcessEnv} env */
async function prepareReviewPlanCheckout(env) {
  const selected = await resolveReviewMerge(env);
  prepareReviewCheckout({ ...env, REVIEW_MERGE: selected?.merge, REVIEW_BASE: selected?.base });
}

/** @param {NodeJS.ProcessEnv} env */
export function prepareReviewCheckout(env) {
  requireReviewAuthority(env);
  const checkout = env.GITHUB_WORKSPACE;
  const merge = env.REVIEW_MERGE;
  if (!matchesReviewMerge(merge, env)) {
    console.log(REVIEW_OWED_NOTICE);
    appendFileSync(env.GITHUB_OUTPUT, "available=false\n");
    return;
  }
  runReviewGit(checkout, ["checkout", "--detach", merge]);
  const folder = mkdtempSync(join(env.RUNNER_TEMP, "review-data-"));
  const view = join(checkout, ".review");
  // Remove the directory entry, including a PR-provided symlink, before linking fresh data.
  rmSync(view, { recursive: true, force: true });
  symlinkSync(folder, view, "dir");
  const output = mkdtempSync(join(env.RUNNER_TEMP, "review-upload-"));
  appendFileSync(
    env.GITHUB_ENV,
    `REVIEW_CHECKOUT=${checkout}\nREVIEW_FOLDER=${view}\nREVIEW_DATA=${folder}\nREVIEW_UPLOAD=${output}\nREVIEW_MERGE=${merge}\nREVIEW_BASE=${env.REVIEW_BASE}\nREVIEW_RULE_ROOT=${SOURCE}\n`,
  );
  appendFileSync(env.GITHUB_OUTPUT, `available=true\nmerge=${merge}\nbase=${env.REVIEW_BASE}\n`);
}

/** @param {string} script @param {string[]} args @param {NodeJS.ProcessEnv} env @param {boolean} [captureOutput] */
const invokeReviewScript = (script, args, env, captureOutput = false) =>
  execFileSync(process.execPath, [join(SOURCE, "worker", script), ...args], {
    cwd: env.REVIEW_CHECKOUT,
    env,
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });

/** @param {string} folder @param {string} stage @param {NodeJS.ProcessEnv} env */
export function exportReviewArtifact(folder, stage, env) {
  const identity = readReviewIdentity(env);
  const names =
    stage === "plan"
      ? listPlanFiles(validateReviewPlan(readJson(join(folder, "plan.json"))))
      : stageRecords(stage);
  const destination = join(env.REVIEW_UPLOAD, `trusted-review-${stage}`);
  mkdirSync(destination);
  copyReviewFiles(folder, destination, names);
  if (/^find-\d+$/.test(stage) && identity.provider !== "codex") {
    const recordPath = join(destination, `${stage}.json`);
    const record = readJson(recordPath);
    const area = readJson(join(folder, "plan.json")).areas.find(
      (area) => nameFindRecord(area.area) === `${stage}.json`,
    );
    writeFileSync(recordPath, JSON.stringify(normalizeClaudeReadEvidence(record, area, folder)));
  }
  sealReviewArtifact(destination, stage, identity, names);
}

/** @param {string} input */
function collectReviewArtifacts(input) {
  /** @type {Map<string, string>} */
  const artifacts = new Map();
  listReviewFiles(input);
  const folders = listReviewArtifactFolders(input, "trusted-review-", "provenance.json");
  for (const { name, path } of folders) {
    const stage = name ?? readJson(join(path, "provenance.json")).stage;
    artifacts.set(stage, path);
  }
  return artifacts;
}

/** @param {string} input @param {string} folder @param {NodeJS.ProcessEnv} env */
export function importReviewArtifacts(input, folder, env) {
  const identity = readReviewIdentity(env);
  const artifacts = collectReviewArtifacts(input);
  const planFolder = artifacts.get("plan");
  if (!planFolder) throw new Error("Missing review plan artifact.");
  const plan = validateReviewPlan(readJson(join(planFolder, "plan.json")));
  if (
    identity.provider &&
    (plan.provider !== identity.provider || plan.selection !== identity.selection)
  )
    throw new Error("Stale or mixed review provider plan.");
  const planFiles = listPlanFiles(plan);
  validateReviewArtifact(planFolder, "plan", identity, planFiles);
  copyReviewFiles(planFolder, folder, planFiles);
  const stages = ["plan", ...plan.areas.map((area) => `find-${area.area}`), "across", "post"];
  for (const [stage, source] of artifacts) {
    if (!stages.includes(stage)) throw new Error("Unexpected review artifact.");
    if (stage === "plan") continue;
    const names = stageRecords(stage);
    validateReviewArtifact(source, stage, identity, names);
    copyReviewFiles(source, folder, names);
  }
  const records = [];
  for (const area of plan.areas) {
    const name = nameFindRecord(area.area);
    if (!existsSync(join(folder, name))) continue;
    const record = recomputeReviewCoverage(readJson(join(folder, name)), area, folder);
    if (identity.provider === "codex" && record.provider !== "codex")
      throw new Error("Mixed review providers.");
    if (identity.provider !== "codex" && record.provider === "codex")
      throw new Error("Mixed review providers.");
    if (record.provider !== "codex")
      for (const attempt of record.tries)
        attempt.reads = attempt.reads.map(([path, ranges]) => [join(folder, path), ranges]);
    writeFileSync(join(folder, name), JSON.stringify(record));
    records.push(record);
  }
  if (existsSync(join(folder, "across.json"))) {
    if (records.length !== plan.areas.length)
      throw new Error("An area's review artifact is missing.");
    validateAcrossCandidates(
      records,
      readJson(join(folder, "across.json")),
      readJson(join(folder, "candidates.json")),
    );
    const across = readJson(join(folder, "across.json"));
    if (identity.provider === "codex") {
      const portion = isContainedCodexReview(plan.areas.length) ? 1 : "integration";
      const request = buildCodexRequest(folder, portion, identity);
      const expected = {
        kind: "supplied-content",
        portion,
        promptSha256: request.promptSha256,
        files: request.supplied,
      };
      if (
        across.provider !== "codex" ||
        JSON.stringify(across.evidence) !== JSON.stringify(expected)
      )
        throw new Error("Missing or changed Codex integration evidence.");
    }
  }
  if (existsSync(join(folder, "post.json"))) {
    const post = readJson(join(folder, "post.json"));
    if (
      !Array.isArray(post.weights) ||
      !post.weights.every((weight) => WEIGHTS.includes(weight)) ||
      !Number.isSafeInteger(post.repeated) ||
      post.repeated < 0
    )
      throw new Error("Invalid posting record.");
  }
  return plan;
}

/** @param {NodeJS.ProcessEnv} env @param {(path: string) => Promise<any>} [callGitHub] */
export async function verifyReviewEvent(
  env,
  callGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, env, fetchImpl: fetch }),
) {
  const pull = await callGitHub(`/pulls/${env.PR}`);
  if (!isCurrentReviewPull(pull, env))
    throw new Error("The pull request moved after this review started.");
  await verifyReviewProvider(env, callGitHub);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ invokeScript?: typeof invokeReviewScript, readRepository?: typeof runReviewGit, readGitHub?: ReturnType<typeof createGitHub> }} [options]
 */
export async function writeTrustedReviewPlan(env, options = {}) {
  const invokeScript = options.invokeScript ?? invokeReviewScript;
  const readRepository = options.readRepository ?? runReviewGit;
  const folder = env.REVIEW_FOLDER;
  invokeScript("plan-review.mjs", [folder], env, true);
  invokeScript("review-context.mjs", [folder], env);
  for (const name of ["REVIEW.md", "AGENTS.md"])
    copyFileSync(join(SOURCE, name), join(folder, name));
  let plan = readJson(join(folder, "plan.json"));
  if (env.REVIEW_PROVIDER)
    plan = { ...plan, provider: env.REVIEW_PROVIDER, selection: env.REVIEW_SELECTION };
  if (env.REVIEW_PROVIDER) {
    const repoFiles = readRepository(env.REVIEW_CHECKOUT, ["ls-files"]).split("\n");
    if (env.REVIEW_PROVIDER === "codex") plan = arrangeCodexPortions(plan, repoFiles);
    const readGitHub =
      options.readGitHub ??
      createGitHub({ repository: env.GITHUB_REPOSITORY, env, fetchImpl: fetch });
    const checks = await readAllPages(
      readGitHub,
      `/commits/${env.REVIEW_HEAD}/check-runs`,
      (answer) => answer.check_runs,
    );
    writeFileSync(
      join(folder, "test-context.md"),
      JSON.stringify(
        {
          head: env.REVIEW_HEAD,
          checks: checks.map(({ name, status, conclusion }) => ({ name, status, conclusion })),
          testSources: repoFiles.filter((path) => /\.(test|spec)\.m?js$/.test(path)),
          note: "Observed CI checks only. Locate and inspect relevant test sources in the checkout; do not execute PR code.",
        },
        null,
        2,
      ),
    );
  }
  writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
  console.log(`stage=${plan.stage}`);
  console.log(formatJobOutputs(listJobs(plan.areas)));
  console.log(`integration=${needsCodexIntegration(plan.provider, plan.areas.length)}`);
  exportReviewArtifact(folder, "plan", env);
}

/** @param {string | undefined} output @param {NodeJS.ProcessEnv} env */
function readValidReviewerOutput(output, env) {
  if (!output) return undefined;
  try {
    const answer = readReviewAnswer(output, "candidates", {
      checkout: env.REVIEW_CHECKOUT,
      data: env.REVIEW_DATA,
    });
    return JSON.stringify({ candidates: answer.items, unjudged: answer.unjudged });
  } catch {
    console.error("The reviewer returned a malformed answer; this try counts as unanswered.");
    return undefined;
  }
}

/** @param {number} area @param {NodeJS.ProcessEnv} env */
function recordTrustedFindTry(area, env) {
  const record = recordFindTry(env.REVIEW_FOLDER, area, {
    ...env,
    STRUCTURED_OUTPUT: readValidReviewerOutput(env.STRUCTURED_OUTPUT, env),
  });
  console.log(formatFindOutputs(record));
}

/** @param {NodeJS.ProcessEnv} env */
function gatherTrustedCandidates(env) {
  const folder = env.REVIEW_FOLDER;
  const plan = readJson(join(folder, "plan.json"));
  if (!plan.areas.every((area) => existsSync(join(folder, nameFindRecord(area.area)))))
    throw new Error("An area's review is missing.");
  keepCandidates(folder);
}

/** @param {NodeJS.ProcessEnv} env */
function keepTrustedAcross(env) {
  const folder = env.REVIEW_FOLDER;
  const answer = readReviewAnswer(env.STRUCTURED_OUTPUT, "findings", {
    checkout: env.REVIEW_CHECKOUT,
    data: env.REVIEW_DATA,
  });
  console.log(
    `unchecked=${keepAcross(folder, JSON.stringify({ findings: answer.items, unjudged: answer.unjudged })).length}`,
  );
  const plan = readJson(join(folder, "plan.json"));
  const records = plan.areas.map((area) => readJson(join(folder, nameFindRecord(area.area))));
  validateAcrossCandidates(
    records,
    readJson(join(folder, "across.json")),
    gatherCandidates(records),
  );
  exportReviewArtifact(folder, "across", env);
}

/** @param {string} folder */
function requireCompleteReviewCoverage(folder) {
  const plan = readJson(join(folder, "plan.json"));
  const complete = plan.areas.every((area) => {
    const record = recomputeReviewCoverage(
      readJson(join(folder, nameFindRecord(area.area))),
      area,
      folder,
    );
    return record.isAnswered && record.unread.length === 0;
  });
  if (!complete) throw new Error("Incomplete coverage cannot authorize posting findings.");
}

/** @param {"post" | "summary"} command @param {NodeJS.ProcessEnv} env */
async function postTrustedReview(command, env) {
  const folder = env.REVIEW_FOLDER;
  if (command === "post") requireCompleteReviewCoverage(folder);
  await verifyReviewEvent(env);
  invokeReviewScript(
    command === "post" ? "post-review.mjs" : "judge-review.mjs",
    command === "post" ? [folder] : ["summary", folder],
    { ...env, SHA: env.REVIEW_HEAD },
  );
  if (command === "post") exportReviewArtifact(folder, "post", env);
}

/** @param {NodeJS.ProcessEnv} env */
function recordTrustedResult(env) {
  if (env.REVIEW_OWED !== "false") throw new Error("A review is still owed on this code.");
  const tree = runReviewGit(env.REVIEW_CHECKOUT, ["rev-parse", "HEAD^{tree}"]);
  const destination = join(env.REVIEW_UPLOAD, "trusted-review-result");
  mkdirSync(destination);
  const identity = readReviewIdentity(env);
  writeFileSync(join(destination, "result.json"), JSON.stringify({ identity, tree, passed: true }));
  sealReviewArtifact(destination, "result", identity, ["result.json"]);
  appendFileSync(env.GITHUB_OUTPUT, `tree=${tree}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  const { env } = process;
  const commands = {
    prepare: () => prepareReviewCheckout(env),
    "prepare-plan": () => prepareReviewPlanCheckout(env),
    plan: () => writeTrustedReviewPlan(env),
    import: () => importReviewArtifacts(argument, env.REVIEW_FOLDER, env),
    find: () => recordTrustedFindTry(Number(argument), env),
    candidates: () => gatherTrustedCandidates(env),
    across: () => keepTrustedAcross(env),
    export: () => exportReviewArtifact(env.REVIEW_FOLDER, argument, env),
    post: () => postTrustedReview("post", env),
    summary: () => postTrustedReview("summary", env),
    result: () => recordTrustedResult(env),
  };
  if (!Object.hasOwn(commands, command)) throw new Error("Unknown trusted review command.");
  if (!["prepare", "prepare-plan"].includes(command)) readReviewIdentity(env);
  await commands[command]();
}
