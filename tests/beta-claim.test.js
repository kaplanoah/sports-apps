import test from "node:test";
import assert from "node:assert/strict";
import {
  BETA_LABEL,
  FREE_MESSAGE,
  WAIT_LABEL,
  checkBetaDeploy,
  decideBetaDeploy,
  describePlan,
  findHolder,
  formatTakenMessage,
  isReleased,
  listLine,
  planQueue,
  updateQueue,
} from "../worker/beta-claim.mjs";
import { GitHubError } from "../worker/github-api.mjs";
import { readRepoFile } from "./repo-files.js";

/** @typedef {import('../worker/beta-claim.mjs').PullRequest} PullRequest */
/** @typedef {import('../worker/labeling.mjs').TimelineEvent} TimelineEvent */

/** @param {number} minute */
const at = (minute) => `2026-10-20T12:${String(minute).padStart(2, "0")}:00Z`;

/**
 * @param {string} type labeled or unlabeled
 * @param {string} label
 * @param {number} minute
 * @returns {TimelineEvent}
 */
const createLabelEvent = (type, label, minute) => ({
  event: type,
  created_at: at(minute),
  label: { name: label },
  actor: { login: "owner" },
});

/**
 * @param {string} label
 * @param {number} minute
 */
const addLabel = (label, minute) => createLabelEvent("labeled", label, minute);

/**
 * @param {string} label
 * @param {number} minute
 */
const removeLabel = (label, minute) => createLabelEvent("unlabeled", label, minute);

/**
 * The comment that tells a pull request beta is free, as the workflow posts it.
 * @param {number} minute
 * @returns {TimelineEvent}
 */
const tell = (minute) => ({
  event: "commented",
  created_at: at(minute),
  body: `${FREE_MESSAGE}\n\n<!-- beta-free -->`,
});

/**
 * The comment that tells a pull request `holder` took beta before it claimed it, as the workflow
 * posts it.
 * @param {number} minute
 * @param {number} holder
 * @returns {TimelineEvent}
 */
const noteTaken = (minute, holder) => ({
  event: "commented",
  created_at: at(minute),
  body: `${formatTakenMessage(holder)}\n\n<!-- beta-taken -->`,
});

/** @param {number} number */
const nameHead = (number) => String(number).repeat(40).slice(0, 40);

/**
 * The labels a timeline leaves on a pull request.
 * @param {TimelineEvent[]} events
 */
function listLabels(events) {
  const labels = new Set();
  for (const { event, label } of events) {
    if (event === "labeled" && label) labels.add(label.name);
    if (event === "unlabeled" && label) labels.delete(label.name);
  }
  return [...labels];
}

/**
 * A pull request with these events on its timeline, pushed at minute 0 unless it says otherwise.
 * @param {number} number
 * @param {TimelineEvent[]} events
 * @param {{ pushedAt?: number, isOpen?: boolean }} [state]
 * @returns {PullRequest}
 */
const createPull = (number, events, { pushedAt = 0, isOpen = true } = {}) => ({
  number,
  isOpen,
  headSha: nameHead(number),
  labels: listLabels(events),
  events,
  headPushedAt: Date.parse(at(pushedAt)),
});

/**
 * The pull requests as GitHub has them once a run's plan is done at `minute`.
 * @param {PullRequest[]} pulls
 * @param {ReturnType<typeof planQueue>} plan
 * @param {number} minute
 */
const applyPlan = (pulls, plan, minute) =>
  pulls.map((pull) => {
    const events = [
      ...pull.events,
      ...plan.changes
        .filter(({ number }) => number === pull.number)
        .map(({ label, isAdded }) => (isAdded ? addLabel : removeLabel)(label, minute)),
      ...(plan.told === pull.number ? [tell(minute)] : []),
      ...(plan.taken === pull.number && plan.holder ? [noteTaken(minute, plan.holder)] : []),
    ];
    return { ...pull, events, labels: listLabels(events) };
  });

/**
 * Adds events to one pull request.
 * @param {PullRequest[]} pulls
 * @param {number} number
 * @param {TimelineEvent[]} events
 */
const addEvents = (pulls, number, events) =>
  pulls.map((pull) => {
    if (pull.number !== number) return pull;
    const all = [...pull.events, ...events];
    return { ...pull, events: all, labels: listLabels(all) };
  });

/** @param {PullRequest[]} pulls */
const listLineNumbers = (pulls) => listLine(pulls).map(({ number }) => number);

test("of two pull requests labeled beta, the one labeled first holds it, in either order", () => {
  const first = createPull(7, [addLabel(BETA_LABEL, 2)]);
  const second = createPull(3, [addLabel(BETA_LABEL, 5)]);
  assert.equal(findHolder([first, second])?.number, 7);
  assert.equal(findHolder([second, first])?.number, 7);
  assert.equal(findHolder([]), null);
});

test("a push to beta deploys only the head of the pull request that holds it", () => {
  const holder = createPull(7, [addLabel(BETA_LABEL, 2)]);
  const later = createPull(3, [addLabel(BETA_LABEL, 5)]);
  const other = createPull(9, [addLabel("bug", 1)]);
  const pulls = [holder, later, other];

  const allowed = decideBetaDeploy(pulls, nameHead(7));
  assert.equal(allowed.mayDeploy, true);
  assert.match(allowed.message, /#7 has held beta since 2026-10-20T12:02:00Z/);

  for (const commit of [nameHead(3), nameHead(9), "f".repeat(40)]) {
    const refused = decideBetaDeploy(pulls, commit);
    assert.equal(refused.mayDeploy, false, commit);
    assert.equal(
      refused.message,
      `#7 has held beta since 2026-10-20T12:02:00Z, and ${commit.slice(0, 7)} isn't its head, so nothing was deployed to beta.`,
    );
  }
});

test("a push to beta deploys nothing when no pull request holds beta", () => {
  for (const pulls of [[], [createPull(7, [addLabel(BETA_LABEL, 2)], { pushedAt: 4 })]]) {
    const refused = decideBetaDeploy(pulls, nameHead(7));
    assert.equal(refused.mayDeploy, false);
    assert.match(
      refused.message,
      /^No open pull request holds beta, so nothing was deployed to beta\./,
    );
  }
});

test("a push to beta deploys nothing when GitHub can't say who holds beta", async () => {
  const refused = await checkBetaDeploy(nameHead(7), async () => {
    throw new GitHubError(502, "GET /pulls?state=open");
  });
  assert.deepEqual(refused, {
    mayDeploy: false,
    message:
      "GitHub couldn't say who holds beta (GitHub answered 502 for GET /pulls?state=open), so nothing was deployed to beta.",
  });
  const allowed = await checkBetaDeploy(nameHead(7), async () => [
    createPull(7, [addLabel(BETA_LABEL, 2)]),
  ]);
  assert.equal(allowed.mayDeploy, true);
});

test("a pull request gives beta up when it closes or merges, is pushed after its label, or gets phone-ok after it", () => {
  const claimed = addLabel(BETA_LABEL, 5);
  assert.equal(isReleased(createPull(7, [claimed], { isOpen: false })), true, "closed or merged");
  assert.equal(isReleased(createPull(7, [claimed], { pushedAt: 6 })), true, "pushed after");
  const forcePush = { event: "head_ref_force_pushed", created_at: at(6) };
  assert.equal(isReleased(createPull(7, [claimed, forcePush])), true, "force pushed after");
  assert.equal(isReleased(createPull(7, [claimed, addLabel("phone-ok", 6)])), true, "phone-ok");
});

test("a pull request keeps beta through a push before its label, an older phone-ok, a comment, or another label", () => {
  const claimed = addLabel(BETA_LABEL, 5);
  assert.equal(isReleased(createPull(7, [claimed], { pushedAt: 4 })), false, "pushed before");
  assert.equal(
    isReleased(createPull(7, [addLabel("phone-ok", 1), claimed])),
    false,
    "phone-ok before",
  );
  const comment = { event: "commented", created_at: at(6), body: "Looks good." };
  assert.equal(isReleased(createPull(7, [claimed, comment])), false, "comment");
  assert.equal(isReleased(createPull(7, [claimed, addLabel("review", 6)])), false, "another label");
});

test("a run puts every holder and waiter right whatever event started it, a run after a dropped one too", () => {
  // Three label changes, of which GitHub kept only the last run.
  const pulls = [
    createPull(4, [addLabel(BETA_LABEL, 3)]),
    createPull(5, [addLabel(BETA_LABEL, 1)]),
    createPull(6, [addLabel(BETA_LABEL, 2)]),
    createPull(8, [addLabel(WAIT_LABEL, 1), addLabel(BETA_LABEL, 4)], { isOpen: false }),
  ];
  const plan = planQueue(pulls);
  assert.deepEqual(planQueue(pulls.toReversed()), {
    ...plan,
    changes: plan.changes.toSorted((first, second) => second.number - first.number),
  });
  assert.equal(plan.holder, 5);
  assert.deepEqual(plan.changes, [
    { number: 4, label: BETA_LABEL, isAdded: false },
    { number: 4, label: WAIT_LABEL, isAdded: true },
    { number: 6, label: BETA_LABEL, isAdded: false },
    { number: 6, label: WAIT_LABEL, isAdded: true },
    { number: 8, label: BETA_LABEL, isAdded: false },
    { number: 8, label: WAIT_LABEL, isAdded: false },
  ]);
  assert.equal(plan.told, null);

  const after = applyPlan(pulls, plan, 10);
  assert.deepEqual(planQueue(after), { holder: 5, changes: [], told: null, taken: null });
  assert.deepEqual(listLineNumbers(after), [4, 6]);
});

test("a run that frees beta tells the next in line in the same run", () => {
  const pulls = [
    createPull(5, [addLabel(BETA_LABEL, 1)], { pushedAt: 8 }),
    createPull(6, [addLabel(WAIT_LABEL, 2)]),
  ];
  assert.deepEqual(planQueue(pulls), {
    holder: null,
    changes: [{ number: 5, label: BETA_LABEL, isAdded: false }],
    told: 6,
    taken: null,
  });
});

test("once beta is free, the pull request that has waited longest is told, and only once", () => {
  const waiting = [
    createPull(4, [addLabel(WAIT_LABEL, 3)]),
    createPull(6, [addLabel(WAIT_LABEL, 1)]),
  ];
  const plan = planQueue(waiting);
  assert.equal(plan.told, 6);
  const told = applyPlan(waiting, plan, 10);
  assert.equal(
    planQueue(told).told,
    null,
    "not twice, and not the next while the first has its turn",
  );

  const dropped = addEvents(told, 6, [removeLabel(WAIT_LABEL, 11)]);
  assert.equal(planQueue(dropped).told, 4);
});

test("no one is told while beta is held, or when no one waits", () => {
  const held = [createPull(5, [addLabel(BETA_LABEL, 2)]), createPull(6, [addLabel(WAIT_LABEL, 1)])];
  assert.equal(planQueue(held).told, null);
  assert.equal(planQueue([]).told, null);
  assert.equal(planQueue([createPull(5, [addLabel("bug", 1)])]).told, null);
});

test("the later of two pull requests labeled beta goes in line with beta-wait", () => {
  const pulls = [
    createPull(5, [addLabel(BETA_LABEL, 1)]),
    createPull(6, [addLabel(BETA_LABEL, 2)]),
  ];
  const after = applyPlan(pulls, planQueue(pulls), 3);
  assert.deepEqual(
    after.map(({ number, labels }) => ({ number, labels })),
    [
      { number: 5, labels: [BETA_LABEL] },
      { number: 6, labels: [WAIT_LABEL] },
    ],
  );
});

test("a pull request put on beta now holds it, the one it replaced is last in line, and a waiter told meanwhile can be told again", () => {
  let pulls = [
    createPull(1, [addLabel(BETA_LABEL, 1)]),
    createPull(2, [addLabel(WAIT_LABEL, 2)]),
    createPull(3, []),
  ];
  // The session for #3 takes beta off the holder and puts it in line.
  pulls = addEvents(pulls, 1, [removeLabel(BETA_LABEL, 10), addLabel(WAIT_LABEL, 10)]);
  const freed = planQueue(pulls);
  assert.equal(freed.told, 2);
  pulls = applyPlan(pulls, freed, 11);
  // #3 claims, and #2, told meanwhile, claims after it.
  pulls = addEvents(pulls, 3, [addLabel(BETA_LABEL, 12)]);
  pulls = addEvents(pulls, 2, [addLabel(BETA_LABEL, 13)]);
  const claimed = planQueue(pulls);
  assert.equal(claimed.holder, 3);
  assert.deepEqual(claimed.changes, [{ number: 2, label: BETA_LABEL, isAdded: false }]);
  pulls = applyPlan(pulls, claimed, 14);
  assert.deepEqual(listLineNumbers(pulls), [2, 1]);

  // The owner's phone-ok frees beta, and #2 is told again.
  pulls = addEvents(pulls, 3, [addLabel("phone-ok", 20)]);
  assert.equal(planQueue(pulls).told, 2);
});

test("a waiter told before another takes beta is told it stays first in line, once while that one holds it", () => {
  let pulls = [createPull(2, [addLabel(WAIT_LABEL, 2), tell(5)]), createPull(3, [])];
  // The owner puts #3 on beta now, before #2 claims it.
  pulls = addEvents(pulls, 3, [addLabel(BETA_LABEL, 6)]);
  const taken = planQueue(pulls);
  assert.deepEqual(taken, { holder: 3, changes: [], told: null, taken: 2 });
  pulls = applyPlan(pulls, taken, 7);
  assert.equal(planQueue(pulls).taken, null, "not twice while #3 holds beta");
  pulls = addEvents(pulls, 3, [addLabel("review", 8)]);
  assert.equal(planQueue(pulls).taken, null, "not on a later run either");
});

test("a waiter told it stays first in line is told again once beta is free", () => {
  const pulls = [
    createPull(2, [addLabel(WAIT_LABEL, 2), tell(5), noteTaken(7, 3)]),
    createPull(3, [addLabel(BETA_LABEL, 6)], { isOpen: false }),
  ];
  assert.equal(planQueue(pulls).told, 2);
});

test("a waiter told with no one taking beta since isn't told again while beta is free", () => {
  const pulls = [
    createPull(2, [addLabel(WAIT_LABEL, 2), tell(5), noteTaken(4, 3)]),
    createPull(4, [addLabel(WAIT_LABEL, 3)]),
  ];
  assert.deepEqual(planQueue(pulls), { holder: null, changes: [], told: null, taken: null });
});

/**
 * A fake GitHub that answers from these pull requests and records each request.
 * @param {{ open: object[], closed: { number: number, pull_request: object, labels: { name: string }[] }[], timelines: Record<number, TimelineEvent[]>, missingLabels?: string[] }} state
 */
function createGitHubFake({ open, closed, timelines, missingLabels = [] }) {
  /** @type {{ method: string, path: string, body?: unknown }[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const path = String(url).replace("https://api.github.com/repos/owner/repo", "");
    const method = init?.method ?? "GET";
    requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const labelName = path.match(/^\/labels\/([\w-]+)$/)?.[1];
    if (labelName && missingLabels.includes(labelName)) return new Response("", { status: 404 });
    if (path.startsWith("/pulls?state=open")) return Response.json(open);
    if (path.startsWith("/issues?state=closed&labels=")) {
      const label = path.match(/labels=([\w-]+)/)?.[1];
      return Response.json(
        closed.filter((issue) => issue.labels.some(({ name }) => name === label)),
      );
    }
    const timeline = path.match(/^\/issues\/(\d+)\/timeline/)?.[1];
    if (timeline) return Response.json(timelines[Number(timeline)] ?? []);
    if (path.includes("/check-suites"))
      return Response.json({ check_suites: [{ created_at: at(0) }] });
    return Response.json({});
  };
  return { fetchImpl, requests };
}

/**
 * @param {number} number
 * @param {string[]} labels
 */
const createListedPull = (number, labels) => ({
  number,
  head: { sha: nameHead(number) },
  labels: labels.map((name) => ({ name })),
});

test("a run adds and takes off one label at a time, comments to tell the next in line, and makes missing labels", async () => {
  const { fetchImpl, requests } = createGitHubFake({
    open: [
      createListedPull(5, [BETA_LABEL, "phone-ok"]),
      createListedPull(6, [WAIT_LABEL]),
      createListedPull(9, ["bug"]),
    ],
    closed: [{ number: 8, pull_request: {}, labels: [{ name: WAIT_LABEL }] }],
    timelines: {
      5: [addLabel(BETA_LABEL, 1), addLabel("phone-ok", 2)],
      6: [addLabel(WAIT_LABEL, 1)],
    },
    missingLabels: [WAIT_LABEL],
  });
  const plan = await updateQueue({ repository: "owner/repo", fetchImpl, env: { GH_TOKEN: "t" } });
  assert.deepEqual(plan, {
    holder: null,
    changes: [
      { number: 5, label: BETA_LABEL, isAdded: false },
      { number: 8, label: WAIT_LABEL, isAdded: false },
    ],
    told: 6,
    taken: null,
  });
  const writes = requests.filter(({ method }) => method !== "GET");
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/labels",
      body: {
        name: WAIT_LABEL,
        color: "c5def5",
        description: "Waits in line for the beta channel",
      },
    },
    { method: "DELETE", path: "/issues/5/labels/beta", body: undefined },
    { method: "DELETE", path: "/issues/8/labels/beta-wait", body: undefined },
    {
      method: "POST",
      path: "/issues/6/comments",
      body: { body: `${FREE_MESSAGE}\n\n<!-- beta-free -->` },
    },
  ]);
  assert.ok(
    !requests.some(({ path }) => path.startsWith("/issues/9/")),
    "an unlabeled one isn't read",
  );
});

test("a run comments on a waiter told before another took beta that it stays first in line", async () => {
  const { fetchImpl, requests } = createGitHubFake({
    open: [createListedPull(5, [BETA_LABEL]), createListedPull(6, [WAIT_LABEL])],
    closed: [],
    timelines: {
      5: [addLabel(BETA_LABEL, 3)],
      6: [addLabel(WAIT_LABEL, 1), tell(2)],
    },
  });
  const plan = await updateQueue({ repository: "owner/repo", fetchImpl, env: { GH_TOKEN: "t" } });
  assert.deepEqual(plan, { holder: 5, changes: [], told: null, taken: 6 });
  assert.deepEqual(
    requests.filter(({ path }) => path.endsWith("/comments")),
    [
      {
        method: "POST",
        path: "/issues/6/comments",
        body: {
          body: "#5 took beta before this pull request claimed it, so it stays first in line.\n\n<!-- beta-taken -->",
        },
      },
    ],
  );
});

test("a run's log says whom it told beta is free, whom it told another took beta first, or that it told no one", () => {
  const change = { number: 4, label: BETA_LABEL, isAdded: false };
  assert.equal(
    describePlan({ holder: null, changes: [change], told: 6, taken: null }),
    "Beta is free.\nTook off beta on #4.\nTold #6 beta is free.",
  );
  assert.equal(
    describePlan({ holder: 3, changes: [], told: null, taken: 2 }),
    "#3 holds beta.\nTold #2 that #3 took beta first.",
  );
  assert.equal(
    describePlan({ holder: 3, changes: [], told: null, taken: null }),
    "#3 holds beta.\nTold no one.",
  );
});

test("a run adds beta-wait beside the labels a pull request has, and a label someone took off meanwhile doesn't fail it", async () => {
  const { fetchImpl: answer, requests } = createGitHubFake({
    open: [
      createListedPull(5, [BETA_LABEL]),
      createListedPull(6, [BETA_LABEL, WAIT_LABEL]),
      createListedPull(7, [BETA_LABEL, "phone-ok", "review"]),
    ],
    closed: [],
    timelines: {
      5: [addLabel(BETA_LABEL, 1)],
      6: [addLabel(BETA_LABEL, 2), addLabel(WAIT_LABEL, 2)],
      7: [addLabel("phone-ok", 1), addLabel("review", 1), addLabel(BETA_LABEL, 3)],
    },
  });
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) =>
    init?.method === "DELETE" ? new Response("", { status: 404 }) : answer(url, init);
  const plan = await updateQueue({ repository: "owner/repo", fetchImpl, env: { GH_TOKEN: "t" } });
  assert.deepEqual(plan.changes, [
    { number: 6, label: BETA_LABEL, isAdded: false },
    { number: 7, label: BETA_LABEL, isAdded: false },
    { number: 7, label: WAIT_LABEL, isAdded: true },
  ]);
  assert.deepEqual(
    requests.filter(({ method }) => method === "POST" || method === "PUT"),
    [{ method: "POST", path: "/issues/7/labels", body: { labels: [WAIT_LABEL] } }],
  );
});

test("the Beta workflow runs main's rules on pull request events and merges to main, one run at a time across the repository", () => {
  const workflow = readRepoFile(".github/workflows/beta.yml");
  assert.match(
    workflow,
    /^on:\n {2}pull_request:\n {4}types: \[[^\]]*\bclosed\b[^\]]*\blabeled, unlabeled\]\n {2}push:\n {4}branches: \[main\]\n/m,
  );
  assert.doesNotMatch(workflow, /pull_request_target|schedule:/);
  const [, job = ""] = workflow.split(/^ {2}queue:\n/m);
  assert.match(job, /\n {4}concurrency:\n {6}group: beta\n {6}cancel-in-progress: false/);
  assert.match(job, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(job, /run: node worker\/beta-claim\.mjs queue/);
  assert.doesNotMatch(workflow.split(/^jobs:$/m)[0], /concurrency:/);
});

// Sessions wait for this comment, which the skill quotes.
test("the ship skill quotes the comment that tells a pull request beta is free", () => {
  assert.ok(readRepoFile(".claude/skills/ship/SKILL.md").includes(FREE_MESSAGE));
});

test("a push to beta checks the claim before anything deploys", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const check = workflow.indexOf('node worker/beta-claim.mjs deploy "$GITHUB_SHA"');
  assert.ok(check > 0);
  assert.ok(check < workflow.indexOf("node worker/deploy.mjs"));
  assert.ok(check < workflow.indexOf("npm ci"));
});
