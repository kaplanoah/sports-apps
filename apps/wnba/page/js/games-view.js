import { formatCalendarDate, formatClockTime } from "#shared/days.js";
import { renderGameRow } from "#shared/game-row.js";
import { html } from "#shared/html.js";
import { listFoundDays, listSeasonDays as listDayStripDays } from "#shared/season-days.js";
import { renderAllStarClub, renderClub, renderPlainClub } from "./clubs.js";
import { readGameDay } from "./days.js";
import { renderScoreboard } from "./scoreboard.js";
import { describeSeriesAfterWin } from "#shared/series-text.js";
import { nameTeam } from "./series.js";
import { countWinsNeeded, ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {{ team: string | null, seed: number | null, score: number | null, isInBonus: boolean }} GameSide */
/** @typedef {{ id: string, round: number | null, series: string | null, number: number | null, start: string | null, state: string, status: string, isTimeSet: boolean, period: number | null, clock: string | null, isIfNeeded: boolean, away: GameSide, home: GameSide, end?: string, networks?: string[], allStar?: { away: string, home: string }, arena?: { name: string, city: string, state: string }, isNeutral?: boolean }} Game */

// Once a series is decided, the games it no longer needs never happen.
/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
export const isCalledOff = (game, seriesById) =>
  game.state === "pre" && game.isIfNeeded && !!seriesById.get(game.series ?? "")?.winner;

/** @param {Game} game */
export function findLoser(game) {
  if (game.state !== "final") return null;
  return game.away.score < game.home.score ? "away" : "home";
}

/** @param {Game} game */
const findWinningTeam = (game) =>
  game.away.score > game.home.score ? game.away.team : game.home.team;

/** @param {number} period */
export function describePeriod(period) {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

// Between periods the clock stops at zero, and the league's own status says which break it is.
/** @param {Game} game */
const isClockRunning = (game) => !!(game.clock && game.clock !== "0.0" && game.period);

/**
 * When a game that hasn't started starts, or TBD while its time isn't set.
 * @param {Game} game
 */
export const describeStartTime = (game) =>
  game.isTimeSet && game.start ? formatClockTime(new Date(game.start)) : "TBD";

/** @param {Game} game */
export function renderHeadline(game) {
  if (game.state === "pre")
    return html`<span class="time tabular">${describeStartTime(game)}</span>`;
  const loser = findLoser(game);
  return html`<span class="score"
    >${renderScoreboard(game.away.score, { isLoser: loser === "away" })}${renderScoreboard(
      game.home.score,
      { isLoser: loser === "home" },
    )}</span
  >`;
}

/**
 * A live game's period and clock, or which break it's in while the clock stops between periods.
 * @param {Game} game
 */
export const describeLiveClock = (game) =>
  isClockRunning(game) ? `${describePeriod(game.period ?? 0)} ${game.clock}` : game.status;

/** @param {Game} game */
export function renderStatus(game) {
  if (game.state === "live" && isClockRunning(game))
    return html`<span class="clock tabular">${describeLiveClock(game)}</span>`;
  if (game.state === "live") return html`<span class="break">${game.status}</span>`;
  if (game.state === "final") return html`${game.status || "Final"}`;
  return game.isIfNeeded && html`<span class="if-needed">If needed</span>`;
}

// A game shows its series as it stood at tip-off, and once it's over, as it stood after.
/**
 * @param {Game} game
 * @param {Game[]} games
 */
function countSeriesWins(game, games) {
  const isCounted = (other) =>
    other.series === game.series &&
    other.state === "final" &&
    (other.id === game.id || other.number < game.number);
  const winners = games.filter(isCounted).map(findWinningTeam);
  const countWins = (team) => winners.filter((winner) => winner === team).length;
  return [countWins(game.away.team), countWins(game.home.team)];
}

/**
 * Where a final's series stood once it was over, as its winner tells it, or nothing for a game
 * outside a series.
 * @param {Game} game
 * @param {Game[]} games
 */
export function describeFinalInSeries(game, games) {
  if (game.state !== "final" || !game.round) return "";
  const [awayWins, homeWins] = countSeriesWins(game, games);
  const isAwayWinner = findLoser(game) === "home";
  return describeSeriesAfterWin({
    winner: nameTeam(findWinningTeam(game)),
    wins: isAwayWinner ? awayWins : homeWins,
    losses: isAwayWinner ? homeWins : awayWins,
    winsNeeded: countWinsNeeded(game.round),
  });
}

// A game the league plays at a neutral site, away from its home team's arena, says where.
/** @param {Game} game */
const renderElsewhereLabel = (game) =>
  !!game.isNeutral && !!game.arena && html`<span class="series-label">In ${game.arena.city}</span>`;

// Short names, since the label shares the row's middle with the time or score. Until both teams
// are known, the game's number tells the series' games apart instead.
/**
 * @param {Game} game
 * @param {Game[]} games
 */
function renderSeriesLabel(game, games) {
  if (game.allStar) return html`<span class="series-label">All-Star Game</span>`;
  if (!game.round) return renderElsewhereLabel(game);
  const round = ROUNDS[game.round];
  if (!game.away.team || !game.home.team)
    return html`<span class="series-label">${round.shortName} G${game.number}</span>`;
  const wins = countSeriesWins(game, games);
  const isDecided = Math.max(...wins) > round.bestOf / 2;
  return html`<span class="series-label${isDecided ? " decided" : ""}"
    >${round.shortName} <span class="series-count tabular">${wins.join("-")}</span></span
  >`;
}

/** @param {Game} game */
const hasBothTeams = (game) => !!game.away.team && !!game.home.team;

// The All-Star Game's teams aren't the league's, so it has no sheet, and nor do they.
/** @param {Game} game */
const canOpen = (game) => hasBothTeams(game) && !game.allStar;

// Every game holds a line for Bonus under each team, so the teams stay put as it comes and goes.
// A row that opens its game opens it wherever it's tapped, so its teams are plain.
/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function describeSide(game, place) {
  const side = game[place];
  const bonus = game.state === "live" && side.isInBonus && html`<span class="bonus">Bonus</span>`;
  return {
    lines: renderSideClub(game, place),
    classes: [findLoser(game) === place && "lost"],
    extra: html`${bonus}`,
  };
}

/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function renderSideClub(game, place) {
  const side = game[place];
  if (game.allStar) return renderAllStarClub({ game: game.id, name: game.allStar[place], place });
  const renderTeam = canOpen(game) && side.team ? renderPlainClub : renderClub;
  return renderTeam(side.team, { seed: side.seed });
}

/** @param {Game} game */
export const nameGame = (game) =>
  game.round ? `${ROUNDS[game.round].name} Game ${game.number}` : "Game";

/** @param {Game} game */
function nameOpenButton(game) {
  const teams = `${nameTeam(game.away.team)} at ${nameTeam(game.home.team)}`;
  return `Game details: ${teams}, ${nameGame(game)}`;
}

// The whole row opens the game's sheet, once both its teams are known.
/** @param {Game} game */
const renderOpenButton = (game) =>
  canOpen(game) &&
  html`<button type="button" class="game-open" aria-label="${nameOpenButton(game)}"></button>`;

// Away from its row, as in an update, the button names its game itself.
/** @param {Game} game */
export const renderGameOpenButton = (game) =>
  hasBothTeams(game) &&
  html`<button type="button" class="game-open" aria-label="${nameOpenButton(game)}" data-game="${game.id}"></button>`;

/**
 * @param {Game} game
 * @param {Game[]} games
 */
const renderGame = (game, games) =>
  renderGameRow({
    id: game.id,
    classes: [game.state],
    away: describeSide(game, "away"),
    home: describeSide(game, "home"),
    label: renderSeriesLabel(game, games),
    headline: renderHeadline(game),
    status: renderStatus(game),
    action: renderOpenButton(game),
  });

/**
 * @param {Game[]} games
 * @param {Game[]} allGames every game of the season, which the series labels count from
 */
const renderGameList = (games, allGames) =>
  html`<ul class="game-list">
    ${games.map((game) => renderGame(game, allGames))}
  </ul>`;

/**
 * Games grouped by day, in the order given.
 * @param {Game[]} games
 * @returns {{ day: Date, games: Game[] }[]}
 */
function groupByDay(games) {
  const days = new Map();
  for (const game of games) {
    const day = readGameDay(game);
    if (!day) continue;
    const key = day.getTime();
    if (!days.has(key)) days.set(key, { day, games: [] });
    days.get(key).games.push(game);
  }
  return [...days.values()];
}

/** @param {Game} game */
const readStart = (game) => Date.parse(game.start ?? "");

/**
 * Every game of the season, from the store's list of them, with the season's own copies, which
 * carry a game while it's played, over it. A season the store has no list for has its own games.
 * @param {{ games?: Game[], nearestGames?: Game[] } | null} season
 * @param {{ games?: Game[] } | null} schedule
 */
export function listSeasonGames(season, schedule) {
  const byId = new Map((schedule?.games ?? []).map((game) => [game.id, game]));
  for (const game of [...(season?.nearestGames ?? []), ...(season?.games ?? [])])
    byId.set(game.id, { ...byId.get(game.id), ...game });
  return [...byId.values()].sort((first, second) => readStart(first) - readStart(second));
}

/**
 * The day a game still under way began, which the list opens on when it began before today, as
 * one does past midnight.
 * @param {Game[]} games
 */
function findLiveDay(games) {
  const live = games.find((game) => game.state === "live");
  const day = live && readGameDay(live);
  return day ? formatCalendarDate(day) : null;
}

/**
 * Every game of the season the Games view lists, which leaves out a game a decided series won't need.
 * @param {{ games?: Game[], nearestGames?: Game[], series?: Series[] } | null} season
 * @param {{ games?: Game[] } | null} schedule
 */
export function listListedGames(season, schedule) {
  const seriesById = new Map((season?.series ?? []).map((series) => [series.id, series]));
  return listSeasonGames(season, schedule).filter((game) => !isCalledOff(game, seriesById));
}

/**
 * The days of some of the season's games, as a search lists them, each drawn as the Games view
 * draws it.
 * @param {Game[]} games the games found, in order of start
 * @param {Game[]} allGames every game the Games view lists, which the series labels count from
 * @param {number} now
 */
export const listFoundGameDays = (games, allGames, now) =>
  listFoundDays({
    gameDays: groupByDay(games).map((gameDay) => ({
      day: formatCalendarDate(gameDay.day),
      count: gameDay.games.length,
      games: renderGameList(gameDay.games, allGames),
    })),
    today: formatCalendarDate(new Date(now)),
  });

/**
 * Each game day of the season as the Games view lists it, from its first to its last, with a day
 * saying there are no games today when today falls between them, and the day the list opens on.
 * @param {{ games?: Game[], nearestGames?: Game[], series?: Series[] } | null} season
 * @param {{ games?: Game[] } | null} schedule
 * @param {number} now
 */
export function listSeasonDays(season, schedule, now) {
  const games = listListedGames(season, schedule);
  const today = formatCalendarDate(new Date(now));
  return listDayStripDays({
    gameDays: groupByDay(games).map((gameDay) => ({
      day: formatCalendarDate(gameDay.day),
      count: gameDay.games.length,
      games: renderGameList(gameDay.games, games),
    })),
    today,
    openDay: findLiveDay(games),
    emptyNote: "No games scheduled yet",
    standsIn: true,
  });
}
