import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubError } from "../worker/github-api.mjs";
import {
  listCheckedFindings,
  listPosted,
  listToPost,
  nameFinding,
  postFindings,
  readAcross,
  readAreaCount,
  readChecks,
  readPostInputs,
} from "../worker/post-review.mjs";
import { OFF_DIFF_HEADING, writeFindingMark } from "../worker/review-state.mjs";

const SHA = "a".repeat(40);
const EARLIER = "e".repeat(40);

const finding = (/** @type {object} */ fields) => ({
  weight: "Nit",
  path: "shared/page/sheet.js",
  line: 12,
  body: "The comment names a file that's gone.",
  ...fields,
});

const CHECKS = [
  {
    area: 2,
    items: [
      finding({ verdict: "unsure", weight: "Important", body: "can't settle" }),
      finding({ verdict: "confirmed", weight: "Important", body: "a bug" }),
    ],
  },
  {
    area: 1,
    items: [
      finding({ verdict: "rejected", weight: "Important", body: "turned down" }),
      finding({ verdict: "confirmed", body: "a nit" }),
    ],
  },
];

test("what the checkers confirmed or left unsure is listed in area order, each with its ref", () => {
  assert.deepEqual(
    listCheckedFindings(CHECKS).map(({ ref, weight, body }) => [ref, weight, body]),
    [
      ["1.1", "Nit", "a nit"],
      ["2.1", "Unsure", "can't settle"],
      ["2.2", "Important", "a bug"],
    ],
  );
});

test("every finding the checkers kept is posted, weightiest first, without a check across areas", () => {
  assert.deepEqual(
    listToPost(listCheckedFindings(CHECKS), null).map(({ weight, body }) => [weight, body]),
    [
      ["Important", "a bug"],
      ["Unsure", "can't settle"],
      ["Nit", "a nit"],
    ],
  );
});

test("the check across areas drops only the later repeats it names, and adds what it found", () => {
  const across = {
    duplicates: [["2.2", "1.1"]],
    added: [
      finding({ weight: "Pre-existing", body: "spans two areas" }),
      finding({ weight: "Serious", body: "no such weight" }),
      finding({ path: "", body: "nowhere" }),
    ],
    unjudged: [],
  };
  assert.deepEqual(
    listToPost(listCheckedFindings(CHECKS), across).map((item) => item.body),
    ["a bug", "can't settle", "spans two areas"],
  );
});

test("a repeat group the check across areas got wrong never drops a finding nothing else stands in for", () => {
  const checked = listCheckedFindings(CHECKS);
  const posted = (/** @type {string[][]} */ duplicates) =>
    listToPost(checked, { duplicates, added: [], unjudged: [] }).map((item) => item.body);
  assert.deepEqual(posted([["9.9", "1.1"]]), ["a bug", "can't settle", "a nit"]);
  assert.deepEqual(posted([["1.1", "1.1"]]), ["a bug", "can't settle", "a nit"]);
  assert.deepEqual(
    posted([
      ["1.1", "2.2"],
      ["2.2", "1.1"],
    ]),
    ["can't settle", "a nit"],
  );
  assert.deepEqual(
    posted([
      ["2.1", "1.1"],
      ["1.1", "2.2"],
    ]),
    ["a bug", "can't settle"],
  );
  assert.deepEqual(
    posted([
      ["1.1", "2.2"],
      ["2.1", "1.1"],
    ]),
    ["can't settle", "a nit"],
  );
});

test("a check across areas that gave no answer, or one of another shape, reads as none", () => {
  assert.equal(readAcross(undefined), null);
  assert.equal(readAcross("not json"), null);
  assert.equal(readAcross('{"findings": []}'), null);
  assert.deepEqual(
    readAcross('{"duplicates": [["1.1", "2.1"], "1.2"], "added": [], "unjudged": "x"}'),
    {
      duplicates: [["1.1", "2.1"]],
      added: [],
      unjudged: [],
    },
  );
});

/**
 * A GitHub that refuses a comment with 422 where it won't take it.
 * @param {(body: any) => boolean} accepts
 * @param {number} [status] what it answers when it refuses
 */
function fakeGitHub(accepts, status = 422) {
  /** @type {{ path: string, body: any, isTaken: boolean }[]} */
  const calls = [];
  const callGitHub = async (/** @type {string} */ path, /** @type {any} */ request = {}) => {
    const isTaken = accepts(request.body);
    calls.push({ path, body: request.body, isTaken });
    if (!isTaken) throw new GitHubError(status, `POST ${path}`);
    return {};
  };
  return { calls, callGitHub };
}

test("each finding goes on its line, or on its file off the diff, or in one comment off the pull request's files", async () => {
  const { calls, callGitHub } = fakeGitHub((body) =>
    body.line === 12 || body.subject_type === "file"
      ? body.path !== "apps/wnba/page/js/app.js"
      : body.path === undefined,
  );
  const onDiff = finding({ weight: "Important", body: "on the diff" });
  const offFile = finding({ path: "apps/wnba/page/js/app.js", line: 192, body: "elsewhere" });
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [onDiff, finding({ line: 400, body: "off the diff" }), offFile],
    posted: new Map(),
  });
  assert.deepEqual(result, { weights: ["Important", "Nit", "Nit"], repeated: 0 });
  assert.deepEqual(calls[0], {
    path: "/pulls/7/comments",
    isTaken: true,
    body: {
      body: `**Important** on the diff\n\n${writeFindingMark(nameFinding(onDiff), SHA)}`,
      commit_id: SHA,
      path: "shared/page/sheet.js",
      line: 12,
      side: "RIGHT",
    },
  });
  assert.match(
    calls[2].body.body,
    /^\*\*Nit\*\* \(about line 400\) off the diff\n\n<!-- claude-finding/,
  );
  assert.equal(calls[2].body.subject_type, "file");
  assert.equal(calls.at(-1)?.path, "/issues/7/comments");
  assert.ok(
    calls
      .at(-1)
      ?.body.body.startsWith(
        `${OFF_DIFF_HEADING}\n\n- \`apps/wnba/page/js/app.js:192\`: **Nit** elsewhere`,
      ),
  );
});

test("a refusal that isn't about the line stops the step, so a re-run posts the finding once", async () => {
  const { calls, callGitHub } = fakeGitHub(() => false, 502);
  await assert.rejects(
    postFindings(callGitHub, {
      pullNumber: "7",
      sha: SHA,
      findings: [finding({})],
      posted: new Map(),
    }),
    /GitHub answered 502/,
  );
  assert.equal(calls.length, 1);
});

test("a finding already posted in any form isn't posted again, and counts as new only from this head", async () => {
  const offFile = finding({ line: 400, body: "posted on its file" });
  const fromEarlier = finding({ body: "an earlier head's" });
  const { calls: first, callGitHub: postOnce } = fakeGitHub((body) => body.line !== 400);
  await postFindings(postOnce, {
    pullNumber: "7",
    sha: SHA,
    findings: [offFile],
    posted: new Map(),
  });
  const comments = [
    ...first
      .filter((call) => call.isTaken)
      .map((call) => ({ user: { login: "github-actions[bot]" }, body: call.body.body })),
    {
      user: { login: "github-actions[bot]" },
      body: `**Nit** an earlier head's\n\n${writeFindingMark(nameFinding(fromEarlier), EARLIER)}`,
    },
    {
      user: { login: "someone" },
      body: writeFindingMark(nameFinding(finding({ body: "new" })), EARLIER),
    },
  ];
  const { calls, callGitHub } = fakeGitHub(() => true);
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [offFile, fromEarlier, finding({ body: "new" })],
    posted: listPosted(comments),
  });
  assert.deepEqual(result, { weights: ["Nit", "Nit"], repeated: 1 });
  assert.deepEqual(
    calls.map((call) => call.body.body.split("\n")[0]),
    ["**Nit** new"],
  );
});

test("a stage's checks are read as the checkers leave them, each with its area, and no other stage's", () => {
  const folder = mkdtempSync(join(tmpdir(), "post-review-"));
  const record = (/** @type {string} */ body) =>
    JSON.stringify({ items: [finding({ verdict: "confirmed", body })], unjudged: [] });
  writeFileSync(join(folder, "check-push-10.json"), record("ten"));
  writeFileSync(join(folder, "check-push-1.json"), record("one"));
  writeFileSync(join(folder, "check-final-1.json"), record("final"));
  writeFileSync(join(folder, "candidates-push-1.json"), "[]");
  assert.deepEqual(
    listCheckedFindings(readChecks(folder, "push", 10)).map(({ ref, body }) => [ref, body]),
    [
      ["1.1", "one"],
      ["10.1", "ten"],
    ],
  );
});

test("a stage's count of areas must be named, so a job that lost it stops rather than posting nothing", () => {
  assert.equal(readAreaCount("3"), 3);
  for (const areas of [undefined, "", "0", "two", "1.5"])
    assert.throws(() => readAreaCount(areas), /AREAS must name how many areas/, String(areas));
});

test("the posting step reads every finding already on the pull request, and the check across areas' answer", async () => {
  const folder = mkdtempSync(join(tmpdir(), "post-review-"));
  const onLine = finding({ body: "on its line" });
  const offFile = finding({ path: "apps/wnba/page/js/app.js", body: "elsewhere" });
  const repeat = finding({ path: "apps/mlb/page/js/app.js", body: "the same, in mlb" });
  const record = (/** @type {object[]} */ items) =>
    JSON.stringify({
      items: items.map((item) => ({ ...item, ids: ["bugs-1"], verdict: "confirmed" })),
      unjudged: [],
    });
  writeFileSync(join(folder, "check-push-1.json"), record([onLine, offFile]));
  writeFileSync(join(folder, "check-push-2.json"), record([repeat]));
  const bot = { login: "github-actions[bot]" };
  const lineComment = {
    user: bot,
    body: `**Nit** on its line\n\n${writeFindingMark(nameFinding(onLine), EARLIER)}`,
  };
  const offDiffComment = {
    user: bot,
    body: `${OFF_DIFF_HEADING}\n\n- \`apps/wnba/page/js/app.js:12\`: **Nit** elsewhere\n\n${writeFindingMark(nameFinding(offFile), EARLIER)}`,
  };
  const callGitHub = async (/** @type {string} */ path) => {
    if (path.startsWith("/pulls/7/comments")) return [lineComment];
    return path.startsWith("/issues/7/comments") ? [offDiffComment] : [];
  };
  const inputs = { folder, stage: "push", areaCount: 2, pullNumber: "7" };
  await assert.rejects(
    readPostInputs(callGitHub, inputs),
    /check across areas didn't leave its answer/,
  );
  const across = {
    duplicates: [["1.1", "2.1"]],
    added: [finding({ body: "spans two areas" })],
    unjudged: [],
  };
  writeFileSync(join(folder, "across-push.json"), JSON.stringify(across));
  const read = await readPostInputs(callGitHub, inputs);
  assert.deepEqual(
    read.findings.map((item) => item.body),
    ["on its line", "elsewhere", "spans two areas"],
  );
  assert.deepEqual(read.across, across);
  assert.deepEqual([...(read.posted.get(nameFinding(onLine)) ?? [])], [EARLIER]);
  assert.deepEqual([...(read.posted.get(nameFinding(offFile)) ?? [])], [EARLIER]);
});
