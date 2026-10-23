import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub } from "./github-api.mjs";
import { createReviewGitEnvironment } from "./review-repository.mjs";
import {
  readJson,
  nameFindRecord,
  recordFindTry,
  formatFindOutputs,
  keepCandidates,
  keepAcross,
  gatherCandidates,
} from "./judge-review.mjs";
import {
  copyReviewFiles,
  listPlanFiles,
  listReviewFiles,
  readReviewIdentity,
  readReviewAnswer,
  recomputeReviewCoverage,
  sealReviewArtifact,
  validateAcrossCandidates,
  validateReviewArtifact,
  validateReviewPlan,
} from "./review-data.mjs";

const SOURCE = fileURLToPath(new URL("..", import.meta.url));

/** @param {string[]} args @param {string} cwd */
const readGit = (args, cwd) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: createReviewGitEnvironment(),
  }).trim();

/** @param {NodeJS.ProcessEnv} env */
export function prepareReviewCheckout(env) {
  if (env.GITHUB_EVENT_NAME !== "pull_request_target")
    throw new Error("Trusted review requires default-branch workflow authority.");
  const checkout = env.GITHUB_WORKSPACE;
  readGit(["fetch", "--no-tags", "origin", `refs/pull/${Number(env.PR)}/merge`], checkout);
  const merge = env.REVIEW_MERGE || readGit(["rev-parse", "FETCH_HEAD"], checkout);
  if (
    readGit(["rev-parse", `${merge}^1`], checkout) !== env.REVIEW_BASE ||
    readGit(["rev-parse", `${merge}^2`], checkout) !== env.REVIEW_HEAD
  )
    throw new Error("The reviewed merge no longer matches this event's head and base.");
  readGit(["checkout", "--detach", merge], checkout);
  const folder = mkdtempSync(join(env.RUNNER_TEMP, "review-data-"));
  const view = join(checkout, ".review");
  // Remove the directory entry, including a PR-provided symlink, before linking fresh data.
  rmSync(view, { recursive: true, force: true });
  symlinkSync(folder, view, "dir");
  const output = mkdtempSync(join(env.RUNNER_TEMP, "review-upload-"));
  appendFileSync(
    env.GITHUB_ENV,
    `REVIEW_CHECKOUT=${checkout}\nREVIEW_FOLDER=${view}\nREVIEW_DATA=${folder}\nREVIEW_UPLOAD=${output}\nREVIEW_MERGE=${merge}\nREVIEW_RULE_ROOT=${SOURCE}\n`,
  );
  appendFileSync(env.GITHUB_OUTPUT, `merge=${merge}\n`);
}

/** @param {string} script @param {string[]} args @param {NodeJS.ProcessEnv} env */
const invokeReviewScript = (script, args, env) =>
  execFileSync(process.execPath, [join(SOURCE, "worker", script), ...args], {
    cwd: env.REVIEW_CHECKOUT,
    env,
    stdio: "inherit",
  });

/** @param {string} folder @param {string} stage @param {NodeJS.ProcessEnv} env */
export function exportReviewArtifact(folder, stage, env) {
  const identity = readReviewIdentity(env);
  const names =
    stage === "plan"
      ? listPlanFiles(validateReviewPlan(readJson(join(folder, "plan.json"))))
      : stage === "across"
        ? ["across.json", "candidates.json"]
        : stage === "post"
          ? ["post.json"]
          : [`${stage}.json`];
  const destination = join(env.REVIEW_UPLOAD, `trusted-review-${stage}`);
  mkdirSync(destination);
  copyReviewFiles(folder, destination, names);
  if (/^find-\d+$/.test(stage)) {
    const recordPath = join(destination, `${stage}.json`);
    const record = readJson(recordPath);
    const area = readJson(join(folder, "plan.json")).areas.find(
      (area) => nameFindRecord(area.area) === `${stage}.json`,
    );
    const parts = new Set([...Object.values(area.partsByFile).flat(), ...area.rules]);
    for (const attempt of record.tries)
      attempt.reads = attempt.reads.flatMap(([path, ranges]) => {
        const relativeView = relative(folder, path);
        const part = parts.has(relativeView) ? relativeView : relative(realpathSync(folder), path);
        return parts.has(part) ? [[part, ranges]] : [];
      });
    recomputeReviewCoverage(record, area, folder);
    writeFileSync(recordPath, JSON.stringify(record));
  }
  sealReviewArtifact(destination, stage, identity, names);
}

/** @param {string} input @param {string} folder @param {NodeJS.ProcessEnv} env */
export function importReviewArtifacts(input, folder, env) {
  const identity = readReviewIdentity(env);
  const planFolder = join(input, "trusted-review-plan");
  listReviewFiles(planFolder);
  const plan = validateReviewPlan(readJson(join(planFolder, "plan.json")));
  const planFiles = listPlanFiles(plan);
  validateReviewArtifact(planFolder, "plan", identity, planFiles);
  copyReviewFiles(planFolder, folder, planFiles);
  const stages = ["plan", ...plan.areas.map((area) => `find-${area.area}`), "across", "post"];
  for (const name of readdirSync(input)) {
    const stage = name.replace(/^trusted-review-/, "");
    if (!name.startsWith("trusted-review-") || !stages.includes(stage))
      throw new Error("Unexpected review artifact.");
    if (stage === "plan") continue;
    const names = stage === "across" ? ["across.json", "candidates.json"] : [`${stage}.json`];
    validateReviewArtifact(join(input, name), stage, identity, names);
    copyReviewFiles(join(input, name), folder, names);
  }
  const records = [];
  for (const area of plan.areas) {
    const name = nameFindRecord(area.area);
    if (!existsSync(join(folder, name))) continue;
    const record = recomputeReviewCoverage(readJson(join(folder, name)), area, folder);
    // The existing judge's coverage reader uses the local absolute paths.
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
  }
  if (existsSync(join(folder, "post.json"))) {
    const post = readJson(join(folder, "post.json"));
    if (
      !Array.isArray(post.weights) ||
      !post.weights.every((weight) =>
        ["Important", "Unsure", "Nit", "Pre-existing"].includes(weight),
      ) ||
      !Number.isSafeInteger(post.repeated) ||
      post.repeated < 0
    )
      throw new Error("Invalid posting record.");
  }
  return plan;
}

/** @param {NodeJS.ProcessEnv} env */
async function verifyReviewEvent(env) {
  const callGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, env, fetchImpl: fetch });
  const pull = await callGitHub(`/pulls/${env.PR}`);
  if (
    pull.state !== "open" ||
    pull.head.sha !== env.REVIEW_HEAD ||
    pull.base.sha !== env.REVIEW_BASE ||
    pull.base.ref !== "main"
  )
    throw new Error("The pull request moved after this review started.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  const { env } = process;
  const folder = env.REVIEW_FOLDER;
  if (command === "prepare") prepareReviewCheckout(env);
  else {
    readReviewIdentity(env);
    if (command === "plan") {
      invokeReviewScript("plan-review.mjs", [folder], env);
      invokeReviewScript("review-context.mjs", [folder], env);
      for (const name of ["REVIEW.md", "AGENTS.md"])
        copyFileSync(join(SOURCE, name), join(folder, name));
      exportReviewArtifact(folder, "plan", env);
    } else if (command === "import") importReviewArtifacts(argument, folder, env);
    else if (command === "find") {
      let structuredOutput = env.STRUCTURED_OUTPUT;
      if (structuredOutput) {
        try {
          readReviewAnswer(structuredOutput, "candidates");
        } catch {
          structuredOutput = undefined;
          console.error("The reviewer returned a malformed answer; this try counts as unanswered.");
        }
      }
      console.log(
        formatFindOutputs(
          recordFindTry(folder, Number(argument), { ...env, STRUCTURED_OUTPUT: structuredOutput }),
        ),
      );
    } else if (command === "candidates") {
      const plan = readJson(join(folder, "plan.json"));
      if (!plan.areas.every((area) => existsSync(join(folder, nameFindRecord(area.area)))))
        throw new Error("An area's review is missing.");
      keepCandidates(folder);
    } else if (command === "across") {
      readReviewAnswer(env.STRUCTURED_OUTPUT, "findings");
      console.log(`unchecked=${keepAcross(folder, env.STRUCTURED_OUTPUT).length}`);
      const plan = readJson(join(folder, "plan.json"));
      const records = plan.areas.map((area) => readJson(join(folder, nameFindRecord(area.area))));
      validateAcrossCandidates(
        records,
        readJson(join(folder, "across.json")),
        gatherCandidates(records),
      );
      exportReviewArtifact(folder, "across", env);
    } else if (command === "export") exportReviewArtifact(folder, argument, env);
    else if (command === "post" || command === "summary") {
      if (command === "post") {
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
      await verifyReviewEvent(env);
      invokeReviewScript(
        command === "post" ? "post-review.mjs" : "judge-review.mjs",
        command === "post" ? [folder] : ["summary", folder],
        { ...env, SHA: env.REVIEW_HEAD },
      );
      if (command === "post") exportReviewArtifact(folder, "post", env);
    } else if (command === "result") {
      if (env.REVIEW_OWED !== "false") throw new Error("A review is still owed on this code.");
      const tree = readGit(["rev-parse", "HEAD^{tree}"], env.REVIEW_CHECKOUT);
      const destination = join(env.REVIEW_UPLOAD, "trusted-review-result");
      mkdirSync(destination);
      writeFileSync(
        join(destination, "result.json"),
        JSON.stringify({ identity: readReviewIdentity(env), tree, passed: true }),
      );
      sealReviewArtifact(destination, "result", readReviewIdentity(env), ["result.json"]);
      appendFileSync(env.GITHUB_OUTPUT, `tree=${tree}\n`);
    } else throw new Error("Unknown trusted review command.");
  }
}
