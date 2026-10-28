import { formatShortDate, formatShortWeekday, nameDay } from "./days.js";
import { hasImageFailed } from "./failed-images.js";
import { html, isWebAddress, joinWithSeparator } from "./html.js";
import { framePhoto, WIDEST_FRAME } from "./news-photo.js";
import { pickReadCards } from "./news-picks.js";

// The News view: a card for each piece of news, newest first, led by the story that tells it best,
// with the others that add to it in a quiet list under it. A story shows only its headline, a short
// summary, and who wrote it; the whole story is on its outlet's site, which opens apart from the
// page and is never told the page's address. A league hands it how to draw its teams and which of
// its outlets need a subscription.

/** @typedef {import("./news-picks.js").NewsStory} NewsStory */
/** @typedef {import("./news-picks.js").NewsCard} NewsCard */

/**
 * What a league hands the News view.
 * @typedef {object} NewsLeague
 * @property {(team: string) => import("./html.js").Markup | null} renderTeam a team's dot and name,
 *   or null for a code that isn't the league's
 * @property {import("./news-picks.js").OutletSwitches} outletSwitches the league's switches for
 *   outlets a device can leave out, like ones whose stories mostly need a subscription
 */

const WEEK_DAYS = 7;
// A story can be about more teams than a card has room to name.
const MAX_CARD_TEAMS = 2;

// Phosphor's arrow-up-right, at its Regular weight.
const READ_ARROW = html`<svg class="read-arrow" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/></svg>`;

/**
 * @param {Date} date
 * @param {number} daysAway
 */
const nameEarlierDay = (date, daysAway) =>
  Math.abs(daysAway) < WEEK_DAYS ? formatShortWeekday(date) : formatShortDate(date);

/**
 * "Today", "Yesterday", or the day's short weekday, or its date over a week ago.
 * @param {string} publishedAt
 * @param {number} now
 */
export const nameStoryDay = (publishedAt, now) =>
  nameDay(new Date(publishedAt), new Date(now), {
    nearDays: [-1, 0],
    nameOtherDay: nameEarlierDay,
    isCapitalized: true,
  });

/** @param {string} credit */
const describeCredit = (credit) =>
  credit.startsWith("via ") ? `Photo ${credit}` : `Photo: ${credit}`;

/**
 * Credit text that can also wrap after each slash, as between a photographer and their agency.
 * @param {string} text
 */
const renderCreditText = (text) =>
  text.split("/").map((piece, index) => (index === 0 ? piece : html`/<wbr />${piece}`));

/**
 * The credit, in parts that wrap apart when each fits on a line of its own: who took the photo,
 * then the agency it came through. fitPhotoCredits lets it wrap as one text when either doesn't.
 * @param {string} credit
 */
function renderCredit(credit) {
  const described = describeCredit(credit);
  const viaAt = described.indexOf(" via ");
  if (viaAt < 0) return renderCreditText(described);
  return html`<span class="credit-part">${renderCreditText(described.slice(0, viaAt))}</span>
    <span class="credit-part">${renderCreditText(described.slice(viaAt + 1))}</span>`;
}

/** @param {NewsStory["photo"]} photo */
const findPhotoUrl = (photo) =>
  photo && isWebAddress(photo.url) && !hasImageFailed(photo.url) ? photo.url : null;

/**
 * A link that opens the story, or what it holds alone when its address isn't a web address.
 * @param {NewsStory} story
 * @param {import("#shared/html.js").Markup | string} content
 */
const renderStoryLink = (story, content) =>
  isWebAddress(story.url)
    ? html`<a href="${story.url}" target="_blank" rel="noopener noreferrer">${content}</a>`
    : content;

/**
 * The button that opens the story, or nothing when its address isn't a web address.
 * @param {Pick<NewsStory, "url" | "outlet" | "title">} story
 */
export function renderReadButton(story) {
  if (!isWebAddress(story.url)) return html``;
  const label = `Read on ${story.outlet}`;
  return html`<div class="news-foot">
    <a
      class="read-button"
      href="${story.url}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="${label}: ${story.title}"
      ><span class="read-label">${label}</span>${READ_ARROW}</a
    >
  </div>`;
}

/**
 * @param {NewsStory} story
 * @param {number} now
 */
const renderMeta = (story, now) =>
  html`<p class="news-meta">
    ${joinWithSeparator([story.author, story.outlet, nameStoryDay(story.publishedAt, now)].filter(Boolean))}
  </p>`;

/** @param {NewsStory} story */
const renderSummary = (story) =>
  story.summary && html`<p class="news-summary" data-quoted>${story.summary}</p>`;

/**
 * @param {string[]} teams
 * @param {NewsLeague["renderTeam"]} renderTeam
 */
function renderTeams(teams, renderTeam) {
  const known = teams.map(renderTeam).filter((team) => team !== null);
  return known.length > 0 && html`<p class="news-teams">${known}</p>`;
}

/** @param {number} value */
const roundForCss = (value) => Math.round(value * 1000) / 1000;

/**
 * The photo in its frame, which the Worker sized to the photo, so the card keeps its height as the
 * photo arrives.
 * @param {NewsStory["photo"]} photo
 */
function renderPhoto(photo) {
  const url = findPhotoUrl(photo);
  if (!photo || !url) return null;
  const { aspect, position } = framePhoto(photo);
  return html`<img
    class="news-photo"
    src="${url}"
    alt=""
    loading="lazy"
    referrerpolicy="no-referrer"
    style="--photo-aspect: ${roundForCss(aspect)}; --photo-position: ${roundForCss(position)}%"
  />`;
}

/**
 * The story's teams, with its photo's credit across from them, under the photo.
 * @param {string[]} teams
 * @param {NewsStory["photo"]} photo
 * @param {NewsLeague["renderTeam"]} renderTeam
 */
function renderCardTop(teams, photo, renderTeam) {
  const credit = findPhotoUrl(photo) && photo?.credit;
  const teamLine = renderTeams(teams, renderTeam);
  if (!credit) return teamLine;
  return html`<div class="news-top">
    ${teamLine}
    <p class="news-photo-credit">${renderCredit(credit)}</p>
  </div>`;
}

/**
 * A story under the lead, in a line or two: its headline, then its outlet and day.
 * @param {NewsStory} story
 * @param {number} now
 */
const renderMoreStory = (story, now) =>
  html`<li>
    <p class="news-more-title" data-quoted>${renderStoryLink(story, story.title)}</p>
    <p class="news-meta">${joinWithSeparator([story.outlet, nameStoryDay(story.publishedAt, now)])}</p>
  </li>`;

/**
 * @param {NewsStory[]} more
 * @param {number} now
 */
const renderMore = (more, now) =>
  more.length > 0 &&
  html`<div class="news-more">
    <p class="news-more-label">More on this</p>
    <ul class="news-more-list">
      ${more.map((story) => renderMoreStory(story, now))}
    </ul>
  </div>`;

/**
 * @param {NewsCard} card
 * @param {number} now
 * @param {NewsLeague["renderTeam"]} renderTeam
 */
function renderCard({ lead, more }, now, renderTeam) {
  return html`<article class="news-card">
    ${renderPhoto(lead.photo)}
    <div class="news-body">
      ${renderCardTop(lead.teams.slice(0, MAX_CARD_TEAMS), lead.photo, renderTeam)}
      <h2 class="news-title" data-quoted>${renderStoryLink(lead, lead.title)}</h2>
      ${renderMeta(lead, now)} ${renderSummary(lead)} ${renderReadButton(lead)}
      ${renderMore(more, now)}
    </div>
  </article>`;
}

// How tall each part of a card draws, roughly, in the same unit, so the columns a wide screen shows
// come out about as long as each other.
const CARD_TEXT_HEIGHT = 3.4;
// A photo in its widest frame, 16:9; a taller frame draws taller in step.
const WIDEST_PHOTO_HEIGHT = 5.1;
const MORE_LABEL_HEIGHT = 0.8;
const MORE_STORY_HEIGHT = 1.3;

/** @param {NewsStory["photo"]} photo */
const estimatePhotoHeight = (photo) =>
  photo && findPhotoUrl(photo)
    ? (WIDEST_PHOTO_HEIGHT * WIDEST_FRAME) / framePhoto(photo).aspect
    : 0;

/** @param {NewsCard} card */
const estimateCardHeight = ({ lead, more }) =>
  CARD_TEXT_HEIGHT +
  estimatePhotoHeight(lead.photo) +
  (more.length > 0 ? MORE_LABEL_HEIGHT + more.length * MORE_STORY_HEIGHT : 0);

/**
 * The cards in `columnCount` columns, each card in turn going to the shortest, so each column
 * stacks its cards without gaps and the newest still come first.
 * @param {NewsCard[]} cards
 * @param {number} columnCount
 */
function placeInColumns(cards, columnCount) {
  /** @type {{ height: number, cards: NewsCard[] }[]} */
  const columns = Array.from({ length: columnCount }, () => ({ height: 0, cards: [] }));
  for (const card of cards) {
    const shortest = columns.reduce((best, column) =>
      column.height < best.height ? column : best,
    );
    shortest.height += estimateCardHeight(card);
    shortest.cards.push(card);
  }
  return columns.map((column) => column.cards);
}

/**
 * The cards the Worker saved, with only the outlets `choices` reads, in `columnCount` columns.
 * @param {NewsCard[]} cards
 * @param {import("./news-picks.js").NewsChoices} choices
 * @param {number} now
 * @param {NewsLeague & { columnCount?: number }} options
 */
export function renderNews(cards, choices, now, { renderTeam, outletSwitches, columnCount = 1 }) {
  const read = pickReadCards(cards, choices, outletSwitches);
  if (!read.length) return html`<p class="empty-note">No news yet</p>`;
  return html`<div class="news-cards">
      ${placeInColumns(read, columnCount).map(
        (column) =>
          html`<ul class="news-column">
            ${column.map(
              (card) =>
                html`<li data-key="${card.lead.id}">${renderCard(card, now, renderTeam)}</li>`,
            )}
          </ul>`,
      )}
    </div>`;
}
