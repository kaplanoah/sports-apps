import { pickSideColors } from "#shared/team-colors.js";
import { TEAMS } from "./teams.js";

// The game sheet draws each team's side of its charts and bars in the team's own color, on each
// theme, picked as shared/team-colors.js picks two teams' colors.

const THEMES = /** @type {const} */ (["light", "dark"]);

/**
 * The colors the two teams' sides take on one theme.
 * @param {string} away
 * @param {string} home
 * @param {"light" | "dark"} theme
 */
export const pickSheetColors = (away, home, theme) =>
  pickSideColors(TEAMS[away].chartColors[theme], TEAMS[home].chartColors[theme]);

/**
 * The shade of a team's color its name and numbers read in on one theme: its own darker shade where
 * the team keeps one for that color, or the color itself.
 * @param {string} code
 * @param {"light" | "dark"} theme
 * @param {string} color
 */
function readNameColor(code, theme, color) {
  const team = TEAMS[code];
  const isFirstChoice = color === team.chartColors[theme][0];
  return (isFirstChoice && "nameColors" in team && team.nameColors[theme]) || color;
}

/**
 * The style that hands one side its color on one theme, and the darker shade its name reads in when
 * the color is too light to read as text.
 * @param {"away" | "home"} side
 * @param {string} code
 * @param {"light" | "dark"} theme
 * @param {string} color
 */
function formatSideColors(side, code, theme, color) {
  const nameColor = readNameColor(code, theme, color);
  const nameStyle = nameColor === color ? "" : ` --${side}-name-${theme}: ${nameColor};`;
  return `--${side}-${theme}: ${color};${nameStyle}`;
}

/**
 * The style that hands the sheet each team's color on each theme, or none while a team isn't
 * known.
 * @param {string | null} away
 * @param {string | null} home
 */
export function formatSheetColors(away, home) {
  if (!away || !home || !TEAMS[away] || !TEAMS[home]) return "";
  return THEMES.map((theme) => {
    const colors = pickSheetColors(away, home, theme);
    return `${formatSideColors("away", away, theme, colors.away)} ${formatSideColors("home", home, theme, colors.home)}`;
  }).join(" ");
}

/**
 * The style that hands a player's sheet her team's mark color on each theme.
 * @param {string} code
 */
export const formatMarkColors = (code) =>
  THEMES.map((theme) => `--mark-${theme}: ${TEAMS[code].markColors[theme]};`).join(" ");
