// A row that opens something tints while it's pressed, as an iPhone's lists do: a finger's press
// shows a moment after it lands, so a finger that starts a scroll never tints a row, a quick tap
// still shows, and the tint fades as it lets go. A mouse's shows at once. The page marks the
// pressed row's button with .is-pressed, and each row's stylesheet tints the row it covers.
// As on an iPhone's lists, a finger that drifts or scrolls the list never opens the row, though
// iOS sometimes still sends a click for it, as when the finger stops a list that's still gliding.

// How long a finger rests before its press shows, and how long a quick tap's press stays.
const TOUCH_SETTLE_MS = 60;
const QUICK_TAP_MS = 120;
// How far a finger may drift before its press is a scroll or a swipe instead.
const DRIFT_PX = 10;

// The buttons of the rows every app shares: a game's, a card's, a search's, and a table's.
const SHARED_ROW_BUTTONS = [
  ".game-open",
  ".game-card-button",
  ".search-example",
  ".search-suggestion",
  ".search-games-line",
  ".row-button-cell button",
];

/** @type {{ button: Element, x: number, y: number, timer: number | null } | null} */
let press = null;
// The last finger on a row, until its click, and whether it's still a tap.
/** @type {{ button: Element, x: number, y: number, isTap: boolean } | null} */
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
  letGo();
  touch = null;
  if (!event.isPrimary || event.button !== 0) return;
  const button = /** @type {Element} */ (event.target).closest(rowButtons);
  if (!button) return;
  const { clientX: x, clientY: y } = event;
  press = { button, x, y, timer: null };
  if (event.pointerType !== "touch") {
    markPressed(button);
    return;
  }
  touch = { button, x, y, isTap: true };
  press.timer = window.setTimeout(() => markPressed(button), TOUCH_SETTLE_MS);
}

/**
 * @param {PointerEvent} event
 * @param {{ x: number, y: number }} start
 */
const hasDrifted = (event, start) =>
  Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRIFT_PX;

/** @param {PointerEvent} event */
function followDrift(event) {
  if (!event.isPrimary) return;
  if (touch && hasDrifted(event, touch)) touch.isTap = false;
  if (press && hasDrifted(event, press)) letGo();
}

// The browser cancels a finger's pointer once it takes the touch for a scroll.
function cancelPress() {
  letGo();
  if (touch) touch.isTap = false;
}

// A key's click, as Enter on a row's button, is never a finger's.
function forgetTouch() {
  touch = null;
}

/**
 * Drops the click iOS sends for a finger that drifted or scrolled the list, before anything that
 * opens the row hears of it.
 * @param {MouseEvent} event
 */
function dropClickAfterScroll(event) {
  const last = touch;
  touch = null;
  if (!last || last.isTap) return;
  if (!(event.target instanceof Node) || !last.button.contains(event.target)) return;
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
 * Tints each row the page shares, and any the app adds by its buttons' selectors, while pressed.
 * @param {string[]} [appRowButtons] the buttons of the app's own rows, like a bracket's team lines
 */
export function watchPresses(appRowButtons = []) {
  const rowButtons = [...SHARED_ROW_BUTTONS, ...appRowButtons].join(", ");
  document.addEventListener("pointerdown", (event) => startPress(event, rowButtons), {
    passive: true,
  });
  document.addEventListener("pointermove", followDrift, { passive: true });
  document.addEventListener("pointerup", endPress, { passive: true });
  document.addEventListener("pointercancel", cancelPress, { passive: true });
  document.addEventListener("scroll", letGo, { capture: true, passive: true });
  document.addEventListener("click", dropClickAfterScroll, { capture: true });
  document.addEventListener("keydown", forgetTouch, { capture: true, passive: true });
}
