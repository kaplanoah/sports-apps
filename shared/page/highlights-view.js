// A finished game's Highlights section, as highlights.css lays it out: the league's recap video
// across the top, its written recap under it with a button that opens the whole story, and the clip
// of each play, in the order they came, each its still beside its title and where in the game it
// came. A tap on a clip plays it full screen (clip-player.js). A clip the league has taken down
// leaves the list.

import { hasImageFailed } from "./failed-images.js";
import { html, isWebAddress, joinWithSeparator } from "./html.js";
import { renderReadButton } from "./news-view.js";
import { renderPlaceholder } from "./placeholder.js";
import { renderSheetPart } from "./sheet-part.js";

/**
 * @typedef {object} Clip
 * @property {string} title
 * @property {number | null} length in seconds
 * @property {string | null} still
 * @property {string} video
 * @property {string | null} [expiresAt] when the league takes it down
 */

/**
 * @typedef {object} Highlights
 * @property {(Clip & { blurb: string }) | null} recap
 * @property {{ title: string, lead: string, url: string, outlet: string } | null} story
 * @property {Clip[]} plays
 */

// Phosphor's play, at its Fill weight, as video players draw it over a still.
const PLAY = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"
  />
</svg>`;

/**
 * "3:01" for 181 seconds.
 * @param {number | null} seconds
 */
export function formatClipLength(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * @param {Clip} clip
 * @param {number} now
 */
const isPlayable = (clip, now) =>
  isWebAddress(clip.video) && !(clip.expiresAt && Date.parse(clip.expiresAt) <= now);

/** @param {Clip} clip */
function renderStill(clip) {
  const length = formatClipLength(clip.length);
  return html`<span class="clip-still">
    ${
      clip.still &&
      isWebAddress(clip.still) &&
      !hasImageFailed(clip.still) &&
      html`<img src="${clip.still}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    }
    <span class="clip-play">${PLAY}</span>
    ${length && html`<span class="clip-length tabular">${length}</span>`}
  </span>`;
}

/** @param {Clip} clip */
const describeClipLabel = (clip) =>
  [`Play ${clip.title}`, formatClipLength(clip.length)].filter(Boolean).join(", ");

/** @param {Clip & { blurb: string }} recap */
const renderRecap = (recap) =>
  html`<button
    type="button"
    class="clip-open clip-feature"
    data-video="${recap.video}"
    aria-label="${describeClipLabel(recap)}"
  >
    ${renderStill(recap)}
    <span class="clip-text">
      <span class="clip-title" data-quoted>${recap.title}</span>
      ${recap.blurb && html`<span class="clip-blurb" data-quoted>${recap.blurb}</span>`}
    </span>
  </button>`;

/** @param {NonNullable<Highlights["story"]>} story */
const renderStory = (story) =>
  renderSheetPart(
    "Story",
    html`<article class="highlights-story">
      <h4 class="highlights-story-title" data-quoted>${story.title}</h4>
      <p class="highlights-story-lead" data-quoted>${story.lead}</p>
      ${renderReadButton(story)}
    </article>`,
  );

/**
 * @param {Clip} clip
 * @param {(clip: Clip) => (import("./html.js").Markup | string)[]} describePlay where in the game
 *   the play came, in the league's words
 */
function renderPlay(clip, describePlay) {
  const facts = describePlay(clip).filter(Boolean);
  return html`<button
    type="button"
    class="clip-open clip-row"
    data-video="${clip.video}"
    aria-label="${describeClipLabel(clip)}"
  >
    ${renderStill(clip)}
    <span class="clip-text">
      <span class="clip-title" data-quoted>${clip.title}</span>
      ${facts.length > 0 && html`<span class="clip-meta">${joinWithSeparator(facts)}</span>`}
    </span>
  </button>`;
}

/**
 * @param {Highlights} highlights
 * @param {object} options
 * @param {(clip: Clip) => (import("./html.js").Markup | string)[]} options.describePlay
 * @param {number} options.now
 */
export function renderHighlights(highlights, { describePlay, now }) {
  const recap = highlights.recap && isPlayable(highlights.recap, now) ? highlights.recap : null;
  const plays = (highlights.plays ?? []).filter((clip) => isPlayable(clip, now));
  if (!recap && !highlights.story && plays.length === 0)
    return html`<p class="sheet-message">No highlights for this game yet</p>`;
  return html`${recap && renderRecap(recap)}${highlights.story && renderStory(highlights.story)}${
    plays.length > 0 &&
    renderSheetPart(
      "Plays",
      html`<div class="clip-rows">${plays.map((clip) => renderPlay(clip, describePlay))}</div>`,
    )
  }`;
}

const renderPendingRow = () =>
  html`<div class="clip-row">
    <span class="clip-still"></span>
    <span class="clip-text">
      <span class="clip-title">${renderPlaceholder("A play's title on a line")}</span>
      <span class="clip-meta">${renderPlaceholder("Top 1st")}</span>
    </span>
  </div>`;

// The section's shape while its highlights load: the recap's still and title, then a few plays.
export const renderPendingHighlights = () =>
  html`<div class="clip-feature">
      <span class="clip-still"></span>
      <span class="clip-text">
        <span class="clip-title">${renderPlaceholder("The two clubs' Game Highlights")}</span>
      </span>
    </div>
    ${renderSheetPart("Plays", html`<div class="clip-rows">${[1, 2, 3].map(renderPendingRow)}</div>`)}`;
