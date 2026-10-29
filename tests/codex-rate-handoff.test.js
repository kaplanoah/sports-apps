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
import {
  readNativeRatePolicyHash,
  createNativeAdmissionStepName,
} from "../worker/codex-rate-policy.mjs";

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

function packageQuotaRecord(record, name) {
  return execFileSync(
    "python3",
    [
      "-I",
      "-c",
      'import io,json,sys,zipfile\na=json.load(sys.stdin)\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z: z.writestr(a["name"],json.dumps(a["record"]))\nsys.stdout.buffer.write(b.getvalue())',
    ],
    {
      input: JSON.stringify({ name: name, record }),
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
}

/** @param {(fixture:any)=>void} [change] */
function createFixture(change = () => {}) {
  const current = createRun(30, start + 1000, "in_progress");
  const previous = createRun(12, start, "completed");
  const job = {
    id: 7,
    run_id: 30,
    run_attempt: 1,
    name: "investigate (1) / model",
    status: "in_progress",
    conclusion: null,
    started_at: new Date(start + 100000).toISOString(),
    steps: [
      { name: createNativeAdmissionStepName("1"), status: "in_progress", conclusion: null },
      { name: "Native Codex investigation", status: "queued", conclusion: null },
    ],
  };
  const previousJob = {
    id: 4,
    run_id: 12,
    run_attempt: 1,
    name: "investigate (2) / model",
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
    missingArtifacts: false,
    extraRuns: [],
    extraArtifacts: [],
    trailingArtifacts: [],
    ownProducer: null,
  };
  change(fixture);
  const archive = packageQuotaRecord(record, fixture.archiveName);
  const ownArchive = fixture.ownProducer
    ? packageQuotaRecord(fixture.ownProducer.record, "cooldown.json")
    : null;
  if (fixture.ownProducer) {
    fixture.ownProducer.artifact.digest = `sha256:${createHash("sha256").update(ownArchive).digest("hex")}`;
    fixture.ownProducer.artifact.size_in_bytes = ownArchive.length;
  }
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
    const extra = fixture.extraRuns.find((run) => path.endsWith(`/runs/${run.id}`));
    if (extra) return Response.json(extra);
    if (path.endsWith("/runs/30")) return Response.json(current);
    if (path.endsWith("/runs/12")) return Response.json(previous);
    if (path.endsWith("/runs/40")) return Response.json(fixture.carriedRun.run);
    if (path.endsWith("/runs/40/jobs")) return Response.json({ jobs: [fixture.carriedRun.job] });
    if (path.endsWith("/runs/30/jobs"))
      return Response.json({
        jobs: [...(fixture.ownProducer ? [fixture.ownProducer.job] : []), job],
      });
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
      const threshold = query.has("created")
        ? Date.parse(query.get("created").slice(2))
        : -Infinity;
      const extra = fixture.extraRuns.filter(
        (run) =>
          (!query.has("status") || run.status === query.get("status")) &&
          Date.parse(run.created_at) >= threshold,
      );
      return Response.json({ workflow_runs: [...extra, ...runs] });
    }
    if (path.endsWith("/runs/30/artifacts"))
      return Response.json({
        artifacts: fixture.ownProducer ? [fixture.ownProducer.artifact] : [],
      });
    if (path.endsWith("/artifacts")) {
      if (fixture.denied) return new Response("denied", { status: 403 });
      return Response.json({
        artifacts: [
          ...fixture.extraArtifacts,
          ...(fixture.bootstrap || fixture.missingArtifacts
            ? []
            : fixture.duplicate
              ? [artifact, artifact]
              : [artifact]),
          ...(fixture.ownProducer ? [fixture.ownProducer.artifact] : []),
          ...fixture.trailingArtifacts,
        ],
      });
    }
    if (fixture.ownProducer && path.endsWith(`/artifacts/${fixture.ownProducer.artifact.id}/zip`))
      return new Response(ownArchive);
    if (path.endsWith("/artifacts/5/zip"))
      return new Response(fixture.tampered ? Buffer.from("wrong archive") : archive);
    throw new Error(`Unexpected mocked quota read: ${path}`);
  };
  return fixture;
}

const admit = (fixture, now = start + 110000) =>
  readNativeQuotaAdmission(expected, {
    fetchImpl: fixture.fetchImpl,
    now: () => now,
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
  assert.equal(readNativeQuotaSource(run, expected), source);
  run.display_title = run.display_title.replace("intent review", "intent observe");
  assert.throws(() => readNativeQuotaSource(run, expected));
});

test("ambiguous current jobs, overlap and a skipped Claude native step cannot count as a producer", () => {
  const fixture = createFixture();
  assert.throws(() => selectCurrentQuotaJob([fixture.job, fixture.job], 30, "1"));
  assert.throws(() => selectCurrentQuotaJob([fixture.job], 30, "unknown"));
  for (const steps of [
    [],
    [{ name: createNativeAdmissionStepName("2"), status: "in_progress" }],
    [{ name: createNativeAdmissionStepName("1"), status: "completed" }],
  ])
    assert.throws(() => selectCurrentQuotaJob([{ ...fixture.job, steps }], 30, "1"));
  assert.equal(
    selectCurrentQuotaJob([{ ...fixture.job, name: "review-codex (shared page) / model" }], 30, "1")
      .id,
    fixture.job.id,
  );
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

test("aged policy changes, expired evidence and missing evidence recover through a full warm-up", async () => {
  const later = start + 800000;
  for (const change of [
    (fixture) => {
      fixture.record.policy = "b".repeat(64);
    },
    (fixture) => {
      fixture.artifact.expired = true;
    },
    (fixture) => {
      fixture.missingArtifacts = true;
    },
  ]) {
    await assert.rejects(admit(createFixture(change)));
    const result = await admit(createFixture(change), later);
    assert.equal(result.predecessor, 4);
    assert.equal(result.notBefore, later + 60000);
  }
  const retained = await admit(
    createFixture((fixture) => {
      fixture.record.policy = "b".repeat(64);
      fixture.record.notBefore = later + 900000;
    }),
    later,
  );
  assert.equal(retained.notBefore, later + 900000);
  await assert.rejects(
    admit(
      createFixture((fixture) => {
        fixture.duplicate = true;
      }),
      later,
    ),
    /duplicate/,
  );
});

test("untrusted PR-triggered artifacts and native-looking runs cannot poison global quota discovery", async () => {
  const fixture = createFixture((value) => {
    const forged = createRun(44, start + 500, "in_progress");
    forged.event = "pull_request";
    value.extraRuns.push(forged);
    value.extraArtifacts.push({
      ...value.artifact,
      id: 99,
      name: "codex-rate-handoff-99",
      workflow_run: { id: 44, repository_id: 9 },
    });
  });
  const result = await admit(fixture);
  assert.equal(result.predecessor, 4);
  assert.deepEqual(result.activeRuns, [30]);
  assert.equal(
    fixture.calls.some((path) => /runs\/44\/jobs|artifacts\/99\/zip/.test(path)),
    false,
  );
});

test("untrusted actor and repository runs are ignored without accepting their quota records", async () => {
  for (const change of [
    (fixture) => {
      fixture.previous.actor.login = "other";
    },
    (fixture) => {
      fixture.previous.repository.id = 10;
    },
  ]) {
    const result = await admit(createFixture(change));
    assert.equal(result.predecessor, null);
    assert.equal(result.notBefore, start + 170000);
  }
});

test("an aged old policy with a shorter window uses current warm-up instead of permanent rejection", async () => {
  const later = start + 800000;
  const result = await admit(
    createFixture((fixture) => {
      fixture.record.policy = "b".repeat(64);
      fixture.record.notBefore = fixture.record.completedAt + 10000;
    }),
    later,
  );
  assert.equal(result.notBefore, later + 60000);
});

test("an aged missing latest record cannot erase an earlier authenticated longer cooldown", async () => {
  const later = start + 800000;
  const deadline = later + 900000;
  const result = await admit(
    createFixture((fixture) => {
      fixture.record.notBefore = deadline;
      fixture.record.activeRuns.push(40);
      fixture.carriedRun = {
        run: createRun(40, start - 10000, "completed"),
        job: {
          ...fixture.previousJob,
          id: 8,
          run_id: 40,
          conclusion: "failure",
          completed_at: new Date(start + 90000).toISOString(),
        },
      };
    }),
    later,
  );
  assert.equal(result.predecessor, 8);
  assert.equal(result.notBefore, deadline);
});

test("aged expired seeds skip redundant reads while old queued recent consumers stay discoverable", async () => {
  const later = start + 800000;
  const cold = createFixture((fixture) => {
    fixture.artifact.expired = true;
    fixture.previous.updated_at = new Date(start + 95000).toISOString();
    fixture.trailingArtifacts.push({
      ...fixture.artifact,
      id: 99,
      workflow_run: { id: 44, repository_id: 9 },
    });
  });
  const result = await admit(cold, later);
  assert.equal(result.notBefore, later + 60000);
  assert.equal(
    cold.calls.some((path) => path.includes("/runs/44")),
    false,
  );
  assert.equal(cold.previousJobReads, 1);

  const queued = createFixture((fixture) => {
    fixture.artifact.expired = true;
    fixture.previous.created_at = new Date(start + 10000).toISOString();
    fixture.previous.updated_at = new Date(start + 95000).toISOString();
    fixture.job.started_at = new Date(later - 500).toISOString();
    const run = {
      ...createRun(40, start + 5000, "completed"),
      updated_at: new Date(later - 1000).toISOString(),
    };
    fixture.extraRuns.push(run);
    fixture.carriedRun = {
      run,
      job: {
        ...fixture.previousJob,
        id: 8,
        run_id: 40,
        started_at: new Date(later - 5000).toISOString(),
        completed_at: new Date(later - 1500).toISOString(),
      },
    };
  });
  await assert.rejects(admit(queued, later), /Missing or duplicate preceding/);
  assert.ok(queued.calls.some((path) => path.endsWith("/runs/40/jobs")));
});

test("an expired newest record does not hide an available older long cooldown", async () => {
  const later = start + 800000;
  const deadline = later + 900000;
  const fixture = createFixture((value) => {
    value.record.notBefore = deadline;
    value.previous.updated_at = new Date(start + 95000).toISOString();
    const run = {
      ...createRun(40, start + 5000, "completed"),
      updated_at: new Date(start + 95000).toISOString(),
    };
    value.extraRuns.push(run);
    value.carriedRun = {
      run,
      job: {
        ...value.previousJob,
        id: 8,
        run_id: 40,
        completed_at: new Date(start + 95000).toISOString(),
      },
    };
    value.extraArtifacts.push({
      ...value.artifact,
      id: 6,
      name: "codex-rate-handoff-8",
      expired: true,
      created_at: new Date(start + 90000).toISOString(),
      workflow_run: { id: 40, repository_id: 9 },
    });
  });
  assert.equal((await admit(fixture, later)).notBefore, deadline);
});

test("an active workflow with old update metadata cannot disappear from admission", async () => {
  const later = start + 800000;
  const fixture = createFixture((value) => {
    value.record.activeRuns.push(40);
    value.carriedRun = {
      run: {
        ...createRun(40, start + 5000, "in_progress"),
        updated_at: new Date(start + 6000).toISOString(),
      },
      job: {
        ...value.previousJob,
        id: 8,
        run_id: 40,
        status: "in_progress",
        conclusion: null,
        steps: [{ name: "Native Codex investigation", status: "in_progress", conclusion: null }],
      },
    };
  });
  await assert.rejects(admit(fixture, later), /active or unverifiable/);
});

test("an older current-workflow seed cannot hide a later aged global consumer's future cooldown", async () => {
  const later = start + 800000;
  const deadline = later + 900000;
  const fixture = createFixture((value) => {
    value.record.notBefore = deadline;
    value.previous.updated_at = new Date(start + 95000).toISOString();
    value.job.started_at = new Date(later - 500).toISOString();
    value.ownProducer = {
      job: {
        ...value.previousJob,
        id: 3,
        run_id: 30,
        name: "investigate (old) / model",
        completed_at: new Date(start + 60000).toISOString(),
      },
      artifact: {
        ...value.artifact,
        id: 6,
        name: "codex-rate-handoff-3",
        created_at: new Date(start + 55000).toISOString(),
        workflow_run: { id: 30, repository_id: 9 },
      },
      record: {
        ...value.record,
        run: 30,
        job: 3,
        completedAt: start + 50000,
        notBefore: start + 110000,
      },
    };
  });
  assert.equal((await admit(fixture, later)).notBefore, deadline);
});
