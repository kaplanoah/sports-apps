import test from "node:test";
import assert from "node:assert/strict";
import { GitHubError } from "../worker/github-api.mjs";
import {
  listConfirmed,
  listPosted,
  listToPost,
  nameFinding,
  postFindings,
  readAcross,
} from "../worker/post-review.mjs";
import { OFF_DIFF_HEADING, writeFindingMark } from "../worker/review-state.mjs";

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
    listConfirmed(CHECKS).map(({ ref, weight, body }) => [ref, weight, body]),
    [
      ["1.1", "Nit", "a nit"],
      ["2.1", "Unsure", "can't settle"],
      ["2.2", "Important", "a bug"],
    ],
  );
});

test("every confirmed finding is posted, weightiest first, without a check across areas", () => {
  assert.deepEqual(
    listToPost(listConfirmed(CHECKS), null).map(({ weight, body }) => [weight, body]),
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
    listToPost(listConfirmed(CHECKS), across).map((item) => item.body),
    ["a bug", "can't settle", "spans two areas"],
  );
});

test("a check across areas that gave no answer, or one of another shape, reads as none", () => {
  assert.equal(readAcross(undefined), null);
  assert.equal(readAcross("not json"), null);
  assert.equal(readAcross('{"findings": []}'), null);
  assert.deepEqual(readAcross('{"duplicates": [], "added": []}'), {
    duplicates: [],
    added: [],
    unjudged: [],
  });
});

/**
 * A GitHub that refuses a comment with 422 where it won't take it.
 * @param {(body: any) => boolean} accepts
 * @param {number} [status] what it answers when it refuses
 */
function fakeGitHub(accepts, status = 422) {
  /** @type {{ path: string, body: any }[]} */
  const calls = [];
  const callGitHub = async (/** @type {string} */ path, /** @type {any} */ request = {}) => {
    calls.push({ path, body: request.body });
    if (!accepts(request.body)) throw new GitHubError(status, `POST ${path}`);
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
    sha: "abc",
    findings: [onDiff, finding({ line: 400, body: "off the diff" }), offFile],
    posted: new Set(),
  });
  assert.deepEqual(result, { weights: ["Important", "Nit", "Nit"], repeated: 0 });
  assert.deepEqual(calls[0], {
    path: "/pulls/7/comments",
    body: {
      body: `**Important** on the diff\n\n${writeFindingMark(nameFinding(onDiff))}`,
      commit_id: "abc",
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
      sha: "abc",
      findings: [finding({})],
      posted: new Set(),
    }),
    /GitHub answered 502/,
  );
  assert.equal(calls.length, 1);
});

test("a finding already posted in any form isn't posted again, and doesn't count as new", async () => {
  const onFile = finding({ body: "posted on its file" });
  const offDiff = finding({ path: "elsewhere.js", body: "posted off the diff" });
  const posted = listPosted([
    {
      user: { login: "github-actions[bot]" },
      body: `**Nit** (about line 12) posted on its file\n\n${writeFindingMark(nameFinding(onFile))}`,
    },
    {
      user: { login: "github-actions[bot]" },
      body: `${OFF_DIFF_HEADING}\n\n- \`elsewhere.js:12\`: **Nit** posted off the diff\n\n${writeFindingMark(nameFinding(offDiff))}`,
    },
    { user: { login: "someone" }, body: writeFindingMark(nameFinding(finding({ body: "new" }))) },
  ]);
  const { calls, callGitHub } = fakeGitHub(() => true);
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: "abc",
    findings: [onFile, offDiff, finding({ body: "new" })],
    posted,
  });
  assert.deepEqual(result, { weights: ["Nit"], repeated: 2 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.body, /^\*\*Nit\*\* new/);
});
