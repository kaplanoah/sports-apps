import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptCodexAnswer, buildCodexRequest } from "./review-codex.mjs";
import { readReviewIdentity, sealReviewArtifact } from "./review-data.mjs";
import { validatePublicationJobs, REVIEW_PUBLICATION_STAGES } from "./review-publication.mjs";
import { requireOwnerTrialAuthority, TrialAuthorityError } from "./review-trial-authority.mjs";
import { exportReviewArtifact, importReviewArtifacts } from "./trusted-review.mjs";

const FIXTURE_ENV = {
  GITHUB_REPOSITORY: "example/repository",
  GITHUB_RUN_ID: "1",
  REVIEW_HEAD: "a".repeat(40),
  REVIEW_BASE: "b".repeat(40),
  REVIEW_MERGE: "c".repeat(40),
  REVIEW_TRUSTED: "d".repeat(40),
  GITHUB_WORKFLOW_REF: "example/repository/.github/workflows/review.yml@refs/heads/main",
  REVIEW_PROVIDER: "codex",
  REVIEW_SELECTION: "initial",
};
const FIXTURE_IDENTITY = readReviewIdentity(FIXTURE_ENV);

class ValidationProofError extends Error {}

/** @param {string} path */
const readFixture = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} folder @param {number | "integration"} portion */
function createFixtureAnswer(folder, portion) {
  return JSON.stringify({
    binding: buildCodexRequest(folder, portion, FIXTURE_IDENTITY).binding,
    complete: true,
    unfinished: [],
    unjudged: [],
    ...(portion === "integration" ? { findings: [] } : { candidates: [] }),
  });
}

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
export function prepareValidationFixture(folder, env) {
  requireOwnerTrialAuthority(env);
  mkdirSync(folder);
  const data = join(folder, "data");
  const upload = join(folder, "artifacts");
  mkdirSync(data);
  mkdirSync(upload);
  mkdirSync(join(data, "first"));
  const files = ["shared/page/example.js", "shared/worker/example.js"];
  const plan = {
    provider: "codex",
    selection: "initial",
    stage: "first",
    since: null,
    unread: [],
    areas: files.map((file, index) => ({
      area: index + 1,
      name: `fixture ${index + 1}`,
      files: [file],
      rules: [],
      partsByFile: { [file]: [`first/${index + 1}.diff`] },
    })),
  };
  for (const name of [
    "REVIEW.md",
    "AGENTS.md",
    "pull-request.md",
    "test-context.md",
    "stale-names.md",
    "first.md",
    "first/1.diff",
    "first/2.diff",
  ])
    writeFileSync(join(data, name), `Synthetic validator fixture: ${name}\n`);
  writeFileSync(join(data, "plan.json"), JSON.stringify(plan));
  const fixtureEnv = { ...FIXTURE_ENV, REVIEW_UPLOAD: upload };
  exportReviewArtifact(data, "plan", fixtureEnv);
  for (const area of plan.areas) {
    acceptCodexAnswer(data, area.area, FIXTURE_IDENTITY, createFixtureAnswer(data, area.area));
    exportReviewArtifact(data, `find-${area.area}`, fixtureEnv);
  }
  writeFileSync(join(data, "candidates.json"), "[]");
  acceptCodexAnswer(
    data,
    "integration",
    FIXTURE_IDENTITY,
    createFixtureAnswer(data, "integration"),
  );
  exportReviewArtifact(data, "across", fixtureEnv);
  writeFileSync(
    join(folder, "manifest.json"),
    JSON.stringify({
      kind: "synthetic-validator-fixture",
      source: env.GITHUB_SHA,
      run: env.GITHUB_RUN_ID,
    }),
  );
  rmSync(data, { recursive: true });
}

/** @param {() => unknown} operation @param {RegExp} expected */
export function requireRejection(operation, expected) {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error && expected.test(error.message)) return;
    throw new ValidationProofError("Validator proof failed for an unexpected reason.", {
      cause: error,
    });
  }
  throw new ValidationProofError("Validator accepted a negative control.");
}

function createPublicationFixture() {
  const needs = Object.fromEntries(
    REVIEW_PUBLICATION_STAGES.map((name) => [
      name,
      {
        result: ["review-label", "review-area", "review-across"].includes(name)
          ? "skipped"
          : "success",
        outputs: {},
      },
    ]),
  );
  needs["review-select"].outputs = { provider: "codex", selection: "initial" };
  needs["review-plan"].outputs = {
    provider: "codex",
    selection: "initial",
    count: "2",
    labeled: "false",
  };
  const jobs = REVIEW_PUBLICATION_STAGES.flatMap((name, index) => {
    const prefixes = name === "review-codex" ? ["review-codex (1)", "review-codex (2)"] : [name];
    return prefixes.flatMap((prefix) =>
      ["review-codex", "review-codex-across"].includes(name)
        ? ["request", "model", "validate"].map((stage, offset) => ({
            id: index * 100 + Number(prefix.endsWith("(2)")) * 10 + offset,
            name: `${prefix} / ${stage}`,
            run_attempt: 1,
            status: "completed",
            conclusion: needs[name].result,
          }))
        : [
            {
              id: index * 100,
              name,
              run_attempt: 1,
              status: "completed",
              conclusion: needs[name].result,
            },
          ],
    );
  });
  return { needs, jobs };
}

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
export function verifyValidationFixture(folder, env) {
  requireOwnerTrialAuthority(env);
  const manifest = readFixture(join(folder, "manifest.json"));
  if (
    manifest.kind !== "synthetic-validator-fixture" ||
    manifest.source !== env.GITHUB_SHA ||
    manifest.run !== env.GITHUB_RUN_ID
  )
    throw new ValidationProofError("Foreign validator fixture.");
  const scratch = mkdtempSync(join(env.RUNNER_TEMP, "validation-proof-"));
  const checks = [];
  /** @template T @param {string} name @param {() => T} operation @returns {T} */
  const check = (name, operation) => {
    try {
      const result = operation();
      checks.push(name);
      return result;
    } catch (error) {
      const reason =
        error instanceof ValidationProofError ? error.message : "Unexpected validator error.";
      throw new ValidationProofError(`Control ${name}: ${reason}`, { cause: error });
    }
  };
  /** @param {NodeJS.ProcessEnv} [changes] */
  const importFixture = (changes = {}) => {
    const target = mkdtempSync(join(scratch, "import-"));
    importReviewArtifacts(join(folder, "artifacts"), target, { ...FIXTURE_ENV, ...changes });
    return target;
  };
  try {
    const data = check("valid-sealed-artifact-fixture", () => importFixture());
    check("valid-empty-integration-fixture", () => {
      const across = readFixture(join(data, "across.json"));
      if (across.evidence.portion !== "integration" || across.items.length !== 0)
        throw new ValidationProofError("The positive control has no empty integration.");
    });
    /** @type {[string, NodeJS.ProcessEnv][]} */
    const identities = [
      ["stale-head", { REVIEW_HEAD: "e".repeat(40) }],
      ["stale-base", { REVIEW_BASE: "e".repeat(40) }],
      ["stale-source", { REVIEW_TRUSTED: "e".repeat(40) }],
      ["stale-run", { GITHUB_RUN_ID: "2" }],
      ["mixed-provider", { REVIEW_PROVIDER: "claude" }],
      ["changed-provider-selection", { REVIEW_SELECTION: "2" }],
    ];
    for (const [name, changes] of identities)
      check(name, () =>
        requireRejection(() => importFixture(changes), /stale or foreign artifact|provider/),
      );
    for (const [name, output] of [
      ["malformed-answer", "{incomplete"],
      [
        "incomplete-answer",
        JSON.stringify({ ...JSON.parse(createFixtureAnswer(data, 1)), complete: false }),
      ],
      [
        "unjudged-answer",
        JSON.stringify({
          ...JSON.parse(createFixtureAnswer(data, 1)),
          unjudged: [{ file: "shared/page/example.js", why: "Not inspected" }],
        }),
      ],
    ])
      check(name, () =>
        requireRejection(
          () => acceptCodexAnswer(data, 1, FIXTURE_IDENTITY, output),
          /JSON|Unexpected|complete|unfinished|unjudged/,
        ),
      );
    check("missing-supplied-coverage", () => {
      const altered = join(scratch, "missing-coverage");
      cpSync(join(folder, "artifacts"), altered, { recursive: true });
      const portion = join(altered, "trusted-review-find-1");
      const record = readFixture(join(portion, "find-1.json"));
      record.tries[0].evidence.files.pop();
      writeFileSync(join(portion, "find-1.json"), JSON.stringify(record));
      sealReviewArtifact(portion, "find-1", FIXTURE_IDENTITY, ["find-1.json"]);
      requireRejection(
        () => importReviewArtifacts(altered, join(scratch, "coverage-target"), FIXTURE_ENV),
        /supplied|coverage|evidence/i,
      );
    });
    check("missing-integration-evidence", () => {
      const altered = join(scratch, "missing-integration");
      cpSync(join(folder, "artifacts"), altered, { recursive: true });
      const portion = join(altered, "trusted-review-across");
      const record = readFixture(join(portion, "across.json"));
      record.evidence.portion = 1;
      writeFileSync(join(portion, "across.json"), JSON.stringify(record));
      sealReviewArtifact(portion, "across", FIXTURE_IDENTITY, ["across.json", "candidates.json"]);
      requireRejection(
        () => importReviewArtifacts(altered, join(scratch, "integration-target"), FIXTURE_ENV),
        /Missing or changed Codex integration evidence/,
      );
    });
    const publication = createPublicationFixture();
    check("valid-publication-producers-fixture", () => {
      validatePublicationJobs(publication.jobs, 1, publication.needs);
    });
    check("missing-integration-producer", () => {
      const changed = structuredClone(publication.needs);
      changed["review-codex-across"].result = "skipped";
      requireRejection(
        () => validatePublicationJobs(publication.jobs, 1, changed),
        /Required producer/,
      );
    });
    check("interrupted-model-producer", () => {
      const changed = structuredClone(publication.jobs);
      changed.find((job) => job.name === "review-codex (1) / model").conclusion = "cancelled";
      requireRejection(
        () => validatePublicationJobs(changed, 1, publication.needs),
        /Producer attempt/,
      );
    });
    check("missing-validation-producer", () => {
      const changed = publication.jobs.filter((job) => job.name !== "review-codex (2) / validate");
      requireRejection(
        () => validatePublicationJobs(changed, 1, publication.needs),
        /Missing Codex producer/,
      );
    });
    return {
      kind: "synthetic-validator-proof",
      source: env.GITHUB_SHA,
      run: env.GITHUB_RUN_ID,
      checks,
      modelExecuted: false,
      githubCheckPublished: false,
      actualInterruptionProved: false,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env } = process;
  try {
    const folder = join(env.RUNNER_TEMP, "codex-validation-fixture");
    if (process.argv[2] === "prepare") prepareValidationFixture(folder, env);
    else if (process.argv[2] === "verify") {
      const proof = verifyValidationFixture(folder, env);
      writeFileSync(
        join(env.RUNNER_TEMP, "codex-validation-proof.json"),
        JSON.stringify(proof, null, 2),
      );
      console.log(
        `Validated ${proof.checks.length} synthetic controls. No model or live publication was exercised.`,
      );
    } else throw new ValidationProofError("Unknown validator proof command.");
  } catch (error) {
    console.error(
      error instanceof ValidationProofError || error instanceof TrialAuthorityError
        ? error.message
        : "Validator proof failed. This is not a passing activation proof.",
    );
    process.exitCode = 1;
  }
}
