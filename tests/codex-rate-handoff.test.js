import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readNativeQuotaSource,
  selectCurrentQuotaJob,
  selectPreviousQuotaJob,
  validateQuotaHandoff,
  readNativeQuotaAdmission,
} from "../worker/codex-rate-handoff.mjs";
import { readNativeRatePolicyHash } from "../worker/codex-rate-policy.mjs";

const source = "a".repeat(40);
const start = Date.parse("2026-10-29T04:00:00Z");
const expected = {
  repository: "example/repo",
  repositoryId: 9,
  owner: "example",
  source,
  run: 30,
  portion: "1",
  token: "fake-github-token",
};

function createRun(id, created, status) {
  return {
    id,
    created_at: new Date(created).toISOString(),
    status,
    repository: { id: 9, full_name: "example/repo" },
    run_attempt: 1,
    path: ".github/workflows/provider-review-trial.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: source,
    actor: { login: "example" },
    triggering_actor: { login: "example" },
  };
}

/** @param {(fixture:any)=>void} [change] */
function createFixture(change = () => {}) {
  const current = createRun(30, start + 1000, "in_progress");
  const previous = createRun(12, start, "completed");
  const job = {
    id: 7,
    run_id: 30,
    run_attempt: 1,
    name: "investigate (1) / native-codex-1",
    status: "in_progress",
    conclusion: null,
    started_at: new Date(start + 100000).toISOString(),
    steps: [{ name: "Native Codex investigation", status: "queued", conclusion: null }],
  };
  const previousJob = {
    id: 4,
    run_id: 12,
    run_attempt: 1,
    name: "investigate (2) / native-codex-2",
    status: "completed",
    conclusion: "success",
    started_at: new Date(start + 10000).toISOString(),
    completed_at: new Date(start + 80000).toISOString(),
    steps: [{ name: "Native Codex investigation", status: "completed", conclusion: "success" }],
  };
  const record = {
    version: 1,
    repository: "example/repo",
    run: 12,
    job: 4,
    source,
    policy: readNativeRatePolicyHash(),
    finalized: true,
    termination: "parent-exited",
    namespacesRestored: true,
    runtimeRemoved: true,
    feedbackFailed: false,
    completedAt: start + 70000,
    notBefore: start + 180000,
    scanSince: start,
    activeRuns: [12, 30],
    reservedTokens: 100,
    observedTokens: null,
  };
  const artifact = {
    id: 5,
    name: "codex-rate-handoff-4",
    expired: false,
    created_at: new Date(start + 75000).toISOString(),
    workflow_run: { id: 12, repository_id: 9 },
  };
  const fixture = {
    current,
    previous,
    job,
    previousJob,
    record,
    artifact,
    calls: [],
    duplicate: false,
    tampered: false,
    archiveName: "cooldown.json",
    sourceTrusted: true,
    previousJobReads: 0,
    changedProducer: false,
    bootstrap: false,
    carriedRun: null,
    denied: false,
  };
  change(fixture);
  const archive = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      'import io,json,sys,zipfile\na=json.load(sys.stdin)\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z: z.writestr(a["name"],json.dumps(a["record"]))\nsys.stdout.buffer.write(b.getvalue())',
    ],
    {
      input: JSON.stringify({ name: fixture.archiveName, record }),
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  artifact.digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  artifact.size_in_bytes = archive.length;
  fixture.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    const query = new URL(url).searchParams;
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.headers.authorization, "Bearer fake-github-token");
    assert.equal(options.method ?? "GET", "GET");
    fixture.calls.push(path);
    if (path.endsWith("/git/ref/heads/main"))
      return Response.json({ object: { sha: "d".repeat(40) } });
    if (path.includes("/compare/")) {
      const base = path.split("/compare/")[1].split("...")[0];
      return Response.json({
        status: fixture.sourceTrusted ? "ahead" : "diverged",
        behind_by: fixture.sourceTrusted ? 0 : 1,
        merge_base_commit: { sha: base },
      });
    }
    if (path.includes("/commits/"))
      return Response.json({ commit: { committer: { date: new Date(start).toISOString() } } });
    if (path.endsWith("/runs/30")) return Response.json(current);
    if (path.endsWith("/runs/12")) return Response.json(previous);
    if (path.endsWith("/runs/40")) return Response.json(fixture.carriedRun.run);
    if (path.endsWith("/runs/40/jobs")) return Response.json({ jobs: [fixture.carriedRun.job] });
    if (path.endsWith("/runs/30/jobs")) return Response.json({ jobs: [job] });
    if (path.endsWith("/runs/12/jobs")) {
      fixture.previousJobReads++;
      return Response.json({
        jobs: [
          fixture.changedProducer && fixture.previousJobReads >= 3
            ? { ...previousJob, completed_at: new Date(start + 81000).toISOString() }
            : previousJob,
        ],
      });
    }
    if (path.includes("/workflows/") && path.endsWith("/runs")) {
      const runs = path.includes("provider-review-trial.yml")
        ? query.has("status")
          ? query.get("status") === "in_progress"
            ? [current]
            : []
          : [current, ...(fixture.bootstrap ? [] : [previous])]
        : [];
      return Response.json({ workflow_runs: runs });
    }
    if (path.endsWith("/runs/30/artifacts")) return Response.json({ artifacts: [] });
    if (path.endsWith("/artifacts")) {
      if (fixture.denied) return new Response("denied", { status: 403 });
      return Response.json({
        artifacts: fixture.bootstrap ? [] : fixture.duplicate ? [artifact, artifact] : [artifact],
      });
    }
    if (path.endsWith("/artifacts/5/zip"))
      return new Response(fixture.tampered ? Buffer.from("wrong archive") : archive);
    throw new Error(`Unexpected mocked quota read: ${path}`);
  };
  return fixture;
}

const admit = (fixture) =>
  readNativeQuotaAdmission(expected, {
    fetchImpl: fixture.fetchImpl,
    now: () => start + 110000,
  });

test("quota handoff authenticates original ZIP, producer, policy, source and server completion time", async () => {
  const fixture = createFixture();
  const result = await admit(fixture);
  assert.equal(result.predecessor, 4);
  assert.equal(result.job, 7);
  assert.equal(result.notBefore, start + 180000);
  assert.deepEqual(result.activeRuns, [30]);
  assert.equal(result.scanSince, start + 1000);
  assert.equal(fixture.record.observedTokens, null);
  assert.equal(fixture.previousJobReads, 3);
  fixture.record.notBefore = start + 130000;
  assert.equal(
    validateQuotaHandoff(
      fixture.record,
      {
        run: fixture.previous,
        job: fixture.previousJob,
        source,
      },
      expected,
      start + 110000,
    ).notBefore,
    start + 140000,
  );
});

test("first native consumer warms up an entire rolling window instead of starting with a fresh empty budget", async () => {
  const fixture = createFixture((f) => {
    f.bootstrap = true;
  });
  const result = await admit(fixture);
  assert.equal(result.predecessor, null);
  assert.equal(result.notBefore, start + 170000);
});

test("missing preceding quota state and older-created runs carried by the ledger cannot disappear", async () => {
  const fixture = createFixture((f) => {
    f.record.activeRuns.push(40);
    f.carriedRun = {
      run: createRun(40, start - 100000, "completed"),
      job: {
        ...f.previousJob,
        id: 6,
        run_id: 40,
        completed_at: new Date(start + 90000).toISOString(),
      },
    };
  });
  await assert.rejects(admit(fixture), /Missing or duplicate preceding/);
  assert.ok(fixture.calls.some((path) => path.endsWith("/runs/40/jobs")));
});

test("failed or interrupted independent producers retain quota without authorizing a model rerun", async () => {
  const fixture = createFixture((f) => {
    f.previousJob.conclusion = "failure";
    f.record.termination = "deadline";
  });
  assert.equal((await admit(fixture)).notBefore, start + 180000);
  fixture.current.run_attempt = 2;
  await assert.rejects(admit(fixture), /Untrusted/);
});

test("a later no-model publisher attempt preserves the original model job's quota record", async () => {
  const fixture = createFixture((f) => {
    f.previous.run_attempt = 2;
  });
  assert.equal((await admit(fixture)).predecessor, 4);
  fixture.previousJob.run_attempt = 2;
  await assert.rejects(admit(fixture), /terminal model producer/);
});

test("an older pinned current review imports quota from a later trusted-main producer", async () => {
  const fixture = createFixture((f) => {
    f.previous.head_sha = "b".repeat(40);
    f.record.source = "b".repeat(40);
  });
  const result = await admit(fixture);
  assert.equal(result.source, source);
  assert.equal(result.predecessor, 4);
  assert.ok(fixture.calls.some((path) => path.includes(`${"b".repeat(40)}...${"d".repeat(40)}`)));
});

test("foreign, expired, duplicate, tampered and unsafe quota artifacts reject", async () => {
  for (const change of [
    (f) => {
      f.artifact.workflow_run.repository_id = 10;
    },
    (f) => {
      f.artifact.expired = true;
    },
    (f) => {
      f.duplicate = true;
    },
    (f) => {
      f.tampered = true;
    },
    (f) => {
      f.archiveName = "../cooldown.json";
    },
    (f) => {
      f.artifact.created_at = new Date(start).toISOString();
    },
    (f) => {
      f.changedProducer = true;
    },
    (f) => {
      f.sourceTrusted = false;
    },
    (f) => {
      f.previous.actor.login = "other";
    },
    (f) => {
      f.previous.repository.id = 10;
    },
  ])
    await assert.rejects(admit(createFixture(change)));
});

test("missing Actions access remains an explicit pre-model permission failure", async () => {
  await assert.rejects(
    admit(
      createFixture((f) => {
        f.denied = true;
      }),
    ),
    (error) => error instanceof Error && "status" in error && error.status === 403,
  );
});

test("live quota source comes from the authenticated review marker rather than the PR head", () => {
  const run = createRun(12, start, "completed");
  Object.assign(run, {
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_sha: "b".repeat(40),
    display_title: `Review 2 head ${"b".repeat(40)} base ${"c".repeat(40)} source ${source} target main intent review`,
  });
  assert.equal(readNativeQuotaSource(run, expected), source);
  run.display_title = run.display_title.replace("target main", "target other");
  assert.throws(() => readNativeQuotaSource(run, expected));
});

test("ambiguous current jobs, overlap and a skipped Claude native step cannot count as a producer", () => {
  const fixture = createFixture();
  assert.throws(() => selectCurrentQuotaJob([fixture.job, fixture.job], 30, "1"));
  assert.throws(() => selectCurrentQuotaJob([fixture.job], 30, "unknown"));
  const candidate = { job: { ...fixture.previousJob, status: "in_progress" } };
  assert.throws(() => selectPreviousQuotaJob([candidate], fixture.job), /active/);
  candidate.job = { ...fixture.previousJob, completed_at: new Date(start + 120000).toISOString() };
  assert.throws(() => selectPreviousQuotaJob([candidate], fixture.job), /overlap/);
  candidate.job = {
    ...fixture.previousJob,
    steps: [{ name: "Native Codex investigation", status: "completed", conclusion: "skipped" }],
  };
  assert.equal(selectPreviousQuotaJob([candidate], fixture.job), null);
  candidate.job = { ...fixture.previousJob, status: "in_progress", steps: fixture.job.steps };
  assert.throws(() => selectPreviousQuotaJob([candidate], fixture.job), /admission is active/);
});

test("incomplete, future, wrong-policy or forged quota records reject", () => {
  const fixture = createFixture();
  const producer = { run: fixture.previous, job: fixture.previousJob, source };
  for (const change of [
    { finalized: false },
    { source: "b".repeat(40) },
    { job: 8 },
    { run: 40 },
    { policy: "b".repeat(64) },
    { observedTokens: -1 },
    { reservedTokens: -1 },
    { notBefore: start },
    { completedAt: start + 200000 },
    { scanSince: start + 1 },
    { activeRuns: [30, 30] },
    { activeRuns: ["30"] },
    { termination: "success" },
    { namespacesRestored: false },
    { runtimeRemoved: false },
    { feedbackFailed: true },
  ])
    assert.throws(() =>
      validateQuotaHandoff({ ...fixture.record, ...change }, producer, expected, start + 110000),
    );
});
