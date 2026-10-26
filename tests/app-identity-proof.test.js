import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishAppIdentityProof, validateAppProofTarget } from "../worker/test-review-app.mjs";

const SOURCE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MARKER = ".github/issue-809-app-identity-proof.md";

function createProofHarness() {
  const env = {
    GITHUB_REPOSITORY: "example/repository",
    GITHUB_REPOSITORY_OWNER: "example",
    GITHUB_ACTOR: "example",
    GITHUB_TRIGGERING_ACTOR: "example",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF:
      "example/repository/.github/workflows/trusted-review-app-test.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: SOURCE,
    GITHUB_SHA: SOURCE,
    GITHUB_RUN_ID: "41",
    GITHUB_RUN_ATTEMPT: "1",
    APP_PROOF_HEAD: HEAD,
    APP_PROOF_APPROVAL: "APPROVE_ONE_APP_IDENTITY_TEST",
    APP_PROOF_EXPECTED_ID: "7",
    TRUSTED_REVIEW_APP_ID: "7",
    TRUSTED_REVIEW_PUBLISHER_ENABLED: "",
    TRUSTED_CODEX_REVIEW_ENABLED: "",
    APP_PROOF_INSTALLATION: "17",
  };
  const metadata = {
    "": { full_name: "example/repository", default_branch: "main", fork: false },
    "/git/ref/heads/main": {
      ref: "refs/heads/main",
      object: { type: "commit", sha: SOURCE },
    },
    "/git/ref/heads/issue-809-app-identity-proof": {
      ref: "refs/heads/issue-809-app-identity-proof",
      object: { type: "commit", sha: HEAD },
    },
    [`/git/commits/${HEAD}`]: { sha: HEAD, parents: [{ sha: SOURCE }] },
    [`/compare/${SOURCE}...${HEAD}`]: {
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      commits: [{ sha: HEAD }],
      merge_base_commit: { sha: SOURCE },
      files: [{ filename: MARKER, status: "added" }],
    },
    [`/contents/${MARKER}?ref=${HEAD}`]: {
      type: "file",
      path: MARKER,
      encoding: "base64",
      content: Buffer.from("Issue #809 App identity proof only.\n").toString("base64"),
    },
  };
  const state = {
    env,
    metadata,
    pulls: /** @type {any[][]} */ ([[]]),
    checks: /** @type {any[][]} */ ([[]]),
    scope: { total_count: 1, repositories: [{ full_name: "example/repository" }] },
    reads: /** @type {string[]} */ ([]),
    writes: /** @type {any[]} */ ([]),
    created: /** @type {any} */ (null),
    changeCreated: /** @type {(check:any)=>void} */ (() => {}),
    changeObserved: /** @type {(check:any)=>void} */ (() => {}),
    readMetadata: async (path) => {
      state.reads.push(path);
      if (path.startsWith("/pulls?"))
        return structuredClone(
          state.pulls[Number(new URLSearchParams(path.split("?")[1]).get("page")) - 1] ?? [],
        );
      if (path.startsWith(`/commits/${HEAD}/check-runs?`))
        return {
          check_runs: structuredClone(
            state.checks[Number(new URLSearchParams(path.split("?")[1]).get("page")) - 1] ?? [],
          ),
        };
      if (!(path in state.metadata)) throw new Error(`Unexpected metadata path: ${path}`);
      return structuredClone(state.metadata[path]);
    },
    writeChecks: async (path, request = {}) => {
      if (request.method === "POST") {
        assert.equal(path, "/check-runs");
        state.writes.push(structuredClone(request));
        state.created = { ...request.body, id: 29, app: { id: 7 }, unexpected: "not evidence" };
        state.changeCreated(state.created);
        return structuredClone(state.created);
      }
      assert.equal(path, "/check-runs/29");
      const check = structuredClone(state.created);
      state.changeObserved(check);
      return check;
    },
    readInstallation: async () => structuredClone(state.scope),
  };
  return state;
}

/** @param {ReturnType<typeof createProofHarness>} state */
const publishProof = (state) =>
  publishAppIdentityProof(state.env, state.readMetadata, state.writeChecks, state.readInstallation);

test("unused marker-only target validates before any App token or write is needed", async () => {
  const state = createProofHarness();
  assert.deepEqual(await validateAppProofTarget(state.env, state.readMetadata), {
    repository: "example/repository",
    source: SOURCE,
    head: HEAD,
    app: 7,
  });
  assert.deepEqual(state.writes, []);
});

test("non-owner, foreign source, enabled flag, rerun and incomplete approval fail before API access", async () => {
  for (const [key, value] of [
    ["GITHUB_REPOSITORY", "../other/repository"],
    ["GITHUB_REPOSITORY_OWNER", "other"],
    ["GITHUB_ACTOR", "other"],
    ["GITHUB_TRIGGERING_ACTOR", "other"],
    ["GITHUB_REF", "refs/heads/beta"],
    ["GITHUB_REF", "refs/tags/main"],
    ["GITHUB_EVENT_NAME", "pull_request_target"],
    ["GITHUB_WORKFLOW_REF", "example/repository/.github/workflows/review.yml@refs/heads/main"],
    ["GITHUB_WORKFLOW_SHA", HEAD],
    ["GITHUB_SHA", "bad"],
    ["GITHUB_RUN_ID", ""],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["APP_PROOF_HEAD", SOURCE],
    ["APP_PROOF_HEAD", "bad"],
    ["APP_PROOF_APPROVAL", ""],
    ["TRUSTED_REVIEW_PUBLISHER_ENABLED", "true"],
    ["TRUSTED_REVIEW_PUBLISHER_ENABLED", "false"],
    ["TRUSTED_CODEX_REVIEW_ENABLED", "true"],
    ["TRUSTED_CODEX_REVIEW_ENABLED", "false"],
    ["TRUSTED_REVIEW_APP_ID", "8"],
    ["TRUSTED_REVIEW_APP_ID", "0"],
    ["TRUSTED_REVIEW_APP_ID", "07"],
  ]) {
    const state = createProofHarness();
    state.env[key] = value;
    await assert.rejects(
      validateAppProofTarget(state.env, state.readMetadata),
      /requires owner dispatch/,
      key,
    );
    assert.deepEqual(state.reads, [], key);
    assert.deepEqual(state.writes, [], key);
  }
});

test("changed main, ref, parent, code diff or marker content cannot become a proof target", async () => {
  const changes = [
    (data) => {
      data[""].full_name = "other/repository";
    },
    (data) => {
      data[""].default_branch = "beta";
    },
    (data) => {
      data[""].fork = true;
    },
    (data) => {
      data["/git/ref/heads/main"].object.sha = HEAD;
    },
    (data) => {
      data["/git/ref/heads/issue-809-app-identity-proof"].object.sha = SOURCE;
    },
    (data) => {
      data[`/git/commits/${HEAD}`].parents[0].sha = HEAD;
    },
    (data) => {
      data[`/git/commits/${HEAD}`].parents.push({ sha: HEAD });
    },
    (data) => {
      data[`/compare/${SOURCE}...${HEAD}`].ahead_by = 2;
    },
    (data) => {
      data[`/compare/${SOURCE}...${HEAD}`].files.push({
        filename: "worker/change.mjs",
        status: "added",
      });
    },
    (data) => {
      data[`/compare/${SOURCE}...${HEAD}`].files[0].status = "modified";
    },
    (data) => {
      data[`/compare/${SOURCE}...${HEAD}`].merge_base_commit.sha = HEAD;
    },
    (data) => {
      data[`/contents/${MARKER}?ref=${HEAD}`].content =
        Buffer.from("other content").toString("base64");
    },
  ];
  for (const change of changes) {
    const state = createProofHarness();
    change(state.metadata);
    await assert.rejects(publishProof(state), /marker-only commit/);
    assert.deepEqual(state.writes, []);
  }
});

test("all open PR and existing-check pages are inspected, including foreign/draft heads and merge commits", async () => {
  for (const collision of ["head", "merge", "check"]) {
    const state = createProofHarness();
    if (collision === "check") {
      state.checks = [
        Array.from({ length: 100 }, () => ({ name: "other" })),
        [{ name: "trusted-review", app: { id: 999 } }],
      ];
    } else {
      state.pulls = [
        Array.from({ length: 100 }, () => ({ head: { sha: SOURCE } })),
        [
          collision === "head"
            ? { draft: true, head: { sha: HEAD, repo: { full_name: "outsider/fork" } } }
            : { merge_commit_sha: HEAD },
        ],
      ];
    }
    await assert.rejects(publishProof(state), /open pull request|already has a trusted-review/);
    assert.ok(state.reads.some((path) => path.endsWith("page=2")));
    assert.deepEqual(state.writes, []);
  }
});

test("missing installation and broad token repository scope cannot write checks", async () => {
  for (const kind of ["missing", "extra", "foreign", "malformed"]) {
    const state = createProofHarness();
    if (kind === "missing") state.env.APP_PROOF_INSTALLATION = "";
    if (kind === "extra") state.scope.total_count = 2;
    if (kind === "foreign") state.scope.repositories[0].full_name = "example/other";
    if (kind === "malformed") state.scope.repositories = [];
    await assert.rejects(publishProof(state), /installation identity|repository alone/);
    assert.deepEqual(state.writes, []);
  }
});

test("post-mint target read failure stops without using cached preflight metadata", async () => {
  const state = createProofHarness();
  await validateAppProofTarget(state.env, state.readMetadata);
  state.metadata["/git/ref/heads/main"].object.sha = HEAD;
  await assert.rejects(publishProof(state), /marker-only commit/);
  assert.deepEqual(state.writes, []);
});

test("single App write creates only failure and evidence contains only safe identity fields", async () => {
  const state = createProofHarness();
  const evidence = await publishProof(state);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].body.conclusion, "failure");
  assert.equal(state.writes[0].body.head_sha, HEAD);
  assert.match(state.writes[0].body.output.summary, /No review was performed/);
  assert.deepEqual(evidence, {
    repository: "example/repository",
    source: SOURCE,
    head: HEAD,
    app: 7,
    installation: 17,
    check: 29,
    run: "41",
    conclusion: "failure",
  });
});

test("create and readback must both retain App identity, exact head and an explicit failure", async () => {
  for (const phase of ["changeCreated", "changeObserved"]) {
    for (const [key, value] of /** @type {[string,any][]} */ ([
      ["app", { id: 8 }],
      ["head_sha", SOURCE],
      ["name", "other"],
      ["external_id", "foreign"],
      ["status", "in_progress"],
      ["conclusion", "success"],
      ["conclusion", null],
      ["id", -1],
    ])) {
      const state = createProofHarness();
      state[phase] = (check) => {
        check[key] = value;
      };
      await assert.rejects(publishProof(state), /expected App-owned failing proof check/);
      assert.equal(state.writes.length, 1);
      assert.equal(state.writes[0].body.conclusion, "failure");
    }
  }
});

test("API failures stop without retries or additional writes", async () => {
  for (const phase of ["scope", "metadata", "create", "readback"]) {
    const state = createProofHarness();
    let calls = 0;
    const failRequest = async () => {
      calls += 1;
      throw new Error("Simulated API rejection");
    };
    const writeChecks = async (path, request) => {
      if ((phase === "create" && request?.method === "POST") || (phase === "readback" && !request))
        return failRequest();
      return state.writeChecks(path, request);
    };
    await assert.rejects(
      publishAppIdentityProof(
        state.env,
        phase === "metadata" ? failRequest : state.readMetadata,
        writeChecks,
        phase === "scope" ? failRequest : state.readInstallation,
      ),
      /Simulated API rejection/,
    );
    assert.equal(calls, 1);
    assert.equal(state.writes.length, phase === "readback" ? 1 : 0);
    if (phase === "readback") assert.equal(state.created.conclusion, "failure");
  }
});

test("fixture is manual-only, main-only, first-attempt and dependency-free with automatic token revocation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/trusted-review-app-test.yml", import.meta.url),
    "utf8",
  );
  const triggers = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /pull_request|workflow_run|schedule:|push:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github.actor == github.repository_owner/);
  assert.match(workflow, /github.triggering_actor == github.repository_owner/);
  assert.match(workflow, /github.run_attempt == 1/);
  assert.match(workflow, /environment: trusted-review-publisher/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read\n {2}pull-requests: read\n {2}checks: read/);
  assert.match(workflow, /repositories: \$\{\{ github.event.repository.name \}\}/);
  assert.match(workflow, /permission-checks: write/);
  assert.match(
    workflow,
    /TRUSTED_CODEX_REVIEW_ENABLED: \$\{\{ vars.TRUSTED_CODEX_REVIEW_ENABLED \}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /permission-(contents|statuses)|skip-token-revoke|npm |cache@|secrets: inherit/,
  );
  const publisher = readFileSync(
    new URL("../.github/workflows/publish-trusted-review.yml", import.meta.url),
    "utf8",
  );
  const tokenAction = publisher.match(/actions\/create-github-app-token@[0-9a-f]{40}/)[0];
  assert.ok(workflow.includes(tokenAction));
  assert.ok(workflow.indexOf("test-review-app.mjs validate") < workflow.indexOf(tokenAction));
  assert.equal(workflow.match(/secrets\.TRUSTED_REVIEW_APP_PRIVATE_KEY/g).length, 1);
});
