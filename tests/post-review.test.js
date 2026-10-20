import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubError } from "../worker/github-api.mjs";
import { ACROSS_RECORD } from "../worker/judge-review.mjs";
import {
  LIST_HEADING,
  listPosted,
  listToPost,
  nameFinding,
  postFindings,
  readPostInputs,
} from "../worker/post-review.mjs";
import { OFF_DIFF_HEADING, readReviewComments, writeFindingMark } from "../worker/review-state.mjs";

const SHA = "a".repeat(40);
const EARLIER = "e".repeat(40);

const finding = (/** @type {object} */ fields) => ({
  weight: "Nit",
  path: "shared/page/sheet.js",
  line: 12,
  body: "The comment names a file that's gone.",
  ...fields,
});

const JUDGED = [
  finding({ verdict: "unsure", weight: "Important", body: "can't settle" }),
  finding({ verdict: "rejected", weight: "Important", body: "turned down" }),
  finding({ verdict: "confirmed", body: "a nit" }),
  finding({ verdict: "confirmed", weight: "Important", body: "a bug" }),
];

test("what the check across areas confirmed is posted at its weight, what it left unsure as Unsure, weightiest first, and nothing it rejected", () => {
  assert.deepEqual(
    listToPost(JUDGED).map(({ weight, body }) => [weight, body]),
    [
      ["Important", "a bug"],
      ["Unsure", "can't settle"],
      ["Nit", "a nit"],
    ],
  );
});

test("a finding that can't be posted is left out rather than stopping the post", () => {
  const unpostable = [
    finding({ verdict: "confirmed", weight: "Minor", body: "odd weight" }),
    finding({ verdict: "confirmed", weight: "Important", body: "" }),
    finding({ verdict: "confirmed", weight: "Important", path: "", body: "nowhere" }),
    finding({ verdict: "confirmed", path: 3, body: "a number for a path" }),
    finding({ verdict: "confirmed", body: 5 }),
    finding({ verdict: "maybe", body: "no such verdict" }),
  ];
  assert.deepEqual(
    listToPost([...unpostable, finding({ verdict: "confirmed", body: "kept" })]).map(
      ({ body }) => body,
    ),
    ["kept"],
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

test("each Important or Unsure finding goes on its line, or on its file off the diff, or in one comment off the pull request's files", async () => {
  const { calls, callGitHub } = fakeGitHub((body) =>
    body.line === 12 || body.subject_type === "file"
      ? body.path !== "apps/wnba/page/js/app.js"
      : body.path === undefined,
  );
  const onDiff = finding({ weight: "Important", body: "on the diff" });
  const offFile = finding({
    weight: "Important",
    path: "apps/wnba/page/js/app.js",
    line: 192,
    body: "elsewhere",
  });
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [onDiff, finding({ weight: "Unsure", line: 400, body: "off the diff" }), offFile],
    posted: new Map(),
  });
  assert.deepEqual(result, { weights: ["Important", "Unsure", "Important"], repeated: 0 });
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
    /^\*\*Unsure\*\* \(about line 400\) off the diff\n\n<!-- claude-finding/,
  );
  assert.equal(calls[2].body.subject_type, "file");
  assert.equal(calls.at(-1)?.path, "/issues/7/comments");
  assert.ok(
    calls
      .at(-1)
      ?.body.body.startsWith(
        `${OFF_DIFF_HEADING}\n\n- \`apps/wnba/page/js/app.js:192\`: **Important** elsewhere`,
      ),
  );
});

test("a review's Nits and Pre-existing findings go together in one checklist on the first's file, each item naming its place and keeping its body whole", async () => {
  const { calls, callGitHub } = fakeGitHub(() => true);
  const important = finding({ weight: "Important", body: "a bug" });
  const nit = finding({
    path: "apps/mlb/page/js/app.js",
    line: 30,
    body: "a nit, with code:\n\n```js\na();\n```",
  });
  const old = finding({ weight: "Pre-existing", line: 0, body: "from before" });
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [important, nit, old],
    posted: new Map(),
  });
  assert.deepEqual(result, { weights: ["Important", "Nit", "Pre-existing"], repeated: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.line, 12);
  assert.deepEqual(calls[1], {
    path: "/pulls/7/comments",
    isTaken: true,
    body: {
      body: [
        LIST_HEADING,
        "",
        "- [ ] `apps/mlb/page/js/app.js:30`: **Nit** a nit, with code:",
        "",
        "  ```js",
        "  a();",
        "  ```",
        `  ${writeFindingMark(nameFinding(nit), SHA)}`,
        "- [ ] `shared/page/sheet.js`: **Pre-existing** from before",
        `  ${writeFindingMark(nameFinding(old), SHA)}`,
      ].join("\n"),
      commit_id: SHA,
      path: "apps/mlb/page/js/app.js",
      subject_type: "file",
    },
  });
});

test("the checklist goes on the next of its files when GitHub won't take the first's, and off the pull request's files when it takes none", async () => {
  const nits = [
    finding({ path: "apps/wnba/page/js/app.js", body: "elsewhere" }),
    finding({ body: "on the diff" }),
  ];
  const onSheet = fakeGitHub((body) => body.path === "shared/page/sheet.js");
  await postFindings(onSheet.callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: nits,
    posted: new Map(),
  });
  assert.deepEqual(
    onSheet.calls.map(({ body, isTaken }) => [body.path, isTaken]),
    [
      ["apps/wnba/page/js/app.js", false],
      ["shared/page/sheet.js", true],
    ],
  );
  assert.match(onSheet.calls[1].body.body, /elsewhere[^]*on the diff/);
  const offFiles = fakeGitHub((body) => body.path === undefined);
  const result = await postFindings(offFiles.callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: nits,
    posted: new Map(),
  });
  assert.deepEqual(result, { weights: ["Nit", "Nit"], repeated: 0 });
  assert.equal(offFiles.calls.at(-1)?.path, "/issues/7/comments");
  assert.match(
    offFiles.calls.at(-1)?.body.body,
    /^Findings on files[^]*\n- `apps\/wnba\/page\/js\/app\.js:12`: \*\*Nit\*\* elsewhere\n[^]*\n- `shared\/page\/sheet\.js:12`: \*\*Nit\*\* on the diff\n/,
  );
});

test("a checklist or a comment off the pull request's files too long for one comment goes in several, each under GitHub's limit", async () => {
  const long = (/** @type {number} */ index) => `${index} ${"x".repeat(5000)}`;
  const nits = Array.from({ length: 25 }, (_, index) =>
    finding({ line: index + 1, body: long(index) }),
  );
  for (const isFileTaken of [true, false]) {
    const { calls, callGitHub } = fakeGitHub(
      (body) => body.path === undefined || (isFileTaken && body.subject_type === "file"),
    );
    const result = await postFindings(callGitHub, {
      pullNumber: "7",
      sha: SHA,
      findings: nits,
      posted: new Map(),
    });
    assert.equal(result.weights.length, 25);
    const taken = calls.filter((call) => call.isTaken);
    assert.equal(taken.length, 3, String(isFileTaken));
    assert.ok(taken.every(({ body }) => body.body.length < 65536));
    const heading = isFileTaken ? LIST_HEADING : OFF_DIFF_HEADING;
    assert.ok(taken.every(({ body }) => body.body.startsWith(`${heading}\n\n`)));
    assert.deepEqual(
      [
        ...taken
          .map(({ body }) => body.body)
          .join("")
          .matchAll(/(\d+) x{5000}/g),
      ].map(([, index]) => Number(index)),
      nits.map((_, index) => index),
    );
  }
});

test("a finding that names no line goes on its file without one, or off the pull request's files by its file alone", async () => {
  const { calls, callGitHub } = fakeGitHub(
    (body) =>
      body.path === undefined ||
      (body.subject_type === "file" && body.path !== "apps/wnba/page/js/app.js"),
  );
  const wholeFile = listToPost([
    finding({ verdict: "confirmed", weight: "Important", line: 0, body: "whole file" }),
  ]);
  const offFile = finding({
    weight: "Unsure",
    path: "apps/wnba/page/js/app.js",
    line: 0,
    body: "elsewhere",
  });
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [...wholeFile, offFile],
    posted: new Map(),
  });
  assert.deepEqual(result, { weights: ["Important", "Unsure"], repeated: 0 });
  assert.ok(calls.every(({ body }) => body.line === undefined));
  assert.match(calls[0].body.body, /^\*\*Important\*\* whole file\n\n<!-- claude-finding/);
  assert.equal(calls[0].body.subject_type, "file");
  assert.ok(
    calls
      .at(-1)
      ?.body.body.startsWith(
        `${OFF_DIFF_HEADING}\n\n- \`apps/wnba/page/js/app.js\`: **Unsure** elsewhere`,
      ),
  );
});

test("a finding whose line is missing or isn't a whole number goes on its file without one, or off the pull request's files by its file alone", async () => {
  const findings = listToPost([
    { verdict: "confirmed", weight: "Important", path: "shared/page/sheet.js", body: "no line" },
    finding({
      verdict: "unsure",
      path: "shared/page/tape.js",
      line: "3",
      body: "a line as text",
    }),
  ]);
  for (const isFileTaken of [true, false]) {
    const { calls, callGitHub } = fakeGitHub(
      (body) => body.path === undefined || (isFileTaken && body.subject_type === "file"),
    );
    const result = await postFindings(callGitHub, {
      pullNumber: "7",
      sha: SHA,
      findings,
      posted: new Map(),
    });
    assert.deepEqual(result, { weights: ["Important", "Unsure"], repeated: 0 });
    assert.ok(calls.every(({ body }) => body.line === undefined));
    const onFiles = calls.filter(({ body }) => body.subject_type === "file");
    assert.deepEqual(
      onFiles.map(({ path, body }) => [path, body.path]),
      [
        ["/pulls/7/comments", "shared/page/sheet.js"],
        ["/pulls/7/comments", "shared/page/tape.js"],
      ],
    );
    assert.match(onFiles[0].body.body, /^\*\*Important\*\* no line\n\n<!-- claude-finding/);
    assert.match(onFiles[1].body.body, /^\*\*Unsure\*\* a line as text\n\n<!-- claude-finding/);
    if (isFileTaken) {
      assert.equal(calls.length, 2);
    } else {
      assert.equal(calls.at(-1)?.path, "/issues/7/comments");
      assert.match(
        calls.at(-1)?.body.body,
        /\n- `shared\/page\/sheet\.js`: \*\*Important\*\* no line\n[^]*\n- `shared\/page\/tape\.js`: \*\*Unsure\*\* a line as text\n/,
      );
    }
  }
});

test("a finding said twice word for word is posted once, at the heaviest weight the check settled", () => {
  const posted = (/** @type {ReturnType<typeof finding>[]} */ judged) =>
    listToPost(judged).map(({ weight, line, body }) => [weight, line, body]);
  assert.deepEqual(
    posted([
      finding({ verdict: "confirmed", weight: "Nit", line: 30, body: "said twice" }),
      finding({ verdict: "confirmed", weight: "Important", line: 12, body: "said twice" }),
    ]),
    [["Important", 30, "said twice"]],
  );
  assert.deepEqual(
    posted([
      finding({ verdict: "unsure", weight: "Important", line: 12, body: "said twice" }),
      finding({ verdict: "confirmed", weight: "Nit", line: 30, body: "said twice" }),
    ]),
    [["Nit", 12, "said twice"]],
  );
});

test("a refusal that isn't about the line stops the step, so a re-run posts the finding once", async () => {
  for (const weight of ["Important", "Nit"]) {
    const { calls, callGitHub } = fakeGitHub(() => false, 502);
    await assert.rejects(
      postFindings(callGitHub, {
        pullNumber: "7",
        sha: SHA,
        findings: [finding({ weight })],
        posted: new Map(),
      }),
      /GitHub answered 502/,
    );
    assert.equal(calls.length, 1, weight);
  }
});

test("a file comment GitHub refuses for another reason than the line stops the step too, rather than listing the finding off the pull request's files", async () => {
  /** @type {any[]} */
  const calls = [];
  const callGitHub = async (/** @type {string} */ path, /** @type {any} */ request = {}) => {
    calls.push({ path, body: request.body });
    throw new GitHubError(request.body.subject_type === "file" ? 502 : 422, `POST ${path}`);
  };
  await assert.rejects(
    postFindings(callGitHub, {
      pullNumber: "7",
      sha: SHA,
      findings: [finding({ weight: "Important" })],
      posted: new Map(),
    }),
    /GitHub answered 502/,
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.path === "/pulls/7/comments"));
});

test("a finding already posted in any form isn't posted again, and counts as new only from this head", async () => {
  const offFile = finding({ weight: "Important", line: 400, body: "posted on its file" });
  const listed = finding({ body: "posted in the checklist" });
  const fromEarlier = finding({ body: "an earlier head's" });
  const fresh = finding({ body: "new" });
  const { calls: first, callGitHub: postOnce } = fakeGitHub((body) => body.line !== 400);
  await postFindings(postOnce, {
    pullNumber: "7",
    sha: SHA,
    findings: [offFile, listed],
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
      body: writeFindingMark(nameFinding(fresh), EARLIER),
    },
  ];
  const readGitHub = async (/** @type {string} */ path) =>
    path.startsWith("/pulls/7/comments?per_page=100&page=1") ? comments : [];
  const { calls, callGitHub } = fakeGitHub(() => true);
  const result = await postFindings(callGitHub, {
    pullNumber: "7",
    sha: SHA,
    findings: [offFile, listed, fromEarlier, fresh],
    posted: listPosted(await readReviewComments(readGitHub, "7")),
  });
  assert.deepEqual(result, { weights: ["Important", "Nit", "Nit"], repeated: 1 });
  assert.deepEqual(
    calls.map((call) => call.body.body.split("\n").slice(2)),
    [
      [
        "- [ ] `shared/page/sheet.js:12`: **Nit** new",
        `  ${writeFindingMark(nameFinding(fresh), SHA)}`,
      ],
    ],
  );
});

test("the posting step reads every finding already on the pull request, and the check across areas' answer", async () => {
  const folder = mkdtempSync(join(tmpdir(), "post-review-"));
  const onLine = finding({ body: "on its line" });
  const offFile = finding({ path: "apps/wnba/page/js/app.js", body: "elsewhere" });
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
  const inputs = { folder, pullNumber: "7" };
  await assert.rejects(
    readPostInputs(callGitHub, inputs),
    /check across areas didn't leave its answer/,
  );
  const items = [
    { ...onLine, ids: ["1.1"], verdict: "confirmed" },
    { ...offFile, ids: ["1.2", "2.1"], verdict: "confirmed" },
    { ...finding({ body: "spans two areas" }), ids: [], verdict: "confirmed" },
    { ...finding({ body: "turned down" }), ids: ["2.2"], verdict: "rejected" },
  ];
  writeFileSync(join(folder, ACROSS_RECORD), JSON.stringify({ items, unjudged: [] }));
  const read = await readPostInputs(callGitHub, inputs);
  assert.deepEqual(
    read.findings.map((item) => item.body),
    ["on its line", "elsewhere", "spans two areas"],
  );
  assert.deepEqual([...(read.posted.get(nameFinding(onLine)) ?? [])], [EARLIER]);
  assert.deepEqual([...(read.posted.get(nameFinding(offFile)) ?? [])], [EARLIER]);
});
