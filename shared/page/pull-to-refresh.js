import { isOnHomeScreen } from "./device.js";
import { html, setHtml } from "./html.js";
import { DRIFT_PX } from "./press.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { reloadIfReplaced } from "./resume.js";
import { watchShownView } from "./shown-view.js";
import { isPageOffTop, isPast } from "./spring-scroll.js";

// A phone gives a page on the Home Screen no pull to refresh, so the page draws its own, as an
// iPhone list does: pulled down from the top, the page follows the finger as spokes appear one by
// one above it, which start to turn once the pull is far enough to refresh. Let go then, and the
// page stays held down with the spokes turning until the store has caught up, and long enough to
// see. The browser has a pull to refresh of its own, which reloads the page, so there the page
// leaves it to the browser. A pull starts anywhere on the page at its top, but inside a list or
// part of the season scrolled down from its own top, which the finger scrolls instead. A listener
// that may stop a scroll makes the browser wait on the page before every scroll under it, so the
// page listens that way only on the parts where a pull can start. The browser decides as a touch
// starts whether the page may stop its scroll, so the listeners move as the page scrolls, not as a
// pull starts.

const RESISTANCE = 0.5;
const MAX_PULL_PX = 120;
const REFRESH_PULL_PX = 64;
const HOLD_PX = 56;
const SPOKE_COUNT = 8;
const SHORTEST_REFRESH_MS = 800;

// Phosphor's spinner, at its Regular weight: eight spokes, like the iPhone's own.
const SPOKES = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M136,32V64a8,8,0,0,1-16,0V32a8,8,0,0,1,16,0Zm37.25,58.75a8,8,0,0,0,5.66-2.35l22.63-22.62a8,8,0,0,0-11.32-11.32L167.6,77.09a8,8,0,0,0,5.65,13.66ZM224,120H192a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16Zm-45.09,47.6a8,8,0,0,0-11.31,11.31l22.62,22.63a8,8,0,0,0,11.32-11.32ZM128,184a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V192A8,8,0,0,0,128,184ZM77.09,167.6,54.46,190.22a8,8,0,0,0,11.32,11.32L88.4,178.91A8,8,0,0,0,77.09,167.6ZM72,128a8,8,0,0,0-8-8H32a8,8,0,0,0,0,16H64A8,8,0,0,0,72,128ZM65.78,54.46A8,8,0,0,0,54.46,65.78L77.09,88.4A8,8,0,0,0,88.4,77.09Z"
  />
</svg>`;

/** @typedef {{ waitForCatchUp: () => Promise<boolean> }} RefreshStore */

/* global listPageParts, isInFlow -- from season-header.js */

// What the pull moves: the page's own parts in its flow, not what stays put on the screen, like the
// edge fade, or what opens over it. They move by a relative offset rather than a transform, which
// would carry what's fixed inside them, like the tab bar, along.
/** @param {HTMLElement} spinner */
const listMovedParts = (spinner) =>
  listPageParts().filter((element) => element !== spinner && isInFlow(element));

/** @param {HTMLElement[]} parts */
function releaseParts(parts) {
  for (const part of parts) {
    part.style.position = "";
    part.style.top = "";
    part.style.transition = "";
  }
}

// What scrolls inside the page and was last left down from its top: only something scrolled can
// be off its top, so these are all that can keep a pull from starting inside them.
/** @type {Set<Element>} */
const scrolledDown = new Set();

/** @param {EventTarget | null} target */
function noteScrolled(target) {
  if (!(target instanceof Element)) return;
  if (isPast(target, 0)) scrolledDown.add(target);
  else scrolledDown.delete(target);
}

// What the page put back as it opened may have scrolled before this module was listening, and a
// list in a view not shown reads as at its top, taking back its scroll with no scroll event as its
// view shows again.
const noteScrollsPutBack = () => document.querySelectorAll("body *").forEach(noteScrolled);

// A part of the season slid away is still laid out, but hidden.
/** @param {Element} element */
const isShown = (element) =>
  element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";

function listShownScrolledDown() {
  const shown = [];
  for (const element of scrolledDown) {
    if (!element.isConnected || !isPast(element, 0)) scrolledDown.delete(element);
    else if (isShown(element)) shown.push(element);
  }
  return shown;
}

// Each element around the lists given, out to the page's root.
/** @param {Element[]} lists */
function listAround(lists) {
  /** @type {Set<Element>} */
  const around = new Set();
  for (const list of lists)
    for (let element = list.parentElement; element; element = element.parentElement)
      around.add(element);
  return [...around];
}

// Everything on the page but what's inside the lists given: beside each list, and beside each
// element around it.
/**
 * @param {Element[]} lists
 * @param {Element[]} around
 */
function listPartsBeside(lists, around) {
  const isOnTheWay = (/** @type {Element} */ element) =>
    around.includes(element) || lists.includes(element);
  return around.flatMap((element) => [...element.children].filter((child) => !isOnTheWay(child)));
}

// Where a pull can start: anywhere on a page at its top, but inside a list scrolled down from its
// top, which the finger scrolls instead. What's around such a list is where a part beside it can
// come or go.
/** @returns {{ parts: (Document | Element)[], around: Element[] }} */
function findPullableParts() {
  if (isPageOffTop()) return { parts: [], around: [] };
  const lists = listShownScrolledDown();
  if (!lists.length) return { parts: [document], around: [] };
  const around = listAround(lists);
  return { parts: listPartsBeside(lists, around), around };
}

/**
 * @param {unknown[]} these
 * @param {unknown[]} those
 */
const isSameList = (these, those) =>
  these.length === those.length && these.every((each, index) => each === those[index]);

function createSpinner() {
  const spinner = document.createElement("div");
  spinner.className = "pull-refresh";
  spinner.hidden = true;
  setHtml(spinner, SPOKES);
  document.body.append(spinner);
  return spinner;
}

/**
 * Lets someone on the Home Screen pull the page down to catch up on the store, and reloads the
 * page when a deploy has replaced it.
 * @param {object} options
 * @param {RefreshStore} options.store
 * @param {(awayMs: number) => void} options.catchUp the app's own catch-up, as on a return
 */
export function startPullToRefresh({ store, catchUp }) {
  if (!isOnHomeScreen()) return;
  const spinner = createSpinner();
  /** @type {"idle" | "tracking" | "pulling" | "refreshing"} */
  let state = "idle";
  let startX = 0;
  let startY = 0;
  let pulledPx = 0;
  /** @type {HTMLElement[]} */
  let movedParts = [];
  /** @type {(Document | Element)[]} */
  let listenedParts = [];
  /** @type {Element[]} */
  let watchedAround = [];

  // What opens over the page, like a sheet, scrolls on its own and never pulls the page.
  /** @param {EventTarget | null} target */
  const isPullable = (target) =>
    target instanceof Element &&
    !target.closest("dialog") &&
    listenedParts.some((part) => part.contains(target));

  /**
   * @param {number} offsetPx
   * @param {boolean} isEased
   */
  function movePage(offsetPx, isEased) {
    const transition = isEased && !prefersReducedMotion() ? "top 0.3s ease" : "";
    for (const part of movedParts) {
      part.style.transition = transition;
      part.style.position = "relative";
      part.style.top = `${offsetPx}px`;
    }
  }

  /** @param {number} pulled how far the page is pulled, in pixels */
  function showSpokes(pulled) {
    const spokes = Math.min(SPOKE_COUNT, Math.floor((pulled / REFRESH_PULL_PX) * SPOKE_COUNT));
    spinner.hidden = false;
    spinner.style.setProperty("--pull-spokes", String(spokes));
    spinner.classList.toggle("turning", spokes === SPOKE_COUNT);
  }

  // Once the page is back in place, its parts drop the relative position the pull gave them,
  // which would otherwise anchor what's absolutely placed inside them. A page already in place
  // has nowhere to ease to, and only its own move back, not one inside it, says it's there.
  function settle() {
    const settled = movedParts;
    const [first] = settled;
    movePage(0, !!first && first.style.top !== "0px");
    spinner.hidden = true;
    spinner.classList.remove("turning");
    becomeIdle();
    if (!first || !first.style.transition) return releaseParts(settled);
    /** @param {TransitionEvent} event */
    const releaseOnceBack = (event) => {
      if (event.target !== first || event.propertyName !== "top") return;
      first.removeEventListener("transitionend", releaseOnceBack);
      if (state === "idle") releaseParts(settled);
    };
    first.addEventListener("transitionend", releaseOnceBack);
  }

  async function refresh() {
    state = "refreshing";
    movePage(HOLD_PX, true);
    showSpokes(REFRESH_PULL_PX);
    catchUp(0);
    reloadIfReplaced();
    const shortestRefresh = new Promise((resolve) => setTimeout(resolve, SHORTEST_REFRESH_MS));
    await Promise.all([store.waitForCatchUp(), shortestRefresh]);
    settle();
  }

  /** @param {TouchEvent} event */
  function startTouch(event) {
    if (state !== "idle" || event.touches.length !== 1) return;
    if (!isPullable(event.target)) return;
    state = "tracking";
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }

  // A touch that starts sideways or upward is someone else's, like a pager's swipe or a scroll.
  /** @param {Touch} touch */
  function decideDirection(touch) {
    const across = Math.abs(touch.clientX - startX);
    const down = touch.clientY - startY;
    if (down <= DRIFT_PX && across <= DRIFT_PX) return;
    if (down <= across) return becomeIdle();
    state = "pulling";
    movedParts = listMovedParts(spinner);
  }

  /** @param {TouchEvent} event */
  function followTouch(event) {
    if (state === "tracking") decideDirection(event.touches[0]);
    if (state !== "pulling") return;
    if (event.cancelable) event.preventDefault();
    const down = event.touches[0].clientY - startY - DRIFT_PX;
    pulledPx = Math.min(MAX_PULL_PX, Math.max(0, down * RESISTANCE));
    movePage(pulledPx, false);
    showSpokes(pulledPx);
  }

  /** @param {TouchEvent} event */
  function endTouch(event) {
    if (state === "tracking") becomeIdle();
    if (state !== "pulling") return;
    if (event.type === "touchend" && pulledPx >= REFRESH_PULL_PX) refresh();
    else settle();
  }

  // A part a redraw adds beside a list scrolled down, or around it, can start a pull too.
  const partsWatcher = new MutationObserver(listenWherePullable);

  /** @param {Element[]} around */
  function watchAround(around) {
    partsWatcher.disconnect();
    for (const element of around) partsWatcher.observe(element, { childList: true });
    watchedAround = around;
  }

  // A touch under way keeps its listeners where they are, until it's over. Each listener put on or
  // taken off has the browser work out again where it waits on the page, so they move only when
  // where a pull can start has changed.
  function listenWherePullable() {
    if (state !== "idle") return;
    const { parts, around } = findPullableParts();
    if (!isSameList(around, watchedAround)) watchAround(around);
    if (isSameList(parts, listenedParts)) return;
    for (const part of listenedParts) part.removeEventListener("touchmove", followTouch);
    listenedParts = parts;
    for (const part of listenedParts)
      part.addEventListener("touchmove", followTouch, { passive: false });
  }

  /** @param {Event} event */
  function followScroll(event) {
    noteScrolled(event.target);
    listenWherePullable();
  }

  function becomeIdle() {
    state = "idle";
    listenWherePullable();
  }

  function followShownView() {
    noteScrollsPutBack();
    listenWherePullable();
  }

  document.addEventListener("touchstart", startTouch, { passive: true });
  document.addEventListener("touchend", endTouch, { passive: true });
  document.addEventListener("touchcancel", endTouch, { passive: true });
  document.addEventListener("scroll", followScroll, { capture: true, passive: true });
  watchShownView(followShownView);
  followShownView();
}
