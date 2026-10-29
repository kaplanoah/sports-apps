import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GitHubError } from "../worker/github-api.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReviewRun, requireTrustedReviewAuthority } from "../worker/review-run.mjs";
import { readReviewIdentity } from "../worker/review-data.mjs";
import { readReviewArtifact } from "../worker/review-artifact.mjs";
import {
  createPublicationStamp,
  REVIEW_PUBLICATION_STAGES,
  selectPublicationPull,
  selectPublicationRun,
  validatePublicationJobs,
  validatePublicationEvidence,
} from "../worker/review-publication.mjs";
import {
  discoverPublicationHeads,
  reconcileReviewPublication,
} from "../worker/publish-trusted-review.mjs";
import { readRepoFile } from "./repo-files.js";
import { createTimelineAnswer } from "./timeline.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE = "c".repeat(40);
const SOURCE = "d".repeat(40);
const TREE = "e".repeat(40);
const TIP = "f".repeat(40);
const REPOSITORY = "example/repository";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** @param {Record<string,string>} files */
function createArchive(files) {
  return execFileSync(
    "python3",
    [
      "-I",
      "-c",
      "import io,json,sys,zipfile; buffer=io.BytesIO(); archive=zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED); [archive.writestr(name,text) for name,text in json.load(sys.stdin).items()]; archive.close(); sys.stdout.buffer.write(buffer.getvalue())",
    ],
    {
      input: JSON.stringify(files),
      env: { PATH: process.env.PATH },
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

function createHarness() {
  const env = {
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "pull_request_target",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: "1",
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/review.yml@refs/heads/main`,
    GITHUB_RUN_ID: "7",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: SOURCE,
    TRUSTED_REVIEW_APP_ID: "9",
    PUBLISH_HEAD: HEAD,
    PUBLISH_PHASE: "finish",
    GH_TOKEN: "read-token",
    RUNNER_TEMP: mkdtempSync(join(tmpdir(), "publication-test-")),
    PUBLISH_NEEDS: "",
  };
  const pull = {
    number: 1,
    state: "open",
    draft: false,
    user: { login: "example", type: "User" },
    head: { sha: HEAD },
    base: { sha: BASE, ref: "main", repo: { full_name: REPOSITORY, id: 1 } },
  };
  const run = {
    id: 7,
    run_attempt: 2,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_sha: HEAD,
    repository: { full_name: REPOSITORY, id: 1 },
    created_at: "2026-10-24T12:00:00Z",
    display_title: `Review 1 head ${HEAD} base ${BASE} source ${SOURCE} target main intent review`,
    status: "in_progress",
    conclusion: null,
  };
  const needs = Object.fromEntries(
    [
      "review-begin",
      "review-plan",
      "review-label",
      "review-area",
      "review-across",
      "review-post",
      "review",
    ].map((name) => [
      name,
      {
        result: ["review-label", "review-area", "review-across", "review-post"].includes(name)
          ? "skipped"
          : "success",
        outputs: {},
      },
    ]),
  );
  needs["review-plan"].outputs = { count: "0", labeled: "false", base: TIP };
  const jobs = Object.entries(needs).map(([name, state], index) => ({
    id: index + 20,
    name: name === "review-begin" ? "review-begin / publish" : name,
    run_id: 7,
    run_attempt: 1,
    status: "completed",
    conclusion: state.result,
  }));
  jobs.push({
    id: 40,
    name: "review-publish / publish",
    run_id: 7,
    run_attempt: 2,
    status: "in_progress",
    conclusion: null,
  });
  const identity = readReviewIdentity({
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_RUN_ID: "7",
    REVIEW_HEAD: HEAD,
    REVIEW_BASE: TIP,
    REVIEW_MERGE: MERGE,
    REVIEW_TRUSTED: SOURCE,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/review.yml@refs/heads/main`,
  });
  const result = JSON.stringify({ identity, tree: TREE, passed: true });
  const provenance = JSON.stringify({
    stage: "result",
    identity,
    files: { "result.json": sha256(result) },
  });
  const archive = createArchive({ "result.json": result, "provenance.json": provenance });
  const artifact = {
    id: 5,
    name: `trusted-review-passed-${TREE}`,
    workflow_run: { id: 7, repository_id: 1 },
    expired: false,
    size_in_bytes: archive.length,
    digest: `sha256:${sha256(archive)}`,
  };
  needs.review.outputs = { artifact: "5", digest: sha256(archive), tree: TREE };
  env.PUBLISH_NEEDS = JSON.stringify(needs);
  const state = {
    env,
    pull,
    run,
    needs,
    jobs,
    pulls: [pull],
    runs: [run],
    checks: [],
    writes: [],
    providerEvents: [],
    providerComments: [],
    archives: new Map([[5, archive]]),
    artifacts: [artifact],
    failWrites: false,
    commit: { sha: MERGE, tree: { sha: TREE }, parents: [{ sha: TIP }, { sha: HEAD }] },
    suites: null,
    changeWriteAnswer: (answer) => answer,
    async readGitHub(path) {
      if (path.startsWith("/issues/1/comments?")) return state.providerComments;
      if (path === "") return { full_name: REPOSITORY, id: 1 };
      if (path.startsWith("/pulls?")) return state.pulls;
      if (path === "/pulls/1") return state.pull;
      if (path.startsWith("/actions/workflows/")) return { workflow_runs: state.runs };
      if (path === "/actions/runs/7") return state.run;
      if (path.startsWith("/actions/runs/7/jobs?")) return { jobs: state.jobs };
      if (path.startsWith("/actions/runs/7/artifacts?")) return { artifacts: state.artifacts };
      if (path.startsWith("/actions/artifacts/"))
        return state.artifacts.find((item) => item.id === Number(path.split("/").at(-1)));
      if (path === `/git/commits/${MERGE}`) return state.commit;
      throw new Error(`Unexpected read: ${path}`);
    },
    async writeGitHub(path, request) {
      if (!request) {
        if (path.startsWith(`/commits/${HEAD}/check-suites?`))
          return {
            check_suites:
              state.suites ??
              (state.checks.length ? [{ id: 10, head_sha: HEAD, app: { id: 9 } }] : []),
          };
        if (path.startsWith("/check-suites/10/check-runs?")) return { check_runs: state.checks };
        throw new Error(`Unexpected check read: ${path}`);
      }
      if (state.failWrites) throw new Error("Publication permission denied");
      state.writes.push(structuredClone({ path, ...request }));
      let check = state.checks.find((item) => path === `/check-runs/${item.id}`);
      if (!check) {
        check = { id: 60, app: { id: 9 }, head_sha: HEAD };
        state.checks.push(check);
      }
      Object.assign(check, request.body);
      return state.changeWriteAnswer(structuredClone(check));
    },
    async fetchImpl(url) {
      if (url === "https://api.github.com/graphql")
        return Response.json(createTimelineAnswer(state.providerEvents));
      const id = Number(String(url).match(/artifacts\/(\d+)\/zip$/)?.[1]);
      assert.ok(state.archives.has(id));
      return new Response(state.archives.get(id));
    },
  };
  const readGitHub = state.readGitHub;
  state.readGitHub = async (path) => structuredClone(await readGitHub(path));
  return state;
}

test("current terminal validation accepts explicitly reused stages and records exact evidence", async () => {
  const state = createHarness();
  assert.deepEqual(await reconcileReviewPublication(state), { success: true });
  assert.deepEqual(
    state.writes.map((write) => write.body.conclusion),
    ["failure", "success"],
  );
  const evidence = JSON.parse(
    readFileSync(join(state.env.RUNNER_TEMP, "review-publication-evidence/decision.json"), "utf8"),
  );
  assert.equal(evidence.attempt, 2);
  assert.equal(evidence.producers.find((job) => job.name === "review").attempt, 1);
  assert.equal(evidence.artifact, 5);
  assert.equal(evidence.check, 60);
  assert.equal(evidence.base, TIP);
});

test("a newer failed producer cannot be rescued by an older passing result or start", async () => {
  for (const role of ["review-plan", "review", "review-begin"]) {
    const state = createHarness();
    state.jobs.push({
      ...state.jobs.find((job) => job.name.startsWith(role)),
      id: 99,
      run_attempt: 2,
      conclusion: "failure",
    });
    await assert.rejects(reconcileReviewPublication(state), /Producer attempt/);
    assert.ok(state.writes.every((write) => write.body.conclusion === "failure"));
  }
});

test("matrix review producers and label consumption must match the actual trusted plan", () => {
  const state = createHarness();
  state.needs["review-plan"].outputs = { count: "1", labeled: "true" };
  for (const name of ["review-label", "review-area", "review-across", "review-post"]) {
    state.needs[name].result = "success";
    const job = state.jobs.find((item) => item.name === name);
    job.conclusion = "success";
    if (name === "review-area") job.name = "review-area (Tooling) / find";
  }
  assert.equal(validatePublicationJobs(state.jobs, 2, state.needs).length, 7);
  state.needs["review-plan"].outputs.count = "2";
  assert.throws(() => validatePublicationJobs(state.jobs, 2, state.needs), /area jobs/);
  state.needs["review-plan"].outputs.count = "1";
  state.needs["review-label"].result = "failure";
  assert.throws(() => validatePublicationJobs(state.jobs, 2, state.needs), /review-label/);
});

test("Codex publication requires every fresh request, model and validation stage plus large-change integration", () => {
  const state = createHarness();
  state.needs["review-select"] = {
    result: "success",
    outputs: { provider: "codex", selection: "initial" },
  };
  state.needs["review-plan"].outputs = {
    count: "2",
    labeled: "false",
    base: TIP,
    provider: "codex",
    selection: "initial",
  };
  for (const name of ["review-codex", "review-codex-across", "review-post"])
    state.needs[name] = { result: "success", outputs: {} };
  state.jobs.find((job) => job.name === "review-post").conclusion = "success";
  state.jobs.push({
    id: 100,
    run_id: 7,
    name: "review-select",
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
  });
  let next = 101;
  for (const prefix of [
    "review-codex (shared page)",
    "review-codex (mlb Worker)",
    "review-codex-across",
  ])
    for (const stage of ["request", "model", "validate"]) {
      const nativeWorkflow = readFileSync(
        new URL("../.github/workflows/trusted-codex-review.yml", import.meta.url),
        "utf8",
      );
      const modelJob = nativeWorkflow.split("\n  model:\n")[1].split("\n  validate:\n")[0];
      const displayedModel = /^ {4}name: (.+)$/m.exec(modelJob)?.[1] ?? "model";
      state.jobs.push({
        id: next++,
        run_id: 7,
        name: `${prefix} / ${stage === "model" ? displayedModel : stage}`,
        run_attempt: 2,
        status: "completed",
        conclusion: "success",
      });
    }
  assert.ok(validatePublicationJobs(state.jobs, 2, state.needs).length > 0);
  for (const name of ["review-codex (shared page) / model", "review-codex-across / validate"])
    assert.throws(
      () =>
        validatePublicationJobs(
          state.jobs.filter((job) => job.name !== name),
          2,
          state.needs,
        ),
      /Codex producer/,
    );
  state.needs["review-codex-across"].result = "skipped";
  assert.throws(() => validatePublicationJobs(state.jobs, 2, state.needs), /review-codex-across/);
  state.needs["review-codex-across"].result = "success";
  state.needs["review-area"].result = "success";
  assert.throws(() => validatePublicationJobs(state.jobs, 2, state.needs), /review-area/);
});

test("a live owner provider switch invalidates a sealed legacy success on unchanged code", async () => {
  const state = createHarness();
  state.providerEvents = [
    {
      id: "LE_88",
      event: "labeled",
      actor: { login: "example" },
      label: { name: "review-provider:codex" },
    },
  ];
  await assert.rejects(reconcileReviewPublication(state), /Legacy result predates/);
  assert.ok(state.writes.every((write) => write.body.conclusion !== "success"));
});

test("a pinned initial Codex choice cannot inherit a legacy Claude approval", async () => {
  const state = createHarness();
  state.providerComments = [
    {
      user: { login: "github-actions[bot]" },
      body: '<!-- trusted-review-provider {"provider":"codex","selection":"initial"} -->\nChoice.',
    },
  ];
  await assert.rejects(reconcileReviewPublication(state), /Legacy result predates/);
});

test("holding a non-main check preserves the existing stacked-review pipeline", async () => {
  const state = createHarness();
  state.pull.base.ref = "stack";
  state.env.PUBLISH_PHASE = "begin";
  assert.deepEqual(await reconcileReviewPublication(state), { success: false });
  assert.equal(state.checks[0].conclusion, "failure");
  const reviewer = readRepoFile(".github/workflows/review.yml");
  assert.match(
    reviewer,
    /if: vars.TRUSTED_REVIEW_PUBLISHER_ENABLED == 'true' && github.event.pull_request.base.ref == 'main'/,
  );
  assert.match(
    reviewer,
    /github.event.pull_request.base.ref != 'main' \|\| needs.review-begin.result == 'success'/,
  );
  assert.throws(
    () =>
      requireTrustedReviewAuthority({
        ...state.env,
        GITHUB_REF: "refs/heads/stack",
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/review.yml@refs/heads/stack`,
      }),
    /authority/,
  );
});

test("current dependency failures, unexpected skips and foreign jobs hold publication", async () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const state = createHarness();
    state.needs.review.result = result;
    state.env.PUBLISH_NEEDS = JSON.stringify(state.needs);
    await assert.rejects(reconcileReviewPublication(state), /Required producer/);
    assert.equal(state.checks[0].conclusion, "failure");
  }
  const state = createHarness();
  state.jobs[0].run_id = 8;
  await assert.rejects(reconcileReviewPublication(state), /Foreign producer/);
});

test("colliding PRs, draft conversion and same-head retargeting withhold success", async () => {
  for (const change of [
    (state) => state.pulls.push({ ...state.pull, number: 2 }),
    (state) => {
      state.pull.draft = true;
    },
    (state) => {
      state.pull.base.ref = "other";
    },
  ]) {
    const state = createHarness();
    change(state);
    assert.deepEqual(await reconcileReviewPublication(state), { success: false });
    assert.ok(state.writes.every((write) => write.body.conclusion === "failure"));
  }
});

test("main contributions and cached PR base metadata cannot relabel the reviewed pair", async () => {
  for (const during of [false, true]) {
    const state = createHarness();
    if (!during) state.pull.base.sha = SOURCE;
    const original = state.readGitHub;
    state.readGitHub = async (path) => {
      const answer = await original(path);
      if (during && path.startsWith("/git/commits/")) state.pull.base.sha = SOURCE;
      return answer;
    };
    assert.deepEqual(await reconcileReviewPublication(state), { success: true });
    const evidence = JSON.parse(
      readFileSync(
        join(state.env.RUNNER_TEMP, "review-publication-evidence/decision.json"),
        "utf8",
      ),
    );
    assert.equal(evidence.base, TIP);
    assert.equal(evidence.merge, MERGE);
    assert.equal(evidence.tree, TREE);
    assert.equal(evidence.head, HEAD);
    assert.match(state.checks[0].output.summary, new RegExp(`base ${TIP}`));
    completePublication(state);
    assert.deepEqual(await reconcileReviewPublication(state), { success: true });
  }
});

test("a new requested review still owns publication after its event base changes", () => {
  const state = createHarness();
  const newer = {
    ...state.run,
    id: 8,
    created_at: "2026-10-24T13:00:00Z",
    display_title: state.run.display_title.replace(`base ${BASE}`, `base ${SOURCE}`),
  };
  assert.equal(
    selectPublicationRun([state.run, newer], state.pull, { name: REPOSITORY, id: 1 }).id,
    8,
  );
});

test("fresh metadata read catches a collision introduced during result validation", async () => {
  const state = createHarness();
  const original = state.readGitHub;
  state.readGitHub = async (path) => {
    const answer = await original(path);
    if (path.startsWith("/git/commits/")) state.pulls.push({ ...state.pull, number: 2 });
    return answer;
  };
  await assert.rejects(reconcileReviewPublication(state), /context changed/);
  assert.equal(state.checks[0].conclusion, "failure");
});

test("a context change inside the success write is invalidated rather than returned as success", async () => {
  for (const change of [
    (state) => {
      state.pull.head.sha = SOURCE;
    },
    (state) => {
      state.pull.base.ref = "other";
    },
    (state) => {
      state.run.run_attempt = 3;
    },
    (state) => {
      state.providerEvents.push({
        id: "LE_81",
        event: "labeled",
        label: { name: "review-provider:codex" },
        actor: { login: "example" },
      });
    },
  ]) {
    const state = createHarness();
    state.changeWriteAnswer = (answer) => {
      if (answer.conclusion === "success") change(state);
      return answer;
    };
    await assert.rejects(reconcileReviewPublication(state), /context changed/);
    assert.equal(state.checks[0].conclusion, "failure");
    assert.equal(
      existsSync(join(state.env.RUNNER_TEMP, "review-publication-evidence/decision.json")),
      false,
    );
  }
});

test("the latest original request owns the check; rerunning an older run cannot reclaim it", async () => {
  const state = createHarness();
  const newer = { ...state.run, id: 8, run_attempt: 1, created_at: "2026-10-24T13:00:00Z" };
  assert.equal(
    selectPublicationRun([state.run, newer], state.pull, { name: REPOSITORY, id: 1 }).id,
    8,
  );
  state.runs.push(newer);
  state.env.PUBLISH_PHASE = "begin";
  await assert.rejects(reconcileReviewPublication(state), /Superseded/);
  assert.equal(state.writes.length, 0);
});

test("reused start and cancellation observers invalidate old success without trusting old artifacts", async () => {
  for (const status of ["in_progress", "completed"]) {
    const state = createHarness();
    state.env.PUBLISH_PHASE = "observe";
    state.run.status = status;
    state.run.conclusion = status === "completed" ? "cancelled" : null;
    state.checks.push({
      id: 60,
      app: { id: 9 },
      head_sha: HEAD,
      name: "trusted-review",
      conclusion: "success",
    });
    await reconcileReviewPublication(state);
    assert.equal(state.checks[0].conclusion, "failure");
  }
});

test("a denied invalidation write reports failure and cannot promise to clear old success", async () => {
  const state = createHarness();
  state.env.PUBLISH_PHASE = "begin";
  state.checks.push({
    id: 60,
    app: { id: 9 },
    head_sha: HEAD,
    name: "trusted-review",
    conclusion: "success",
  });
  state.failWrites = true;
  await assert.rejects(reconcileReviewPublication(state), /permission denied/);
  assert.equal(state.checks[0].conclusion, "success");
});

test("duplicate same-App checks are all invalidated rather than choosing a convenient success", async () => {
  const state = createHarness();
  state.checks.push(
    ...[60, 61].map((id) => ({
      id,
      app: { id: 9 },
      head_sha: HEAD,
      name: "trusted-review",
      conclusion: "success",
    })),
  );
  await assert.rejects(reconcileReviewPublication(state), /Multiple App-owned/);
  assert.ok(state.checks.every((check) => check.conclusion === "failure"));
});

/** @param {any} state @param {(decision:any)=>void} [change] */
function completePublication(state, change) {
  const decision = JSON.parse(
    readFileSync(join(state.env.RUNNER_TEMP, "review-publication-evidence/decision.json"), "utf8"),
  );
  change?.(decision);
  const archive = createArchive({ "decision.json": JSON.stringify(decision) });
  state.archives.set(6, archive);
  state.artifacts.push({
    id: 6,
    name: "trusted-review-publication-2",
    workflow_run: { id: 7, repository_id: 1 },
    expired: false,
    digest: `sha256:${sha256(archive)}`,
    size_in_bytes: archive.length,
  });
  state.jobs.at(-1).status = "completed";
  state.jobs.at(-1).conclusion = "success";
  state.run.status = "completed";
  state.run.conclusion = "success";
  state.env.PUBLISH_PHASE = "observe";
  state.env.GITHUB_RUN_ID = "88";
}

test("an observer invalidates each observed context change before or after restoring success", async () => {
  for (const changedRead of [2, 3]) {
    const state = createHarness();
    await reconcileReviewPublication(state);
    completePublication(state);
    const original = state.readGitHub;
    let contexts = 0;
    state.readGitHub = async (path) => {
      if (path.startsWith("/pulls?")) {
        contexts++;
        if (contexts === changedRead) state.pull.base.ref = "other";
      }
      return original(path);
    };
    await assert.rejects(reconcileReviewPublication(state), /context changed/);
    assert.equal(state.checks[0].conclusion, "failure");
    assert.equal(state.checks[0].output.title, "Review context changed during publication");
  }
});

test("verification outages are reported truthfully and failed invalidation preserves the original error", async () => {
  for (const changedRead of ["producer", 2, 3]) {
    for (const failHold of [false, true]) {
      const state = createHarness();
      await reconcileReviewPublication(state);
      completePublication(state);
      const originalRead = state.readGitHub;
      const originalWrite = state.writeGitHub;
      const failure = new GitHubError(503, "GET publication context");
      let contexts = 0;
      state.readGitHub = async (path) => {
        if (changedRead === "producer" && path.startsWith("/actions/runs/7/jobs?")) throw failure;
        if (path.startsWith("/pulls?") && ++contexts === changedRead) throw failure;
        return originalRead(path);
      };
      state.writeGitHub = async (path, request) => {
        if (failHold && request?.body?.conclusion === "failure")
          throw new Error("Hold unavailable");
        return originalWrite(path, request);
      };
      await assert.rejects(reconcileReviewPublication(state), (error) => error === failure);
      if (!failHold) {
        assert.equal(state.checks[0].conclusion, "failure");
        assert.equal(
          state.checks[0].output.title,
          changedRead === "producer"
            ? "Trusted publication evidence is unavailable"
            : "Publication could not be re-verified",
        );
      }
    }
  }
});

test("ordinary label events revalidate the authenticated terminal evidence without resetting its owner", async () => {
  const state = createHarness();
  await reconcileReviewPublication(state);
  completePublication(state);
  await reconcileReviewPublication(state);
  assert.equal(state.checks[0].conclusion, "success");
  state.run.run_attempt = 3;
  await assert.rejects(reconcileReviewPublication(state), /current terminal/);
  assert.equal(state.checks[0].conclusion, "failure");
});

test("only authenticated Dependabot identity gets an explicit unreviewed exemption", async () => {
  const state = createHarness();
  state.pull.user = { login: "dependabot[bot]", type: "Bot" };
  state.runs = [];
  assert.deepEqual(await reconcileReviewPublication(state), { success: true, exempt: true });
  assert.match(state.checks[0].output.title, /not required for Dependabot/);
  state.pull.user.type = "User";
  assert.deepEqual(await reconcileReviewPublication(state), { success: false });
});

test("counterfeit terminal artifacts cannot be laundered into success without an App-owned stamp", async () => {
  for (const tamper of ["missing stamp", "modified decision"]) {
    const state = createHarness();
    await reconcileReviewPublication(state);
    completePublication(
      state,
      tamper === "modified decision"
        ? (decision) => {
            decision.needs["review-plan"].outputs.stage = "forged";
          }
        : undefined,
    );
    if (tamper === "missing stamp") state.checks[0].output.text = "";
    await assert.rejects(reconcileReviewPublication(state), /App-owned attestation/);
    assert.equal(state.checks[0].conclusion, "failure");
  }
});

test("direct publication binds claimed source to native main workflow authority", async () => {
  const state = createHarness();
  state.env.GITHUB_SHA = BASE;
  await assert.rejects(reconcileReviewPublication(state), /native trusted workflow/);
  assert.equal(state.writes.length, 0);
});

test("discovery reconciles both old and new heads and authenticates lifecycle source", async () => {
  const state = createHarness();
  assert.deepEqual(
    await discoverPublicationHeads(
      { action: "synchronize", before: BASE, pull_request: state.pull },
      state.env,
      state.readGitHub,
    ),
    [HEAD, BASE],
  );
  state.env.GITHUB_EVENT_NAME = "workflow_run";
  assert.deepEqual(
    await discoverPublicationHeads({ workflow_run: { id: 7 } }, state.env, state.readGitHub),
    [HEAD],
  );
  state.run.event = "pull_request";
  await assert.rejects(
    discoverPublicationHeads({ workflow_run: { id: 7 } }, state.env, state.readGitHub),
    /Untrusted/,
  );
  assert.throws(
    () => requireTrustedReviewAuthority({ ...state.env, GITHUB_REF: "refs/pull/1/merge" }),
    /authority/,
  );
});

test("run metadata separates pre-job review ownership from ordinary events and historical evidence", () => {
  const state = createHarness();
  assert.equal(readReviewRun(state.run).intent, "review");
  assert.equal(
    readReviewRun({
      ...state.run,
      display_title: state.run.display_title.replace("intent review", "intent observe"),
    }).intent,
    "observe",
  );
  assert.equal(
    readReviewRun({
      ...state.run,
      display_title: state.run.display_title.replace(" target main intent review", ""),
    }).intent,
    undefined,
  );
  assert.equal(readReviewRun({ ...state.run, event: "pull_request" }), null);
  assert.equal(
    selectPublicationPull(
      [state.pull, { ...state.pull, number: 2, draft: true }],
      HEAD,
      REPOSITORY,
    ),
    null,
  );
  assert.throws(() => validatePublicationJobs(state.jobs, 0, state.needs), /attempt/);
});

test("artifact reading rejects foreign provenance, unexpected ZIP members, digest changes and oversized data", async () => {
  const state = createHarness();
  const artifact = state.artifacts[0];
  const options = {
    repository: REPOSITORY,
    repositoryId: 1,
    run: 7,
    token: "read-token",
    names: ["result.json", "provenance.json"],
    fetchImpl: state.fetchImpl,
  };
  const folder = await readReviewArtifact(artifact, options);
  rmSync(folder, { recursive: true, force: true });
  await assert.rejects(
    readReviewArtifact({ ...artifact, workflow_run: { id: 8 } }, options),
    /provenance/,
  );
  await assert.rejects(
    readReviewArtifact({ ...artifact, digest: `sha256:${"f".repeat(64)}` }, options),
    /digest mismatch/,
  );
  for (const files of [
    { "../result.json": "{}", "provenance.json": "{}" },
    { "result.json": "x".repeat(65537), "provenance.json": "{}" },
  ]) {
    const archive = createArchive(files);
    state.archives.set(5, archive);
    await assert.rejects(
      readReviewArtifact({ ...artifact, digest: `sha256:${sha256(archive)}` }, options),
    );
  }
});

test("reusable publisher requires only its named environment secret", () => {
  const publisher = readRepoFile(".github/workflows/publish-trusted-review.yml");
  const contract = publisher.split("  workflow_call:\n")[1].split("\npermissions:")[0];
  assert.equal(
    contract.match(/^ {4}secrets:\n((?: {6}.+\n)+)/m)?.[1],
    "      TRUSTED_REVIEW_APP_PRIVATE_KEY:\n        required: true\n",
  );
});

for (const [path, job] of [
  [".github/workflows/review.yml", "review-begin"],
  [".github/workflows/review.yml", "review-publish"],
  [".github/workflows/trusted-review-publisher.yml", "reconcile"],
]) {
  test(`${job} passes only the named publisher environment secret`, () => {
    const workflow = readRepoFile(path);
    const caller = workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
    assert.match(caller, /^ {4}uses: \.\/\.github\/workflows\/publish-trusted-review\.yml$/m);
    assert.equal(
      caller.match(/^ {4}secrets:\n((?: {6}.+\n)+)/m)?.[1],
      "      TRUSTED_REVIEW_APP_PRIVATE_KEY: ${{ secrets.TRUSTED_REVIEW_APP_PRIVATE_KEY }}\n",
    );
  });
}

test("publisher workflows keep credentials isolated, token scope explicit, and model stages unchanged", () => {
  const publisher = readRepoFile(".github/workflows/publish-trusted-review.yml");
  const observer = readRepoFile(".github/workflows/trusted-review-publisher.yml");
  const reviewer = readRepoFile(".github/workflows/review.yml");
  assert.match(publisher, /environment: trusted-review-publisher/);
  assert.match(publisher, /permission-checks: write/);
  assert.match(publisher, /repositories: \$\{\{ github.event.repository.name \}\}/);
  assert.doesNotMatch(
    publisher,
    /skip-token-revoke|secrets: inherit|npm |npx |actions\/cache|pull_request.head/,
  );
  assert.match(observer, /types: \[requested, in_progress, completed\]/);
  assert.match(observer, /converted_to_draft/);
  const finalNeeds = reviewer.split("  review-publish:")[1].match(/needs:\s+\[([^\]]+)\]/)[1];
  assert.deepEqual(
    finalNeeds
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    REVIEW_PUBLICATION_STAGES,
  );
  assert.match(reviewer, /TRUSTED_REVIEW_PUBLISHER_ENABLED != 'true'/);
  assert.equal([...reviewer.matchAll(/uses: anthropics\//g)].length, 1);
  assert.match(publisher, /group: trusted-review-publication-/);
  assert.match(publisher, /cancel-in-progress: false\n\s+queue: max/);
});

test("authenticated upload outputs, artifact names and merge metadata are mandatory", async () => {
  for (const [change, message] of /** @type {[(state:any)=>void, RegExp][]} */ ([
    [(state) => delete state.needs.review.outputs.artifact, /authenticated review upload/],
    [(state) => delete state.needs.review.outputs.digest, /authenticated review upload/],
    [
      (state) => {
        state.artifacts[0].name = "renamed";
      },
      /Unexpected review result artifact/,
    ],
    [
      (state) => {
        state.commit.sha = SOURCE;
      },
      /merge parents or tree/,
    ],
    [
      (state) => {
        state.commit.tree.sha = SOURCE;
      },
      /merge parents or tree/,
    ],
    [
      (state) => {
        state.commit.parents.reverse();
      },
      /merge parents or tree/,
    ],
    [
      (state) => {
        state.commit.parents.pop();
      },
      /merge parents or tree/,
    ],
    [
      (state) => {
        state.commit.parents[0].sha = BASE;
      },
      /merge parents or tree/,
    ],
    [
      (state) => {
        delete state.needs["review-plan"].outputs.base;
      },
      /Missing reviewed base/,
    ],
    [
      (state) => {
        state.needs["review-plan"].outputs.base = BASE;
      },
      /stale or foreign artifact/,
    ],
  ])) {
    const state = createHarness();
    change(state);
    state.env.PUBLISH_NEEDS = JSON.stringify(state.needs);
    await assert.rejects(reconcileReviewPublication(state), message);
    assert.ok(state.writes.every((write) => write.body.conclusion === "failure"));
  }
});

test("foreign check suites and checks cannot supply publisher identity", async () => {
  for (const [level, field, value, message] of /** @type {[string,string,any,RegExp][]} */ ([
    ["suite", "app", { id: 8 }, /Foreign publisher check suite/],
    ["suite", "head_sha", BASE, /Foreign publisher check suite/],
    ["suite", "id", null, /Foreign publisher check suite/],
    ["check", "app", { id: 8 }, /Foreign publisher check\./],
    ["check", "head_sha", BASE, /Foreign publisher check\./],
    ["check", "id", null, /Invalid publisher check ID/],
  ])) {
    const state = createHarness();
    state.suites = [{ id: 10, head_sha: HEAD, app: { id: 9 } }];
    state.checks = [{ id: 60, head_sha: HEAD, app: { id: 9 }, name: "trusted-review" }];
    (level === "suite" ? state.suites[0] : state.checks[0])[field] = value;
    await assert.rejects(reconcileReviewPublication(state), message);
    assert.equal(state.writes.length, 0);
  }
});

test("publication must confirm App, head, name, conclusion and stable check ID", async () => {
  for (const existing of [false, true]) {
    for (const [field, value] of /** @type {[string,any][]} */ ([
      ["app", { id: 8 }],
      ["head_sha", BASE],
      ["name", "other"],
      ["conclusion", "success"],
      ["id", null],
      ...(existing ? [["id", 61]] : []),
    ])) {
      const state = createHarness();
      state.env.PUBLISH_PHASE = "begin";
      if (existing)
        state.checks = [{ id: 60, head_sha: HEAD, app: { id: 9 }, name: "trusted-review" }];
      state.changeWriteAnswer = (answer) => ({ ...answer, [field]: value });
      await assert.rejects(reconcileReviewPublication(state), /did not confirm/);
      assert.equal(
        existsSync(join(state.env.RUNNER_TEMP, "review-publication-evidence/decision.json")),
        false,
      );
    }
  }
});

test("freshness binds the latest attempt, head, target, provider and exemption without shared API references", async () => {
  for (const change of [
    (state) => {
      state.run.run_attempt = 3;
    },
    (state) => {
      state.pull.head.sha = SOURCE;
    },
    (state) => {
      state.pull.base.ref = "other";
    },
    (state) => {
      state.providerEvents.push({
        id: "LE_81",
        event: "labeled",
        label: { name: "review-provider:codex" },
        actor: { login: "example", type: "User" },
      });
    },
    (state) => {
      state.providerComments.push({
        user: { login: "github-actions[bot]" },
        body: '<!-- trusted-review-provider {"provider":"codex","selection":"initial"} -->\n',
      });
    },
    (state) => {
      state.pull.user = { login: "dependabot[bot]", type: "Bot" };
    },
  ]) {
    const state = createHarness();
    const original = state.readGitHub;
    state.readGitHub = async (path) => {
      const answer = await original(path);
      if (path.startsWith("/git/commits/")) change(state);
      return answer;
    };
    await assert.rejects(reconcileReviewPublication(state), /context changed/);
    assert.ok(state.writes.every((write) => write.body.conclusion === "failure"));
  }
});

test("even App-attested terminal result fields must match the authenticated upload", async () => {
  for (const key of ["artifact", "digest", "merge", "tree"]) {
    const state = createHarness();
    await reconcileReviewPublication(state);
    completePublication(state, (decision) => {
      decision[key] = key === "artifact" ? 99 : "f".repeat(40);
      state.checks[0].output.text = createPublicationStamp(decision);
    });
    await assert.rejects(reconcileReviewPublication(state), /Terminal result evidence changed/);
    assert.equal(state.checks[0].conclusion, "failure");
  }
});

test("even a re-attested decision cannot substitute its plan base for the sealed reviewed base", async () => {
  const state = createHarness();
  await reconcileReviewPublication(state);
  completePublication(state, (decision) => {
    decision.base = BASE;
    decision.needs["review-plan"].outputs.base = BASE;
    state.checks[0].output.text = createPublicationStamp(decision);
  });
  await assert.rejects(reconcileReviewPublication(state), /stale or foreign artifact/);
  assert.equal(state.checks[0].conclusion, "failure");
});

test("same-head retargeting reconciles under default-branch authority", async () => {
  const state = createHarness();
  await reconcileReviewPublication(state);
  state.pull.base.ref = "other";
  state.env.GITHUB_WORKFLOW_REF = `${REPOSITORY}/.github/workflows/trusted-review-publisher.yml@refs/heads/main`;
  state.env.PUBLISH_PHASE = "observe";
  assert.deepEqual(
    await discoverPublicationHeads(
      { action: "edited", pull_request: state.pull },
      state.env,
      state.readGitHub,
    ),
    [HEAD],
  );
  await reconcileReviewPublication(state);
  assert.equal(state.checks[0].conclusion, "failure");
  assert.equal(state.env.GITHUB_REF, "refs/heads/main");
});

test("run title bounds base names without changing main eligibility", () => {
  const workflow = readRepoFile(".github/workflows/review.yml");
  assert.match(workflow, /github.event.pull_request.base.ref == 'main' && 'main' \|\| 'other'/);
  assert.doesNotMatch(workflow.split("\n")[1], /\$\{\{ github.event.pull_request.base.ref \}\}/);
  const state = createHarness();
  state.run.display_title = state.run.display_title.replace("target main", "target other");
  assert.equal(readReviewRun(state.run).target, "other");
  assert.equal(
    readReviewRun({
      ...state.run,
      display_title: state.run.display_title.replace("target other", "target arbitrary"),
    }),
    null,
  );
  assert.equal(selectPublicationRun([state.run], state.pull, { name: REPOSITORY, id: 1 }), null);
});

/** @param {"symlink"|"encrypted"} kind */
function createUnsafeArchive(kind) {
  const archive = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      `
import io,stat,sys,zipfile
buffer=io.BytesIO()
with zipfile.ZipFile(buffer, 'w') as archive:
    entry=zipfile.ZipInfo('result.json')
    entry.create_system=3
    entry.external_attr=(stat.S_IFLNK|0o777)<<16 if sys.argv[1]=='symlink' else (stat.S_IFREG|0o644)<<16
    archive.writestr(entry,'{}')
sys.stdout.buffer.write(buffer.getvalue())
`,
      kind,
    ],
    { env: { PATH: process.env.PATH } },
  );
  if (kind === "encrypted") {
    archive.writeUInt16LE(archive.readUInt16LE(6) | 1, 6);
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt16LE(archive.readUInt16LE(central + 8) | 1, central + 8);
  }
  return archive;
}

test("unsafe ZIP members are rejected and rejected extraction leaves no temporary folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "rejected-archive-test-"));
  try {
    for (const kind of /** @type {const} */ (["symlink", "encrypted"])) {
      const archive = createUnsafeArchive(kind);
      const artifact = {
        id: 5,
        workflow_run: { id: 7, repository_id: 1 },
        size_in_bytes: archive.length,
        digest: `sha256:${sha256(archive)}`,
      };
      const script = `
        import { readReviewArtifact } from ${JSON.stringify(new URL("../worker/review-artifact.mjs", import.meta.url).href)};
        const archive = Buffer.from(${JSON.stringify(archive.toString("base64"))}, "base64");
        try {
          await readReviewArtifact(${JSON.stringify(artifact)}, {
            repository: "example/repository", repositoryId: 1, run: 7, token: "read-token", names: ["result.json"],
            fetchImpl: async () => new Response(archive),
          });
          throw new Error("Unsafe ZIP was accepted");
        } catch (error) {
          if (!String(error.stderr).includes("Unsafe or oversized artifact member")) throw error;
        }
      `;
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { PATH: process.env.PATH, TMPDIR: root },
        stdio: "pipe",
      });
      assert.deepEqual(readdirSync(root), [], kind);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("App-attested identity and exact producer attempts still bind terminal evidence", async () => {
  for (const [key, value] of /** @type {[string,any][]} */ ([
    ["version", 2],
    ["repository", "other/repository"],
    ["repositoryId", 2],
    ["pull", 2],
    ["head", BASE],
    ["base", HEAD],
    ["target", "other"],
    ["source", BASE],
    ["run", 8],
    ["attempt", 1],
    ["producers", []],
  ])) {
    const state = createHarness();
    await reconcileReviewPublication(state);
    completePublication(state, (decision) => {
      decision[key] = value;
      assert.throws(
        () => validatePublicationEvidence(state.pull, state.run, decision, state.jobs),
        /Stale or foreign publication evidence|Publication producer attempts changed/,
      );
      state.checks[0].output.text = createPublicationStamp(decision);
    });
    await assert.rejects(
      reconcileReviewPublication(state),
      /Stale or foreign publication evidence|Publication producer attempts changed|App-owned attestation/,
    );
    assert.equal(state.checks[0].conclusion, "failure");
  }
});

test("observer producer-read failure invalidates previously successful publication", async () => {
  const state = createHarness();
  await reconcileReviewPublication(state);
  completePublication(state);
  state.jobs[0].run_id = 8;
  await assert.rejects(reconcileReviewPublication(state), /Foreign producer job/);
  assert.equal(state.checks[0].conclusion, "failure");
});
