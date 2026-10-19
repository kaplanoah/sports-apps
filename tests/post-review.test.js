import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubError } from "../worker/github-api.mjs";
import {
  LIST_HEADING,
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
import { OFF_DIFF_HEADING, readReviewComments, writeFindingMark } from "../worker/review-state.mjs";

/** @typedef {import("../worker/post-review.mjs").Across} Across */

const SHA = "a".repeat(40);
const EARLIER = "e".repeat(40);

const finding = (/** @type {object} */ fields) => ({
  weight: "Nit",
  path: "shared/page/sheet.js",
  line: 12,
  body: "The comment names a file that's gone.",
  ...fields,
});

/**
 * Groups of repeats that keep their first finding's words.
 * @param {string[][]} groups
 */
const repeats = (groups) => groups.map((refs) => ({ refs, body: "" }));

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
    duplicates: repeats([["2.2", "1.1"]]),
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
    listToPost(checked, { duplicates: repeats(duplicates), added: [], unjudged: [] }).map(
      (item) => item.body,
    );
  assert.deepEqual(posted([["9.9", "1.1"]]), ["a bug", "can't settle", "a nit"]);
  assert.deepEqual(posted([["1.1", "1.1"]]), ["a bug", "can't settle", "a nit"]);
  assert.deepEqual(
    posted([
      ["1.1", "2.2"],
      ["2.2", "1.1"],
    ]),
    ["a nit", "can't settle"],
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
    ["a nit", "can't settle"],
  );
});

test("a finding that stands in for its repeats takes the heaviest weight a checker settled", () => {
  const checked = listCheckedFindings(CHECKS);
  const posted = (/** @type {string[][]} */ duplicates) =>
    listToPost(checked, { duplicates: repeats(duplicates), added: [], unjudged: [] }).map(
      ({ weight, body }) => [weight, body],
    );
  assert.deepEqual(posted([["1.1", "2.2"]]), [
    ["Important", "a nit"],
    ["Unsure", "can't settle"],
  ]);
  assert.deepEqual(posted([["2.2", "1.1"]]), [
    ["Important", "a bug"],
    ["Unsure", "can't settle"],
  ]);
  assert.deepEqual(posted([["1.1", "2.1"]]), [
    ["Important", "a bug"],
    ["Nit", "a nit"],
  ]);
  assert.deepEqual(posted([["2.1", "1.1"]]), [
    ["Important", "a bug"],
    ["Nit", "can't settle"],
  ]);
  assert.deepEqual(
    posted([
      ["2.2", "1.1"],
      ["2.1", "2.2"],
    ]),
    [
      ["Important", "a bug"],
      ["Unsure", "can't settle"],
    ],
  );
});

test("a finding that can't be posted neither leads nor joins a group", () => {
  const unpostable = [
    finding({ weight: "Minor", body: "odd weight" }),
    finding({ weight: "Important", body: "" }),
    finding({ weight: "Important", path: "", body: "nowhere" }),
  ];
  for (const bad of unpostable) {
    const checked = [
      { ...finding({ weight: "Unsure", body: "can't settle" }), ref: "1.1" },
      { ...bad, ref: "2.1" },
    ];
    const posted = (/** @type {string[][]} */ duplicates) =>
      listToPost(checked, { duplicates: repeats(duplicates), added: [], unjudged: [] }).map(
        ({ weight, body }) => [weight, body],
      );
    assert.deepEqual(posted([["1.1", "2.1"]]), [["Unsure", "can't settle"]], bad.body);
    assert.deepEqual(posted([["2.1", "1.1"]]), [["Unsure", "can't settle"]], bad.body);
    assert.deepEqual(posted([["2.1"]]), [["Unsure", "can't settle"]], bad.body);
  }
});

test("a finding of another shape the check across areas added is left out rather than stopping the post", () => {
  const checks = [{ area: 1, items: [finding({ verdict: "confirmed" })] }];
  const across = readAcross(
    JSON.stringify({
      duplicates: [],
      added: [
        null,
        "a string",
        { weight: "Nit", path: 3, body: "a number for a path" },
        { weight: "Nit", path: "a.js", body: 5 },
      ],
      unjudged: [
        null,
        "a string",
        { why: "names no file" },
        { file: "b.js" },
        { file: "a.js", why: "too big" },
      ],
    }),
  );
  assert.deepEqual(across?.unjudged, [{ file: "a.js", why: "too big" }]);
  assert.deepEqual(
    listToPost(listCheckedFindings(checks), across).map(({ body }) => body),
    [finding({}).body],
  );
});

test("a check across areas that gave no answer, or one of another shape, reads as none", () => {
  assert.equal(readAcross(undefined), null);
  assert.equal(readAcross("not json"), null);
  assert.equal(readAcross('{"findings": []}'), null);
  const duplicates = [
    { refs: ["1.1", "2.1"], body: "in both apps" },
    null,
    ["1.2"],
    "1.3",
    { refs: "1.4" },
    { refs: ["1.5", 5] },
    { refs: ["1.6"], body: 6 },
  ];
  assert.deepEqual(readAcross(JSON.stringify({ duplicates, added: [], unjudged: "x" })), {
    duplicates: [
      { refs: ["1.1", "2.1"], body: "in both apps" },
      { refs: ["1.6"], body: "" },
    ],
    added: [],
    unjudged: [],
  });
});

test("a finding that stands in for its repeats says what the check across areas wrote of every place, or else keeps its own words", () => {
  const checked = listCheckedFindings(CHECKS);
  const posted = (/** @type {Across["duplicates"]} */ duplicates) =>
    listToPost(checked, { duplicates, added: [], unjudged: [] }).map(({ path, line, body }) => [
      path,
      line,
      body,
    ]);
  assert.deepEqual(posted([{ refs: ["2.2", "1.1"], body: "a bug, here and in mlb" }]), [
    ["shared/page/sheet.js", 12, "a bug, here and in mlb"],
    ["shared/page/sheet.js", 12, "can't settle"],
  ]);
  assert.deepEqual(posted([{ refs: ["2.2", "1.1"], body: "" }]), [
    ["shared/page/sheet.js", 12, "a bug"],
    ["shared/page/sheet.js", 12, "can't settle"],
  ]);
  for (const [lastWords, shown] of [
    ["the bug in both apps and the nit", "the bug in both apps and the nit"],
    ["", "the bug in both apps"],
  ])
    assert.deepEqual(
      posted([
        { refs: ["2.2", "1.1"], body: "the bug in both apps" },
        { refs: ["2.2", "2.1"], body: lastWords },
      ]),
      [["shared/page/sheet.js", 12, shown]],
      `a second group led by the same ref, with ${lastWords ? "words" : "none"}`,
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
  const checks = [
    {
      area: 1,
      items: [finding({ verdict: "confirmed", weight: "Important", line: 0, body: "whole file" })],
    },
  ];
  const wholeFile = listToPost(listCheckedFindings(checks), null);
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
  const checks = [
    {
      area: 1,
      items: [
        {
          verdict: "confirmed",
          weight: "Important",
          path: "shared/page/sheet.js",
          body: "no line",
        },
      ],
    },
  ];
  const across = readAcross(
    JSON.stringify({
      duplicates: [],
      added: [
        finding({
          weight: "Unsure",
          path: "shared/page/tape.js",
          line: "3",
          body: "a line as text",
        }),
      ],
      unjudged: [],
    }),
  );
  const findings = listToPost(listCheckedFindings(checks), across);
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

test("a finding said twice word for word is posted once, at the heaviest weight a checker settled", () => {
  const posted = (
    /** @type {ReturnType<typeof finding>[]} */ checked,
    /** @type {ReturnType<typeof finding>[]} */ added,
  ) =>
    listToPost(
      checked.map((item, index) => ({ ...item, ref: `1.${index + 1}` })),
      { duplicates: [], added, unjudged: [] },
    ).map(({ weight, line, body }) => [weight, line, body]);
  assert.deepEqual(
    posted(
      [finding({ weight: "Nit", line: 30, body: "said twice" })],
      [finding({ weight: "Important", line: 12, body: "said twice" })],
    ),
    [["Important", 30, "said twice"]],
  );
  assert.deepEqual(
    posted(
      [finding({ weight: "Unsure", line: 12, body: "said twice" })],
      [finding({ weight: "Nit", line: 30, body: "said twice" })],
    ),
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
    duplicates: repeats([["1.1", "2.1"]]),
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

test("a stage of one area posts its checker's findings with no check across areas", async () => {
  const folder = mkdtempSync(join(tmpdir(), "post-review-"));
  writeFileSync(
    join(folder, "check-push-1.json"),
    JSON.stringify({
      items: [{ ...finding({ body: "alone" }), ids: ["bugs-1"], verdict: "confirmed" }],
      unjudged: [],
    }),
  );
  const read = await readPostInputs(async () => [], {
    folder,
    stage: "push",
    areaCount: 1,
    pullNumber: "7",
  });
  assert.deepEqual(
    read.findings.map((item) => item.body),
    ["alone"],
  );
  assert.equal(read.across, null);
});
