import { renderAllStarMark } from "#shared/all-star.js";
import { html } from "#shared/html.js";
import { renderTeamSheetButton } from "#shared/team-sheet.js";
import { nameTeam } from "./series.js";
import { TEAMS } from "./teams.js";

/** @param {string | null} code */
export function renderDot(code) {
  const team = code ? TEAMS[code] : null;
  if (!team) return html`<span class="dot unknown"></span>`;
  return html`<span class="dot" style="--color:${team.color};--color2:${team.color2};--split:${team.dotSplit}%"></span>`;
}

// The feeds give a seed of 0 to a team that isn't known yet.
/** @param {number | null | undefined} seed */
const renderSeed = (seed) => (seed ? html`<span class="seed">${seed}</span>` : "");

/**
 * @param {string | null} code
 * @param {number | null | undefined} seed
 */
const renderClubParts = (code, seed) =>
  html`${renderDot(code)}${renderSeed(seed)}<span class="team-name">${nameTeam(code)}</span>`;

/**
 * A team's dot, seed, and name, that opens its sheet, or TBD while it isn't known.
 * @param {string | null} code
 * @param {{ seed?: number | null }} [options]
 */
export function renderClub(code, { seed } = {}) {
  if (!code || !TEAMS[code])
    return html`<span class="club tbd">${renderClubParts(code, seed)}</span>`;
  return renderTeamSheetButton({
    team: code,
    content: renderClubParts(code, seed),
    className: "club",
  });
}

/**
 * A team's dot, seed, and name, for inside a button of its own, like a game's row.
 * @param {string} code
 * @param {{ seed?: number | null }} [options]
 */
export const renderPlainClub = (code, { seed } = {}) =>
  html`<span class="club">${renderClubParts(code, seed)}</span>`;

/**
 * A button around a team's name that opens its sheet.
 * @param {string} code
 * @param {import("#shared/html.js").Markup | string} content
 */
export const renderTeamButton = (code, content) => renderTeamSheetButton({ team: code, content });

/**
 * A team's name in a line of text, that opens its sheet once the team is known.
 * @param {string | null} code
 */
export const renderTeamName = (code) =>
  code && TEAMS[code] ? renderTeamButton(code, nameTeam(code)) : nameTeam(code);

// The All-Star Game's teams wear the classic pair: the West orange and the East white, and in a
// year of captains' teams, the visitors orange and the home team white.
const ALL_STAR_COLORS = { orange: "#ee6730", white: "#ffffff" };

// Its star is set into the card as a dot is, with the dot's own shadow and light.
const ALL_STAR_LOOK = {
  size: 18.5,
  shadow: { x: 0.4, y: 0.4, blur: 1 },
  light: { x: 0.4, y: 0.4 },
  hairline: 0.15,
};

/**
 * @param {string} name
 * @param {"away" | "home"} place
 */
function chooseAllStarColor(name, place) {
  if (/\bWest\b/i.test(name)) return ALL_STAR_COLORS.orange;
  if (/\bEast\b/i.test(name)) return ALL_STAR_COLORS.white;
  return place === "away" ? ALL_STAR_COLORS.orange : ALL_STAR_COLORS.white;
}

/**
 * An All-Star team's star, in its uniform's color, and its name.
 * @param {{ game: string, name: string, place: "away" | "home" }} team `game` is the game's ID
 */
export const renderAllStarClub = ({ game, name, place }) =>
  html`<span class="club">${renderAllStarMark({
    id: `all-star-${game}-${place}`,
    color: chooseAllStarColor(name, place),
    look: ALL_STAR_LOOK,
  })}<span class="team-name">${name}</span></span>`;
