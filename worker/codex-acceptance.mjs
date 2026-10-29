import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { acceptCodexAnswer, buildCodexRequest } from "./review-codex.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { isRepositoryName, isRunId } from "./review-run.mjs";
import { measureReviewTokens, readCodexEvents, retainCodexUsage } from "./review-evaluation.mjs";
import { hashReviewContent } from "./review-supplied.mjs";
import { gatherCandidates } from "./judge-review.mjs";

/** @param {string | undefined} value */
export function readCodexProofScenario(value) {
  const scenario = value || "runner";
  if (!["runner", "interruption", "integration"].includes(scenario))
    throw new Error("Unknown Codex proof scenario.");
  return scenario;
}

/** @param {string} checkout @param {string[]} args */
function readFixtureGit(checkout, args) {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Proof fixture",
      GIT_AUTHOR_EMAIL: "proof@example.invalid",
      GIT_COMMITTER_NAME: "Proof fixture",
      GIT_COMMITTER_EMAIL: "proof@example.invalid",
    },
  }).trimEnd();
}

/** @param {string} checkout */
function writeIntegrationFixtureHistory(checkout) {
  const files = ["shared/page/score.js", "shared/worker/games.js"];
  const versions = [
    [
      "export const describeScore = (score) => String(score);\n",
      "export const countGames = (values) => values.length;\n",
    ],
    [
      "export const describeScore = (runs) => String(runs);\n",
      "export const countGames = (games) => games.length;\n",
    ],
  ];
  const commits = versions.map((contents, index) => {
    files.forEach((file, position) => {
      mkdirSync(dirname(join(checkout, file)), { recursive: true });
      writeFileSync(join(checkout, file), contents[position]);
    });
    readFixtureGit(checkout, ["add", "--", ...files]);
    readFixtureGit(checkout, ["commit", "--quiet", "-m", `Fixture ${index + 1}`]);
    return readFixtureGit(checkout, ["rev-parse", "HEAD"]);
  });
  return { files, base: commits[0], head: commits[1] };
}

/** @param {string} data @param {string} checkout @param {{files:string[],base:string,head:string}} fixture */
function writeIntegrationFixturePlan(data, checkout, fixture) {
  mkdirSync(join(data, "first"), { recursive: true });
  const plan = {
    provider: "codex",
    selection: "initial",
    stage: "first",
    since: null,
    unread: [],
    areas: fixture.files.map((file, index) => ({
      area: index + 1,
      name: `Fixture ${index + 1}`,
      files: [file],
      rules: [],
      partsByFile: { [file]: [`first/${index + 1}.diff`] },
    })),
  };
  fixture.files.forEach((file, index) =>
    writeFileSync(
      join(data, `first/${index + 1}.diff`),
      readFixtureGit(checkout, ["diff", "--no-ext-diff", fixture.base, fixture.head, "--", file]) +
        "\n",
    ),
  );
  writeFileSync(join(data, "plan.json"), JSON.stringify(plan));
  return plan;
}

/** @param {string} data */
function writeIntegrationFixtureContext(data) {
  for (const name of ["AGENTS.md", "REVIEW.md"])
    copyFileSync(new URL(`../${name}`, import.meta.url), join(data, name));
  writeFileSync(
    join(data, "pull-request.md"),
    "Synthetic acceptance fixture, not a real PR. Review the two actual Git diffs and their shared interactions. Both portion results are synthetic empty seeds; only this integration runs a native model. Inspect the local Git base and head with native tools. Do not run fixture code or tests.\n",
  );
  writeFileSync(
    join(data, "test-context.md"),
    "No observed CI results. Fixture functions have not been executed.\n",
  );
  writeFileSync(join(data, "stale-names.md"), "No previous findings.\n");
}

/** @param {string} data @param {any} plan @param {any} identity */
function writeEmptyPortionSeeds(data, plan, identity) {
  for (const area of plan.areas)
    acceptCodexAnswer(
      data,
      area.area,
      identity,
      JSON.stringify({
        binding: buildCodexRequest(data, area.area, identity).binding,
        complete: true,
        unfinished: [],
        unjudged: [],
        candidates: [],
      }),
    );
  writeFileSync(join(data, "candidates.json"), "[]");
}

/** @param {string} root @param {NodeJS.ProcessEnv} env */
export function prepareEmptyCodexIntegration(root, env) {
  if (
    !isRepositoryName(env.GITHUB_REPOSITORY) ||
    !isRunId(env.GITHUB_RUN_ID) ||
    !isGitObjectId(env.GITHUB_SHA)
  )
    throw new Error("Missing acceptance proof identity.");
  const checkout = join(root, "checkout");
  const data = join(root, "data");
  const fixture = writeIntegrationFixtureHistory(checkout);
  const identity = {
    kind: "offline-trial",
    scenario: "synthetic-empty-integration",
    repository: env.GITHUB_REPOSITORY,
    run: env.GITHUB_RUN_ID,
    source: env.GITHUB_SHA,
    base: fixture.base,
    head: fixture.head,
    provider: "codex",
    selection: "initial",
  };
  const plan = writeIntegrationFixturePlan(data, checkout, fixture);
  writeIntegrationFixtureContext(data);
  writeEmptyPortionSeeds(data, plan, identity);
  writeFileSync(join(root, "identity.json"), JSON.stringify(identity));
  const request = buildCodexRequest(data, "integration", identity);
  writeFileSync(join(root, "prompt.txt"), request.prompt);
  writeFileSync(join(root, "schema.json"), JSON.stringify(request.schema));
}

/** @param {string} root @param {NodeJS.ProcessEnv} env @param {string} transcript @param {string} output */
export function verifyEmptyCodexIntegration(root, env, transcript, output) {
  const identity = JSON.parse(readFileSync(join(root, "identity.json"), "utf8"));
  if (
    identity.kind !== "offline-trial" ||
    identity.scenario !== "synthetic-empty-integration" ||
    identity.source !== env.GITHUB_SHA ||
    identity.run !== env.GITHUB_RUN_ID ||
    identity.repository !== env.GITHUB_REPOSITORY
  )
    throw new Error("Foreign empty integration proof.");
  const data = join(root, "data");
  const plan = JSON.parse(readFileSync(join(data, "plan.json"), "utf8"));
  if (
    plan.areas.length !== 2 ||
    gatherCandidates(
      plan.areas.map((area) =>
        JSON.parse(readFileSync(join(data, `find-${area.area}.json`), "utf8")),
      ),
    ).length
  )
    throw new Error("The integration proof requires two empty synthetic portions.");
  if (readFileSync(join(data, "candidates.json"), "utf8") !== "[]")
    throw new Error("The integration proof requires empty synthetic seeds.");
  const request = buildCodexRequest(data, "integration", identity);
  if (
    readFileSync(join(root, "prompt.txt"), "utf8") !== request.prompt ||
    readFileSync(join(root, "schema.json"), "utf8") !== JSON.stringify(request.schema)
  )
    throw new Error("Changed integration proof request.");
  const events = readCodexEvents(transcript);
  const commands = events.filter(
    (event) =>
      event.type === "item.completed" &&
      event.item?.type === "command_execution" &&
      event.item.exit_code === 0,
  );
  if (!commands.length || events.some((event) => ["error", "turn.failed"].includes(event.type)))
    throw new Error("Missing successful native integration execution.");
  acceptCodexAnswer(data, "integration", identity, output);
  return {
    nativeIntegration: true,
    syntheticPortionSeeds: 2,
    candidates: 0,
    binding: request.binding,
    nativeCommands: commands.length,
    tokens: measureReviewTokens(retainCodexUsage(transcript), "codex"),
    transcriptSha256: hashReviewContent(transcript),
  };
}
