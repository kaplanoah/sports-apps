import { TEAMS } from "./teams.js";
import { buildBracket } from "./bracket.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderTeamSheetButton } from "#shared/team-sheet.js";
import { readRanking } from "./kept-on-device.js";
import { session, readSeasonYear } from "./session.js";

// A page saved before tracked titles were lists kept only a club's latest one, as a number.
const listTrackedTitles = (id) => [].concat(session.trackedTitles[id] ?? []);

// The club that won this season's World Series, from the season as the store has it now, so its
// title shows as soon as the bracket does, without waiting for the page to read the seasons again.
function findCurrentChampion() {
  const { state } = session;
  const isCurrentShown = session.activeYear === readSeasonYear() && state && state.teams;
  return isCurrentShown ? (buildBracket(state).ws?.winner ?? null) : null;
}

const listCurrentTitle = (id) => (findCurrentChampion() === id ? [readSeasonYear()] : []);

/** Every World Series a club won, newest first. */
export const listTitles = (id) =>
  [...new Set([...TEAMS[id].titles, ...listTrackedTitles(id), ...listCurrentTitle(id)])].sort(
    (first, second) => second - first,
  );

const findLastTitle = (id) => listTitles(id)[0] ?? null;

export function describeDrought(id) {
  const won = findLastTitle(id);
  if (!won) return `Since ${TEAMS[id].firstSeason}`;
  const year = readSeasonYear();
  if (won >= year) return "Reigning";
  if (won === year - 1 && !findCurrentChampion()) return "Defending";
  const years = year - won;
  return `${years} ${years === 1 ? "yr" : "yrs"} ago`;
}

/** The last World Series a club won, or that it never has, and how long ago. */
export function renderTitleSummary(id) {
  const won = findLastTitle(id);
  return joinWithSeparator([
    html`<span>${won ? `Last WS ${won}` : "Never won WS"}</span>`,
    html`<span>${describeDrought(id)}</span>`,
  ]);
}

const STATUS_CHIPS = {
  champion: { label: "Champs", className: "champ" },
  alive: { label: "Alive", className: "alive" },
  out: { label: "Out", className: "out" },
};

/** @param {"champion" | "alive" | "out"} status */
export function renderStatusChip(status) {
  const chip = STATUS_CHIPS[status];
  return html`<span class="chip status-chip ${chip.className}">${chip.label}</span>`;
}

const measureLightness = (hex) => {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return 0.299 * red + 0.587 * green + 0.114 * blue;
};

// Split vertically so the inner shadow shades both halves alike; a much lighter half reads larger,
// so it gets slightly less room.
function chooseDotSplit(team) {
  const contrastGap = measureLightness(team.color2) - measureLightness(team.color);
  if (contrastGap > 90) return 52;
  if (contrastGap < -90) return 48;
  return 50;
}

export function renderTeamDot(id) {
  const team = TEAMS[id];
  if (!team) return html`<span class="dot" style="background:#999"></span>`;
  const split = chooseDotSplit(team);
  return html`<span class="dot" style="background:linear-gradient(90deg, ${team.color} ${split}%, ${team.color2} ${split}%)"></span>`;
}

export function nameTeam(id) {
  return TEAMS[id] ? TEAMS[id].name : "?";
}

/**
 * A club's name with its city, as "New York Mets", or its name alone when its city isn't in it.
 * @param {string} id
 */
export const nameClubFully = (id) =>
  TEAMS[id] ? [TEAMS[id].city, TEAMS[id].name].filter(Boolean).join(" ") : "?";

const renderClubParts = (id) =>
  html`${renderTeamDot(id)}<span class="team-name">${nameTeam(id)}</span>`;

/** A club's dot and name, that opens its sheet. */
export function renderClub(id) {
  if (!TEAMS[id]) return renderPlainClub(id);
  return renderTeamSheetButton({
    team: id,
    name: nameTeam(id),
    content: renderClubParts(id),
    className: "club",
  });
}

/** A club's dot and name, where a tap does something else, like dragging it in the ranking. */
export const renderPlainClub = (id) => html`<span class="club">${renderClubParts(id)}</span>`;

/** A club's name in a line of text, that opens its sheet. */
export const renderClubName = (id) =>
  TEAMS[id]
    ? renderTeamSheetButton({ team: id, name: nameTeam(id), content: nameTeam(id) })
    : nameTeam(id);

// A device's ranking changes only on a drag, so it can name clubs that left the field and miss ones
// that arrived, which go by name, as every club does before the first drag.
export function listRankedOrder() {
  const { state } = session;
  if (!state || !state.teams) return [];
  const ranked = readRanking(session.activeYear).filter((id) => state.teams[id]);
  const unranked = Object.keys(state.teams)
    .filter((id) => !ranked.includes(id))
    .sort((first, second) => nameTeam(first).localeCompare(nameTeam(second), "en"));
  return ranked.concat(unranked);
}

export function renderRankTag(id, solid) {
  const index = listRankedOrder().indexOf(id);
  if (index === -1) return html``;
  return html`<span class="rank-slot"><span class="chip rank-tag ${solid ? "solid" : ""}">#${index + 1}</span></span>`;
}
