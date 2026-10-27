import test from "node:test";
import { createTrialFixture } from "./review-trial-fixture.js";
import { createEvidenceCertificate } from "./evaluation-certificate.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareTrialEvidenceCertificate,
  encryptReviewTrialEvidence,
} from "../worker/review-trial-evidence.mjs";
import {
  requireReviewTrialAuthority,
  readTrialProviderConfiguration,
  importTrialPortions,
  retainClaudeTrialUsage,
  renderTrialComponent,
} from "../worker/review-trial.mjs";
import { buildCodexRequest, acceptCodexAnswer } from "../worker/review-codex.mjs";
import { readReviewGit, runReviewGit } from "../worker/review-repository.mjs";
import { verifyEvaluationSnapshot } from "../worker/review-evaluation.mjs";
import { readCodexProofConfiguration } from "../worker/prove-codex-runner.mjs";
import { readRepoFile } from "./repo-files.js";

const OWNER = {
  GITHUB_REPOSITORY: "kaplanoah/sports-apps",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_ACTOR: "kaplanoah",
  GITHUB_TRIGGERING_ACTOR: "kaplanoah",
  GITHUB_RUN_ATTEMPT: "1",
  TRIAL_PROVIDER: "codex",
  TRIAL_CASE: "case-1",
};

test("component delivery preserves trailing spaces, blank lines and the final newline", () => {
  for (const text of ["a  \n\n", "a  ", "a\n"]) {
    const part = renderTrialComponent("shared/page/example.js", text);
    const supplied =
      part.diff
        .split("\n")
        .slice(4)
        .filter((line) => line.startsWith("+"))
        .map((line) => line.slice(1))
        .join("\n") + (text.endsWith("\n") ? "\n" : "");
    assert.equal(supplied, text);
  }
});

test("offline trials require a first owner dispatch, a frozen snapshot and one explicit provider", () => {
  assert.equal(requireReviewTrialAuthority(OWNER).id, "case-1");
  for (const [name, value] of [
    ["GITHUB_REPOSITORY", "example/fork"],
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_ACTOR", "outsider"],
    ["GITHUB_TRIGGERING_ACTOR", "outsider"],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["TRUSTED_CODEX_REVIEW_ENABLED", "true"],
    ["TRIAL_PROVIDER", "both"],
    ["TRIAL_CASE", "unfrozen"],
  ])
    assert.throws(() => requireReviewTrialAuthority({ ...OWNER, [name]: value }));
});

test("a blind large-range bundle contains only historical ancestors and complete trusted coverage", (context) => {
  const root = mkdtempSync(join(tmpdir(), "review-trial-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = createTrialFixture(root, "range-694");
  const env = {
    ...process.env,
    ...OWNER,
    TRIAL_TEST_FIXTURE: fixture.path,
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: join(root, "outputs"),
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "7",
    TRIAL_CASE: "range-694",
    TRIAL_EVIDENCE_CERTIFICATE: createEvidenceCertificate(root),
  };
  const { command } = fixture;
  const prepared = spawnSync(process.execPath, [command, "prepare"], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const metadata = JSON.parse(readFileSync(join(root, "trial/identity.json"), "utf8"));
  assert.equal(metadata.head, fixture.snapshot.entry.head);
  assert.equal(metadata.base, fixture.base);
  const plan = JSON.parse(readFileSync(join(root, "trial/data/plan.json"), "utf8"));
  assert.ok(plan.areas.length > 1);
  const files = plan.areas.flatMap((area) => area.files);
  assert.ok(files.includes("apps/mlb/page/js/app.js"));
  assert.ok(files.includes("apps/wnba/page/js/app.js"));
  assert.ok(files.includes("shared/page/worker-store.js"));
  assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /integration=true/);
  const claudeRoot = join(root, "claude");
  mkdirSync(claudeRoot);
  const claudeEnv = {
    ...env,
    RUNNER_TEMP: claudeRoot,
    TRIAL_PROVIDER: "claude",
    GITHUB_OUTPUT: join(claudeRoot, "outputs"),
  };
  const claudePrepared = spawnSync(process.execPath, [command, "prepare"], {
    env: claudeEnv,
    encoding: "utf8",
  });
  assert.equal(claudePrepared.status, 0, claudePrepared.stderr);
  const claudeIdentity = JSON.parse(readFileSync(join(claudeRoot, "trial/identity.json"), "utf8"));
  assert.equal(claudeIdentity.inputSha256, metadata.inputSha256);
  const clone = join(root, "model-checkout");
  assert.equal(
    spawnSync("git", ["clone", "--quiet", join(root, "trial/snapshot.bundle"), clone]).status,
    0,
  );
  assert.equal(
    spawnSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    metadata.head,
  );
  assert.notEqual(
    spawnSync("git", ["-C", clone, "cat-file", "-e", `${fixture.fix}^{commit}`], { stdio: "pipe" })
      .status,
    0,
  );
  assert.equal(existsSync(join(root, "trial/rubric.json")), false);
  assert.equal(existsSync(join(root, "trial/fixed")), false);
  const production = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../worker/review-trial.mjs", import.meta.url)), "request", "1"],
    {
      env: { ...env, GITHUB_WORKSPACE: clone },
      encoding: "utf8",
    },
  );
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Foreign trial input\./);
  const unknown = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../worker/review-trial.mjs", import.meta.url)), "unknown"],
    {
      env: { ...env, GITHUB_WORKSPACE: clone },
      encoding: "utf8",
    },
  );
  assert.notEqual(unknown.status, 0);
  assert.doesNotMatch(unknown.stderr, /Foreign trial input\./);
  const privateRoot = join(root, "private-diagnostic");
  mkdirSync(privateRoot);
  cpSync(join(root, "trial"), join(privateRoot, "trial"), { recursive: true });
  writeFileSync(join(privateRoot, "trial/identity.json"), "privdiag");
  const unexpected = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../worker/review-trial.mjs", import.meta.url)), "request", "1"],
    {
      env: { ...env, RUNNER_TEMP: privateRoot, GITHUB_WORKSPACE: clone },
      encoding: "utf8",
    },
  );
  assert.notEqual(unexpected.status, 0);
  assert.doesNotMatch(unexpected.stderr, /privdiag|Foreign trial input\./);
  assert.equal(existsSync(join(root, "trial/prompt.txt")), false);
  const requested = spawnSync(process.execPath, [command, "request", "1"], {
    env: { ...env, GITHUB_WORKSPACE: clone },
    encoding: "utf8",
  });
  assert.equal(requested.status, 0, requested.stderr);
  const request = buildCodexRequest(join(root, "trial/data"), 1, metadata);
  assert.equal(readFileSync(join(root, "trial/prompt.txt"), "utf8"), request.prompt);
  assert.match(request.prompt, /blind offline historical trial/);
  assert.match(
    readFileSync(join(root, "codex-home/config.toml"), "utf8"),
    /web_search = "disabled"/,
  );
  assert.doesNotMatch(request.prompt, /1b90fd34|unknown socket frame|rubric.json/);
  for (const change of [
    { head: "b".repeat(40) },
    { base: "b".repeat(40) },
    { source: "b".repeat(40) },
    { run: "8" },
    { inputSha256: "b".repeat(64) },
    { bundleSha256: "b".repeat(64) },
    { planSha256: "b".repeat(64) },
  ]) {
    const staleRoot = mkdtempSync(join(root, "stale-"));
    cpSync(join(root, "trial"), join(staleRoot, "trial"), { recursive: true });
    writeFileSync(
      join(staleRoot, "trial/identity.json"),
      JSON.stringify({ ...metadata, ...change }),
    );
    const invalid = spawnSync(process.execPath, [command, "request", "1"], {
      env: { ...env, RUNNER_TEMP: staleRoot, GITHUB_WORKSPACE: clone },
      encoding: "utf8",
    });
    assert.notEqual(invalid.status, 0);
  }
  writeFileSync(join(root, "trial/identity.json"), JSON.stringify(metadata));
  const configuration = JSON.parse(readFileSync(join(root, "trial/configuration.json"), "utf8"));
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin/codex"),
    '#!/usr/bin/env node\nconsole.log("codex-cli " + process.env.PROOF_TEST_CLI);\n',
    { mode: 0o755 },
  );
  writeFileSync(join(root, "trial-start.txt"), process.hrtime.bigint().toString());
  writeFileSync(
    join(root, "codex-events.jsonl"),
    '{"type":"item.completed","private":"private caller trace"}\n{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":2,"output_tokens":3}}\n',
  );
  writeFileSync(
    join(root, "trial-answer.json"),
    JSON.stringify({
      binding: request.binding,
      complete: true,
      unfinished: [],
      unjudged: [],
      candidates: [],
    }),
  );
  const collected = spawnSync(process.execPath, [command, "collect", "1"], {
    env: {
      ...env,
      GITHUB_WORKSPACE: clone,
      MODEL_OUTCOME: "success",
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      PROOF_TEST_CLI: configuration.cli,
    },
    encoding: "utf8",
  });
  assert.equal(collected.status, 0, collected.stderr);
  const result = JSON.parse(readFileSync(join(root, "trial-result/session.json"), "utf8"));
  assert.equal(result.status, "completed");
  assert.equal(result.toolVersion, `codex-cli ${configuration.cli}`);
  assert.equal(result.configuration.configuredModel, configuration.configuredModel);
  assert.equal(JSON.stringify(result).includes("private caller trace"), false);
  assert.deepEqual(result.tokens, { input: 10, output: 3, cached: 2, cacheWrite: 0 });
  assert.ok(result.sessionElapsedSeconds > 0);
  assert.ok(existsSync(join(root, "trial-private/evidence.cms")));
  for (const [name, outcome, changedAnswer, events, expectedStage] of [
    ["failed-action", "failure", null, null, "provider-action"],
    ["interrupted-action", "cancelled", null, null, "provider-action"],
    ["malformed", "success", "private malformed answer", null, "answer-validation"],
    [
      "incomplete",
      "success",
      JSON.stringify({
        binding: request.binding,
        complete: false,
        unfinished: ["remaining callers"],
        unjudged: [],
        candidates: [],
      }),
      null,
      "answer-validation",
    ],
    [
      "stale",
      "success",
      JSON.stringify({
        binding: "stale-binding",
        complete: true,
        unfinished: [],
        unjudged: [],
        candidates: [],
      }),
      null,
      "answer-validation",
    ],
    ["missing-usage", "success", null, "", "telemetry"],
  ]) {
    const attempt = join(root, name);
    mkdirSync(attempt);
    cpSync(join(root, "trial"), join(attempt, "trial"), { recursive: true });
    writeFileSync(join(attempt, "trial-start.txt"), process.hrtime.bigint().toString());
    writeFileSync(
      join(attempt, "codex-events.jsonl"),
      events ?? readFileSync(join(root, "codex-events.jsonl")),
    );
    writeFileSync(
      join(attempt, "trial-answer.json"),
      changedAnswer ?? readFileSync(join(root, "trial-answer.json")),
    );
    const failed = spawnSync(process.execPath, [command, "collect", "1"], {
      env: {
        ...env,
        RUNNER_TEMP: attempt,
        GITHUB_WORKSPACE: clone,
        MODEL_OUTCOME: outcome,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        PROOF_TEST_CLI: configuration.cli,
      },
      encoding: "utf8",
    });
    assert.notEqual(failed.status, 0, name);
    assert.doesNotMatch(
      failed.stdout + failed.stderr,
      /private malformed answer|private caller trace/,
    );
    const failedSession = JSON.parse(
      readFileSync(join(attempt, "trial-result/session.json"), "utf8"),
    );
    assert.equal(failedSession.status, outcome === "cancelled" ? "interrupted" : "failed", name);
    assert.equal(failedSession.failureStage, expectedStage, name);
    assert.equal(existsSync(join(attempt, "trial-private/evidence.cms")), true, name);
    assert.equal("record" in failedSession, false, name);
    if (name !== "missing-usage") assert.deepEqual(failedSession.tokens, result.tokens);
    else assert.equal("tokens" in failedSession, false);
  }
  const decoded = join(root, "private-evidence.tgz");
  assert.equal(
    spawnSync(
      "openssl",
      [
        "cms",
        "-decrypt",
        "-binary",
        "-inform",
        "DER",
        "-in",
        join(root, "failed-action/trial-private/evidence.cms"),
        "-out",
        decoded,
        "-recip",
        join(root, "certificate.pem"),
        "-inkey",
        join(root, "key.pem"),
      ],
      { stdio: "pipe" },
    ).status,
    0,
  );
  assert.match(
    spawnSync("tar", ["-xOf", decoded, "./transcript.json"], { encoding: "utf8" }).stdout,
    /private caller trace/,
  );
});

test("raw trial evidence is authenticated ciphertext, decryptable only with the held private key", (context) => {
  const root = mkdtempSync(join(tmpdir(), "trial-evidence-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const certificate = createEvidenceCertificate(root);
  assert.match(prepareTrialEvidenceCertificate(root, certificate), /^[A-F0-9:]+$/);
  assert.throws(() => prepareTrialEvidenceCertificate(root, "-----BEGIN PRIVATE KEY-----"));
  const input = join(root, "input.txt");
  const encrypted = join(root, "evidence.cms");
  const decoded = join(root, "decoded.txt");
  writeFileSync(input, "private raw command and output");
  encryptReviewTrialEvidence(input, encrypted, join(root, "evidence-certificate.pem"));
  assert.equal(readFileSync(encrypted).includes(Buffer.from("private raw command")), false);
  const envelope = spawnSync(
    "openssl",
    ["cms", "-cmsout", "-print", "-inform", "DER", "-in", encrypted],
    { encoding: "utf8" },
  );
  assert.equal(envelope.status, 0);
  assert.match(envelope.stdout, /aes-256-gcm/);
  assert.match(envelope.stdout, /rsaesOaep/);
  assert.match(envelope.stdout, /sha256/);
  const args = [
    "cms",
    "-decrypt",
    "-binary",
    "-inform",
    "DER",
    "-in",
    encrypted,
    "-out",
    decoded,
    "-recip",
    join(root, "certificate.pem"),
    "-inkey",
    join(root, "key.pem"),
  ];
  assert.equal(spawnSync("openssl", args, { stdio: "pipe" }).status, 0);
  assert.equal(readFileSync(decoded, "utf8"), "private raw command and output");
  const changed = readFileSync(encrypted);
  changed[changed.length - 1] ^= 1;
  writeFileSync(encrypted, changed);
  assert.notEqual(spawnSync("openssl", args, { stdio: "pipe" }).status, 0);
});

test("integration imports every complete exact-provider portion even when all candidates are empty", (context) => {
  const root = mkdtempSync(join(tmpdir(), "review-trial-portions-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "data");
  mkdirSync(folder);
  const identity = {
    kind: "offline-trial",
    case: "case-1",
    provider: "codex",
    head: "a".repeat(40),
    base: "b".repeat(40),
    source: "c".repeat(40),
    run: "7",
  };
  const plan = {
    provider: "codex",
    stage: "first",
    since: null,
    unread: [],
    areas: [1, 2].map((area) => ({
      area,
      name: `portion ${area}`,
      files: [`shared/page/value-${area}.js`],
      rules: [],
      partsByFile: { [`shared/page/value-${area}.js`]: [`part-${area}.diff`] },
    })),
  };
  writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
  for (const path of [
    "REVIEW.md",
    "AGENTS.md",
    "pull-request.md",
    "test-context.md",
    "stale-names.md",
    "part-1.diff",
    "part-2.diff",
  ])
    writeFileSync(join(folder, path), `Complete supplied ${path}.\n`);
  const artifacts = [];
  for (const area of [1, 2]) {
    const request = buildCodexRequest(folder, area, identity);
    acceptCodexAnswer(
      folder,
      area,
      identity,
      JSON.stringify({
        binding: request.binding,
        complete: true,
        unfinished: [],
        unjudged: [],
        candidates: [],
      }),
    );
    const artifact = {
      identity,
      portion: area,
      status: "completed",
      record: JSON.parse(readFileSync(join(folder, `find-${area}.json`), "utf8")),
    };
    const destination = join(root, `review-trial-session-${area}`);
    mkdirSync(destination);
    writeFileSync(join(destination, "session.json"), JSON.stringify(artifact));
    artifacts.push({ artifact, destination });
  }
  importTrialPortions(folder, root, identity);
  const request = buildCodexRequest(folder, "integration", identity);
  assert.match(
    request.prompt,
    /mandatory independent integration pass, even when candidates are empty/,
  );
  assert.ok(request.prompt.includes("Complete supplied part-1.diff."));
  assert.ok(request.prompt.includes("Complete supplied part-2.diff."));
  for (const change of [
    { identity: { ...identity, provider: "claude" } },
    { identity: { ...identity, head: "d".repeat(40) } },
    { identity: { ...identity, base: "d".repeat(40) } },
    { identity: { ...identity, source: "d".repeat(40) } },
    { status: "failed" },
    { record: { ...artifacts[0].artifact.record, tries: [] } },
    {
      record: {
        ...artifacts[0].artifact.record,
        tries: artifacts[0].artifact.record.tries.map((attempt) => ({ ...attempt, answer: null })),
      },
    },
    { record: { ...artifacts[0].artifact.record, provider: "claude" } },
    {
      record: {
        ...artifacts[0].artifact.record,
        tries: artifacts[0].artifact.record.tries.map((attempt) => ({
          ...attempt,
          answer: {
            ...attempt.answer,
            unjudged: [{ file: "shared/page/value-1.js", why: "Required callers unjudged." }],
          },
        })),
      },
    },
    {
      record: {
        provider: "claude",
        area: 1,
        tries: [{ reads: [["part-1.diff", [[1, 1]]]], answer: { items: [], unjudged: [] } }],
      },
    },
  ]) {
    writeFileSync(
      join(artifacts[0].destination, "session.json"),
      JSON.stringify({ ...artifacts[0].artifact, ...change }),
    );
    assert.throws(() => importTrialPortions(folder, root, identity));
  }
});

test("Claude telemetry retains only numeric final usage and rejects missing counters", () => {
  const events = [
    { type: "assistant", message: { content: "private raw turn" } },
    {
      type: "result",
      private: "private metadata",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
        other: "private",
      },
    },
  ];
  const retained = retainClaudeTrialUsage(JSON.stringify(events));
  assert.doesNotMatch(retained, /private|assistant|message|other/);
  assert.equal(JSON.parse(retained).length, 1);
  assert.throws(() => retainClaudeTrialUsage("[]"));
});

test("trial workflows isolate provider credentials and guard paid reruns with no publishing rights", () => {
  const workflow = readRepoFile(".github/workflows/provider-review-trial.yml");
  const session = readRepoFile(".github/workflows/provider-review-session.yml");
  assert.match(workflow, /options: \[claude, codex\]/);
  assert.match(workflow, /inputs.provider == 'codex' && secrets.TRUSTED_REVIEW_OPENAI_API_KEY/);
  assert.match(workflow, /inputs.provider == 'claude' && secrets.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.doesNotMatch(
    workflow + session,
    /secrets: inherit|pull-requests: write|checks: write|contents: write/,
  );
  assert.match(session, /model:\n {4}needs: request\n {4}if: \*trial-authority/);
  const model = session.split("\n  model:\n")[1];
  assert.doesNotMatch(model.split("      # Current source")[0], /actions\/checkout/);
  assert.match(model, /Native Codex investigation[\s\S]*if: inputs.provider == 'codex'/);
  assert.match(model, /Claude investigation[\s\S]*if: inputs.provider == 'claude'/);
  assert.match(model, /path: \$\{\{ runner.temp \}\}\/trial-result\//);
  assert.doesNotMatch(model.split("name: review-trial-session-")[1], /events|execution|transcript/);
});

test("Claude trials use real Read evidence and verify empty integration coverage independently", (context) => {
  const root = mkdtempSync(join(tmpdir(), "claude-trial-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = createTrialFixture(root, "case-1", [
    "shared/page/worker-store.js",
    "shared/worker/season-store.js",
  ]);
  const { command } = fixture;
  const env = {
    ...process.env,
    ...OWNER,
    TRIAL_TEST_FIXTURE: fixture.path,
    TRIAL_PROVIDER: "claude",
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: join(root, "outputs"),
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "7",
    TRIAL_EVIDENCE_CERTIFICATE: createEvidenceCertificate(root),
  };
  const prepared = spawnSync(process.execPath, [command, "prepare"], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const plan = JSON.parse(readFileSync(join(root, "trial/data/plan.json"), "utf8"));
  assert.deepEqual(
    plan.areas.flatMap((area) => area.files).sort(),
    [...fixture.snapshot.entry.targets].sort(),
  );
  assert.match(readFileSync(join(root, "trial/data/pull-request.md"), "utf8"), /component audit/);
  const portions = join(root, "portions");
  mkdirSync(portions);
  function collectClaudeFixture(
    portion,
    { omitted = false, limited = false, readCandidatesWithShell = false } = {},
  ) {
    const variant = readCandidatesWithShell
      ? "shell-candidates"
      : limited
        ? "limited"
        : omitted
          ? "missing"
          : "full";
    const attempt = join(root, `${portion}-${variant}`);
    mkdirSync(attempt);
    cpSync(join(root, "trial"), join(attempt, "trial"), { recursive: true });
    if (portion === "integration")
      cpSync(portions, join(attempt, "trial-portions"), { recursive: true });
    const workspace = join(attempt, "workspace");
    mkdirSync(workspace);
    symlinkSync(join(attempt, "trial/data"), join(workspace, ".review"));
    const fixtureEnv = {
      ...env,
      RUNNER_TEMP: attempt,
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: join(attempt, "outputs"),
      MODEL_OUTCOME: "success",
      EXECUTION_FILE: join(attempt, "execution.json"),
      STRUCTURED_OUTPUT: JSON.stringify({
        [portion === "integration" ? "findings" : "candidates"]: [],
        unjudged: limited
          ? [{ file: plan.areas[0].files[0], why: "Hosted behavior remains unjudged." }]
          : [],
      }),
    };
    const requested = spawnSync(process.execPath, [command, "request", `${portion}`], {
      env: fixtureEnv,
      encoding: "utf8",
    });
    assert.equal(requested.status, 0, requested.stderr);
    const requestPrompt = readFileSync(join(attempt, "trial/prompt.txt"), "utf8");
    assert.match(requestPrompt, /grep -n -F -e <text> -- <path>/);
    assert.match(requestPrompt, /single-attempt trial results/);
    if (portion !== "integration") {
      assert.match(requestPrompt, /For each change to behavior, find the test/);
      assert.match(requestPrompt, /stale-names.md/);
    } else {
      assert.match(
        requestPrompt,
        /Use the Read tool for \.review\/candidates\.json and every diff and rule/,
      );
      assert.match(
        requestPrompt,
        /Shell output does not satisfy this profile's Read-coverage check/,
      );
    }
    const areas =
      portion === "integration" ? plan.areas : plan.areas.filter((area) => area.area === portion);
    const paths = [
      ...new Set(
        areas.flatMap((area) => [...Object.values(area.partsByFile).flat(), ...area.rules]),
      ),
    ];
    if (portion === "integration") paths.push("candidates.json");
    const readPaths = (omitted ? paths.slice(1) : paths).filter(
      (path) => !readCandidatesWithShell || path !== "candidates.json",
    );
    /** @type {any[]} */
    const messages = readPaths.flatMap((path, index) => [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: `${index}`,
              name: "Read",
              input: {
                file_path: join(workspace, ".review", path),
                offset: 1,
                limit: readFileSync(join(workspace, ".review", path), "utf8").split("\n").length,
              },
            },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: `${index}`, is_error: false }] },
      },
    ]);
    if (readCandidatesWithShell)
      messages.push(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "shell-candidates",
                name: "Bash",
                input: { command: `cat ${join(workspace, ".review/candidates.json")}` },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "shell-candidates",
                is_error: false,
                content: readFileSync(join(workspace, ".review/candidates.json"), "utf8"),
              },
            ],
          },
        },
      );
    messages.push({
      type: "result",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      },
    });
    writeFileSync(fixtureEnv.EXECUTION_FILE, JSON.stringify(messages));
    writeFileSync(join(attempt, "trial-start.txt"), process.hrtime.bigint().toString());
    const collected = spawnSync(process.execPath, [command, "collect", `${portion}`], {
      env: fixtureEnv,
      encoding: "utf8",
    });
    const incomplete = omitted || readCandidatesWithShell;
    assert.equal(collected.status, incomplete ? 1 : 0, collected.stderr);
    const session = JSON.parse(readFileSync(join(attempt, "trial-result/session.json"), "utf8"));
    assert.equal(session.status, incomplete ? "failed" : "completed");
    if (readCandidatesWithShell) {
      assert.equal(session.failureStage, "answer-validation");
      assert.equal(session.tokens.input, 10);
      assert.ok(existsSync(join(attempt, "trial-private/evidence.cms")));
    }
    if (limited)
      assert.deepEqual(session.unjudged, [
        { file: plan.areas[0].files[0], why: "Hosted behavior remains unjudged." },
      ]);
    if (!omitted && portion !== "integration") {
      assert.ok(session.record.tries[0].reads.length > 0);
      assert.ok(session.record.tries[0].reads.every(([path]) => !path.startsWith("/")));
      assert.equal(session.record.provider, undefined);
      cpSync(join(attempt, "trial-result"), join(portions, `review-trial-session-${portion}`), {
        recursive: true,
      });
    }
    if (!incomplete && portion === "integration")
      assert.ok(session.integrationCoverage.tries[0].reads.length > 0);
  }
  for (const area of plan.areas) collectClaudeFixture(area.area);
  collectClaudeFixture(plan.areas[0].area, { omitted: true });
  collectClaudeFixture(plan.areas[0].area, { limited: true });
  collectClaudeFixture("integration", { omitted: true });
  collectClaudeFixture("integration", { readCandidatesWithShell: true });
  collectClaudeFixture("integration");
  collectClaudeFixture("integration", { limited: true });
});

test("trial actions and provider configurations agree with the trusted production pins", () => {
  const session = readRepoFile(".github/workflows/provider-review-session.yml");
  assert.deepEqual(readTrialProviderConfiguration("codex", 1), {
    ...readCodexProofConfiguration(readRepoFile(".github/workflows/trusted-codex-review.yml")),
    comparisonProfile: "native-offline",
    offlineWebSearch: "disabled",
  });
  for (const portion of /** @type {const} */ ([1, "integration"])) {
    const workflow = portion === "integration" ? "review.yml" : "trusted-review-area.yml";
    const production = readRepoFile(`.github/workflows/${workflow}`);
    const configured = readTrialProviderConfiguration("claude", portion);
    assert.equal(
      configured.action,
      session.match(/uses: anthropics\/claude-code-action@([a-f0-9]{40})/)[1],
    );
    assert.equal(configured.configuredModel, production.match(/--model ([\w.-]+)/)[1]);
    assert.equal(configured.maxTurns, Number(production.match(/--max-turns (\d+)/)[1]));
    assert.equal(
      configured.timeoutMinutes,
      Number(
        production.match(/timeout-minutes: (\d+)\n\s*uses: anthropics\/claude-code-action@/)[1],
      ),
    );
    assert.equal(configured.comparisonProfile, "production-prompt-single-attempt");
    assert.equal(configured.automaticReadRetry, false);
  }
});

test("snapshot validation verifies actual objects, fix ancestry and immediate component parents", (context) => {
  const root = mkdtempSync(join(tmpdir(), "trial-snapshot-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const { snapshot, base, fix } = createTrialFixture(root, "case-1");
  const entry = { ...snapshot.entry, fix };
  const bytes = readReviewGit(
    snapshot.repository,
    ["show", `${entry.head}:apps/mlb/page/js/app.js`],
    "buffer",
  );
  assert.equal(Buffer.isBuffer(bytes), true);
  assert.equal(bytes.toString(), "export const value = 2;\n");
  assert.equal(
    runReviewGit(snapshot.repository, ["show", `${entry.head}:apps/mlb/page/js/app.js`]),
    "export const value = 2;",
  );
  assert.throws(() =>
    runReviewGit(snapshot.repository, ["rev-parse", "HEAD"], {
      environment: {
        PATH: process.env.PATH,
        REVIEW_BASE: entry.head,
        REVIEW_TRUSTED: "untrusted",
      },
    }),
  );
  const configuration = join(root, "host.gitconfig");
  writeFileSync(configuration, "[credential]\nhelper = example-fixture-helper\n");
  const previous = process.env.GIT_CONFIG_GLOBAL;
  try {
    process.env.GIT_CONFIG_GLOBAL = configuration;
    assert.throws(() =>
      readReviewGit(snapshot.repository, ["config", "--get", "credential.helper"]),
    );
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
  assert.equal(verifyEvaluationSnapshot(entry, snapshot.repository), entry.head);
  assert.equal(
    verifyEvaluationSnapshot(
      { ...entry, targets: ["apps/mlb/page/js/app.js"] },
      snapshot.repository,
    ),
    entry.head,
  );
  assert.throws(() =>
    verifyEvaluationSnapshot({ ...entry, head: "f".repeat(40) }, snapshot.repository),
  );
  assert.throws(() =>
    verifyEvaluationSnapshot({ ...entry, head: fix, fix: base }, snapshot.repository),
  );
  assert.throws(() =>
    verifyEvaluationSnapshot(
      { ...entry, head: base, targets: ["apps/mlb/page/js/app.js"] },
      snapshot.repository,
    ),
  );
});

test("proof and trial workflows collect and upload failure evidence without another model attempt", () => {
  for (const [path, ids, collector, artifact] of [
    ["codex-runner-proof.yml", ["model"], "provecodex", "codex-proof-private"],
    ["provider-review-session.yml", ["codex", "claude"], "trial", "review-trial-private-"],
  ]) {
    const workflow = readRepoFile(`.github/workflows/${path}`);
    const steps = workflow.split("\n  model:\n")[1].split(/^ {6}- /m);
    for (const id of ids) {
      const model = steps.find((step) => new RegExp(`^ *id: ${id}$`, "m").test(step));
      assert.ok(model, `${path} ${id}`);
      assert.match(model, /continue-on-error: true/);
    }
    const checkout = steps.find((step) => /path: (?:controls|trial-validator)/.test(step));
    assert.match(checkout, /if: always\(\)/);
    const collect = steps.find((step) => /run: node .* collect/.test(step));
    assert.match(collect, /if: always\(\)/);
    assert.match(
      collect,
      collector === "trial"
        ? /MODEL_OUTCOME: .*steps.codex.outcome.*steps.claude.outcome/
        : /MODEL_OUTCOME: .*steps.model.outcome/,
    );
    const uploads = steps.filter((step) => step.includes("uses: actions/upload-artifact@"));
    assert.equal(uploads.length, 2);
    for (const upload of uploads) assert.match(upload, /if: always\(\)/);
    const encrypted = uploads.find((step) => step.includes(`name: ${artifact}`));
    assert.match(encrypted, /if-no-files-found: error/);
    assert.match(encrypted, /trial-private\/evidence.cms/);
    const claude = steps.find((step) => /id: claude/.test(step));
    if (claude)
      assert.match(
        claude,
        /timeout-minutes: \$\{\{ fromJSON\(needs.request.outputs.claude-timeout\) \}\}/,
      );
  }
});
