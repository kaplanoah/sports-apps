import { describeDay, formatClockTime, formatShortDate, isStillToComeToday } from "#shared/days.js";
import { renderGameCards } from "#shared/game-cards.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import {
  describePlayoffField,
  describeTeamGames,
  formatMargin,
  listFieldRows,
  listSeasonRankRows,
  renderFieldLegend,
} from "#shared/team-numbers.js";
import { renderTitles } from "#shared/team-sheet.js";
import { renderDot, renderTeamName } from "./clubs.js";
import { readGameDay } from "./days.js";
import { describeLiveClock, describeStartTime } from "./games-view.js";
import { findTeamNearestGames, isCalledOff, mapSeriesById } from "./nearest-games.js";
import { nameTeam, readPlayoffRuns } from "./series.js";
import { formatMarkColors } from "./sheet-colors.js";
import { renderPlayerTable } from "./sheet-parts.js";
import { renderPlayerButton } from "./player-button.js";
import { ROUNDS } from "./snapshot.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./standings-view.js").StandingsRow} StandingsRow */
/** @typedef {{ seed: number | null, round: number, isOut: boolean, isChampion: boolean }} Run */
/** @typedef {{ team: string, id: number, firstName: string, lastName: string, games: number, minutes?: number, points: number, rebounds: number, assists: number, fieldGoalShare?: number | null }} Leader */
/** @typedef {{ label: string, title: string, read: (leader: Leader) => string, isQuiet?: boolean }} LeaderColumn */
/** @typedef {{ series?: Series[], standings?: StandingsRow[], games?: Game[], nearestGames?: Game[], leaders?: Leader[] }} Season */
/** @typedef {import("#shared/team-numbers.js").PhaseStats} PhaseStats */
/** @typedef {import("#shared/team-numbers.js").Measure} Measure */

/**
 * @param {Game} game
 * @param {string} team
 */
const findPlace = (game, team) =>
  game.home.team === team ? "home" : game.away.team === team ? "away" : null;

/**
 * A team's leading scorers, best first.
 * @param {Season | null} season
 * @param {string} team
 */
export const findTeamLeaders = (season, team) =>
  (season?.leaders ?? []).filter((leader) => leader.team === team);

// A leader saved without her minutes or shooting shows a dash until the season's next update.
/** @param {number | null | undefined} value */
export const formatAverage = (value) => (value == null ? "-" : value.toFixed(1));

/** @param {number | null | undefined} share */
export const formatPercentage = (share) => (share == null ? "-" : (share * 100).toFixed(1));

// Points, rebounds, and assists, then how well each player shoots and how much she plays.
/** @type {LeaderColumn[]} */
const LEADER_COLUMNS = [
  { label: "Pts", title: "Points per game", read: (leader) => formatAverage(leader.points) },
  { label: "Reb", title: "Rebounds per game", read: (leader) => formatAverage(leader.rebounds) },
  { label: "Ast", title: "Assists per game", read: (leader) => formatAverage(leader.assists) },
  {
    label: "FG%",
    title: "Field goal percentage",
    read: (leader) => formatPercentage(leader.fieldGoalShare),
    isQuiet: true,
  },
  {
    label: "Min",
    title: "Minutes per game",
    read: (leader) => formatAverage(leader.minutes),
    isQuiet: true,
  },
];

/** @param {Leader} leader */
const renderLeaderRow = (leader) =>
  html`<tr>
    <th scope="row">
      ${renderPlayerButton(leader, html`<span class="first-name">${leader.firstName}</span> ${leader.lastName}`)}
    </th>
    ${LEADER_COLUMNS.map((column) =>
      column.isQuiet
        ? html`<td class="quiet-stat">${column.read(leader)}</td>`
        : html`<td>${column.read(leader)}</td>`,
    )}
  </tr>`;

/**
 * Players' averages a game, in one table with a part for each group, under a heading over their
 * names.
 * @param {{ heading: import("#shared/html.js").Markup | string, leaders: Leader[] }[]} groups
 */
export const renderLeaderTable = (groups) =>
  renderPlayerTable(
    groups.map(({ heading, leaders }) => ({ heading, rows: leaders.map(renderLeaderRow) })),
    LEADER_COLUMNS,
  );

/** @param {Leader[]} leaders */
const renderLeadingScorers = (leaders) =>
  leaders.length > 0 &&
  renderSheetPart(
    "Leading scorers",
    renderLeaderTable([{ heading: "Player", leaders }]),
    "Per game",
  );

const OTHER_PLACE = { home: "away", away: "home" };

/**
 * A team's playoff games: those it has finished, and the next one it plays, if any. A game the
 * league put off stays its series' next, since the series plays it before the one after it.
 * @param {Season} season
 * @param {string} team
 */
function listTeamGames(season, team) {
  const seriesById = mapSeriesById(season.series);
  const games = (season.games ?? []).filter((game) => findPlace(game, team));
  const finished = games.filter((game) => game.state === "final");
  const next = games.find((game) => game.state !== "final" && !isCalledOff(game, seriesById));
  return { finished, next: next ?? null };
}

/**
 * @param {Game} game
 * @param {number} now
 */
function describeWhen(game, now) {
  if (game.state === "live") return "Live";
  const day = readGameDay(game);
  if (!day) return "";
  const time = game.isTimeSet && game.start ? ` ${formatClockTime(new Date(game.start))}` : "";
  return `${describeDay(day, now)}${time}`;
}

/**
 * The chip beside a team's Playoffs: its round while it's still in, how far it got once out, or
 * that it missed them once the field is set.
 * @param {Run | undefined} run
 * @param {{ hasField: boolean }} context
 */
function describeChip(run, { hasField }) {
  if (!run) return hasField ? { label: "Missed", kind: "missed" } : null;
  const round = ROUNDS[run.round].shortName;
  if (run.isChampion) return { label: "Champions", kind: "champion" };
  if (run.isOut) return { label: `Out ${round}`, kind: "out" };
  return { label: round, kind: "alive" };
}

/**
 * A team's playoffs as its sheets show them: its run, its games, whether it still plays, and the
 * chip that says how far it has got.
 * @param {Season | null} season
 * @param {string} team
 */
export function readTeamPlayoffs(season, team) {
  const runs = readPlayoffRuns(season?.series ?? []);
  const run = runs.get(team);
  return {
    run,
    games: listTeamGames(season ?? {}, team),
    isPlaying: !!run && !run.isOut && !run.isChampion,
    chip: describeChip(run, { hasField: runs.size > 0 }),
  };
}

/** @param {{ label: string, kind: string } | null} chip */
export const renderChip = (chip) =>
  chip && html`<span class="status-chip ${chip.kind}">${chip.label}</span>`;

/**
 * The seasons a team won it all: those it had won before, and this one once it has.
 * @param {string} code
 * @param {Run | undefined} run
 * @param {number} year
 */
function listTitles(code, run, year) {
  const before = TEAMS[code].titles.filter((title) => title !== year);
  return { before, now: run?.isChampion ? [year] : [] };
}

/** @param {StandingsRow} row */
const readRegularSeason = (row) => ({
  record: `${row.wins}-${row.losses}`,
  scored: row.pointsFor ?? null,
  allowed: row.pointsAgainst ?? null,
  margin: row.margin ?? null,
  home: row.home ?? null,
  road: row.road ?? null,
});

/**
 * A team's numbers through the playoff games it has finished, or null before its first.
 * @param {Game[]} finished
 * @param {string} team
 */
const readPlayoffs = (finished, team) =>
  describeTeamGames(
    finished.map((game) => {
      const place = findPlace(game, team) ?? "home";
      return {
        own: game[place].score ?? 0,
        theirs: game[OTHER_PLACE[place]].score ?? 0,
        isHome: place === "home",
      };
    }),
  );

/**
 * The playoffs so far, as one side to measure a team against.
 * @param {Game[]} games
 */
const readLeaguePlayoffs = (games) =>
  describePlayoffField(
    games
      .filter((game) => game.state === "final")
      .map((game) => ({ home: game.home.score ?? 0, away: game.away.score ?? 0 })),
  );

/**
 * A points margin a game, with its sign, as +4.2, or 0.0 when it rounds to nothing.
 * @param {number} margin
 */
export const formatPointMargin = (margin) => formatMargin(margin, 1);

/** @type {Measure[]} */
const MEASURES = [
  { label: "PPG", key: "scored", format: formatAverage },
  { label: "Opp PPG", key: "allowed", format: formatAverage, isFewestFirst: true },
  { label: "Margin", key: "margin", format: formatPointMargin },
  { label: "Home", key: "home" },
  { label: "Road", key: "road" },
];

/**
 * The rows of a team's numbers, in its mark color for each theme, as a player's sheet draws hers.
 * @param {string} code
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderRanks = (code, rows) =>
  html`<div class="player-ranks team-ranks" style="${formatMarkColors(code)}">${rows}</div>`;

/**
 * A team's regular season ranked among every team's, each measure on a curve of theirs.
 * @param {string} code
 * @param {PhaseStats} team
 * @param {PhaseStats[]} teams
 */
function renderSeasonRanks(code, team, teams) {
  const rows = listSeasonRankRows(MEASURES, team, teams);
  return rows.length > 0 && renderRanks(code, rows);
}

/**
 * A team's playoff numbers across from the playoff field's, under the two sides' names, each
 * measure a dot for each on a line across the regular season's range of every team's, so a playoff
 * number reads as high or low for the league, dashed past it as far as either number reaches, with
 * a legend saying so.
 * @param {string} code
 * @param {PhaseStats} team
 * @param {PhaseStats | null} field
 * @param {PhaseStats[]} teams every team's regular season
 */
function renderAgainstField(code, team, field, teams) {
  const rows = listFieldRows(MEASURES, team, field, teams);
  return html`<div class="team-numbers">
    <div class="tape-teams">
      <span class="club">${nameTeam(code)} <span class="team-record tabular">${team.record}</span></span>
      <span class="club">Playoff field</span>
    </div>
    ${renderRanks(code, rows)}${renderFieldLegend(MEASURES, team, field, teams)}
  </div>`;
}

/**
 * A streak, like W 3, marked when it's a winning one.
 * @param {string} streak
 */
const renderStreak = (streak) =>
  streak.startsWith("W") ? html`<span class="streak-won">${streak}</span>` : streak;

/**
 * How the team ended the regular season: its last ten games and its streak, as the standings
 * show them, each on its own line, or nothing while it has neither.
 * @param {StandingsRow} row
 */
function renderRecentForm(row) {
  /** @type {[string, import("#shared/html.js").Markup | string | null][]} */
  const facts = [
    ["Last 10", row.lastTen],
    ["Streak", row.streak && renderStreak(row.streak)],
  ];
  const shown = facts.filter(([, value]) => value);
  return (
    shown.length > 0 &&
    html`<dl class="team-form">
      ${shown.map(
        ([label, value]) =>
          html`<dt class="tape-label">${label}</dt><dd class="tape-value tabular">${value}</dd>`,
      )}
    </dl>`
  );
}

/**
 * The team's regular season ranked among every team's, from the standings, beside how many games
 * it played, then its last ten and its streak.
 * @param {string} code
 * @param {StandingsRow[]} standings
 */
function renderRegularSeason(code, standings) {
  const row = standings.find((each) => each.team === code);
  if (!row) return false;
  const games = row.wins + row.losses;
  return renderSheetPart(
    "Regular season",
    html`<div class="team-season">
      ${renderSeasonRanks(code, readRegularSeason(row), standings.map(readRegularSeason))}${renderRecentForm(row)}
    </div>`,
    `${games} ${games === 1 ? "game" : "games"}`,
  );
}

/**
 * The seasons a team won it all, newest first, each it won under an earlier name saying so.
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function listTitleYears(code, titles) {
  const formerTeam = TEAMS[code].titlesAs;
  const before = [...titles.before]
    .sort((first, second) => second - first)
    .map((year) => (formerTeam ? `${year} (as ${formerTeam})` : String(year)));
  return [...titles.now.map(String), ...before];
}

/**
 * @param {Game} game
 * @param {string} team
 */
function describeMatchup(game, team) {
  const place = findPlace(game, team) ?? "home";
  const opponent = game[OTHER_PLACE[place]].team;
  const round = game.round ? ROUNDS[game.round].shortName : "";
  return html`${place === "home" ? "vs" : "at"} ${renderTeamName(opponent)}
    <span class="team-round">${round}</span>`;
}

/** @param {{ own: number, theirs: number }} score */
const renderScore = ({ own, theirs }) =>
  html`<span class="team-score tabular">${own}-${theirs}</span>`;

/**
 * A finished game's row: its number, whether the team won, who it played, and, at its end, the
 * score or whatever `renderEnd` shows in its place.
 * @param {Game} game
 * @param {string} team
 * @param {(score: { own: number, theirs: number }) => import("#shared/html.js").Markup} [renderEnd]
 */
export function renderFinishedGame(game, team, renderEnd = renderScore) {
  const place = findPlace(game, team) ?? "home";
  const own = game[place].score ?? 0;
  const theirs = game[OTHER_PLACE[place]].score ?? 0;
  const isWin = own > theirs;
  return html`<div class="team-game">
    <span class="team-game-number">G${game.number}</span>
    <span class="team-result ${isWin ? "won" : "lost"}">${isWin ? "W" : "L"}</span>
    <span class="team-matchup">${describeMatchup(game, team)}</span>
    ${renderEnd({ own, theirs })}
  </div>`;
}

// Phosphor's caret-right, at its Regular weight.
const NEXT_GAME_ICON = html`<svg class="next-game-icon" viewBox="0 0 256 256" fill="currentColor">
  <path
    d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"
  />
</svg>`;

/**
 * @param {Game} game
 * @param {string} team
 * @param {number} now
 */
export function renderNextGame(game, team, now) {
  const isSoon =
    game.state === "live" ||
    isStillToComeToday({ state: game.state, day: readGameDay(game) }, new Date(now));
  return html`<div class="team-game next${isSoon ? " soon" : ""}">
    <span class="team-game-number">G${game.number}</span>
    <span class="team-result" aria-hidden="true">${NEXT_GAME_ICON}</span>
    <span class="team-matchup">${describeMatchup(game, team)}</span>
    <span class="team-when">${describeWhen(game, now)}</span>
  </div>`;
}

/**
 * The team's playoff games under its run so far, then its numbers across from the whole playoff
 * field's, or only the run for a team that missed them. The games come first, so the run's chip
 * heads them rather than the field's side of the numbers.
 * @param {string} team
 * @param {{ finished: Game[], next: Game | null }} games
 * @param {{ label: string, kind: string } | null} chip
 * @param {{ isPlaying: boolean, field: PhaseStats | null, teams: PhaseStats[], now: number }} context
 */
function renderPlayoffs(team, { finished, next }, chip, { isPlaying, field, teams, now }) {
  if (!chip) return false;
  const stats = readPlayoffs(finished, team);
  const shownNext = isPlaying && next;
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-season">
      <div class="team-playoffs">
        ${finished.map((game) => renderFinishedGame(game, team))}
        ${shownNext && renderNextGame(shownNext, team, now)}
      </div>
      ${stats && renderAgainstField(team, stats, field, teams)}
    </div>`,
    renderChip(chip),
  );
}

/**
 * A team's nearest games: its last, the one it's playing, and its next, from every game of the
 * season, or from its playoff games for a season saved before it kept the others.
 * @param {Season} season
 * @param {string} team
 */
const readNearestGames = (season, team) =>
  findTeamNearestGames(
    season.nearestGames ?? season.games ?? [],
    team,
    mapSeriesById(season.series),
  );

/** @param {Game} game */
function describeCardDay(game) {
  const day = readGameDay(game);
  return day ? formatShortDate(day) : "";
}

/**
 * @param {Game} game
 * @param {string} team
 * @returns {import("#shared/game-cards.js").GameCard}
 */
function describeGameCard(game, team) {
  const place = findPlace(game, team) ?? "home";
  const other = game[OTHER_PLACE[place]];
  const own = game[place].score;
  return {
    id: game.id,
    label: `${nameTeam(game.away.team)} at ${nameTeam(game.home.team)}, ${describeCardDay(game)}`,
    state: /** @type {"final" | "live" | "pre"} */ (game.state),
    day: readGameDay(game),
    clock: game.state === "live" ? describeLiveClock(game) : "",
    score: own == null || other.score == null ? null : { own, theirs: other.score },
    time: describeStartTime(game),
    isHome: place === "home",
    dot: renderDot(other.team),
    opponent: nameTeam(other.team),
  };
}

/**
 * @param {Season} season
 * @param {string} team
 * @param {number} now
 */
function renderNearestGames(season, team, now) {
  const nearest = readNearestGames(season, team);
  const games = [nearest.last, nearest.now, nearest.next].filter((game) => game !== null);
  return renderGameCards(
    games.map((game) => describeGameCard(game, team)),
    new Date(now),
  );
}

/**
 * @param {StandingsRow | undefined} row
 * @param {Run | undefined} run
 */
const listFacts = (row, run) =>
  [row?.conference, run?.seed && `${run.seed} seed`, row && `${row.wins}-${row.losses}`].filter(
    Boolean,
  );

/**
 * A team's dot and full name, as its sheets title it.
 * @param {string} code
 */
const renderTeamHeading = (code) =>
  html`${renderDot(code)}<span>${TEAMS[code].city} ${TEAMS[code].name}</span>`;

/**
 * The sheet a team opens: its name, its conference, seed, and record, then its nearest games, its
 * regular season with its leading scorers and its playoffs, the playoffs first for a team that made
 * them, then its titles.
 * @param {Season | null} season
 * @param {string} code
 * @param {{ year: number, now: number }} options
 */
export function renderTeamSheet(season, code, { year, now }) {
  const row = season?.standings?.find((each) => each.team === code);
  const { run, games, isPlaying, chip } = readTeamPlayoffs(season, code);
  const titles = listTitles(code, run, year);
  const regularSeason = html`${renderRegularSeason(code, season?.standings ?? [])}
  ${renderLeadingScorers(findTeamLeaders(season, code))}`;
  const playoffs = renderPlayoffs(code, games, chip, {
    isPlaying,
    field: readLeaguePlayoffs(season?.games ?? []),
    teams: (season?.standings ?? []).map(readRegularSeason),
    now,
  });
  return {
    heading: renderTeamHeading(code),
    note: joinWithSeparator(listFacts(row, run)),
    body: html`${renderNearestGames(season ?? {}, code, now)}
    ${run ? html`${playoffs}${regularSeason}` : html`${regularSeason}${playoffs}`}
    ${renderTitles(listTitleYears(code, titles))}`,
  };
}
