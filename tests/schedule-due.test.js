import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createScheduleDue, SCHEDULE_WAIT_MS } from "../shared/page/schedule-due.js";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

/** A schedule's due flag as the page keeps it, and how many times it redrew. */
function followSchedule() {
  const followed = { isDue: false, redraws: 0 };
  const scheduleDue = createScheduleDue((isDue) => (followed.isDue = isDue));
  const showChange = () => followed.redraws++;
  scheduleDue.expectAnswer(showChange);
  return { followed, scheduleDue, showChange };
}

test("a followed schedule is due until its first answer, which leaves the redraw to its reader", () => {
  const { followed, scheduleDue } = followSchedule();
  assert.equal(followed.isDue, true);

  scheduleDue.noteAnswer();
  mock.timers.tick(SCHEDULE_WAIT_MS);

  assert.deepEqual(followed, { isDue: false, redraws: 0 });
});

test("a schedule whose read never answers stops being due after the wait, and redraws once", () => {
  const { followed } = followSchedule();

  mock.timers.tick(SCHEDULE_WAIT_MS - 1);
  assert.equal(followed.isDue, true);
  mock.timers.tick(1);

  assert.deepEqual(followed, { isDue: false, redraws: 1 });
});

test("a schedule whose read fails stops being due and redraws once, and not again after the wait", () => {
  const { followed, scheduleDue, showChange } = followSchedule();

  scheduleDue.stopWaiting(showChange);
  scheduleDue.stopWaiting(showChange);
  mock.timers.tick(SCHEDULE_WAIT_MS);

  assert.deepEqual(followed, { isDue: false, redraws: 1 });
});

test("a schedule followed again waits its whole wait anew, with no redraw from the one before", () => {
  const { followed, scheduleDue, showChange } = followSchedule();

  mock.timers.tick(SCHEDULE_WAIT_MS - 1);
  scheduleDue.expectAnswer(showChange);
  mock.timers.tick(SCHEDULE_WAIT_MS - 1);

  assert.deepEqual(followed, { isDue: true, redraws: 0 });
});
