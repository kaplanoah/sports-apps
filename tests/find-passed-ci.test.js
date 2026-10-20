import test from "node:test";
import assert from "node:assert/strict";
import {
  findPassedRun,
  findReviewedRun,
  findTestedRun,
  namePassedArtifact,
  nameReviewedArtifact,
  nameTestedArtifact,
  readSearchKind,
} from "../worker/find-passed-ci.mjs";

const TREE = "a".repeat(40);
const REPOSITORY = "owner/sports-apps";
const THIS_REPOSITORY = { id: 1 };
const FORK = { id: 2 };
const PASSED_RUN = {
  id: 7,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  conclusion: "success",
  repository: THIS_REPOSITORY,
  head_repository: THIS_REPOSITORY,
};

/**
 * GitHub's API with these artifacts under the given name for TREE, and these runs by id.
 * @param {object[]} artifacts
 * @param {{ id: number }[]} runs
 */
function createFakeGitHub(artifacts, runs, name = namePassedArtifact(TREE)) {
  const paths = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    const { pathname, search } = new URL(String(url));
    paths.push(pathname + search);
    if (pathname.endsWith("/actions/artifacts"))
      return Response.json({
        artifacts: search.includes(name) ? artifacts : [],
      });
    const run = runs.find((each) => pathname.endsWith(`/actions/runs/${each.id}`));
    return run ? Response.json(run) : new Response("", { status: 404 });
  };
  return { fetchImpl, paths };
}

/** @param {number} id */
const buildArtifact = (id, expired = false) => ({ expired, workflow_run: { id } });

test("a pull request's CI run that passed on main's exact code is found", async () => {
  const github = createFakeGitHub([buildArtifact(7)], [PASSED_RUN]);
  const runId = await findPassedRun({
    tree: TREE,
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, 7);
  assert.deepEqual(github.paths, [
    `/repos/${REPOSITORY}/actions/artifacts?name=ci-passed-${TREE}&per_page=100`,
    `/repos/${REPOSITORY}/actions/runs/7`,
  ]);
});

test("no run passed on main's code when none recorded its tree", async () => {
  const github = createFakeGitHub([], [PASSED_RUN]);
  const runId = await findPassedRun({
    tree: "b".repeat(40),
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, null);
});

test("a fork's run, a failed run, another workflow, another event, or an expired record doesn't count", async () => {
  const runs = [
    { ...PASSED_RUN, id: 1, head_repository: FORK },
    { ...PASSED_RUN, id: 2, conclusion: "failure" },
    { ...PASSED_RUN, id: 3, path: ".github/workflows/deploy.yml" },
    { ...PASSED_RUN, id: 4, event: "push" },
    { ...PASSED_RUN, id: 5 },
  ];
  const artifacts = [1, 2, 3, 4].map((id) => buildArtifact(id)).concat(buildArtifact(5, true));
  const github = createFakeGitHub(artifacts, runs);
  const runId = await findPassedRun({
    tree: TREE,
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, null);
  assert.ok(!github.paths.some((path) => path.endsWith("/actions/runs/5")));

  const withPassed = createFakeGitHub([...artifacts, buildArtifact(7)], [...runs, PASSED_RUN]);
  assert.equal(
    await findPassedRun({ tree: TREE, repository: REPOSITORY, fetchImpl: withPassed.fetchImpl }),
    7,
  );
});

// A held red change's run, which check fails while main's rules don't require the phone status,
// is found again on the label change that lets it through.
test("a run whose tests all passed on this exact code is found for a label change, even if check held it", async () => {
  const held = { ...PASSED_RUN, conclusion: "failure" };
  const github = createFakeGitHub([buildArtifact(7)], [held], nameTestedArtifact(TREE));
  const runId = await findTestedRun({
    tree: TREE,
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, 7);
  assert.deepEqual(github.paths, [
    `/repos/${REPOSITORY}/actions/artifacts?name=ci-tested-${TREE}&per_page=100`,
    `/repos/${REPOSITORY}/actions/runs/7`,
  ]);
});

test("for a label change, a fork's run, another workflow, another event, or an expired record doesn't count", async () => {
  const runs = [
    { ...PASSED_RUN, id: 1, head_repository: FORK },
    { ...PASSED_RUN, id: 2, path: ".github/workflows/deploy.yml" },
    { ...PASSED_RUN, id: 3, event: "push" },
    { ...PASSED_RUN, id: 4 },
  ];
  const artifacts = [1, 2, 3].map((id) => buildArtifact(id)).concat(buildArtifact(4, true));
  const github = createFakeGitHub(artifacts, runs, nameTestedArtifact(TREE));
  const runId = await findTestedRun({
    tree: TREE,
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, null);
  assert.ok(!github.paths.some((path) => path.endsWith("/actions/runs/4")));
});

// A label that asks for a review skips it only where a run passed the review on this exact code,
// never where a run only passed its tests, as a push's run does, which reviews nothing.
test("a run whose review passed on this exact code is found for a label that asks for one, and a tested run isn't", async () => {
  const reviewed = createFakeGitHub([buildArtifact(7)], [PASSED_RUN], nameReviewedArtifact(TREE));
  assert.equal(
    await findReviewedRun({ tree: TREE, repository: REPOSITORY, fetchImpl: reviewed.fetchImpl }),
    7,
  );
  assert.deepEqual(reviewed.paths, [
    `/repos/${REPOSITORY}/actions/artifacts?name=ci-reviewed-${TREE}&per_page=100`,
    `/repos/${REPOSITORY}/actions/runs/7`,
  ]);
  const tested = createFakeGitHub([buildArtifact(7)], [PASSED_RUN], nameTestedArtifact(TREE));
  assert.equal(
    await findReviewedRun({ tree: TREE, repository: REPOSITORY, fetchImpl: tested.fetchImpl }),
    null,
  );
  const fork = { ...PASSED_RUN, head_repository: FORK };
  const forked = createFakeGitHub([buildArtifact(7)], [fork], nameReviewedArtifact(TREE));
  assert.equal(
    await findReviewedRun({ tree: TREE, repository: REPOSITORY, fetchImpl: forked.fetchImpl }),
    null,
  );
});

test("each flag picks the record it looks for, main's deploy's when it names none", () => {
  assert.equal(readSearchKind(["node", "find-passed-ci.mjs"]), "passed");
  assert.equal(readSearchKind(["node", "find-passed-ci.mjs", "--tested"]), "tested");
  assert.equal(readSearchKind(["node", "find-passed-ci.mjs", "--reviewed"]), "reviewed");
});

// Main deploys only code whose gate passed too.
test("a run whose tests passed but whose gate didn't isn't found for main's deploy", async () => {
  const github = createFakeGitHub([buildArtifact(7)], [PASSED_RUN], nameTestedArtifact(TREE));
  const runId = await findPassedRun({
    tree: TREE,
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
  });
  assert.equal(runId, null);
});

test("a refusal from GitHub names its status, and sends the token", async () => {
  const sent = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (_url, init) => {
    sent.push(new Headers(init?.headers).get("authorization"));
    return new Response("", { status: 403 });
  };
  await assert.rejects(
    findPassedRun({ tree: TREE, repository: REPOSITORY, fetchImpl, env: { GH_TOKEN: "token123" } }),
    /GitHub answered 403/,
  );
  assert.deepEqual(sent, ["Bearer token123"]);
});
