// A game sheet's Highlights section, which shows a finished game's highlights from the app's
// Worker (highlights-view.js): its placeholders until they arrive, what a reload kept while they
// read again, and a Try again block where a read failed. A tap on a clip plays it
// (clip-player.js).

import { watchClipTaps } from "./clip-player.js";
import { renderHighlights, renderPendingHighlights } from "./highlights-view.js";
import { setHtml } from "./html.js";
import { classifyReadFailure, renderRetryBlock } from "./retry.js";

/** @typedef {import("./highlights-view.js").Highlights} Highlights */
/** @typedef {import("./highlights-view.js").Clip} Clip */
/** @typedef {{ id: string, highlights: Highlights | null, error: any }} ShownHighlights */

// A game the league has no word of has no highlights.
const NO_HIGHLIGHTS = { recap: null, story: null, plays: [] };

/**
 * @param {HTMLElement} body the section's body
 * @param {(clip: Clip) => (import("./html.js").Markup | string)[]} describePlay where in the game
 *   a play came, in the league's words
 */
export function createHighlightsSection(body, describePlay) {
  /** @type {ShownHighlights | null} */
  let shown = null;

  function draw() {
    if (!shown) return;
    const { highlights, error } = shown;
    if (highlights) setHtml(body, renderHighlights(highlights, { describePlay, now: Date.now() }));
    else if (error) setHtml(body, renderRetryBlock("highlights", classifyReadFailure(error)));
    else setHtml(body, renderPendingHighlights());
    body.setAttribute("aria-busy", String(!highlights && !error));
  }

  /**
   * Reads the game's highlights, keeping what shows when the read fails.
   * @param {ShownHighlights} opened
   * @param {() => Promise<Highlights>} load
   */
  async function read(opened, load) {
    try {
      const highlights = await load();
      if (shown !== opened) return;
      Object.assign(opened, { highlights, error: null });
    } catch (error) {
      if (shown !== opened) return;
      if (/** @type {any} */ (error)?.status === 404) opened.highlights = NO_HIGHLIGHTS;
      else if (!opened.highlights) opened.error = error;
    }
    draw();
  }

  watchClipTaps(body);
  // A still that doesn't load, as when the phone is offline, leaves its box's plain color.
  body.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) event.target.hidden = true;
    },
    true,
  );

  return {
    /**
     * Shows a game's highlights, starting from what a reload kept, and reads them again, unless
     * the section already shows the game's.
     * @param {string} id
     * @param {() => Promise<Highlights>} load
     * @param {Highlights | null} [kept]
     */
    show(id, load, kept = null) {
      if (shown?.id === id) return;
      shown = { id, highlights: kept, error: null };
      draw();
      read(shown, load);
    },
    /**
     * Reads again a game's highlights that didn't load, showing placeholders meanwhile.
     * @param {() => Promise<Highlights>} load
     */
    retry(load) {
      if (!shown?.error) return;
      shown.error = null;
      draw();
      read(shown, load);
    },
    /** What the section shows, for a reload to draw again. */
    read: () => shown && { id: shown.id, highlights: shown.highlights },
    forget() {
      shown = null;
    },
  };
}
