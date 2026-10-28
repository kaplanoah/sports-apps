import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashReviewContent } from "./review-supplied.mjs";
import { readReviewGit } from "./review-repository.mjs";

export const TRIAL_COMPARISON_PROFILES = Object.freeze({
  claude: "production-prompt-single-attempt",
  codex: "native-offline",
});

const SOCKET_CASE = {
  fix: "1b90fd34f64459f960ff0e735c1eb1f1266fcc11",
  test: "tests/worker-store.test.js",
  pattern: "an unknown socket message leaves watched documents",
};

const CASES = [
  {
    id: "case-1",
    head: "950a11002a35bab3d2671c2d858615ff86587fd7",
    ...SOCKET_CASE,
    targets: ["shared/page/worker-store.js", "shared/worker/season-store.js"],
    bug: "An unknown socket frame reaches receivePush without a document path and throws instead of preserving watches.",
  },
  {
    id: "case-2",
    head: "8e61ec83806cf5cd0f21a2791b456039aec5e7be",
    fix: "f2f919e6ae856d9e7b2a953ffceb9e55ffe66714",
    test: "apps/mlb/tests/season-updater.test.js",
    pattern: "a month whose every game MLB dropped goes",
    targets: [
      "apps/mlb/worker/src/season-updater.js",
      "apps/mlb/page/js/feed-schedule.js",
      "apps/mlb/page/js/snapshot.js",
    ],
    bug: "A stored playoff month remains after the current schedule drops every game it contained.",
  },
  {
    id: "range-694",
    head: "54e0ca728ecd43d12a670b8a35aebb97b63335c2",
    ...SOCKET_CASE,
    targets: [],
    bug: "The unknown socket frame failure is also reproduced in the complete historical PR #694 snapshot.",
  },
  {
    id: "range-734",
    detectionTarget: false,
    head: "a6105d72d8706dc280d162b890a6cd82b21888dc",
    ...SOCKET_CASE,
    targets: [],
    bug: "The unknown socket frame failure is also reproduced in the complete historical PR #734 snapshot.",
  },
];

/** @param {string} id */
export function readReviewEvaluationCase(id) {
  const entry = CASES.find((entry) => entry.id === id);
  if (!entry) throw new Error("Unknown frozen review case.");
  return entry;
}

/** @param {any} entry @param {string} [repository] */
export function verifyEvaluationSnapshot(entry, repository = process.cwd()) {
  const head = readReviewGit(repository, [
    "rev-parse",
    "--verify",
    `${entry.head}^{commit}`,
  ]).trim();
  readReviewGit(repository, ["merge-base", "--is-ancestor", head, entry.fix]);
  if (
    entry.targets.length &&
    readReviewGit(repository, ["rev-parse", `${entry.fix}^1`]).trim() !== head
  )
    throw new Error("Component snapshot is not its fix's parent.");
  return head;
}

/** @param {string} destination */
export function reproduceReviewCases(destination) {
  mkdirSync(destination);
  return CASES.map((entry) => {
    const head = verifyEvaluationSnapshot(entry);
    const folder = join(destination, entry.id);
    mkdirSync(folder);
    const results = {};
    for (const [name, revision] of [
      ["buggy", head],
      ["fixed", entry.fix],
    ]) {
      const checkout = join(folder, name);
      mkdirSync(checkout);
      execFileSync("tar", ["-x", "-C", checkout], {
        input: readReviewGit(process.cwd(), ["archive", revision], "buffer"),
      });
      const original = readFileSync(join(checkout, entry.test));
      writeFileSync(
        join(checkout, entry.test),
        readReviewGit(process.cwd(), ["show", `${entry.fix}:${entry.test}`], "buffer"),
      );
      const trial = spawnSync(
        process.execPath,
        ["--test", "--test-name-pattern", entry.pattern, entry.test],
        {
          cwd: checkout,
          encoding: "utf8",
          env: { PATH: process.env.PATH, TZ: "America/New_York" },
        },
      );
      writeFileSync(join(checkout, entry.test), original);
      const output = trial.stdout + trial.stderr;
      if (trial.error || trial.signal || !output.includes(entry.pattern))
        throw new Error("Historical reproducer did not reach its test.");
      results[name] = trial.status;
      writeFileSync(join(folder, `${name}-reproduction.txt`), output);
    }
    if (results.buggy === 0 || results.fixed !== 0)
      throw new Error(`Historical defect not reproduced: ${entry.id}.`);
    const evidence = { ...entry, head, results, reproduced: true };
    writeFileSync(join(folder, "rubric.json"), JSON.stringify(evidence, null, 2));
    const context = {
      case: entry.id,
      head,
      targets: entry.targets,
      instruction:
        "Audit these historical components completely with their callers, shared state, failure paths, tests and both apps. This is an offline snapshot, not a live PR. Do not inspect the sibling fixed checkout, reproduction logs or hidden rubric. No publishing.",
    };
    writeFileSync(join(folder, "review-context.json"), JSON.stringify(context, null, 2));
    return evidence;
  });
}

/** @param {string} text */
export function readCodexEvents(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
}

/** @param {any} usage */
function hasValidCodexSubcounts(usage) {
  return [
    ["cache_write_input_tokens", usage.input_tokens - usage.cached_input_tokens],
    ["reasoning_output_tokens", usage.output_tokens],
  ].every(
    ([field, limit]) =>
      usage[field] === undefined ||
      (Number.isSafeInteger(usage[field]) && usage[field] >= 0 && usage[field] <= limit),
  );
}

/** @param {string} text @param {string} provider */
function readReviewUsage(text, provider) {
  let events;
  try {
    events = provider === "claude" ? JSON.parse(text) : readCodexEvents(text);
  } catch {
    throw new Error("Invalid evaluation telemetry.");
  }
  if (!Array.isArray(events) || !["claude", "codex"].includes(provider))
    throw new Error("Invalid evaluation telemetry.");
  const usages = events
    .filter((event) =>
      provider === "claude" ? event.type === "result" : event.type === "turn.completed",
    )
    .map((event) => event.usage);
  if (
    !usages.length ||
    usages.some(
      (usage) =>
        !usage ||
        !Number.isSafeInteger(usage.input_tokens) ||
        !Number.isSafeInteger(usage.output_tokens) ||
        usage.input_tokens < 0 ||
        usage.output_tokens < 0 ||
        (provider === "codex"
          ? !Number.isSafeInteger(usage.cached_input_tokens) ||
            usage.cached_input_tokens < 0 ||
            usage.cached_input_tokens > usage.input_tokens ||
            !hasValidCodexSubcounts(usage)
          : !Number.isSafeInteger(usage.cache_read_input_tokens) ||
            !Number.isSafeInteger(usage.cache_creation_input_tokens) ||
            usage.cache_read_input_tokens < 0 ||
            usage.cache_creation_input_tokens < 0),
    )
  )
    throw new Error("Evaluation token usage is missing.");
  return usages;
}

/** @param {string} text */
export function retainCodexUsage(text) {
  const fields = [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
  ];
  return readReviewUsage(text, "codex")
    .map((usage) =>
      JSON.stringify({
        type: "turn.completed",
        usage: Object.fromEntries(
          fields
            .filter((field) => Object.hasOwn(usage, field))
            .map((field) => [field, usage[field]]),
        ),
      }),
    )
    .join("\n");
}

/** @param {any[]} usages @param {string} field */
function sumReportedUsage(usages, field) {
  return usages.some((usage) => usage[field] === undefined)
    ? null
    : usages.reduce((total, usage) => total + usage[field], 0);
}

/** @param {string} text @param {string} provider */
export function measureReviewTokens(text, provider) {
  const usages = readReviewUsage(text, provider);
  const total = usages.reduce(
    (total, usage) => ({
      input:
        total.input + usage.input_tokens - (provider === "codex" ? usage.cached_input_tokens : 0),
      output: total.output + usage.output_tokens,
      cached:
        total.cached +
        (provider === "codex" ? usage.cached_input_tokens : usage.cache_read_input_tokens),
    }),
    { input: 0, output: 0, cached: 0 },
  );
  return provider === "codex"
    ? {
        ...total,
        cacheWrite: sumReportedUsage(usages, "cache_write_input_tokens"),
        reasoningOutput: sumReportedUsage(usages, "reasoning_output_tokens"),
      }
    : { ...total, cacheWrite: sumReportedUsage(usages, "cache_creation_input_tokens") };
}

/** @param {any} trial @param {string} telemetry */
export function measureReviewTrial(trial, telemetry) {
  if (
    !CASES.some(
      (entry) => entry.id === trial.case && entry.fix === trial.fix && entry.head === trial.head,
    ) ||
    !["claude", "codex"].includes(trial.provider) ||
    trial.comparisonProfile !== TRIAL_COMPARISON_PROFILES[trial.provider] ||
    !Number.isFinite(trial.elapsedSeconds) ||
    trial.elapsedSeconds <= 0 ||
    !["completed", "failed", "interrupted"].includes(trial.status) ||
    !Array.isArray(trial.adjudications) ||
    typeof trial.model !== "string" ||
    !trial.model ||
    typeof trial.toolVersion !== "string" ||
    !trial.toolVersion
  )
    throw new Error("Invalid evaluation trial.");
  if (
    trial.adjudications.some(
      (item) =>
        typeof item.id !== "string" ||
        !item.id.trim() ||
        !["confirmed-target", "confirmed-other", "false", "unsure"].includes(item.verdict) ||
        typeof item.reason !== "string" ||
        !item.reason.trim(),
    ) ||
    new Set(trial.adjudications.map((item) => item.id)).size !== trial.adjudications.length
  )
    throw new Error("Evaluation requires evidence-based adjudication.");
  const entry = readReviewEvaluationCase(trial.case);
  const hasDetectionTarget = !("detectionTarget" in entry && entry.detectionTarget === false);
  const detected = trial.adjudications.some((item) => item.verdict === "confirmed-target");
  if (!hasDetectionTarget && detected)
    throw new Error("This historical range has no changed-code detection target.");
  return {
    case: trial.case,
    provider: trial.provider,
    comparisonProfile: trial.comparisonProfile,
    fix: trial.fix,
    head: trial.head,
    model: trial.model,
    toolVersion: trial.toolVersion,
    status: trial.status,
    completed: trial.status === "completed",
    detected: hasDetectionTarget ? detected : null,
    falseFindings: trial.adjudications.filter((item) => item.verdict === "false").length,
    unsure: trial.adjudications.filter((item) => item.verdict === "unsure").length,
    tokens: measureReviewTokens(telemetry, trial.provider),
    elapsedSeconds: trial.elapsedSeconds,
    telemetrySha256: hashReviewContent(telemetry),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, path, telemetry] = process.argv.slice(2);
  if (command === "reproduce")
    console.log(
      JSON.stringify(
        reproduceReviewCases(path).map(({ id, head, results }) => ({ id, head, results })),
        null,
        2,
      ),
    );
  else if (command === "measure")
    console.log(
      JSON.stringify(
        measureReviewTrial(JSON.parse(readFileSync(path, "utf8")), readFileSync(telemetry, "utf8")),
        null,
        2,
      ),
    );
  else throw new Error("Use reproduce <new-folder> or measure <trial.json> <telemetry-file>.");
}
