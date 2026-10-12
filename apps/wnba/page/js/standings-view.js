import { html } from "#shared/html.js";
import { createPager } from "#shared/pager.js";
import { renderPlainClub, renderTeamButton } from "./clubs.js";
import { readPlayoffRuns } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {{ team: string, conference: string, wins: number, losses: number, place: number, conferencePlace: number, gamesBack: number | null, conferenceGamesBack: number | null, clinch: string | null, streak: string | null, lastTen: string | null, pointsFor?: number | null, pointsAgainst?: number | null, margin?: number | null, home?: string | null, road?: string | null }} StandingsRow */
/** @typedef {"League" | "East" | "West"} StandingsView */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./team-view.js").Run} Run */
/** @typedef {{ standings?: StandingsRow[], series?: Series[] }} Season */
/** @typedef {import("#shared/html.js").Markup | string} Cell */
/** @typedef {{ group: string, heads: [string, string], renderCells: (row: StandingsRow) => [Cell, Cell] }} FormColumns */

/** @type {StandingsView[]} */
const STANDINGS_VIEWS = ["League", "East", "West"];

/** @param {StandingsView} view */
const nameViewKey = (view) => view.toLowerCase();

/** @type {ReturnType<typeof createPager> | null} */
let standingsPager = null;

// The top eight across the league make the playoffs, whatever their conference.
const PLAYOFF_SPOTS = 8;

const PLAYOFF_LINE = html`<tr class="playoff-line" aria-hidden="true"><td colspan="6"></td></tr>`;

/** @param {StandingsRow} row */
const isAboveLine = (row) => row.place <= PLAYOFF_SPOTS;

/** @param {number | null} gamesBack */
const formatGamesBack = (gamesBack) => (gamesBack ? gamesBack.toFixed(1) : "-");

/**
 * The league view tags each team's conference, and a conference view each playoff team's league seed.
 * @param {StandingsRow} row
 * @param {StandingsView} view
 */
function renderTeamTag(row, view) {
  if (view === "League") {
    return html`<span class="conference-tag ${row.conference.toLowerCase()}">${row.conference.charAt(0)}</span>`;
  }
  return isAboveLine(row) ? html`<span class="seed-note">${row.place} seed</span>` : "";
}

/**
 * A streak, like W 3, marked when it's a winning one.
 * @param {string | null} streak
 */
export const renderStreak = (streak) =>
  streak?.startsWith("W") ? html`<span class="streak-won">${streak}</span>` : (streak ?? "");

/**
 * A team's first-round series from its own side: "W 2-0" once it won, "L 0-2" once it lost, and
 * "1-1" while it's still being played.
 * @param {Series} series
 * @param {string} team
 */
function renderFirstRound(series, team) {
  const [own, other] =
    series.top?.team === team ? [series.top, series.bottom] : [series.bottom, series.top];
  const score = `${own?.wins ?? 0}-${other?.wins ?? 0}`;
  if (series.winner === team) return html`<span class="series-won">W ${score}</span>`;
  return series.winner ? `L ${score}` : score;
}

/**
 * Where a team's run stands: out, champions, the next game of a first round it's still playing,
 * or the furthest round it has reached, which is at least the second once it wins the first.
 * @param {Run} run
 * @param {Series} firstRound
 */
function renderPlayoffNow(run, firstRound) {
  if (run.isOut) return html`<span class="playoff-out">Out</span>`;
  if (run.isChampion) return html`<span class="still-in">Champions</span>`;
  if (firstRound.winner)
    return html`<span class="still-in">${ROUNDS[Math.max(run.round, 2)].shortName}</span>`;
  const nextGame = (firstRound.top?.wins ?? 0) + (firstRound.bottom?.wins ?? 0) + 1;
  return html`<span class="still-in">Game ${nextGame}</span>`;
}

/** @param {[Cell, Cell]} cells */
const renderFormCells = ([first, second]) =>
  html`<td class="tabular recent recent-start">${first}</td>
    <td class="tabular recent pair-end">${second}</td>`;

/** @type {FormColumns} */
const RECENT_COLUMNS = {
  group: "Recent",
  heads: ["L10", "Strk"],
  renderCells: (row) => [row.lastTen ?? "", renderStreak(row.streak)],
};

/**
 * @param {Series[]} allSeries
 * @param {string} team
 */
const findFirstRound = (allSeries, team) =>
  allSeries.find(
    (series) => series.round === 1 && [series.top?.team, series.bottom?.team].includes(team),
  );

/**
 * Each team's first round and where its run stands, blank for a team that missed the playoffs.
 * @param {Series[]} allSeries
 * @param {Map<string, Run>} runs
 * @returns {FormColumns}
 */
function listPlayoffColumns(allSeries, runs) {
  return {
    group: "Playoffs",
    heads: ["Rd 1", "Now"],
    renderCells: (row) => {
      const run = runs.get(row.team);
      const firstRound = findFirstRound(allSeries, row.team);
      if (!run || !firstRound) return ["", ""];
      return [renderFirstRound(firstRound, row.team), renderPlayoffNow(run, firstRound)];
    },
  };
}

/**
 * The standings' last two columns: recent form through the regular season, then each team's
 * playoff run once the field is set, since the league's L10 and streak stop where the regular
 * season ended.
 * @param {Season | null} season
 */
function chooseFormColumns(season) {
  const allSeries = season?.series ?? [];
  const runs = readPlayoffRuns(allSeries);
  return runs.size ? listPlayoffColumns(allSeries, runs) : RECENT_COLUMNS;
}

/**
 * @param {StandingsRow} row
 * @param {StandingsView} view
 * @param {FormColumns} form
 */
function renderRow(row, view, form) {
  const isLeague = view === "League";
  return html`<tr class="${isAboveLine(row) ? "" : "below"}" data-team="${row.team}">
    <td class="place tabular">${isLeague ? row.place : row.conferencePlace}</td>
    <td class="team row-button-cell">${renderTeamButton(row.team, html`<span class="team-cell">${renderPlainClub(row.team)}${renderTeamTag(row, view)}</span>`)}</td>
    <td class="tabular season">${row.wins}-${row.losses}</td>
    <td class="tabular season pair-end">${formatGamesBack(isLeague ? row.gamesBack : row.conferenceGamesBack)}</td>
    ${renderFormCells(form.renderCells(row))}
  </tr>`;
}

/**
 * The view's teams in its own order, with the playoff line above the first team below it.
 * @param {StandingsRow[]} rows
 * @param {StandingsView} view
 * @param {FormColumns} form
 */
function renderBody(rows, view, form) {
  return rows.map((row, index) => {
    const isFirstBelow = index > 0 && isAboveLine(rows[index - 1]) && !isAboveLine(row);
    return html`${isFirstBelow && PLAYOFF_LINE}${renderRow(row, view, form)}`;
  });
}

/**
 * @param {StandingsRow[]} league
 * @param {StandingsView} view
 */
function listViewRows(league, view) {
  if (view === "League") return league;
  return league
    .filter((row) => row.conference === view)
    .sort((first, second) => first.conferencePlace - second.conferencePlace);
}

/**
 * One table, of the league or a conference, with the playoff line after the league's eighth.
 * @param {Season | null} season
 * @param {StandingsView} [view]
 */
export function renderStandings(season, view = "League") {
  const rows = season?.standings ?? [];
  if (!rows.length) return html`<p class="empty-note">No standings yet</p>`;
  const league = [...rows].sort((first, second) => first.place - second.place);
  const form = chooseFormColumns(season);
  return html`<div class="row-button-clip">
    <table class="standings" aria-label="${view} standings">
      <thead>
        <tr class="groups">
          <th colspan="2"></th>
          <th colspan="2">Season</th>
          <th colspan="2" class="recent-start">${form.group}</th>
        </tr>
        <tr>
          <th></th>
          <th class="team">Team</th>
          <th>W-L</th>
          <th class="pair-end">GB</th>
          <th class="recent recent-start">${form.heads[0]}</th>
          <th class="recent pair-end">${form.heads[1]}</th>
        </tr>
      </thead>
      <tbody>
        ${renderBody(listViewRows(league, view), view, form)}
      </tbody>
    </table>
  </div>`;
}

/** Builds the pill over the league's and each conference's table, which a swipe moves between. */
export function startStandings() {
  standingsPager = createPager(
    /** @type {HTMLElement} */ (document.getElementById("standingsPager")),
    {
      label: "Standings",
      idPrefix: "standings",
      lists: STANDINGS_VIEWS.map((view) => ({ key: nameViewKey(view), name: view })),
      openOn: nameViewKey("League"),
    },
  );
}

/** @param {Season | null} season */
export function drawStandings(season) {
  standingsPager.fill((key) =>
    renderStandings(
      season,
      STANDINGS_VIEWS.find((view) => nameViewKey(view) === key),
    ),
  );
}

/**
 * Shows one of the tab's lists, as a search's row for it asks.
 * @param {string} key
 */
export function showStandingsList(key) {
  standingsPager?.switchToList(key);
}
