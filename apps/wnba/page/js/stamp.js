import { nameDay } from "#shared/days.js";
import { html, joinNames, joinWithSeparator } from "#shared/html.js";
import {
  describeFinishedDay,
  renderStampLine,
  renderStampNow,
  renderStampTime,
  renderStampWhen,
} from "#shared/stamp.js";
import { readGameDay } from "./days.js";
import { describeLiveMoment, isCalledOff, listSeasonGames } from "./games-view.js";
import { nameTeam, orderBySeriesWins } from "./series.js";

// The header's lines on the latest score and the next tip-off, or on why the page isn't current.

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */

const FEED_NAMES = {
  scoreboard: "today's scores",
  schedule: "the schedule",
  bracket: "the bracket",
  standings: "the standings",
};

/** @param {Game} game */
const hasBothTeams = (game) => !!(game.away.team && game.home.team);

/** @param {Game} game */
const readStart = (game) => Date.parse(game.start ?? "");

/** @param {Game} game */
const formatMatchup = (game) => `${nameTeam(game.away.team)} @ ${nameTeam(game.home.team)}`;

/** @param {Game} game */
const describeLiveGame = (game) =>
  `${formatMatchup(game)} ${game.away.score}-${game.home.score} ${describeLiveMoment(game) || game.status}`;

/**
 * Where a game's series stands after it: "Liberty won series 2-0", "series tied 1-1", or
 * "Dream lead series 1-0".
 * @param {Series | undefined} series
 */
function describeSeriesAfter(series) {
  if (!series?.top || !series.bottom) return "";
  const [ahead, behind] = orderBySeriesWins(series.top, series.bottom);
  const score = `${ahead.wins}-${behind.wins}`;
  if (series.winner) return `${nameTeam(series.winner)} won series ${score}`;
  if (ahead.wins === behind.wins) return `series tied ${score}`;
  return `${nameTeam(ahead.team)} lead series ${score}`;
}

/** @param {Game} game */
function describeScore(game) {
  const [winner, loser] =
    game.away.score > game.home.score ? [game.away, game.home] : [game.home, game.away];
  return `${nameTeam(winner.team)} ${winner.score} ${nameTeam(loser.team)} ${loser.score}`;
}

// A game saved final before the Worker saw it live has no end, so only its day is known.
/**
 * When a final game ended: "at 10:41 PM yesterday", "at 4:02 PM", or a day.
 * @param {Game} game
 * @param {Date} now
 */
function describeFinalWhen(game, now) {
  const start = new Date(readStart(game));
  const end = game.end ? new Date(game.end) : null;
  const day = describeFinishedDay(end ?? start, start, now);
  const shownDay = day === "today" ? "" : day;
  if (!end) return shownDay && html`<b>${shownDay}</b>`;
  return html`at ${renderStampTime(end, shownDay)}`;
}

/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatestFinal(game, seriesById, now) {
  const when = describeFinalWhen(game, now);
  const sentence = html`Last game ${describeScore(game)} final${when && html` ${when}`}`;
  const standing = describeSeriesAfter(seriesById.get(game.series ?? ""));
  return standing ? html`${sentence} &mdash; ${standing}` : sentence;
}

/**
 * The games in one state whose teams and start are known, earliest first.
 * @param {Game[]} games
 * @param {string} state
 */
const listGamesInState = (games, state) =>
  games
    .filter(
      (game) => game.state === state && hasBothTeams(game) && Number.isFinite(readStart(game)),
    )
    .sort((first, second) => readStart(first) - readStart(second));

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatest(games, seriesById, now) {
  const live = listGamesInState(games, "live");
  if (live.length)
    return html`${renderStampNow()} ${joinWithSeparator(live.map(describeLiveGame))}`;
  const latestFinal = listGamesInState(games, "final").at(-1);
  return latestFinal ? describeLatestFinal(latestFinal, seriesById, now) : "";
}

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 */
const findNextGame = (games, seriesById) =>
  listGamesInState(games, "pre").find((game) => !isCalledOff(game, seriesById));

/**
 * @param {Game} game
 * @param {Date} now
 */
function renderNextTipOff(game, now) {
  const when = game.isTimeSet
    ? renderStampWhen(new Date(readStart(game)), now)
    : nameDay(/** @type {Date} */ (readGameDay(game)), now);
  return renderStampLine("Next tip-off", when, formatMatchup(game));
}

/**
 * What last happened, or the score of each game under way, and which game is next, from the
 * season's playoff games and each team's nearest, which hold every team's last, live, and next
 * game in the regular season too.
 * @param {{ games?: Game[], nearestGames?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderStampLines(season, now) {
  const games = listSeasonGames(season, null);
  const seriesById = new Map((season?.series ?? []).map((series) => [series.id, series]));
  const today = new Date(now);
  const latest = describeLatest(games, seriesById, today);
  const lines = latest ? [html`<span>${latest}</span>`] : [];
  const next = findNextGame(games, seriesById);
  if (next) lines.push(renderNextTipOff(next, today));
  return lines;
}

/**
 * @param {{ error?: string, detail?: string, standIn?: string } | null} status
 * @returns {string}
 */
function describeFeedProblem(status) {
  if (!status?.error) return "";
  if (status.error !== "wnba_feeds_missing") return "The WNBA isn't answering right now";
  const feeds = String(status.detail ?? "")
    .split(", ")
    .map((feed) => FEED_NAMES[feed] ?? feed);
  const stopped = `The WNBA stopped sending ${joinNames(feeds, "and")}`;
  return status.standIn === "espn" ? `${stopped}. Scores are from ESPN for now.` : stopped;
}

/**
 * @param {{ status: { error?: string, detail?: string, standIn?: string } | null, problem: string }} state
 * @returns {string}
 */
export const describeStampProblem = ({ status, problem }) => problem || describeFeedProblem(status);
