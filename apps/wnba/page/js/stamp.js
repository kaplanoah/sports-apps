import { nameDay } from "#shared/days.js";
import { html, joinNames, joinWithSeparator } from "#shared/html.js";
import {
  describeDaySlate,
  describeFinishedDay,
  describeSlate,
  isWholeSlate,
  renderStampLine,
  renderStampNow,
  renderStampTime,
  renderStampWhen,
} from "#shared/stamp.js";
import { isGameToday, readGameDay } from "./days.js";
import { describeLiveMoment, listSeasonGames } from "./games-view.js";
import { isToBePlayed, mapSeriesById } from "./nearest-games.js";
import { nameTeam, orderBySeriesWins } from "./series.js";
import { isScoreboardGame } from "./snapshot.js";

// The header's lines on the latest score and the next tip-off, or on why the page isn't current.

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("#shared/diagnostics.js").UpdateStatus} UpdateStatus */

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
 * @param {string} slate how today's full slate stands, or nothing
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatestFinal(game, slate, seriesById, now) {
  const when = describeFinalWhen(game, now);
  const sentence = html`Last game ${describeScore(game)} final${when && html` ${when}`}`;
  const standing = describeSeriesAfter(seriesById.get(game.series ?? ""));
  const line = standing ? html`${sentence} &mdash; ${standing}` : sentence;
  return slate ? html`${line}, ${slate}` : line;
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
 * The games that will be played on a game's day.
 * @param {Game[]} games
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
function listDayGames(games, game, seriesById) {
  const day = readGameDay(game)?.getTime();
  return games.filter(
    (each) =>
      hasBothTeams(each) && isToBePlayed(each, seriesById) && readGameDay(each)?.getTime() === day,
  );
}

/**
 * Each game under way on a day of few games, or else the one that tipped off last and the day's
 * slate.
 * @param {Game[]} live the games under way, earliest first
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 */
function describeLiveGames(live, games, seriesById) {
  const lead = /** @type {Game} */ (live.at(-1));
  const slate = describeDaySlate(listDayGames(games, lead, seriesById));
  if (!slate) return joinWithSeparator(live.map(describeLiveGame));
  return `${describeLiveGame(lead)}, ${slate}`;
}

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatest(games, seriesById, now) {
  const live = listGamesInState(games, "live");
  if (live.length) return html`${renderStampNow()} ${describeLiveGames(live, games, seriesById)}`;
  const latestFinal = listGamesInState(games, "final").at(-1);
  if (!latestFinal) return "";
  const slate = isGameToday(latestFinal, now.getTime())
    ? describeDaySlate(listDayGames(games, latestFinal, seriesById))
    : "";
  return describeLatestFinal(latestFinal, slate, seriesById, now);
}

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 */
const findNextGame = (games, seriesById) =>
  listGamesInState(games, "pre").find((game) => isToBePlayed(game, seriesById));

/**
 * @param {Game} game
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function renderNextTipOff(game, games, seriesById, now) {
  const when = game.isTimeSet
    ? renderStampWhen(new Date(readStart(game)), now)
    : nameDay(/** @type {Date} */ (readGameDay(game)), now);
  const dayGames = listDayGames(games, game, seriesById);
  const matchup = isWholeSlate(dayGames, "pre")
    ? `${formatMatchup(game)}, ${describeSlate(dayGames.length, "starts")}`
    : formatMatchup(game);
  return renderStampLine("Next tip-off", when, matchup);
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
  const seriesById = mapSeriesById(season?.series);
  const today = new Date(now);
  const latest = describeLatest(games, seriesById, today);
  const lines = latest ? [html`<span>${latest}</span>`] : [];
  const next = findNextGame(games, seriesById);
  if (next) lines.push(renderNextTipOff(next, games, seriesById, today));
  return lines;
}

// Today's scores are missed only while the scoreboard has a game to score, since the league may
// not send them at all on a day without one.
/**
 * @param {UpdateStatus} status
 * @param {boolean} hasScoresToMiss
 */
function listMissedFeeds(status, hasScoresToMiss) {
  const feeds = String(status.detail ?? "").split(", ");
  return hasScoresToMiss ? feeds : feeds.filter((feed) => feed !== "scoreboard");
}

/**
 * @param {UpdateStatus | null} status
 * @param {boolean} hasScoresToMiss
 * @returns {string}
 */
function describeFeedProblem(status, hasScoresToMiss) {
  if (!status?.error) return "";
  if (status.error !== "wnba_feeds_missing") return "The WNBA isn't answering right now";
  const feeds = listMissedFeeds(status, hasScoresToMiss);
  if (!feeds.length) return "";
  const stopped = `The WNBA stopped sending ${joinNames(
    feeds.map((feed) => FEED_NAMES[feed] ?? feed),
    "and",
  )}`;
  return feeds.includes("scoreboard") && status.standIn === "espn"
    ? `${stopped}. Scores are from ESPN for now.`
    : stopped;
}

/**
 * @param {{ games?: Game[], nearestGames?: Game[], series?: Series[] } | null} season
 * @param {{ games?: Game[] } | null} schedule
 * @param {number} now
 */
function hasScoresToMiss(season, schedule, now) {
  const seriesById = mapSeriesById(season?.series);
  return listSeasonGames(season, schedule).some((game) => isScoreboardGame(game, seriesById, now));
}

/**
 * @param {{ status: UpdateStatus | null, problem: string, season: { games?: Game[], nearestGames?: Game[], series?: Series[] } | null, schedule: { games?: Game[] } | null, now: number }} state
 * @returns {string}
 */
export const describeStampProblem = ({ status, problem, season, schedule, now }) =>
  problem || describeFeedProblem(status, hasScoresToMiss(season, schedule, now));
