// Picking the stories this device reads from each card: every story the Worker keeps, but a team's
// own beat writers' and the outlets each of the league's switches names, when the device switches
// them off. When it leaves out a card's lead, the first story under it that it reads leads in its
// place.

const MAX_MORE = 3;
export const TEAM_OUTLETS = "teamOutlets";

/**
 * A story as `news/cards` keeps it.
 * @typedef {object} NewsStory
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} summary
 * @property {string} author
 * @property {string} outlet
 * @property {string} source
 * @property {string} [teamFeed] the team whose own outlets alone carry it
 * @property {string} publishedAt
 * @property {import("./news-photo.js").NewsPhoto | null} photo
 * @property {string[]} teams
 */

/**
 * The story that tells a piece of news best, and the others that add to it.
 * @typedef {{ lead: NewsStory, more: NewsStory[] }} NewsCard
 */

/**
 * Which of the optional outlets a device reads, by switch: a team's own beat writers, and each of
 * the league's switches for its outlets. A switch the device hasn't touched is on.
 * @typedef {Record<string, boolean>} NewsChoices
 */

/**
 * The outlets each of a league's switches leaves out when it's off, by the switch's name.
 * @typedef {Record<string, string[]>} OutletSwitches
 */

/**
 * @param {NewsChoices} choices
 * @param {string} name
 */
export const isChoiceOn = (choices, name) => choices[name] !== false;

// Stored text is never trusted as a link, so only a web address is.
/** @param {string} url */
export const isWebAddress = (url) => /^https?:\/\//i.test(url ?? "");

/**
 * @param {NewsStory} story
 * @param {NewsChoices} choices
 * @param {OutletSwitches} outletSwitches
 */
const isSwitchedOff = (story, choices, outletSwitches) =>
  (story.teamFeed && !isChoiceOn(choices, TEAM_OUTLETS)) ||
  Object.entries(outletSwitches).some(
    ([name, sources]) => sources.includes(story.source) && !isChoiceOn(choices, name),
  );

/**
 * @param {NewsStory} story
 * @param {NewsChoices} choices
 * @param {OutletSwitches} outletSwitches
 */
const isReadStory = (story, choices, outletSwitches) =>
  isWebAddress(story.url) && !isSwitchedOff(story, choices, outletSwitches);

/**
 * @param {NewsCard} card
 * @param {NewsChoices} choices
 * @param {OutletSwitches} outletSwitches
 * @returns {NewsCard | null}
 */
function pickReadCard(card, choices, outletSwitches) {
  const [lead, ...more] = [card.lead, ...card.more].filter((story) =>
    isReadStory(story, choices, outletSwitches),
  );
  return lead ? { lead, more: more.slice(0, MAX_MORE) } : null;
}

/**
 * The cards with a story this device reads, newest lead first.
 * @param {NewsCard[]} cards
 * @param {NewsChoices} choices
 * @param {OutletSwitches} outletSwitches
 */
export const pickReadCards = (cards, choices, outletSwitches) =>
  cards
    .map((card) => pickReadCard(card, choices, outletSwitches))
    .filter((card) => card !== null)
    .sort(
      (first, second) => Date.parse(second.lead.publishedAt) - Date.parse(first.lead.publishedAt),
    );
