import { isStandIn } from "./rider-taps.js";

// A row that opens something tints while it's pressed, as an iPhone's lists do: a finger's press
// shows a moment after it lands, so a finger that starts a scroll never tints a row, a quick tap
// still shows, and the tint fades as it lets go. A mouse's shows at once. The page marks the
// pressed row's button with .is-pressed, and each row's stylesheet tints the row it covers. A
// stand-in under a row's button (rider-taps.js) hands its press to the button, which presses it.
// As on an iPhone, a touch that's part of a scroll is never a tap, so the page drops the click iOS
// sometimes still sends for it, and the row under it never tints. A touch is part of a scroll once
// the browser takes it for one, and from the start when its finger lands on a list still gliding,
// which it only stops, though iOS hands the page a plain tap for a finger that lifts without
// moving. A finger that drifts on a control without scrolling anything still taps it.

// How long a finger rests before its press shows, and how long a quick tap's press stays.
const TOUCH_SETTLE_MS = 60;
const QUICK_TAP_MS = 120;
// How far a finger may drift before its row lets go of its tint.
const DRIFT_PX = 10;
// Longer than iOS waits after a lift to tell a tap from a double tap, so its click for the lift
// still finds the touch, while a click long after, like a screen reader's, never does.
const LIFT_CLICK_MS = 1000;
// A gliding list scrolls on every frame, so one that hasn't for a few frames has come to rest, and a
// finger that lands then taps. A fling's first frame comes within as long of its finger's lift.
const GLIDE_REST_MS = 100;

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
// The last finger down, until its click: its pointer, what it landed on, whether it's part of a
// scroll, and when it lifted.
/** @type {{ pointerId: number, target: EventTarget | null, isScroll: boolean, liftedAt: number | null } | null} */
let touch = null;
// When a finger's scroll last moved each element, and the page, apart, so each glides on and comes
// to rest on its own.
/** @type {WeakMap<EventTarget, number>} */
const lastScrolledAt = new WeakMap();

/** @param {Element} button */
const markPressed = (button) => button.classList.add("is-pressed");

function letGo() {
  if (!press) return;
  if (press.timer !== null) clearTimeout(press.timer);
  press.button.classList.remove("is-pressed");
  press = null;
}

/**
 * @param {EventTarget} scroller
 * @param {EventTarget | null} target
 */
const holds = (scroller, target) =>
  scroller === document ||
  (scroller instanceof Element && target instanceof Element && scroller.contains(target));

// A finger the browser took for a scroll moves what holds where it landed, while it's down and in
// the frames right after its lift, since a fast flick's first frame can come after the lift.
/** @param {EventTarget} scroller */
const isMovedByFinger = (scroller) =>
  !!touch?.isScroll &&
  holds(scroller, touch.target) &&
  (touch.liftedAt === null || performance.now() - touch.liftedAt < GLIDE_REST_MS);

// What a finger moved glides on frame by frame once it lifts, until it rests, whatever the finger
// does meanwhile, as the click iOS sends for the fling forgetting the touch. So a scroll the page's
// code runs elsewhere, as the strip's dates sliding with the list, or on the list once its glide
// has rested, as a redraw keeping its rows in place, is never a finger's, and a tap right after it
// works.
/** @param {EventTarget} scroller */
const isFingersScroll = (scroller) => isGliding(scroller) || isMovedByFinger(scroller);

/** @param {Event} event */
function noteScroll(event) {
  if (event.target && isFingersScroll(event.target))
    lastScrolledAt.set(event.target, performance.now());
  letGo();
}

/** @param {EventTarget} scroller */
function isGliding(scroller) {
  const scrolledAt = lastScrolledAt.get(scroller);
  return scrolledAt !== undefined && performance.now() - scrolledAt < GLIDE_REST_MS;
}

/**
 * Whether a finger landing on `target` lands on a list still gliding: the element under it, one
 * around it, or the page.
 * @param {EventTarget | null} target
 */
export function isOnGlide(target) {
  let element = target instanceof Element ? target : null;
  while (element && !isGliding(element)) element = element.parentElement;
  return Boolean(element) || isGliding(document);
}

/**
 * @param {PointerEvent} event
 * @param {string} rowButtons
 */
function startPress(event, rowButtons) {
  if (isStandIn(event.target)) return;
  letGo();
  if (!event.isPrimary || event.button !== 0 || touch?.isScroll) return;
  const button = /** @type {Element} */ (event.target).closest(rowButtons);
  if (!button) return;
  press = { button, x: event.clientX, y: event.clientY, timer: null };
  if (event.pointerType === "touch")
    press.timer = window.setTimeout(() => markPressed(button), TOUCH_SETTLE_MS);
  else markPressed(button);
}

// A stand-in passes its finger's press on to its button (rider-taps.js), which is still the touch
// that landed on the stand-in.
/** @param {PointerEvent} event */
const isPassedOn = (event) => touch?.pointerId === event.pointerId && touch.liftedAt === null;

/** @param {PointerEvent} event */
function startTouch(event) {
  if (!event.isPrimary || isPassedOn(event)) return;
  touch =
    event.pointerType === "touch"
      ? {
          pointerId: event.pointerId,
          target: event.target,
          isScroll: isOnGlide(event.target),
          liftedAt: null,
        }
      : null;
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
 * Drops the click iOS sends for a touch that's part of a scroll, on whatever it lands that takes a
 * tap, before anything it opens hears of it.
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
 * and drops the click iOS sends for a touch that's part of a scroll.
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
  document.addEventListener("scroll", noteScroll, { capture: true, passive: true });
  // On the window, so it hears the click before anything else on the page does.
  addEventListener("click", dropClickAfterScroll, { capture: true });
  document.addEventListener("keydown", forgetTouch, { capture: true, passive: true });
}
