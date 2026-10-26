import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { publishIssuerProof, validateIssuerProof } from "../worker/test-review-issuer.mjs";

const SOURCE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE = "c".repeat(40);
const REPOSITORY = "example/repository";
const BASE_REF = "issue-809-issuer-base";
const HEAD_REF = "issue-809-issuer-head";
const MARKER = ".github/issue-809-issuer-proof.md";
const TEXT = "Issue #809 isolated issuer proof only.\n";
const EXTERNAL = `issue-809-issuer:${SOURCE}:${HEAD}`;

/** @param {'fail'|'pass'|'reset'} [phase] */
function createFixture(phase = "fail") {
  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_OWNER: "example",
    GITHUB_ACTOR: "example",
    GITHUB_TRIGGERING_ACTOR: "example",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/trusted-review-issuer-test.yml@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: SOURCE,
    GITHUB_SHA: SOURCE,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "100",
    ISSUER_SOURCE: SOURCE,
    ISSUER_HEAD: HEAD,
    ISSUER_PULL: "7",
    ISSUER_RULESET: "8",
    ISSUER_RULESET_SNAPSHOT: "",
    ISSUER_PHASE: phase,
    ISSUER_CHECK: phase === "fail" ? "0" : "91",
    ISSUER_ACTIONS_CHECK: phase === "fail" ? "0" : "92",
    ISSUER_APPROVAL: "APPROVE_ISOLATED_ISSUER_PROTOCOL",
    ISSUER_EXPECTED_APP: "23",
    TRUSTED_REVIEW_APP_ID: "23",
  };
  const rule = {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: "trusted-review", integration_id: 23 }],
    },
  };
  const pull = {
    number: 7,
    state: "open",
    draft: phase === "fail",
    mergeable: true,
    mergeable_state: "blocked",
    merge_commit_sha: MERGE,
    base: { ref: BASE_REF, sha: SOURCE, repo: { full_name: REPOSITORY } },
    head: { ref: HEAD_REF, sha: HEAD, repo: { full_name: REPOSITORY } },
  };
  const previous = phase === "reset" ? "pass" : "fail";
  const record = {
    schema: "issue-809-issuer-proof/v1",
    phase: previous,
    source: SOURCE,
    head: HEAD,
    pull: 7,
    ruleset: 8,
    rulesetDigest: "",
    run: "99",
  };
  const owned = {
    id: 91,
    app: { id: 23 },
    name: "trusted-review",
    head_sha: HEAD,
    status: "completed",
    conclusion: previous === "pass" ? "success" : "failure",
    external_id: EXTERNAL,
    output: { text: JSON.stringify(record) },
  };
  const actions = {
    id: 92,
    app: { id: 15368 },
    name: "trusted-review",
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
  };
  const data = {
    "": { full_name: REPOSITORY, default_branch: "main", fork: false },
    "/git/ref/heads/main": { ref: "refs/heads/main", object: { type: "commit", sha: SOURCE } },
    [`/git/ref/heads/${BASE_REF}`]: {
      ref: `refs/heads/${BASE_REF}`,
      object: { type: "commit", sha: SOURCE },
    },
    [`/git/ref/heads/${HEAD_REF}`]: {
      ref: `refs/heads/${HEAD_REF}`,
      object: { type: "commit", sha: HEAD },
    },
    [`/git/commits/${HEAD}`]: { sha: HEAD, parents: [{ sha: SOURCE }] },
    [`/compare/${SOURCE}...${HEAD}`]: {
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      merge_base_commit: { sha: SOURCE },
      commits: [{ sha: HEAD }],
      files: [{ filename: MARKER, status: "added" }],
    },
    [`/contents/${MARKER}?ref=${HEAD}`]: {
      type: "file",
      path: MARKER,
      encoding: "base64",
      content: Buffer.from(TEXT).toString("base64"),
    },
    "/pulls/7": pull,
    "/rulesets/8": {
      id: 8,
      name: "Issue 809 issuer proof",
      target: "branch",
      enforcement: "active",
      source_type: "Repository",
      source: REPOSITORY,
      current_user_can_bypass: "never",
      updated_at: "2026-01-01T10:00:00Z",
      bypass_actors: [],
      conditions: { ref_name: { include: [`refs/heads/${BASE_REF}`], exclude: [] } },
      rules: [structuredClone(rule)],
    },
    [`/rules/branches/${BASE_REF}`]: [structuredClone(rule)],
  };
  env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(data["/rulesets/8"]);
  record.rulesetDigest = createHash("sha256").update(env.ISSUER_RULESET_SNAPSHOT).digest("hex");
  owned.output.text = JSON.stringify(record);
  delete data["/rulesets/8"].bypass_actors;
  const state = /** @type {any} */ ({
    env,
    data,
    owned,
    actions,
    record,
    pulls: [pull],
    checks: phase === "fail" ? [] : [owned, actions],
    requests: [],
    writes: [],
    scope: { total_count: 1, repositories: [{ full_name: REPOSITORY }] },
  });
  const readMetadata = async (path) => {
    state.requests.push(path);
    const url = new URL(path || "/", "https://example.com");
    if (url.pathname === "/pulls" || url.pathname === `/commits/${HEAD}/check-runs`) {
      assert.equal(url.searchParams.get("per_page"), "100");
      const page = Number(url.searchParams.get("page"));
      const all = url.pathname === "/pulls" ? state.pulls : state.checks;
      const values = all.slice((page - 1) * 100, page * 100);
      return url.pathname === "/pulls" ? values : { check_runs: values };
    }
    assert.ok(Object.hasOwn(state.data, path), `Unexpected metadata request: ${path}`);
    return state.data[path];
  };
  let result;
  const writeChecks = async (path, request) => {
    if (request) {
      state.writes.push({ path, ...request });
      result = { id: 91, app: { id: 23 }, head_sha: HEAD, ...request.body };
    }
    return result;
  };
  return {
    ...state,
    state,
    readMetadata,
    writeChecks,
    publish: () => publishIssuerProof(env, readMetadata, writeChecks, async () => state.scope),
  };
}

test("visible empty bypass actors are accepted against the owner snapshot", async () => {
  const fixture = createFixture();
  fixture.data["/rulesets/8"].bypass_actors = [];
  assert.equal((await fixture.publish()).conclusion, "failure");
});

test("read-only ruleset metadata may omit caller bypass state", async () => {
  const fixture = createFixture();
  delete fixture.data["/rulesets/8"].current_user_can_bypass;
  assert.equal((await fixture.publish()).conclusion, "failure");
});

test("owner REST snapshot may omit caller bypass state without inventing it", async () => {
  const fixture = createFixture();
  const snapshot = JSON.parse(fixture.env.ISSUER_RULESET_SNAPSHOT);
  delete snapshot.current_user_can_bypass;
  fixture.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(snapshot);
  assert.equal((await fixture.publish()).conclusion, "failure");
});

test("unsafe owner snapshots stop before metadata or key use", async () => {
  for (const change of [
    (f) => {
      f.env.ISSUER_RULESET_SNAPSHOT = "not json";
    },
    (f) => {
      f.env.ISSUER_RULESET_SNAPSHOT = "null";
    },
    (f) => {
      f.env.ISSUER_RULESET_SNAPSHOT = "{}";
    },
    (f) => {
      const s = JSON.parse(f.env.ISSUER_RULESET_SNAPSHOT);
      delete s.bypass_actors;
      f.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(s);
    },
    (f) => {
      const s = JSON.parse(f.env.ISSUER_RULESET_SNAPSHOT);
      s.bypass_actors = [{ actor_id: 1 }];
      f.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(s);
    },
    (f) => {
      const s = JSON.parse(f.env.ISSUER_RULESET_SNAPSHOT);
      s.updated_at = "missing";
      f.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(s);
    },
    (f) => {
      const s = JSON.parse(f.env.ISSUER_RULESET_SNAPSHOT);
      s.current_user_can_bypass = "always";
      f.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(s);
    },
    (f) => {
      const s = JSON.parse(f.env.ISSUER_RULESET_SNAPSHOT);
      delete s.updated_at;
      f.env.ISSUER_RULESET_SNAPSHOT = JSON.stringify(s);
    },
  ]) {
    const fixture = createFixture();
    change(fixture);
    await assert.rejects(
      validateIssuerProof(fixture.env, fixture.readMetadata),
      /owner snapshot|owner ruleset snapshot/,
    );
    assert.deepEqual(fixture.requests, []);
    assert.deepEqual(fixture.writes, []);
  }
});

test("native version and caller bypass state stay bound to the owner snapshot", async () => {
  for (const change of [
    (f) => {
      f.data["/rulesets/8"].updated_at = "2026-01-02T10:00:00Z";
    },
    (f) => {
      f.data["/rulesets/8"].current_user_can_bypass = "always";
    },
    (f) => {
      f.data["/rulesets/8"].current_user_can_bypass = null;
    },
    (f) => {
      f.data["/rulesets/8"].bypass_actors = null;
    },
  ]) {
    const fixture = createFixture();
    change(fixture);
    await assert.rejects(fixture.publish(), /exact disposable base/);
    assert.equal(fixture.writes.length, 0);
  }
});

test("uncomputed mergeability is distinct from a conflict and cannot spend an App write", async () => {
  const fixture = createFixture("pass");
  fixture.data["/pulls/7"].mergeable = null;
  await assert.rejects(fixture.publish(), /not computed yet/);
  assert.equal(fixture.writes.length, 0);
});

test("malformed phase record values are rejected with the phase diagnostic", async () => {
  for (const text of ["null", "[]", "0", '"other"']) {
    const fixture = createFixture("pass");
    fixture.owned.output.text = text;
    await assert.rejects(fixture.publish(), /Missing issuer proof phase record/);
    assert.equal(fixture.writes.length, 0);
  }
});

test("isolated phases create one failure, then update the same check to success and back", async () => {
  for (const phase of /** @type {const} */ (["fail", "pass", "reset"])) {
    const fixture = createFixture(phase);
    const evidence = await fixture.publish();
    assert.equal(evidence.check, 91);
    assert.equal(evidence.phase, phase);
    assert.equal(evidence.conclusion, phase === "pass" ? "success" : "failure");
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.writes[0].method, phase === "fail" ? "POST" : "PATCH");
    assert.equal(fixture.writes[0].path, phase === "fail" ? "/check-runs" : "/check-runs/91");
    assert.equal(fixture.writes[0].body.external_id, EXTERNAL);
    assert.equal(Object.hasOwn(fixture.writes[0].body, "head_sha"), phase === "fail");
    assert.doesNotMatch(fixture.writes[0].body.output.summary, /review passed/i);
  }
});

const authorityChanges = {
  GITHUB_ACTOR: "outsider",
  GITHUB_TRIGGERING_ACTOR: "outsider",
  GITHUB_REF: "refs/heads/other",
  GITHUB_EVENT_NAME: "pull_request_target",
  GITHUB_WORKFLOW_REF: "foreign/workflow@refs/heads/main",
  GITHUB_WORKFLOW_SHA: HEAD,
  GITHUB_SHA: HEAD,
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_RUN_ID: "0",
  GITHUB_REPOSITORY: "outsider/repository",
  GITHUB_REPOSITORY_OWNER: "outsider",
  ISSUER_SOURCE: "d".repeat(40),
  ISSUER_HEAD: SOURCE,
  ISSUER_PULL: "7suffix",
  ISSUER_RULESET: "0",
  ISSUER_PHASE: "toString",
  ISSUER_CHECK: "91",
  ISSUER_ACTIONS_CHECK: "92",
  ISSUER_APPROVAL: "not approved",
  TRUSTED_REVIEW_APP_ID: "24",
  ISSUER_EXPECTED_APP: "24",
  TRUSTED_REVIEW_PUBLISHER_ENABLED: "false",
  TRUSTED_CODEX_REVIEW_ENABLED: "true",
};
for (const [name, value] of Object.entries(authorityChanges)) {
  test(`authority rejects ${name} before metadata or any App write`, async () => {
    const fixture = createFixture();
    fixture.env[name] = value;
    await assert.rejects(
      validateIssuerProof(fixture.env, fixture.readMetadata),
      /owner\/main authority/,
    );
    assert.deepEqual(fixture.requests, []);
    assert.deepEqual(fixture.writes, []);
  });
}

/** @type {Array<[string, (fixture:any)=>void, RegExp]>} */
const targetChanges = [
  [
    "wrong comparison status",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].status = "diverged";
    },
    /one marker-only child/,
  ],
  [
    "wrong ahead count",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].ahead_by = 2;
    },
    /one marker-only child/,
  ],
  [
    "wrong behind count",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].behind_by = 1;
    },
    /one marker-only child/,
  ],
  [
    "extra comparison commit",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].commits.push({ sha: SOURCE });
    },
    /one marker-only child/,
  ],
  [
    "wrong comparison commit",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].commits[0].sha = SOURCE;
    },
    /one marker-only child/,
  ],
  [
    "marker directory",
    (f) => {
      f.data[`/contents/${MARKER}?ref=${HEAD}`].type = "dir";
    },
    /one marker-only child/,
  ],
  [
    "wrong marker path",
    (f) => {
      f.data[`/contents/${MARKER}?ref=${HEAD}`].path = "other.md";
    },
    /one marker-only child/,
  ],
  [
    "wrong marker encoding",
    (f) => {
      f.data[`/contents/${MARKER}?ref=${HEAD}`].encoding = "none";
    },
    /one marker-only child/,
  ],
  [
    "wrong PR base SHA",
    (f) => {
      f.data["/pulls/7"].base.sha = HEAD;
    },
    /exact isolated marker-only PR/,
  ],
  [
    "wrong PR base repository",
    (f) => {
      f.data["/pulls/7"].base.repo.full_name = "foreign/repository";
    },
    /exact isolated marker-only PR/,
  ],
  [
    "foreign repository",
    (f) => {
      f.data[""].full_name = "other/repository";
    },
    /one marker-only child/,
  ],
  [
    "non-main default",
    (f) => {
      f.data[""].default_branch = "other";
    },
    /one marker-only child/,
  ],
  [
    "fork",
    (f) => {
      f.data[""].fork = true;
    },
    /one marker-only child/,
  ],
  [
    "moved main",
    (f) => {
      f.data["/git/ref/heads/main"].object.sha = HEAD;
    },
    /exact isolated marker-only PR/,
  ],
  [
    "wrong base ref",
    (f) => {
      f.data[`/git/ref/heads/${BASE_REF}`].ref = "refs/heads/main";
    },
    /exact isolated marker-only PR/,
  ],
  [
    "moved proof base",
    (f) => {
      f.data[`/git/ref/heads/${BASE_REF}`].object.sha = HEAD;
    },
    /exact isolated marker-only PR/,
  ],
  [
    "moved proof head",
    (f) => {
      f.data[`/git/ref/heads/${HEAD_REF}`].object.sha = SOURCE;
    },
    /exact isolated marker-only PR/,
  ],
  [
    "extra parent",
    (f) => {
      f.data[`/git/commits/${HEAD}`].parents.push({ sha: HEAD });
    },
    /one marker-only child/,
  ],
  [
    "wrong parent",
    (f) => {
      f.data[`/git/commits/${HEAD}`].parents[0].sha = HEAD;
    },
    /one marker-only child/,
  ],
  [
    "extra diff",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].files.push({ filename: "ci.yml", status: "modified" });
    },
    /one marker-only child/,
  ],
  [
    "wrong merge base",
    (f) => {
      f.data[`/compare/${SOURCE}...${HEAD}`].merge_base_commit.sha = HEAD;
    },
    /one marker-only child/,
  ],
  [
    "wrong marker",
    (f) => {
      f.data[`/contents/${MARKER}?ref=${HEAD}`].content = Buffer.from("other\n").toString("base64");
    },
    /one marker-only child/,
  ],
  [
    "Main PR",
    (f) => {
      f.data["/pulls/7"].base.ref = "main";
    },
    /exact isolated marker-only PR/,
  ],
  [
    "foreign PR head",
    (f) => {
      f.data["/pulls/7"].head.repo.full_name = "outsider/repository";
    },
    /exact isolated marker-only PR/,
  ],
  [
    "wrong PR head",
    (f) => {
      f.data["/pulls/7"].head.sha = SOURCE;
    },
    /exact isolated marker-only PR/,
  ],
  [
    "closed initial PR",
    (f) => {
      f.data["/pulls/7"].state = "closed";
    },
    /exact isolated marker-only PR/,
  ],
];
for (const [name, change, diagnostic] of targetChanges) {
  test(`target rejects ${name} with no write`, async () => {
    const fixture = createFixture();
    change(fixture);
    await assert.rejects(fixture.publish(), diagnostic);
    assert.equal(fixture.writes.length, 0);
  });
}

/** @type {Array<[string, (rule:any)=>void]>} */
const ruleChanges = [
  [
    "wrong ruleset id",
    (r) => {
      r.id = 9;
    },
  ],
  [
    "wrong ruleset name",
    (r) => {
      r.name = "Main";
    },
  ],
  [
    "wrong source type",
    (r) => {
      r.source_type = "Organization";
    },
  ],
  [
    "extra ruleset rule",
    (r) => {
      r.rules.push({ type: "pull_request" });
    },
  ],
  [
    "Main include",
    (r) => {
      r.conditions.ref_name.include = ["~DEFAULT_BRANCH"];
    },
  ],
  [
    "extra include",
    (r) => {
      r.conditions.ref_name.include.push("refs/heads/beta");
    },
  ],
  [
    "exclude",
    (r) => {
      r.conditions.ref_name.exclude.push("refs/heads/other");
    },
  ],
  [
    "tag rule",
    (r) => {
      r.target = "tag";
    },
  ],
  [
    "inactive",
    (r) => {
      r.enforcement = "disabled";
    },
  ],
  [
    "foreign source",
    (r) => {
      r.source = "foreign/repository";
    },
  ],
  [
    "bypass",
    (r) => {
      r.bypass_actors = [{ actor_id: 1 }];
    },
  ],
  [
    "wrong issuer",
    (r) => {
      r.rules[0].parameters.required_status_checks[0].integration_id = 15368;
    },
  ],
  [
    "wrong context",
    (r) => {
      r.rules[0].parameters.required_status_checks[0].context = "check";
    },
  ],
  [
    "strict on",
    (r) => {
      r.rules[0].parameters.strict_required_status_checks_policy = true;
    },
  ],
  [
    "create exemption",
    (r) => {
      r.rules[0].parameters.do_not_enforce_on_create = true;
    },
  ],
  [
    "extra required check",
    (r) => {
      r.rules[0].parameters.required_status_checks.push({ context: "other", integration_id: 23 });
    },
  ],
];
for (const [name, change] of ruleChanges) {
  test(`isolated rule rejects ${name}`, async () => {
    const fixture = createFixture();
    change(fixture.data["/rulesets/8"]);
    await assert.rejects(fixture.publish(), /exact disposable base/);
    assert.equal(fixture.writes.length, 0);
  });
}

test("additional inherited rules and effective issuer mismatches stop the proof", async () => {
  for (const effective of [[], [{ type: "pull_request" }], "extra"]) {
    const fixture = createFixture();
    if (effective === "extra")
      fixture.data[`/rules/branches/${BASE_REF}`].push({ type: "pull_request" });
    else fixture.data[`/rules/branches/${BASE_REF}`] = effective;
    await assert.rejects(fixture.publish(), /additional effective rules/);
    assert.equal(fixture.writes.length, 0);
  }
});

test("every open-PR and check page is inspected for collisions", async () => {
  for (const collision of ["head", "check"]) {
    const fixture = createFixture();
    fixture.state.pulls = Array.from({ length: 100 }, (_, index) => ({ number: index + 1000 }));
    if (collision === "check") {
      fixture.state.checks = Array.from({ length: 100 }, () => ({ name: "unrelated" }));
      fixture.state.checks.push({ name: "trusted-review", app: { id: 23 } });
    } else fixture.state.pulls.push({ number: 900, head: { sha: HEAD } });
    await assert.rejects(fixture.publish(), collision === "check" ? /already has/ : /collides/);
    assert.equal(fixture.writes.length, 0);
    assert.ok(fixture.requests.some((path) => path.includes("page=2")));
  }
});

test("pass requires a ready, conflict-free native hold and the exact Actions success", async () => {
  for (const change of [
    (f) => {
      f.data["/pulls/7"].draft = true;
    },
    (f) => {
      f.data["/pulls/7"].mergeable = false;
    },
    (f) => {
      f.data["/pulls/7"].mergeable_state = "clean";
    },
    (f) => {
      f.actions.app.id = 24;
    },
    (f) => {
      f.actions.head_sha = SOURCE;
    },
    (f) => {
      f.actions.conclusion = "failure";
    },
    (f) => {
      f.actions.status = "in_progress";
    },
    (f) => {
      f.env.ISSUER_ACTIONS_CHECK = "93";
    },
  ]) {
    const fixture = createFixture("pass");
    change(fixture);
    await assert.rejects(fixture.publish(), /blocked PR|lookalike check/);
    assert.equal(fixture.writes.length, 0);
  }
});

test("duplicate owned checks, wrong IDs, stale and forged phase records cannot authorize success", async () => {
  for (const change of [
    (f) => {
      f.state.checks.push({ ...f.owned, id: 93 });
    },
    (f) => {
      f.env.ISSUER_CHECK = "93";
    },
    (f) => {
      f.owned.external_id = "foreign";
    },
    (f) => {
      f.owned.conclusion = "success";
    },
    (f) => {
      f.owned.status = "in_progress";
    },
    (f) => {
      f.owned.output.text = "not json";
    },
    (f) => {
      f.record.schema = "foreign";
    },
    (f) => {
      f.record.source = HEAD;
    },
    (f) => {
      f.record.head = SOURCE;
    },
    (f) => {
      f.record.pull = 8;
    },
    (f) => {
      f.record.ruleset = 9;
    },
    (f) => {
      f.record.rulesetDigest = "foreign";
    },
    (f) => {
      f.record.phase = "reset";
    },
    (f) => {
      f.record.run = "100";
    },
  ]) {
    const fixture = createFixture("pass");
    change(fixture);
    if (fixture.owned.output.text !== "not json")
      fixture.owned.output.text = JSON.stringify(fixture.record);
    await assert.rejects(
      fixture.publish(),
      /one exact owned|identity|phase record|phases must advance/,
    );
    assert.equal(fixture.writes.length, 0);
  }
});

test("reset may fail a closed isolated PR but cannot repeat a completed reset", async () => {
  const fixture = createFixture("reset");
  fixture.data["/pulls/7"].state = "closed";
  assert.equal((await fixture.publish()).conclusion, "failure");
  const repeated = createFixture("reset");
  repeated.record.phase = "reset";
  repeated.owned.output.text = JSON.stringify(repeated.record);
  await assert.rejects(repeated.publish(), /phases must advance/);
  assert.equal(repeated.writes.length, 0);
});

test("listing identity uses fields supplied by GitHub's PR collection", async () => {
  const fixture = createFixture("pass");
  const listed = structuredClone(fixture.data["/pulls/7"]);
  delete listed.mergeable;
  delete listed.mergeable_state;
  fixture.state.pulls = [listed];
  assert.equal((await fixture.publish()).conclusion, "success");
  const retargeted = createFixture("pass");
  retargeted.state.pulls = [{ ...retargeted.data["/pulls/7"], base: { ref: "main" } }];
  await assert.rejects(retargeted.publish(), /collides/);
  assert.equal(retargeted.writes.length, 0);
});

test("latest source, refs and PR identity are checked after complete listings", async () => {
  for (const [change, diagnostic] of /** @type {Array<[(fixture:any)=>void, RegExp]>} */ ([
    [
      (f) => {
        f.data["/git/ref/heads/main"].object.sha = HEAD;
      },
      /exact isolated marker-only PR/,
    ],
    [
      (f) => {
        f.data[`/git/ref/heads/${BASE_REF}`].object.sha = HEAD;
      },
      /exact isolated marker-only PR/,
    ],
    [
      (f) => {
        f.data[`/git/ref/heads/${HEAD_REF}`].object.sha = SOURCE;
      },
      /exact isolated marker-only PR/,
    ],
    [
      (f) => {
        f.data["/pulls/7"].base.ref = "main";
      },
      /exact isolated marker-only PR/,
    ],
    [
      (f) => {
        f.data["/pulls/7"].draft = true;
      },
      /blocked PR/,
    ],
  ])) {
    const fixture = createFixture("pass");
    const read = async (path) => {
      const value = await fixture.readMetadata(path);
      if (path.includes("/check-runs?")) change(fixture);
      return value;
    };
    await assert.rejects(
      publishIssuerProof(fixture.env, read, fixture.writeChecks, async () => fixture.state.scope),
      diagnostic,
    );
    assert.equal(fixture.writes.length, 0);
  }
});

test("native ruleset version and effective rules are re-read after check pagination", async () => {
  for (const change of [
    (f) => {
      f.data["/rulesets/8"].updated_at = "2026-01-02T10:00:00Z";
    },
    (f) => {
      f.data[`/rules/branches/${BASE_REF}`].push({ type: "pull_request" });
    },
  ]) {
    const fixture = createFixture("pass");
    const read = async (path) => {
      const answer = await fixture.readMetadata(path);
      if (path.includes("/check-runs?")) change(fixture);
      return answer;
    };
    await assert.rejects(
      publishIssuerProof(fixture.env, read, fixture.writeChecks, async () => fixture.state.scope),
      /exact disposable base/,
    );
    assert.equal(fixture.writes.length, 0);
  }
});

test("repository-only scope, current metadata and readback are required without automatic retries", async () => {
  const count = createFixture();
  count.state.scope.total_count = 2;
  await assert.rejects(count.publish(), /exactly this repository/);
  assert.equal(count.requests.length, 0);
  const scope = createFixture();
  scope.state.scope.repositories.push({ full_name: "example/other" });
  await assert.rejects(scope.publish(), /exactly this repository/);
  assert.equal(scope.requests.length, 0);
  const changed = createFixture("pass");
  await validateIssuerProof(changed.env, changed.readMetadata);
  changed.data["/git/ref/heads/main"].object.sha = HEAD;
  await assert.rejects(changed.publish(), /exact isolated marker-only PR/);
  assert.equal(changed.writes.length, 0);
  const fixture = createFixture();
  let writes = 0;
  await assert.rejects(
    publishIssuerProof(
      fixture.env,
      fixture.readMetadata,
      async () => {
        writes += 1;
        throw new Error("transport failed");
      },
      async () => fixture.state.scope,
    ),
    /transport failed/,
  );
  assert.equal(writes, 1);
  for (const field of [
    "app",
    "head_sha",
    "conclusion",
    "output",
    "id",
    "status",
    "name",
    "external_id",
  ]) {
    const bad = createFixture();
    let calls = 0;
    await assert.rejects(
      publishIssuerProof(
        bad.env,
        bad.readMetadata,
        async (path, request) => {
          const result = await bad.writeChecks(path, request);
          calls += 1;
          return calls === 2 ? { ...result, [field]: null } : result;
        },
        async () => bad.state.scope,
      ),
      /Unexpected issuer proof check identity|GitHub did not confirm/,
    );
    assert.equal(bad.writes.length, 1);
  }
});

test("main-only key use and permission-free lookalike stay distinct from production activation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/trusted-review-issuer-test.yml", import.meta.url),
    "utf8",
  );
  const lookalike = readFileSync(
    new URL("../.github/workflows/trusted-review-lookalike-test.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|workflow_run):/m);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /inputs.approval == 'APPROVE_ISOLATED_ISSUER_PROTOCOL'/);
  assert.match(workflow, /vars.TRUSTED_CODEX_REVIEW_ENABLED != 'true'/);
  assert.match(workflow, /ISSUER_RULESET_SNAPSHOT: \$\{\{ inputs.ruleset-snapshot \}\}/);
  assert.match(workflow, /environment: trusted-review-publisher/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /options: \[fail, pass, reset\]/);
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 1);
  assert.match(workflow, /ISSUER_EXPECTED_APP: "5481243"/);
  assert.match(
    workflow,
    /actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510/,
  );
  assert.match(workflow, /permission-checks: write/);
  assert.match(workflow, /repositories: \$\{\{ github.event.repository.name \}\}/);
  assert.doesNotMatch(workflow, /skip-token-revoke|npm |cache@|secrets: inherit/);
  assert.doesNotMatch(workflow, /^ {2}(?:actions|contents|checks): write/m);
  assert.ok(
    workflow.indexOf("test-review-issuer.mjs validate") <
      workflow.indexOf("actions/create-github-app-token@"),
  );
  assert.match(lookalike, /permissions: \{\}/);
  assert.match(lookalike, /name: trusted-review/);
  assert.match(lookalike, /github.sha == inputs.proof-head/);
  assert.match(lookalike, /refs\/heads\/issue-809-issuer-head/);
  assert.doesNotMatch(lookalike, /secrets\.|github.token|environment:|uses:|APP_TOKEN|checkout/);
});
