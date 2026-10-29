import test from "node:test";
import assert from "node:assert/strict";
import { readNativeReviewName, readReviewConcurrency } from "./workflow-step.js";
import { readRepoFile } from "./repo-files.js";

const OWNER_PULL = { ASSOCIATION: "OWNER", HEAD_REPOSITORY: "example/repository" };
const PUSH = { ...OWNER_PULL, ACTION: "synchronize" };
const OBSERVED_LABELS = ["beta", "beta-wait", "phone-ok"];

/** @param {Record<string,string>} event */
const label = (event) => ({ ...OWNER_PULL, ACTION: "labeled", ...event });

/**
 * GitHub's rule: each group has at most one running run and one waiting run. A run that stops
 * the running one takes the group; any other new run waits, and stops the run waiting before it.
 * @param {Record<string,string>[]} events
 */
function deliverReviewEvents(events) {
  const groups = new Map();
  const runs = events.map((event) => ({
    intent: readNativeReviewName(event).split(" intent ")[1],
    ...readReviewConcurrency(event),
    stopped: false,
  }));
  for (const run of runs) {
    const group = groups.get(run.group) ?? { running: null, waiting: null };
    groups.set(run.group, group);
    if (run.cancelsRunning || !group.running) {
      for (const other of [group.running, group.waiting]) if (other) other.stopped = true;
      Object.assign(group, { running: run, waiting: null });
    } else {
      if (group.waiting) group.waiting.stopped = true;
      group.waiting = run;
    }
  }
  return runs;
}

/** @param {ReturnType<typeof deliverReviewEvents>} runs */
const countLiveReviews = (runs) =>
  runs.filter((run) => run.intent === "review" && !run.stopped).length;

test("a review asked for in the same write as another label still runs, in either order", () => {
  for (const name of OBSERVED_LABELS)
    for (const action of ["labeled", "unlabeled"]) {
      const review = label({ LABEL: "review" });
      const other = label({ ACTION: action, LABEL: name });
      for (const events of [
        [PUSH, review, other],
        [PUSH, other, review],
      ])
        assert.equal(countLiveReviews(deliverReviewEvents(events)), 1, `${action} ${name}`);
    }
});

test("a push or the owner's provider choice still stops a review running or waiting", () => {
  const review = label({ LABEL: "review" });
  const provider = label({ LABEL: "review-provider:codex" });
  assert.equal(countLiveReviews(deliverReviewEvents([PUSH, review, PUSH])), 0);
  assert.equal(countLiveReviews(deliverReviewEvents([review, PUSH])), 0);
  const runs = deliverReviewEvents([PUSH, review, provider]);
  assert.deepEqual(
    runs.map((run) => run.stopped),
    [true, true, false],
  );
});

test("a label event waits with the reviews exactly when it asks for one", () => {
  const reviewGroup = readReviewConcurrency(PUSH).group;
  for (const action of ["labeled", "unlabeled"])
    for (const name of [
      "review",
      "review-provider:claude",
      "review-provider:other",
      ...OBSERVED_LABELS,
    ])
      for (const sender of ["example", "someone"])
        for (const draft of ["true", "false"]) {
          const event = label({ ACTION: action, LABEL: name, SENDER: sender, IS_DRAFT: draft });
          assert.equal(
            readReviewConcurrency(event).group === reviewGroup,
            readNativeReviewName(event).endsWith(" intent review"),
            JSON.stringify(event),
          );
        }
});

test("runs in either group take turns writing the provider comment", () => {
  const select = readRepoFile(".github/workflows/review.yml").match(
    /^ {2}review-select:\n(?: {4}.*\n)*/m,
  )?.[0];
  assert.match(
    select ?? "",
    /^ {4}concurrency:\n {6}group: trusted-review-provider-\$\{\{ github\.event\.pull_request\.number \}\}\n {6}cancel-in-progress: false\n {6}queue: max\n/m,
  );
});
