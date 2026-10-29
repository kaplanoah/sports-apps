import test from "node:test";
import assert from "node:assert/strict";
import {
  readNativeReviewName,
  readReviewConcurrency,
  readReviewTemplates,
} from "./workflow-step.js";
import { readRepoFile } from "./repo-files.js";

const OWNER_PULL = { ASSOCIATION: "OWNER", HEAD_REPOSITORY: "example/repository" };
const PUSH = { ...OWNER_PULL, ACTION: "synchronize" };
const OBSERVED_LABELS = ["beta", "beta-wait", "phone-ok"];

/** @param {Record<string,string>} event */
const createLabelEvent = (event) => ({ ...OWNER_PULL, ACTION: "labeled", ...event });

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
      const review = createLabelEvent({ LABEL: "review" });
      const other = createLabelEvent({ ACTION: action, LABEL: name });
      for (const events of [
        [PUSH, review, other],
        [PUSH, other, review],
      ])
        assert.equal(countLiveReviews(deliverReviewEvents(events)), 1, `${action} ${name}`);
    }
});

test("a push or the owner's provider choice still stops a review running or waiting", () => {
  const review = createLabelEvent({ LABEL: "review" });
  const provider = createLabelEvent({ LABEL: "review-provider:codex" });
  assert.equal(countLiveReviews(deliverReviewEvents([PUSH, review, PUSH])), 0);
  assert.equal(countLiveReviews(deliverReviewEvents([review, PUSH])), 0);
  const runs = deliverReviewEvents([PUSH, review, provider]);
  assert.deepEqual(
    runs.map((run) => run.stopped),
    [true, true, false],
  );
});

/**
 * The provider labels one review workflow expression accepts.
 * @param {string} template
 */
function readProviderLabels(template) {
  const list = template.match(/fromJSON\('(\["review-provider:[^']*\])'\)/)?.[1];
  if (!list) throw new Error(`No provider list in ${template}`);
  return /** @type {string[]} */ (JSON.parse(list));
}

test("the run name, the group, and cancel-in-progress accept the same providers", () => {
  const { runName, group, cancelInProgress } = readReviewTemplates();
  const providers = readProviderLabels(runName);
  assert.deepEqual(readProviderLabels(group), providers);
  assert.deepEqual(readProviderLabels(cancelInProgress), providers);
});

/** Every label event a pull request can get: each label, sender, author and draft state. */
function listLabelEvents() {
  const events = [];
  for (const action of ["labeled", "unlabeled"])
    for (const name of [
      "review",
      ...readProviderLabels(readReviewTemplates().runName),
      "review-provider:unknown",
      ...OBSERVED_LABELS,
    ])
      for (const sender of ["example", "someone"])
        for (const author of ["example", "dependabot[bot]"])
          for (const draft of ["true", "false"])
            events.push(
              createLabelEvent({
                ACTION: action,
                LABEL: name,
                SENDER: sender,
                AUTHOR: author,
                IS_DRAFT: draft,
              }),
            );
  return events;
}

test("a label event waits with the reviews, and stops the running one, only when it asks for one", () => {
  const reviewGroup = readReviewConcurrency(PUSH).group;
  for (const event of listLabelEvents()) {
    const asksForReview = readNativeReviewName(event).endsWith(" intent review");
    const { group, cancelsRunning } = readReviewConcurrency(event);
    assert.equal(group === reviewGroup, asksForReview, JSON.stringify(event));
    assert.equal(cancelsRunning, asksForReview && event.LABEL !== "review", JSON.stringify(event));
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
