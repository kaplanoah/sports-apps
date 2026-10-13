import { nameTeam, renderClub, renderPlainClub } from "./clubs.js";
import { renderAllStarMark } from "#shared/all-star.js";
import { fillDayStrip } from "#shared/day-strip.js";
import {
  formatClockTime,
  formatWeekdayAndDate,
  readCalendarDate,
  readEasternDay,
} from "#shared/days.js";
import { html } from "#shared/html.js";
import { renderGameRow } from "#shared/game-row.js";
import { formatOrdinal } from "#shared/ordinal.js";
import {
  listFoundDays,
  listSeasonDays as listDayStripDays,
  renderHeadingLabel,
} from "#shared/season-days.js";
import { describeRace, findStandingsRow, isSeedFinal } from "./race.js";
import {
  countSeriesWins,
  groupSeriesFinals,
  isSeriesDecided,
  isSeriesGame,
  nameRound,
  nameSeriesGame,
} from "./series-games.js";
import { session } from "./session.js";
import { listSlateGames } from "./slate.js";

const HALF_INNING_LABELS = { top: "Top", middle: "Mid", bottom: "Bot", end: "End" };
const OUT_LIGHTS = 2;
const CLINCH_TITLES = {
  z: "Clinched the best record in the league",
  y: "Clinched the division",
  w: "Clinched a wild card spot",
  x: "Clinched a playoff spot",
};
// Trimmed to the drawing, so sized in em its base sits on the text's baseline like a letter.
const SEED_LOCK = html`<svg class="seed-lock" viewBox="1.5 1.3 9 12.4" role="img" aria-label="seed final"><path d="M3.5 7V4.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="2.2" y="7.2" width="7.6" height="5.8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const ARMS = { L: "Throws left-handed", R: "Throws right-handed" };

// A whole season's rows name their day thousands of times, and formatting a date is slow, so
// each day is formatted once. Its words don't depend on the time zone, since its date is read
// as a calendar day where the viewer is.
/** @type {Map<string, string>} */
const formattedDays = new Map();

/** @param {string} date "YYYY-MM-DD" */
function formatGameDay(date) {
  if (!formattedDays.has(date))
    formattedDays.set(date, formatWeekdayAndDate(readCalendarDate(date)));
  return /** @type {string} */ (formattedDays.get(date));
}

export function describeStart(game) {
  if (game.tbd) return game.doubleheader === 2 ? "After 1st game" : "Time TBD";
  return formatClockTime(new Date(game.start));
}

export function describeInning(game) {
  return [HALF_INNING_LABELS[game.half], formatOrdinal(game.inning || 1)].filter(Boolean).join(" ");
}

// The third out ends the half, so only the first two get a light.
export function renderOutLights(game) {
  if (game.state !== "live" || game.delay || game.outs == null) return html``;
  const lights = Array.from(
    { length: OUT_LIGHTS },
    (_, index) => html`<span class="out-light ${index < game.outs ? "on" : ""}"></span>`,
  );
  const label = game.outs === 1 ? "1 out" : `${game.outs} outs`;
  return html`<span class="out-lights" role="img" aria-label="${label}">${lights}</span>`;
}

// A final that went extra innings, or was called short, says in which inning it ended, as MLB's
// own scoreboard does.
function describeStatus(game) {
  if (game.delay) return game.delay;
  if (game.state === "final") return game.innings ? `Final/${game.innings}` : "Final";
  if (game.state === "live") return describeInning(game);
  return "";
}

// Not a .team-name: its clipped overflow cuts off the slant of the italic's last letter in Safari.
// The row opens its matchup wherever it's tapped, so its clubs are plain.
function renderSideClub(id) {
  if (id) return renderPlainClub(id);
  return html`<span class="club"><span class="dot unknown-club"></span><span class="tbd">TBD</span></span>`;
}

function renderSeed(id) {
  const team = session.state && session.state.teams && session.state.teams[id];
  if (!team || !team.seed) return html``;
  return html`<span class="seed">${team.seed} seed${isSeedFinal(id) && SEED_LOCK}</span>`;
}

function renderRace(row) {
  const race = describeRace(row);
  if (!race || !race.label) return html``;
  const title = race.standing === "clinched" && CLINCH_TITLES[race.label];
  return html`<span class="race ${race.standing}"${title && html` title="${title}"`}>${race.label}</span>`;
}

function renderFacts(id) {
  if (!id) return html``;
  const row = findStandingsRow(id);
  return html`<span class="game-facts">${renderSeed(id)}${row && html`<span class="tabular">${row.w}-${row.l}</span>`}${renderRace(row)}</span>`;
}

// Away from today, a club's standing then isn't its standing now, so a regular season game shows
// only each club's record as of the game, and a postseason game its seed, which never changes.
/**
 * @param {any} game
 * @param {number} index 0 for the away club, 1 for the home club
 */
function renderFactsThen(game, index) {
  const id = index ? game.home : game.away;
  if (!id) return html``;
  if (game.postseason) return html`<span class="game-facts">${renderSeed(id)}</span>`;
  const record = game.records?.[index];
  return html`<span class="game-facts">${record && html`<span class="tabular">${record}</span>`}</span>`;
}

const isNamed = (starter) => Boolean(starter?.name);

export const renderArm = (hand) =>
  ARMS[hand] ? html`<span class="arm" title="${ARMS[hand]}">${hand}</span>` : html``;

const renderStarter = (starter, side) =>
  html`<span class="starter ${side}" title="Starting pitcher"><span class="starter-name">${starter.name}</span>${renderArm(starter.hand)}</span>`;

const renderPendingStarter = (side) =>
  html`<span class="starter ${side} pending" title="Starting pitcher"><span class="starter-name">Still TBD</span></span>`;

function renderStarterLine(starter, place, isPending) {
  if (isNamed(starter)) return renderStarter(starter, place);
  return isPending && renderPendingStarter(place);
}

function describeSide(id, place, starter, hasWon, isPending, renderClubLine, facts) {
  return {
    lines: html`${id ? renderClubLine(id) : renderSideClub(id)}${facts}`,
    classes: [hasWon && "won"],
    extra: renderStarterLine(starter, place, isPending),
  };
}

function renderScore(game, awayLost, homeLost) {
  const [awayScore, homeScore] = game.score;
  return html`<span class="game-score tabular"><span class="${awayLost ? "lost" : ""}">${awayScore}</span><span class="score-dash">-</span><span class="${homeLost ? "lost" : ""}">${homeScore}</span></span>`;
}

// A game's series as it stood at the game, or, until both its clubs are known, its game in the
// series.
/**
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals
 */
function renderSeriesLabel(game, seriesFinals) {
  const round = nameRound(game.series);
  if (!game.away || !game.home)
    return html`<span class="series-label">${round} G${game.number}</span>`;
  const wins = countSeriesWins(game, seriesFinals);
  return html`<span class="series-label ${isSeriesDecided(game.series, wins) ? "decided" : ""}">${round} <span class="series-count tabular">${wins.join("-")}</span></span>`;
}

// A game MLB plays away from its home club's own ballpark, like the London Series, says where.
/** @param {{ neutral?: boolean, ballpark?: { city: string } }} game */
const renderElsewhereLabel = (game) =>
  !!game.neutral &&
  !!game.ballpark &&
  html`<span class="series-label">In ${game.ballpark.city}</span>`;

function renderHeadline(game, awayLost, homeLost) {
  if (game.score) return renderScore(game, awayLost, homeLost);
  const time = game.state === "off" ? game.detail || "Postponed" : describeStart(game);
  return html`<span class="game-time">${time}</span>`;
}

function renderStatus(game) {
  if (game.state === "pre" && game.ifNecessary)
    return html`<span class="if-necessary">If necessary</span>`;
  const status = describeStatus(game);
  return Boolean(status) && html`${status}${renderOutLights(game)}`;
}

const nameSide = (id) => (id ? nameTeam(id) : "TBD");

/** @param {{ away?: string, home?: string }} game */
export const nameGame = (game) => `${nameSide(game.away)} @ ${nameSide(game.home)}`;

// A doubleheader's two games share their day and clubs, so its game number tells them apart.
/** @param {{ date: string, away?: string, home?: string, doubleheader?: number }} game */
export const nameGameKey = (game) =>
  `${game.date} ${game.away ?? ""} ${game.home ?? ""} ${game.doubleheader || 1}`;

/** @param {{ date: string, away?: string, home?: string, series?: string, number?: number }} game */
export function describeGameLabel(game) {
  const clubs = `${nameSide(game.away)} at ${nameSide(game.home)}`;
  const day = formatGameDay(game.date);
  return isSeriesGame(game) ? `${clubs}, ${nameSeriesGame(game)}, ${day}` : `${clubs}, ${day}`;
}

// The whole row, or an update about the game, opens the game's sheet.
export const renderGameButton = (game) =>
  html`<button type="button" class="game-open" aria-label="Game details: ${describeGameLabel(game)}" data-game="${nameGameKey(game)}"></button>`;

const isAwaitingStarter = (game, id, starter) => game.state === "pre" && Boolean(id) && !starter;

/**
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals each postseason series' finals, which its label counts
 * @param {{ isToday: boolean, isAwaitingStarters: boolean }} when whether the game is today's, and
 *   whether a club yet to name its starter says so
 * @param {(id: string) => any} renderClubLine
 */
function describeGameRow(game, seriesFinals, { isToday, isAwaitingStarters }, renderClubLine) {
  const [awayScore, homeScore] = game.score || [];
  const isFinal = game.state === "final";
  const awayLost = isFinal && awayScore < homeScore;
  const homeLost = isFinal && homeScore < awayScore;
  const [awayStarter, homeStarter] = game.starters || [];
  const isAwayPending = isAwaitingStarters && isAwaitingStarter(game, game.away, awayStarter);
  const isHomePending = isAwaitingStarters && isAwaitingStarter(game, game.home, homeStarter);
  const [awayFacts, homeFacts] = isToday
    ? [renderFacts(game.away), renderFacts(game.home)]
    : [renderFactsThen(game, 0), renderFactsThen(game, 1)];
  return {
    classes: [game.state, game.delay && "delayed"],
    away: describeSide(
      game.away,
      "away",
      awayStarter,
      homeLost,
      isAwayPending,
      renderClubLine,
      awayFacts,
    ),
    home: describeSide(
      game.home,
      "home",
      homeStarter,
      awayLost,
      isHomePending,
      renderClubLine,
      homeFacts,
    ),
    label: isSeriesGame(game) ? renderSeriesLabel(game, seriesFinals) : renderElsewhereLabel(game),
    headline: renderHeadline(game, awayLost, homeLost),
    status: renderStatus(game),
  };
}

/**
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals
 * @param {boolean} isToday
 */
function renderGame(game, seriesFinals, isToday) {
  return renderGameRow({
    ...describeGameRow(
      game,
      seriesFinals,
      { isToday, isAwaitingStarters: isToday },
      renderSideClub,
    ),
    action: renderGameButton(game),
  });
}

// The All-Star Game's teams are its leagues, in the colors the page gives them, and its star is set
// in as a club's dot is, with the dot's own shadow and light.
const ALL_STAR_LEAGUES = {
  AL: { name: "American League", color: "var(--al)" },
  NL: { name: "National League", color: "var(--nl)" },
};
const ALL_STAR_LOOK = { size: 19, shadow: { x: 0, y: 2, blur: 3 }, light: { x: 0, y: 1 } };

/**
 * @param {any} game
 * @param {"away" | "home"} place
 */
function renderAllStarClub(game, place) {
  const league = ALL_STAR_LEAGUES[game[place]];
  if (!league) return renderSideClub(null);
  const star = renderAllStarMark({
    id: `all-star-${game.id}-${place}`,
    color: league.color,
    look: ALL_STAR_LOOK,
  });
  return html`<span class="club">${star}<span class="team-name">${league.name}</span></span>`;
}

// Its teams aren't clubs, so it has no sheet, and nor do they.
function renderAllStarGame(game) {
  const [awayScore, homeScore] = game.score || [];
  const isFinal = game.state === "final";
  const awayLost = isFinal && awayScore < homeScore;
  const homeLost = isFinal && homeScore < awayScore;
  return renderGameRow({
    classes: [game.state, game.delay && "delayed"],
    away: { lines: renderAllStarClub(game, "away"), classes: [homeLost && "won"] },
    home: { lines: renderAllStarClub(game, "home"), classes: [awayLost && "won"] },
    label: html`All-Star Game`,
    headline: renderHeadline(game, awayLost, homeLost),
    status: renderStatus(game),
  });
}

/**
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals
 * @param {boolean} isToday
 */
function renderListedGame(game, seriesFinals, isToday) {
  if (game.allStar) return renderAllStarGame(game);
  return renderGame(game, seriesFinals, isToday);
}

/** Each postseason series' finals among the season's games the page has. */
export const groupShownSeriesFinals = () =>
  groupSeriesFinals(listSeasonGames(session.state?.slate, session.schedule));

// A game's sheet heads its Game section with the game's row, whose clubs each open their own
// sheet, and leaves its starters to the line under it.
export function renderGameFaceOff(game) {
  const when = { isToday: !!game.today, isAwaitingStarters: false };
  const seriesFinals = groupShownSeriesFinals();
  const row = describeGameRow({ ...game, starters: [] }, seriesFinals, when, renderClub);
  return html`<ul class="game-list game-faceoff">${renderGameRow(row)}</ul>`;
}

// A doubleheader's games sit together in game order, since MLB can list game 2 with the earlier start.
function orderDay(games) {
  const isSameMatchup = (game, other) => game.away === other.away && game.home === other.home;
  const findSlot = (game) =>
    Math.min(
      ...games
        .filter((other) => isSameMatchup(game, other))
        .map((other) => Date.parse(other.start)),
    );
  return games
    .map((game) => ({ game, slot: findSlot(game) }))
    .sort(
      (first, second) =>
        first.slot - second.slot ||
        (first.game.doubleheader || 0) - (second.game.doubleheader || 0),
    )
    .map(({ game }) => game);
}

/**
 * Every game of the season, from the store's schedule, with the slate's copies, which carry a game
 * while it's played, over it, keeping each club's record with the game, which only the schedule
 * has.
 * @param {any} slate
 * @param {any[] | null} schedule
 */
export function listSeasonGames(slate, schedule) {
  const games = new Map((schedule ?? []).map((game) => [nameGameKey(game), game]));
  const slateGames = slate ? [...listSlateGames(slate), slate.allStar].filter(Boolean) : [];
  for (const game of slateGames)
    games.set(nameGameKey(game), { ...games.get(nameGameKey(game)), ...game });
  return [...games.values()];
}

/** @param {any[]} games */
function groupByDay(games) {
  const dates = [...new Set(games.map((game) => game.date))].sort();
  return dates.map((date) => ({
    date,
    games: orderDay(games.filter((game) => game.date === date)),
  }));
}

/**
 * The day a game still under way began, which the list opens on when it began before today, as
 * one does past midnight.
 * @param {any[]} games
 */
const findLiveDay = (games) => games.find((game) => game.state === "live")?.date ?? null;

/** @param {any} slate */
function describeEmptySeason(slate) {
  if (session.activeYear !== session.currentSeason) return "No games saved for this season yet";
  if (!slate) return "Games appear here as soon as the page can reach MLB";
  return "No games scheduled yet";
}

/**
 * Each day of some games, its games drawn as the Games view draws them.
 * @param {any[]} games
 * @param {Map<string, any[]>} seriesFinals each postseason series' finals, which its label counts
 * @param {string} today
 */
const listGameDays = (games, seriesFinals, today) =>
  groupByDay(games).map((day) => ({
    day: day.date,
    count: day.games.length,
    games: html`<ul class="game-list">
      ${day.games.map((game) => renderListedGame(game, seriesFinals, day.date === today))}
    </ul>`,
  }));

/**
 * Each game day of the season as the Games view lists it, from its first to its last, opening on
 * MLB's day: today, or last night until its games are over.
 * @param {any} slate
 * @param {any[] | null} schedule
 * @param {number} now
 */
export function listSeasonDays(slate, schedule, now) {
  const games = listSeasonGames(slate, schedule);
  const today = slate?.today.date ?? readEasternDay(now).date;
  return listDayStripDays({
    gameDays: listGameDays(games, groupSeriesFinals(games), today),
    today,
    openDay: findLiveDay(games),
    emptyNote: describeEmptySeason(slate),
    renderLabel: renderHeadingLabel,
    standsIn: true,
  });
}

/**
 * The days of some of the season's games, as a search lists them, each drawn as the Games view
 * draws it.
 * @param {any[]} found the games found, in order of start
 * @param {any[]} allGames every game the Games view lists, which the series labels count from
 * @param {number} now
 */
export function listFoundGameDays(found, allGames, now) {
  const today = session.state?.slate?.today.date ?? readEasternDay(now).date;
  return listFoundDays({
    gameDays: listGameDays(found, groupSeriesFinals(allGames), today),
    today,
    renderLabel: renderHeadingLabel,
  });
}

export function renderGames() {
  fillDayStrip(listSeasonDays(session.state?.slate, session.schedule, Date.now()));
}
