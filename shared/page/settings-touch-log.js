import { createStepLog, describeTarget } from "./step-log.js";
import { followOneFingerTouches } from "./one-finger-touch.js";
import { describeLift, describePointer, describeTaking } from "./touch-words.js";

const SETTINGS_DIALOGS = "#settingsDialog, #contactDialog";
const SCREENSHOT_FIELD_ID = "contactScreenshot";

/** @param {Element} target */
const isFollowed = (target) => !!target.closest(SETTINGS_DIALOGS);

// What settings and Contact do with each touch: each touch and click on them, and as the finger
// lifts, how far it moved, whether the page's code or the browser took it, what scrolled, what lies
// under the point it lifted at, whether the page's code took each click, and what came of the
// screenshot field. It names each element as the step log does and never logs a field's value or a
// file's name.
export const settingsTouchLog = createStepLog({
  key: "diagnosticsSettingsTouches",
  title: "Settings and Contact",
  isWatched: isFollowed,
});

/** @typedef {import("./touch-words.js").Move} Move */

/**
 * Who took a touch: the page's code, by preventing its default, the browser, for a scroll, or
 * neither.
 * @param {{ takenAt: Move | null, isPointerCancelled: boolean, scrolled: string | null }} touch
 */
function describeTaker({ takenAt, isPointerCancelled, scrolled }) {
  if (takenAt) return describeTaking(takenAt);
  if (isPointerCancelled || scrolled) return "the browser took the touch";
  return "neither the page's code nor the browser took the touch";
}

/**
 * What became of a touch, as its finger lifts or the browser cancels it.
 * @param {{ isCancelled: boolean, moved: Move, takenAt: Move | null, isLiftTaken: boolean, isPointerCancelled: boolean, scrolled: string | null, endedOver: string | null }} touch
 *   `takenAt` is how far the finger had moved when the page's code took the touch, or null when
 *   it didn't, `isLiftTaken` is whether the page's code took the touch's end, which stops its
 *   click, `scrolled` names what scrolled while the finger was down, and `endedOver` names what
 *   lies under the point it lifted at
 * @returns {string}
 */
function describeSettingsTouchEnd(touch) {
  const { isCancelled, moved, isLiftTaken, isPointerCancelled, scrolled, endedOver } = touch;
  return [
    describeLift(moved, isCancelled),
    describeTaker(touch),
    isLiftTaken ? "the page's code took its end" : "the page's code left its end",
    describePointer(isPointerCancelled),
    scrolled ? `${scrolled} scrolled` : "nothing scrolled",
    endedOver ? `it ended over ${endedOver}` : "it ended over nothing",
  ].join("; ");
}

/**
 * What the page's code did with a click: stopped it before it reached the window, took it, by
 * preventing its default, or neither.
 * @param {{ target: string, isReached: boolean, isTaken: boolean }} click
 */
function describeClick({ target, isReached, isTaken }) {
  if (!isReached)
    return `the page's code stopped${isTaken ? " and took" : ""} the click on ${target}`;
  return isTaken
    ? `the page's code took the click on ${target}`
    : `the click on ${target} reached the window untaken`;
}

/**
 * What came of the screenshot field, by whether a file came back, never by its name.
 * @param {string} type
 * @param {number} fileCount
 */
function describeScreenshotField(type, fileCount) {
  if (type === "cancel") return "the screenshot picker closed with nothing chosen";
  return fileCount
    ? "the screenshot field changed with a file chosen"
    : "the screenshot field changed with no file";
}

/** @param {EventTarget | null} target */
const nameScroller = (target) => (target instanceof Element ? describeTarget(target) : "the page");

/**
 * @param {{ clientX: number, clientY: number } | undefined} point
 * @returns {string | null}
 */
function nameElementAt(point) {
  const element = point && document.elementFromPoint(point.clientX, point.clientY);
  return element ? describeTarget(element) : null;
}

/**
 * Logs, while Diagnostics is on, what became of each one-finger touch and each click on settings
 * and Contact, and of the screenshot field. It listens on the window, which a touch and a click
 * reach last, so each shows whether any of the page's code took it. It hears a click on the window
 * first too, before the page's code it starts ahead of can stop it, and logs it once its dispatch
 * ends, so a click the page's code stopped shows as well.
 */
export function watchSettingsTouches() {
  /** @type {WeakSet<Event>} */
  const reachedClicks = new WeakSet();

  const readTouch = followOneFingerTouches({
    startFollowing: (event) =>
      settingsTouchLog.isLogging() && event.target instanceof Element && isFollowed(event.target)
        ? { scrolled: /** @type {string | null} */ (null) }
        : null,
    noteEnd: ({ moved, takenAt, isPointerCancelled, scrolled }, event) =>
      settingsTouchLog.noteStep(
        describeSettingsTouchEnd({
          isCancelled: event.type === "touchcancel",
          moved,
          takenAt,
          isLiftTaken: event.defaultPrevented,
          isPointerCancelled,
          scrolled,
          endedOver: nameElementAt(event.changedTouches[0]),
        }),
      ),
  });

  /** @param {Event} event */
  function noteScroll(event) {
    const touch = readTouch();
    if (touch) touch.scrolled ??= nameScroller(event.target);
  }

  /** @param {MouseEvent} event */
  function followClick(event) {
    if (!settingsTouchLog.isLogging()) return;
    if (!(event.target instanceof Element && isFollowed(event.target))) return;
    const target = describeTarget(event.target);
    setTimeout(() =>
      settingsTouchLog.noteStep(
        describeClick({
          target,
          isReached: reachedClicks.has(event),
          isTaken: event.defaultPrevented,
        }),
      ),
    );
  }

  /** @param {Event} event */
  function noteScreenshotField(event) {
    const field = /** @type {HTMLInputElement} */ (event.target);
    if (field.id === SCREENSHOT_FIELD_ID)
      settingsTouchLog.noteStep(describeScreenshotField(event.type, field.files?.length ?? 0));
  }

  addEventListener("click", followClick, { capture: true, passive: true });
  addEventListener("click", (event) => reachedClicks.add(event), { passive: true });
  document.addEventListener("scroll", noteScroll, { capture: true, passive: true });
  for (const type of ["change", "cancel"])
    document.addEventListener(type, noteScreenshotField, { capture: true, passive: true });
}
