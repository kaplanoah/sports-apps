import { formatClockTime } from "#shared/days.js";
import { html } from "#shared/html.js";
import { findOpeningRound } from "#shared/opening-round.js";
import { renderRoundDots } from "#shared/round-dots.js";
import { renderClub } from "./clubs.js";
import { describeDayInSentence, readGameDay } from "./days.js";
import { describePeriod } from "./games-view.js";
import { BRACKET_ORDER } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./series.js").SeriesSide} SeriesSide */
/** @typedef {import("./games-view.js").Game} Game */

/**
 * A seed's label, set outside the card beside its row, only in the first round, where its team
 * enters the bracket.
 * @param {SeriesSide} side
 * @param {Series} series
 */
const renderSeedLabel = (side, series) =>
  series.round === 1 && side.seed
    ? html`<span class="seed-label"><span class="seed-number">${side.seed}</span> <span class="seed-word">seed</span></span>`
    : "";

/**
 * @param {SeriesSide | null} side
 * @param {Series} series
 */
function renderTeamLine(side, series) {
  if (!side?.team) return html`<div class="team-line tbd">${renderClub(null)}</div>`;
  const isOut = !!series.winner && series.winner !== side.team;
  const isWinner = series.winner === side.team;
  const state = isOut ? " out" : isWinner ? " won" : "";
  return html`<div class="team-line${state}" data-team="${side.team}">
    ${renderSeedLabel(side, series)}${renderClub(side.team)}<span class="wins tabular"><span>${side.wins}</span></span>
  </div>`;
}

/**
 * A live game's score, in the card's order: its top team's first.
 * @param {Series} series
 * @param {Game} game
 */
function describeLiveScore(series, game) {
  const readScore = (/** @type {SeriesSide | null} */ side) =>
    [game.away, game.home].find((gameSide) => gameSide.team === side?.team)?.score;
  const scores = [readScore(series.top), readScore(series.bottom)];
  return scores.every((score) => score != null) ? scores.join("-") : "";
}

/**
 * Where a live game is, as a broadcaster says it: "with 3:18 in Q2", "at halftime", or "after Q3".
 * Between periods the clock stops at zero.
 * @param {Game} game
 */
function describeLiveMoment({ period, clock }) {
  if (!period) return "";
  if (clock && clock !== "0.0") return `with ${clock} in ${describePeriod(period)}`;
  return period === 2 ? "at halftime" : `after ${describePeriod(period)}`;
}

/**
 * @param {Series} series
 * @param {Game} game
 */
const describeLiveGame = (series, game) =>
  [describeLiveScore(series, game) || "Live", describeLiveMoment(game)].filter(Boolean).join(" ");

/**
 * When a series next plays, with TBD for what the league hasn't set yet.
 * @param {Game} game
 * @param {number} now
 */
function describeNextGame(game, now) {
  const day = readGameDay(game);
  if (!day) return "Next game TBD";
  const dayName = describeDayInSentence(day, now);
  if (!game.isTimeSet || !game.start) return `Next game ${dayName}, time TBD`;
  return `Next game ${dayName} at ${formatClockTime(new Date(game.start))}`;
}

/**
 * A card's note, as on MLB's bracket, says only when its series next plays or how the game on now
 * stands, and a finished series has none. The card's wins already say how the series stands, and
 * so which game is next.
 * @param {Series} series
 * @param {Game[]} games
 * @param {number} now
 */
function renderCardNote(series, games, now) {
  const live = games.find((game) => game.series === series.id && game.state === "live");
  if (live) return html`<p class="card-note live">${describeLiveGame(series, live)}</p>`;
  if (series.winner) return "";
  const next = series.top && series.bottom && games.find((game) => game.id === series.nextGame?.id);
  return html`<p class="card-note">${next ? describeNextGame(next, now) : "Next game TBD"}</p>`;
}

/**
 * @param {Series} series
 * @param {Game[]} games
 * @param {number} now
 */
function renderSeries(series, games, now) {
  const teams = [renderTeamLine(series.top, series), renderTeamLine(series.bottom, series)];
  return html`<div class="bracket-cell cell-${series.id}">
    <div class="series" data-series="${series.id}">
      ${teams}${renderCardNote(series, games, now)}
    </div>
  </div>`;
}

/**
 * A series the feeds don't list yet, drawn with its teams to be decided.
 * @param {string} id
 * @returns {Series}
 */
const describeUnlisted = (id) => ({
  id,
  round: Number(id.split("-")[0]),
  top: null,
  bottom: null,
  winner: null,
  status: "",
  nextGame: null,
});

/**
 * The rounds left to right, each series beside the two it follows, under the rounds' names, opening
 * on the earliest round still playing. Its lines and their turns are drawn once it's on the page
 * (bracket-tree.js).
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderBracket(season, now) {
  const allSeries = season?.series ?? [];
  if (!allSeries.length)
    return html`<p class="empty-note">The bracket fills in once the playoff field is set</p>`;
  const seriesById = new Map(allSeries.map((series) => [series.id, series]));
  const games = season?.games ?? [];
  const rounds = Object.values(BRACKET_ORDER).map((ids) =>
    ids.map((id) => seriesById.get(id) ?? describeUnlisted(id)),
  );
  const openingRound = findOpeningRound(rounds, (series) => !!series.winner) + 1;
  const names = Object.keys(BRACKET_ORDER).map(
    (round) =>
      html`<h2 class="round-name round-${round}" data-round="${round}">
        <span>${ROUNDS[round].name}</span><span class="best-of">Best of ${ROUNDS[round].bestOf}</span>
      </h2>`,
  );
  const cells = rounds.flat().map((series) => renderSeries(series, games, now));
  return html`<div class="bracket" data-opening-round="${openingRound}">
      <svg class="bracket-lines" aria-hidden="true"></svg
      ><svg class="bracket-turns" aria-hidden="true"></svg>${names}${cells}
    </div>
    ${renderRoundDots(Object.keys(BRACKET_ORDER))}`;
}
