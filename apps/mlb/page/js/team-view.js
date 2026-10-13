// The sheet a club's name or dot opens: its division, seed, and record, the cards of its nearest
// games, then once the field is set how far it has gone in the postseason, its race this season,
// and every World Series it won.

import { formatShortDate, readCalendarDate } from "#shared/days.js";
import { renderGameCards } from "#shared/game-cards.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { findNearestGames } from "#shared/nearest-games.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import {
  describePlayoffField,
  describeTeamGames,
  formatMargin,
  listFieldRows,
  listSeasonRankRows,
} from "#shared/team-numbers.js";
import { renderTeamStats, renderTitles } from "#shared/team-sheet.js";
import { buildBracket, describeTeamStatus } from "./bracket.js";
import {
  describeDrought,
  listTitles,
  nameTeam,
  renderClub,
  renderRankTag,
  renderStatusChip,
  renderTeamDot,
} from "./clubs.js";
import {
  describeGameLabel,
  describeInning,
  describeStart,
  listSeasonGames,
  nameGameKey,
} from "./games-view.js";
import { renderLeaders } from "./leaders-view.js";
import { countClubGames } from "./qualifying.js";
import { findClubRoster } from "./roster-section.js";
import { nameRound } from "./series-games.js";
import { session } from "./session.js";
import { listSlateGames } from "./slate.js";
import { SEASON_GAMES } from "./snapshot.js";
import { describeDivisionLead } from "./standings.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/html.js").Markup} Markup */
/** @typedef {import("#shared/team-numbers.js").PhaseStats} PhaseStats */
/** @typedef {import("#shared/team-numbers.js").Measure} Measure */

const MAGIC_NUMBER_TITLE =
  "Division magic number: combined wins by this team and losses by the club closest behind it that would clinch the division. A dash means clinched.";
const DIVISION_ELIMINATION_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const WILD_CARD_ELIMINATION_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

/** @param {string} id */
function findDivision(id) {
  const divisions = session.standings?.divisions ?? {};
  const found = Object.entries(divisions).find(([, rows]) => rows.some((row) => row.id === id));
  if (!found) return null;
  const [name, rows] = found;
  // A division's rows come in the order of its standings.
  const place = rows.findIndex((row) => row.id === id) + 1;
  return { name, place, row: rows[place - 1], divisions };
}

const countGamesLeft = (row) => SEASON_GAMES - row.w - row.l;

const isFieldSet = () => session.state?.projected === false;

const isInSetField = (id) => isFieldSet() && !!session.state.teams?.[id];

const renderGamesBack = (value) => (value === "-" ? html`&mdash;` : value || null);

/** @param {string | null | undefined} value an elimination or magic number, a dash, or E */
function renderRaceNumber(value) {
  if (value === "E") return html`<span class="elim-num">E</span>`;
  if (value == null || value === "-") return html`<span class="elim-num clinched">&mdash;</span>`;
  return html`<span class="elim-num live">${value}</span>`;
}

/** @param {string} label @param {string} title */
const renderTitledLabel = (label, title) => html`<span title="${title}">${label}</span>`;

function renderMagicNumber(row) {
  if (row.clinched) return renderRaceNumber("-");
  return /^\d+$/.test(row.magic || "") ? renderRaceNumber(row.magic) : null;
}

// Each race's row starts with the club's place in it: a division leader has only its division's
// race, and anyone else also has the wild card's.
/** @returns {[Markup | string, Markup | string | null][]} */
function listStats({ name, place, row, divisions }) {
  if (row.lead)
    return [
      [name, formatOrdinal(place)],
      ["Lead", renderGamesBack(describeDivisionLead(row, divisions))],
      [renderTitledLabel("M#", MAGIC_NUMBER_TITLE), renderMagicNumber(row)],
    ];
  return [
    [name, formatOrdinal(place)],
    ["GB", renderGamesBack(row.gb)],
    [renderTitledLabel("E#", DIVISION_ELIMINATION_TITLE), renderRaceNumber(row.elim)],
    ["Wild card", row.wcrank ? formatOrdinal(Number(row.wcrank)) : null],
    ["WCGB", renderGamesBack(row.wcgb)],
    [renderTitledLabel("WCE", WILD_CARD_ELIMINATION_TITLE), renderRaceNumber(row.wce)],
  ];
}

// A game rained out late in the season and never made up still counts as one left until the field
// is set, which ends the regular season for every club.
/** @param {ReturnType<typeof findDivision>} division */
function renderGamesLeft(division) {
  if (isFieldSet() || !division?.row) return false;
  const left = countGamesLeft(division.row);
  return left > 0 && html`<span class="tabular">${left} left</span>`;
}

/** @param {number} value */
const formatRunAverage = (value) => value.toFixed(2);

/** @param {number} value */
const formatRunMargin = (value) => formatMargin(value, 2);

// Runs a game, runs allowed a game, and the margin between them, then the records at home and on
// the road. Fewer runs allowed rank first.
/** @type {Measure[]} */
const MEASURES = [
  { label: "R/G", key: "scored", format: formatRunAverage },
  { label: "RA/G", key: "allowed", format: formatRunAverage, isFewestFirst: true },
  { label: "Diff/G", key: "margin", format: formatRunMargin },
  { label: "Home", key: "home" },
  { label: "Road", key: "road" },
];

/**
 * A club's regular season from its standings row, its runs as averages a game.
 * @param {any} row
 * @returns {PhaseStats}
 */
function readRegularSeason(row) {
  const games = row.w + row.l;
  /** @param {number | undefined} runs */
  const averageRuns = (runs) => (runs == null || !games ? null : runs / games);
  const margin = row.rs == null || row.ra == null ? undefined : row.rs - row.ra;
  return {
    record: `${row.w}-${row.l}`,
    scored: averageRuns(row.rs),
    allowed: averageRuns(row.ra),
    margin: averageRuns(margin),
    home: row.home ?? null,
    road: row.road ?? null,
  };
}

const listRegularSeasons = () =>
  Object.values(session.standings?.divisions ?? {})
    .flat()
    .map(readRegularSeason);

/** @param {Markup[]} rows */
const renderRanks = (rows) =>
  rows.length > 0 && html`<div class="player-ranks team-ranks">${rows}</div>`;

/** @param {ReturnType<typeof findDivision>} division */
function renderSeason(division) {
  if (!division?.row) return false;
  const ranks = listSeasonRankRows(MEASURES, readRegularSeason(division.row), listRegularSeasons());
  return renderSheetPart(
    "Regular season",
    html`<div class="team-season">${renderTeamStats(listStats(division))}${renderRanks(ranks)}</div>`,
    renderGamesLeft(division),
  );
}

function describeSeriesResult(series, id) {
  const [own, theirs] =
    series.teamA === id ? [series.winsA, series.winsB] : [series.winsB, series.winsA];
  const score = `${own}-${theirs}`;
  if (series.winner)
    return series.winner === id
      ? { text: `Won ${score}`, kind: "won" }
      : { text: `Lost ${score}`, kind: "lost" };
  if (!series.started) return { text: score, kind: "upcoming" };
  if (own === theirs) return { text: `Tied ${score}`, kind: "" };
  return { text: `${own > theirs ? "Lead" : "Trail"} ${score}`, kind: "" };
}

function renderSeriesRow(series, id) {
  const opponent = series.teamA === id ? series.teamB : series.teamA;
  const result = describeSeriesResult(series, id);
  return html`<li class="series-row">
    <span class="series-round">${nameRound(series.id)}</span>
    <span class="series-opp">${opponent ? renderClub(opponent) : html`<span class="tbd">TBD</span>`}</span>
    <span class="series-result ${result.kind} tabular">${result.text}</span>
  </li>`;
}

const renderByeRow = (league) =>
  html`<li class="series-row">
    <span class="series-round">${league} WC</span>
    <span class="series-opp"><span class="tbd">Bye</span></span>
    <span class="series-result"></span>
  </li>`;

function listTeamSeries(id) {
  const bracket = buildBracket(session.state);
  const league = TEAMS[id].league === "AL" ? bracket.al : bracket.nl;
  if (!league) return [];
  return [...league.wc, ...league.ds, ...league.cs, bracket.ws]
    .filter(Boolean)
    .filter((series) => series.teamA === id || series.teamB === id);
}

const hasBye = (id) => (session.state.teams[id]?.seed ?? 99) <= 2;

const listPostseasonFinals = () =>
  listSeasonGames(session.state?.slate, session.schedule).filter(
    (game) => game.postseason && game.state === "final" && game.score,
  );

/**
 * A club's postseason numbers across from the whole field's, under the two sides' names, or
 * nothing before its first postseason game ends.
 * @param {string} id
 */
function renderAgainstField(id) {
  const finals = listPostseasonFinals();
  const club = describeTeamGames(
    finals
      .filter((game) => isPlayedBy(game, id))
      .map((game) => {
        const [away, home] = game.score;
        const isHome = game.home === id;
        return { own: isHome ? home : away, theirs: isHome ? away : home, isHome };
      }),
  );
  if (!club) return false;
  const field = describePlayoffField(finals.map(({ score: [away, home] }) => ({ home, away })));
  return html`<div class="team-numbers">
    <div class="field-heads">
      <span class="club">${renderTeamDot(id)}<span>${nameTeam(id)}</span> <span class="team-record tabular">${club.record}</span></span>
      <span class="field-name">Playoff field</span>
    </div>
    ${renderRanks(listFieldRows(MEASURES, club, field, listRegularSeasons()))}
  </div>`;
}

/** @param {string} id */
function renderPlayoffs(id) {
  const status = describeTeamStatus(session.state, id);
  const byeRow = hasBye(id) && renderByeRow(TEAMS[id].league);
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-season">
      <ul class="team-series">${byeRow}${listTeamSeries(id).map((series) => renderSeriesRow(series, id))}</ul>
      ${renderAgainstField(id)}
    </div>`,
    renderStatusChip(status),
  );
}

const isPlayedBy = (game, id) => game.away === id || game.home === id;

// A doubleheader's games go in game order, since MLB can list game 2 with the earlier start.
const compareGames = (first, second) =>
  first.date.localeCompare(second.date) ||
  (first.doubleheader || 0) - (second.doubleheader || 0) ||
  Date.parse(first.start) - Date.parse(second.start);

// A postseason game whose other club isn't known yet may never be played.
const hasBothClubs = (game) => Boolean(game.away && game.home);

/** @param {string} id */
function findClubNearestGames(id) {
  const slate = session.state?.slate;
  const games = slate ? listSlateGames(slate).filter((game) => isPlayedBy(game, id)) : [];
  return findNearestGames(games.sort(compareGames), hasBothClubs);
}

function describeScore(game, isHome) {
  if (!game.score) return null;
  const [away, home] = game.score;
  return isHome ? { own: home, theirs: away } : { own: away, theirs: home };
}

/**
 * @param {any} game
 * @param {string} id
 * @returns {import("#shared/game-cards.js").GameCard}
 */
function describeGameCard(game, id) {
  const isHome = game.home === id;
  const other = isHome ? game.away : game.home;
  const day = formatShortDate(readCalendarDate(game.date));
  return {
    id: nameGameKey(game),
    label: describeGameLabel(game),
    state: game.state,
    when:
      game.state === "live"
        ? html`<span class="game-card-clock">${describeInning(game)}</span>`
        : day,
    score: describeScore(game, isHome),
    time: describeStart(game),
    isHome,
    dot: renderTeamDot(other),
    // A club's code, as the standings' Next column names it, since three cards hold no longer name
    // on a small phone.
    opponent: other,
  };
}

/** @param {string} id */
function renderNearestGames(id) {
  const { last, now, next } = findClubNearestGames(id);
  const games = [last, now, next].filter((game) => game !== null);
  return renderGameCards(games.map((game) => describeGameCard(game, id)));
}

/** @param {string} id @param {ReturnType<typeof findDivision>} division */
function listFacts(id, division) {
  const seed = session.state?.teams?.[id]?.seed;
  const { row } = division ?? {};
  return [
    division ? html`<span class="${TEAMS[id].league}">${division.name}</span>` : TEAMS[id].league,
    seed && `${seed} seed`,
    row && html`<span class="tabular">${row.w}-${row.l}</span>`,
    row?.pct && html`<span class="tabular">${row.pct}</span>`,
  ].filter(Boolean);
}

/**
 * The club's leaders, from its roster, for the current season.
 * @param {string} id
 */
function renderClubLeaders(id) {
  const read = findClubRoster(id);
  if (!read) return false;
  return renderLeaders({ ...read, clubGames: countClubGames(id, session.activeYear) });
}

/**
 * The sheet a club opens: its dot, name, and rank over its division, seed, record, and winning
 * percentage, then the cards of its nearest games, once the field is set its postseason, then its
 * season, its leaders, and its titles.
 * @param {string} id
 */
export function renderTeamSheet(id) {
  const division = findDivision(id);
  return {
    heading: html`${renderTeamDot(id)}<span>${nameTeam(id)}</span>${renderRankTag(id)}`,
    note: joinWithSeparator(listFacts(id, division)),
    body: html`${renderNearestGames(id)}${isInSetField(id) && renderPlayoffs(id)}
      ${renderSeason(division)}${renderClubLeaders(id)}
      ${renderTitles(listTitles(id), html`<span class="tabular">${describeDrought(id)}</span>`)}`,
  };
}
