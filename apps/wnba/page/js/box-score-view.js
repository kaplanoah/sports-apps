import { html, joinWithSeparator } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { isPlayingNow } from "#shared/playing-now.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderPendingTapeRow, renderTapeRow } from "#shared/tape.js";
import { renderClub } from "./clubs.js";
import { findLoser } from "./games-view.js";
import { measureBiggestLeads, renderLeadChart, renderPendingLeadChart } from "./lead-chart.js";
import { nameOvertime, REGULATION_PERIODS } from "./periods.js";
import { renderPlayerButton } from "./player-button.js";
import {
  findLeader,
  measureAgainst,
  renderPendingPlayerRows,
  renderPlayerTable,
  renderTapeTeams,
} from "./sheet-parts.js";
import { nameTeam } from "./series.js";
import { formatPercentage } from "./team-view.js";

// The game sheet's box score for a game that has started: points by quarter, the lead through the
// game, the teams' stats side by side, and each team's top scorers. Until each loads, it holds its
// shape with placeholders.

/** @typedef {{ id: number, firstName: string, lastName: string, minutes: number, points: number, rebounds: number, assists: number, fouls: number }} BoxPlayer */
/** @typedef {{ fieldGoals: number[], threePointers: number[], freeThrows: number[], rebounds: number, assists: number, turnovers: number, paintPoints: number, benchPoints: number, biggestLead: number }} TeamStats */
/** @typedef {{ team: string, score: number, periods: number[], timeouts: number | null, stats: TeamStats, players: BoxPlayer[] }} BoxTeam */
/** @typedef {{ id: string, state: string, period: number | null, leadChanges: number | null, timesTied: number | null, away: BoxTeam, home: BoxTeam }} BoxScore */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];
const TOP_PERFORMERS = 5;
// A player fouls out on her sixth, so a fourth while the game is on puts her in trouble.
const FOUL_TROUBLE = 4;
const FOUL_OUT = 6;

const SHOOTING = [
  { key: "fieldGoals", label: "Field goals" },
  { key: "threePointers", label: "3-pointers" },
  { key: "freeThrows", label: "Free throws" },
];
const COUNTS = [
  { key: "rebounds", label: "Rebounds" },
  { key: "assists", label: "Assists" },
  { key: "turnovers", label: "Turnovers", isLowerBetter: true },
  { key: "paintPoints", label: "Points in the paint" },
  { key: "benchPoints", label: "Bench points" },
];

// The line score heads each quarter with its number alone.
/** @param {number} index */
const nameLineScorePeriod = (index) =>
  index < REGULATION_PERIODS ? String(index + 1) : nameOvertime(index + 1);

// While the game is on, the quarter under way is marked, and the ones still to come are blank.
/** @param {BoxScore} box */
function renderLineScore(box) {
  const isLive = box.state === "live";
  const count = Math.max(REGULATION_PERIODS, box.away.periods.length, box.home.periods.length);
  const indexes = [...Array(count).keys()];
  const isNow = (index) => isLive && index === box.period - 1;
  const isAhead = (index) => isLive && index >= box.period;
  const loser = findLoser(box);
  const renderRow = (place) => {
    const side = box[place];
    const cells = indexes.map((index) =>
      isAhead(index) || side.periods[index] == null
        ? html`<td class="ahead">-</td>`
        : html`<td class="${isNow(index) ? "now" : ""}">${side.periods[index]}</td>`,
    );
    return html`<tr>
      <th scope="row">${renderClub(side.team)}</th>
      ${cells}
      <td class="total${loser === place ? " lost" : ""}">${side.score}</td>
    </tr>`;
  };
  const heads = indexes.map(
    (index) => html`<th class="${isNow(index) ? "now" : ""}">${nameLineScorePeriod(index)}</th>`,
  );
  return renderLineScoreTable(heads, SIDES.map(renderRow));
}

/**
 * @param {import("#shared/html.js").Markup[]} heads each period's heading
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderLineScoreTable = (heads, rows) =>
  html`<table class="line-score tabular">
    <thead>
      <tr>
        <td></td>
        ${heads}
        <th>T</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;

/** @param {Record<"away" | "home", string>} teams */
function renderPendingLineScore(teams) {
  const indexes = [...Array(REGULATION_PERIODS).keys()];
  const renderRow = (place) =>
    html`<tr>
      <th scope="row">${renderClub(teams[place])}</th>
      ${indexes.map(() => html`<td>${renderPlaceholder("00")}</td>`)}
      <td class="total">${renderPlaceholder("00")}</td>
    </tr>`;
  return renderLineScoreTable(
    indexes.map((index) => html`<th>${nameLineScorePeriod(index)}</th>`),
    SIDES.map(renderRow),
  );
}

/**
 * A shooting row: each side's share of its shots made, beside how many it made of how many.
 * @param {BoxScore} box
 * @param {{ key: string, label: string }} measure
 */
function describeShooting(box, { key, label }) {
  const shots = SIDES.map((place) => box[place].stats[key]);
  const shares = shots.map(([made, attempted]) => (attempted ? made / attempted : null));
  const describeSide = (index) => {
    const [made, attempted] = shots[index];
    const share = shares[index];
    return {
      value: `${formatPercentage(share)}${share == null ? "" : "%"}`,
      detail: `${made}-${attempted}`,
      bar: share == null ? null : Math.round(share * 100),
    };
  };
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(shares[0], shares[1]),
  };
}

/**
 * @param {BoxScore} box
 * @param {{ key: string, label: string, isLowerBetter?: boolean }} measure
 */
function describeCount(box, { key, label, isLowerBetter }) {
  const [away, home] = SIDES.map((place) => box[place].stats[key]);
  const most = Math.max(away, home);
  return {
    label,
    away: { value: String(away), bar: measureAgainst(away, most) },
    home: { value: String(home), bar: measureAgainst(home, most) },
    leader: findLeader(away, home, { isLowerBetter }),
  };
}

/**
 * The biggest lead each side had: as the lead chart marks them while the sheet has the lead, so
 * the two agree, and otherwise as the league counts them.
 * @param {BoxScore} box
 * @param {import("./lead-chart.js").Lead | null} lead
 */
function readBiggestLeads(box, lead) {
  if (lead && lead.scores.length > 1) return measureBiggestLeads(lead);
  return { away: box.away.stats.biggestLead, home: box.home.stats.biggestLead };
}

/**
 * @param {BoxScore} box
 * @param {import("./lead-chart.js").Lead | null} lead
 */
function describeGameFlow(box, lead) {
  const biggest = readBiggestLeads(box, lead);
  const leads = SIDES.filter((place) => biggest[place] > 0).map(
    (place) => `${nameTeam(box[place].team)} ${biggest[place]}`,
  );
  const timeouts = SIDES.filter((place) => box[place].timeouts != null).map(
    (place) => `${nameTeam(box[place].team)} ${box[place].timeouts}`,
  );
  return [
    leads.length > 0 && `Biggest lead: ${leads.join(", ")}`,
    box.leadChanges != null && `Lead changes: ${box.leadChanges}`,
    box.timesTied != null && `Ties: ${box.timesTied}`,
    box.state === "live" && timeouts.length > 0 && `Timeouts left: ${timeouts.join(", ")}`,
  ].filter(Boolean);
}

/**
 * @param {BoxScore} box
 * @param {import("./lead-chart.js").Lead | null} lead
 */
function renderTeamStats(box, lead) {
  const rows = [
    ...SHOOTING.map((measure) => describeShooting(box, measure)),
    ...COUNTS.map((measure) => describeCount(box, measure)),
  ];
  return html`${renderTapeTeams(box.away.team, box.home.team)}
    <div class="tape">
      ${rows.map(renderTapeRow)}
      <p class="tape-note">${joinWithSeparator(describeGameFlow(box, lead))}</p>
    </div>`;
}

/** @param {Record<"away" | "home", string>} teams */
const renderPendingTeamStats = (teams) =>
  html`${renderTapeTeams(teams.away, teams.home)}
    <div class="tape">
      ${[...SHOOTING, ...COUNTS].map((measure) => renderPendingTapeRow(measure.label))}
      <p class="tape-note">${renderPlaceholder("Biggest lead: Aces 12, Lead changes: 4")}</p>
    </div>`;

/** @param {string} words */
const renderFoulChip = (words) => html`<span class="chip foul-chip">${words}</span>`;

/**
 * @param {BoxPlayer} player
 * @param {boolean} isLive
 */
function renderFouls({ fouls }, isLive) {
  if (fouls >= FOUL_OUT) return renderFoulChip("Fouled out");
  if (isLive && fouls >= FOUL_TROUBLE) return renderFoulChip(`${fouls} fouls`);
  return false;
}

/** @param {BoxPlayer[]} players */
const pickTopScorers = (players) =>
  [...players]
    .sort((first, second) => second.points - first.points || second.minutes - first.minutes)
    .slice(0, TOP_PERFORMERS);

/**
 * A box score lists every player on a team, so only one with minutes has played in its game.
 * @param {BoxTeam} side
 * @param {boolean} isLive
 * @param {boolean} isPlaying whether the game's players are playing now
 */
function renderTopScorers(side, isLive, isPlaying) {
  const rows = pickTopScorers(side.players).map(
    (player) => html`<tr>
      <th scope="row">
        ${renderPlayerButton(
          { ...player, team: side.team },
          html`<span class="first-name">${player.firstName}</span> ${player.lastName}`,
          { isPlayingNow: isPlaying && player.minutes > 0 },
        )}${renderFouls(player, isLive)}
      </th>
      <td>${player.points}</td>
      <td>${player.rebounds}</td>
      <td>${player.assists}</td>
      <td class="quiet-stat">${player.minutes}</td>
    </tr>`,
  );
  return describeScorers(side.team, rows);
}

/**
 * @param {string} team
 * @param {import("#shared/html.js").Markup[]} rows
 */
const describeScorers = (team, rows) => ({ heading: renderClub(team), rows });

/** @type {import("./sheet-parts.js").PlayerColumn[]} */
const SCORER_COLUMNS = [
  { label: "Pts", title: "Points" },
  { label: "Reb", title: "Rebounds" },
  { label: "Ast", title: "Assists" },
  { label: "Min", title: "Minutes" },
];

/** @param {{ heading: import("#shared/html.js").Markup, rows: import("#shared/html.js").Markup[] }[]} groups */
const renderScorersTable = (groups) => renderPlayerTable(groups, SCORER_COLUMNS);

/** @typedef {{ lead?: import("./lead-chart.js").Lead | null, isLeadLoading?: boolean }} LeadState */

/**
 * The lead through the game once it has a basket, or its shape while it loads, so the sheet
 * keeps its height as it arrives.
 * @param {Record<"away" | "home", string>} teams
 * @param {LeadState} state
 */
function renderLeadPart(teams, { lead = null, isLeadLoading = false }) {
  if (lead && lead.scores.length > 1)
    return renderSheetPart("Lead through the game", renderLeadChart(lead, teams));
  if (isLeadLoading) return renderSheetPart("Lead through the game", renderPendingLeadChart(teams));
  return false;
}

/**
 * @param {BoxScore} box
 * @param {LeadState} [leadState]
 * @param {boolean} [isToday] whether the game is today's
 */
export function renderBoxScore(box, leadState = {}, isToday = false) {
  const isLive = box.state === "live";
  const isPlaying = isPlayingNow(box.state, isToday);
  const teams = { away: box.away.team, home: box.home.team };
  return html`${renderSheetPart("By quarter", renderLineScore(box))}
    ${renderLeadPart(teams, leadState)}
    ${renderSheetPart("Team stats", renderTeamStats(box, leadState.lead ?? null), isLive && "So far")}
    ${renderSheetPart(
      "Top scorers",
      renderScorersTable(SIDES.map((place) => renderTopScorers(box[place], isLive, isPlaying))),
    )}`;
}

/**
 * The box score's parts, in their shape, while it loads, with the lead as far as it has loaded.
 * @param {Record<"away" | "home", string>} teams
 * @param {LeadState} [leadState]
 */
export const renderPendingBoxScore = (teams, leadState = {}) =>
  html`${renderSheetPart("By quarter", renderPendingLineScore(teams))}
    ${renderLeadPart(teams, leadState)}
    ${renderSheetPart("Team stats", renderPendingTeamStats(teams))}
    ${renderSheetPart(
      "Top scorers",
      renderScorersTable(
        SIDES.map((place) =>
          describeScorers(
            teams[place],
            renderPendingPlayerRows(TOP_PERFORMERS, SCORER_COLUMNS.length),
          ),
        ),
      ),
    )}`;
