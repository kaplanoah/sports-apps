import { isOnHomeScreen } from "./device.js";
import { html, setHtml } from "./html.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { reloadIfReplaced } from "./resume.js";
import { isPageOffTop, isPast } from "./spring-scroll.js";

// A phone gives a page on the Home Screen no pull to refresh, so the page draws its own, as an
// iPhone list does: pulled down from the top, the page follows the finger as spokes appear one by
// one above it, which start to turn once the pull is far enough to refresh. Let go then, and the
// page stays held down with the spokes turning until the store has caught up, and long enough to
// see. The browser has a pull to refresh of its own, which reloads the page, so there the page
// leaves it to the browser. A listener that may stop a scroll makes the browser wait on the page
// before every scroll, so the page listens that way only while it's at its top, where a pull can
// start. The browser decides as a touch starts whether the page may stop its scroll, so the
// listener goes on as the page reaches its top, not as a pull starts.

const START_PX = 8;
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

/** @param {Element} target */
function isScrolledInside(target) {
  for (let element = target; element && element !== document.body; element = element.parentElement)
    if (isPast(element, 0)) return true;
  return false;
}

// A touch in a sheet is the sheet's, which a swipe down closes.
/** @param {EventTarget | null} target */
function isPullable(target) {
  if (!(target instanceof Element)) return false;
  if (isPageOffTop()) return false;
  if (target.closest("dialog")) return false;
  return !isScrolledInside(target);
}

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
    state = "idle";
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
    if (down < START_PX && across < START_PX) return;
    state = down > across ? "pulling" : "idle";
    if (state === "pulling") movedParts = listMovedParts(spinner);
  }

  /** @param {TouchEvent} event */
  function followTouch(event) {
    if (state === "tracking") decideDirection(event.touches[0]);
    if (state !== "pulling") return;
    if (event.cancelable) event.preventDefault();
    const down = event.touches[0].clientY - startY - START_PX;
    pulledPx = Math.min(MAX_PULL_PX, Math.max(0, down * RESISTANCE));
    movePage(pulledPx, false);
    showSpokes(pulledPx);
  }

  /** @param {TouchEvent} event */
  function endTouch(event) {
    if (state === "tracking") state = "idle";
    if (state !== "pulling") return;
    if (event.type === "touchend" && pulledPx >= REFRESH_PULL_PX) refresh();
    else settle();
  }

  // A pull under way keeps its listener wherever the page is, until it's over.
  function listenWherePullable() {
    if (isPageOffTop() && state === "idle") document.removeEventListener("touchmove", followTouch);
    else document.addEventListener("touchmove", followTouch, { passive: false });
  }

  document.addEventListener("touchstart", startTouch, { passive: true });
  document.addEventListener("touchend", endTouch, { passive: true });
  document.addEventListener("touchcancel", endTouch, { passive: true });
  addEventListener("scroll", listenWherePullable, { passive: true });
  listenWherePullable();
}
