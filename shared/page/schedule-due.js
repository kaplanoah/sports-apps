// Whether the store has yet to answer for the schedule a page follows, which the Games list waits
// for before it lets the season's record alone place it.

// Long enough for a phone on a slow network to read a whole season's schedule, and short enough that
// a read that never answers leaves the list on its copy for only a moment.
export const SCHEDULE_WAIT_MS = 10 * 1000;

/**
 * Keeps, with `keepDue`, whether a followed schedule is due: from `expectAnswer` until its first
 * answer, its first error, or SCHEDULE_WAIT_MS, whichever comes first. A schedule that stops being
 * due without an answer redraws with `showChange`.
 * @param {(isDue: boolean) => void} keepDue
 */
export function createScheduleDue(keepDue) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let isDue = false;

  function settle() {
    clearTimeout(timer);
    isDue = false;
    keepDue(false);
  }

  /** @param {() => void} showChange */
  function stopWaiting(showChange) {
    if (!isDue) return;
    settle();
    showChange();
  }

  /** @param {() => void} showChange */
  function expectAnswer(showChange) {
    clearTimeout(timer);
    isDue = true;
    keepDue(true);
    timer = setTimeout(() => stopWaiting(showChange), SCHEDULE_WAIT_MS);
  }

  function noteAnswer() {
    if (isDue) settle();
  }

  return { expectAnswer, noteAnswer, stopWaiting };
}
