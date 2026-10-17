import test from "node:test";
import assert from "node:assert/strict";
import { listToPost, postFindings } from "../worker/post-review.mjs";

const finding = (/** @type {object} */ fields) => ({
  weight: "Nit",
  path: "shared/page/sheet.js",
  line: 12,
  body: "The comment names a file that's gone.",
  ...fields,
});

test("without a check across areas, the checkers' confirmed and unsure findings are posted, weightiest first", () => {
  const checks = [
    {
      items: [
        finding({ verdict: "confirmed", body: "a nit" }),
        finding({ verdict: "rejected", weight: "Important", body: "turned down" }),
      ],
    },
    {
      items: [
        finding({ verdict: "unsure", weight: "Important", body: "can't settle" }),
        finding({ verdict: "confirmed", weight: "Important", body: "a bug" }),
      ],
    },
  ];
  assert.deepEqual(
    listToPost(checks, null).map(({ weight, body }) => [weight, body]),
    [
      ["Important", "a bug"],
      ["Unsure", "can't settle"],
      ["Nit", "a nit"],
    ],
  );
});

test("after a check across areas, only what it kept is posted, and nothing without a place or words", () => {
  const across = {
    items: [
      finding({ weight: "Pre-existing", body: "old" }),
      finding({ weight: "Important", body: "merged" }),
      finding({ weight: "Important", path: "", body: "nowhere" }),
      finding({ weight: "Serious", body: "no such weight" }),
    ],
  };
  assert.deepEqual(
    listToPost([{ items: [finding({ verdict: "confirmed" })] }], across).map((item) => item.body),
    ["merged", "old"],
  );
});

/**
 * A GitHub that answers each comment as given, or refuses it.
 * @param {(body: any) => boolean} accepts
 */
function fakeGitHub(accepts) {
  /** @type {{ path: string, body: any }[]} */
  const calls = [];
  const callGitHub = async (/** @type {string} */ path, /** @type {any} */ request = {}) => {
    calls.push({ path, body: request.body });
    if (!accepts(request.body)) throw new Error("GitHub answered 422");
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
  const weights = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: "abc",
    findings: [
      finding({ weight: "Important", body: "on the diff" }),
      finding({ line: 400, body: "off the diff" }),
      finding({ path: "apps/wnba/page/js/app.js", line: 192, body: "a file it doesn't change" }),
    ],
    posted: [],
  });
  assert.deepEqual(weights, ["Important", "Nit", "Nit"]);
  assert.deepEqual(calls[0], {
    path: "/pulls/7/comments",
    body: {
      body: "**Important** on the diff",
      commit_id: "abc",
      path: "shared/page/sheet.js",
      line: 12,
      side: "RIGHT",
    },
  });
  assert.deepEqual(calls[2].body, {
    body: "**Nit** (about line 400) off the diff",
    commit_id: "abc",
    path: "shared/page/sheet.js",
    subject_type: "file",
  });
  assert.deepEqual(calls.at(-1), {
    path: "/issues/7/comments",
    body: {
      body: "Findings on files this pull request doesn't change:\n\n- `apps/wnba/page/js/app.js:192`: **Nit** a file it doesn't change",
    },
  });
});

test("a finding already posted word for word isn't posted again, but still counts", async () => {
  const { calls, callGitHub } = fakeGitHub(() => true);
  const weights = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: "abc",
    findings: [finding({ body: "posted by an earlier try" }), finding({ body: "new" })],
    posted: ["**Nit** posted by an earlier try"],
  });
  assert.deepEqual(weights, ["Nit", "Nit"]);
  assert.deepEqual(
    calls.map((call) => call.body.body),
    ["**Nit** new"],
  );
});
