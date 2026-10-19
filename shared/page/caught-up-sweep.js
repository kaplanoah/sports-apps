import { prefersReducedMotion } from "./reduced-motion.js";

// The page shows what it last drew while it catches up, so a header whose lines read the same
// before and after the store answers gives no sign the page checked. Once the page has caught up,
// the lines show it: lines that changed arrive faded and an edge sweeps them up to full strength,
// and lines that didn't change let a faded band pass through them.

const WIPE_CLASS = "caught-up-wipe";
const BAND_CLASS = "caught-up-band";

const canSweep = () => !document.hidden && !prefersReducedMotion();

/**
 * @param {HTMLElement} lines
 * @param {string} sweep
 */
function playSweep(lines, sweep) {
  lines.classList.remove(WIPE_CLASS, BAND_CLASS);
  // Reading the layout between the two restarts a sweep still under way.
  lines.getBoundingClientRect();
  lines.classList.add(sweep);
}

/** @param {HTMLElement} lines */
function clearSweepWhenDone(lines) {
  lines.addEventListener("animationend", (event) => {
    if (event.target === lines) lines.classList.remove(WIPE_CLASS, BAND_CLASS);
  });
}

/**
 * Sweeps through the header's lines each time the page catches up after falling behind, as it
 * does when it comes back or loads. A header that showed nothing has nothing to confirm. Start it
 * after startCatchUpNote, whose redraw takes the catching-up line out before the lines are compared.
 * @param {{ watchCatchUp: (onChange: (isCaughtUp: boolean) => void) => void }} store
 * @param {HTMLElement} lines
 */
export function startCaughtUpSweep(store, lines) {
  /** @type {string | null} */
  let shownWhileBehind = null;
  clearSweepWhenDone(lines);
  store.watchCatchUp((isCaughtUp) => {
    if (!isCaughtUp) {
      shownWhileBehind ??= lines.textContent;
      return;
    }
    const shown = shownWhileBehind;
    shownWhileBehind = null;
    if (!shown || !canSweep()) return;
    playSweep(lines, lines.textContent === shown ? BAND_CLASS : WIPE_CLASS);
  });
}
