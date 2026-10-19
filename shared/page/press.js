import { isStandIn } from "./rider-taps.js";

// A row that opens something tints while it's pressed, as an iPhone's lists do: a finger's press
// shows a moment after it lands, so a finger that starts a scroll never tints a row, a quick tap
// still shows, and the tint fades as it lets go. A mouse's shows at once. The page marks the
// pressed row's button with .is-pressed, and each row's stylesheet tints the row it covers. A
// stand-in under a row's button (rider-taps.js) hands its press to the button, which presses it.
// As on an iPhone, a touch the browser takes for a scroll is never a tap, though iOS sometimes
// still sends a click for it, as when the finger stops a list still gliding, so the page drops
// that click. A finger that drifts on a control without scrolling anything still taps it.

// How long a finger rests before its press shows, and how long a quick tap's press stays.
const TOUCH_SETTLE_MS = 60;
const QUICK_TAP_MS = 120;
// How far a finger may drift before its press is a scroll or a swipe instead.
const DRIFT_PX = 10;
// Longer than iOS waits after a lift to tell a tap from a double tap, so its click for the lift
// still finds the touch, while a click long after, like a screen reader's, never does.
const LIFT_CLICK_MS = 1000;

// The buttons of the rows every app shares: a game's, a card's, a search's, and a table's.
const SHARED_ROW_BUTTONS = [
  ".game-open",
  ".game-card-button",
  ".search-example",
  ".search-suggestion",
  ".search-games-line",
  ".row-button-cell button",
];
// What an iPhone hands a tap to, whatever listens for it.
export const TAPPABLE = "button, a[href], label, summary, select, input, textarea";

/** @type {{ button: Element, x: number, y: number, timer: number | null } | null} */
let press = null;
// The last finger down, until its click: whether the browser took it for a scroll, and when it
// lifted.
/** @type {{ isScroll: boolean, liftedAt: number | null } | null} */
let touch = null;

/** @param {Element} button */
const markPressed = (button) => button.classList.add("is-pressed");

function letGo() {
  if (!press) return;
  if (press.timer !== null) clearTimeout(press.timer);
  press.button.classList.remove("is-pressed");
  press = null;
}

/**
 * @param {PointerEvent} event
 * @param {string} rowButtons
 */
function startPress(event, rowButtons) {
  if (isStandIn(event.target)) return;
  letGo();
  if (!event.isPrimary || event.button !== 0) return;
  const button = /** @type {Element} */ (event.target).closest(rowButtons);
  if (!button) return;
  press = { button, x: event.clientX, y: event.clientY, timer: null };
  if (event.pointerType === "touch")
    press.timer = window.setTimeout(() => markPressed(button), TOUCH_SETTLE_MS);
  else markPressed(button);
}

/** @param {PointerEvent} event */
function startTouch(event) {
  if (!event.isPrimary) return;
  touch = event.pointerType === "touch" ? { isScroll: false, liftedAt: null } : null;
}

/** @param {PointerEvent} event */
function followDrift(event) {
  if (!press || !event.isPrimary) return;
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRIFT_PX) letGo();
}

// The browser cancels a finger's pointer once it takes the touch for a scroll, well before the
// finger lifts.
/** @param {PointerEvent} event */
function cancelPress(event) {
  letGo();
  if (touch && event.isPrimary) touch.isScroll = true;
}

function noteLift() {
  if (touch) touch.liftedAt = performance.now();
}

// A key's click, as Enter on a focused button, is never a finger's.
function forgetTouch() {
  touch = null;
}

/** @param {{ liftedAt: number | null }} lifted */
const isJustLifted = ({ liftedAt }) =>
  liftedAt !== null && performance.now() - liftedAt < LIFT_CLICK_MS;

/**
 * Drops the click iOS sends for a touch the browser took for a scroll, on whatever it lands that
 * takes a tap, before anything it opens hears of it.
 * @param {MouseEvent} event
 */
function dropClickAfterScroll(event) {
  const last = touch;
  touch = null;
  if (!last?.isScroll || !isJustLifted(last)) return;
  if (!(event.target instanceof Element) || !event.target.closest(TAPPABLE)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

// A quick tap's press shows on the lift, and stays long enough to be seen.
function endPress() {
  if (!press) return;
  const { button } = press;
  if (press.timer !== null) clearTimeout(press.timer);
  markPressed(button);
  press.timer = window.setTimeout(letGo, QUICK_TAP_MS);
}

/**
 * Runs what a row's tap does once its press has shown, so the row's tint is seen before what it
 * opens or the search it runs replaces it, and at once for a tap that isn't a press, like a key's.
 * @param {Element} row
 * @param {() => void} action
 */
export function runAfterPress(row, action) {
  if (row.classList.contains("is-pressed")) window.setTimeout(action, QUICK_TAP_MS);
  else action();
}

/**
 * Tints each row the page shares, and any the app adds by its buttons' selectors, while pressed,
 * and drops the click iOS sends for a touch the browser took for a scroll.
 * @param {string[]} [appRowButtons] the buttons of the app's own rows, like a bracket's team lines
 */
export function watchPresses(appRowButtons = []) {
  const rowButtons = [...SHARED_ROW_BUTTONS, ...appRowButtons].join(", ");
  document.addEventListener("pointerdown", startTouch, { capture: true, passive: true });
  document.addEventListener("pointerdown", (event) => startPress(event, rowButtons), {
    passive: true,
  });
  document.addEventListener("pointermove", followDrift, { passive: true });
  document.addEventListener("pointerup", endPress, { passive: true });
  document.addEventListener("pointercancel", cancelPress, { passive: true });
  document.addEventListener("touchend", noteLift, { passive: true });
  document.addEventListener("touchcancel", noteLift, { passive: true });
  document.addEventListener("scroll", letGo, { capture: true, passive: true });
  // On the window, so it hears the click before anything else on the page does.
  addEventListener("click", dropClickAfterScroll, { capture: true });
  document.addEventListener("keydown", forgetTouch, { capture: true, passive: true });
}
