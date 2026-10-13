import { listRankedOrder, renderClub, renderRankTag } from "./clubs.js";
import { readGameDay } from "./dates.js";
import { formatClockTimeWithoutMeridiem, formatShortWeekday, nameDay } from "#shared/days.js";
import { html, setHtml } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { session } from "./session.js";

const DIVISION_ORDER = ["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"];
const DIVISION_ELIMINATION_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const MAGIC_NUMBER_TITLE =
  "Division magic number: combined wins by this team and losses by the club closest behind it that would clinch the division. A dash means clinched.";
const WILD_CARD_ELIMINATION_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

// Shared column classes, sized in styles.css, line the columns up across every table.
const COLUMNS = html`<colgroup><col class="c-rank"><col class="c-seed"><col class="c-team"><col class="c-w"><col class="c-l"><col class="c-pct"><col class="c-gb"><col class="c-e"><col></colgroup>`;
const COLUMN_COUNT = 9;
const WILD_CARD_SPOTS = 3;
const MIN_CHASERS = 3;

const EMPTY_NEXT_CELL = html`<td class="next-cell">&mdash;</td>`;

function renderGamesBackCell(value) {
  if (value == null || value === "") return html`<td class="tabular"></td>`;
  return html`<td class="tabular">${value === "-" ? html`&mdash;` : value}</td>`;
}

function renderEliminationCell(value) {
  if (value === "E") return html`<td class="elim-num mid">E</td>`;
  if (value == null || value === "-") return html`<td class="elim-num clinched mid">&mdash;</td>`;
  return html`<td class="elim-num live tabular mid">${value}</td>`;
}

const hasStarted = (game, now) => game && game.at && !game.tbd && Date.parse(game.at) <= now;

// A game that has started isn't next, even before the standings refresh.
function findNextGame(row, now) {
  if (!hasStarted(row.next, now)) return row.next;
  return hasStarted(row.then, now) ? null : row.then;
}

// A club out of the table's race still shows a postseason game, since it only has one while alive.
const isNextShown = (next, isOut) => next && next.at && (!isOut || next.postseason);

const isPlayedBy = (game, id) => game.away === id || game.home === id;
const hasPassedStart = (game, now) => !game.tbd && Date.parse(game.start) <= now;
// MLB can call a start delayed before its scheduled time.
const isAboutToStart = (game, now) =>
  game.state === "pre" && (!!game.delay || hasPassedStart(game, now));

// A club's standings row lists only games still to come, so its game under way comes from the slate.
function findGameUnderWay(id, now) {
  const games = (session.state?.slate?.today?.games || []).filter((game) => isPlayedBy(game, id));
  return (
    games.find((game) => game.state === "live") ||
    games.find((game) => isAboutToStart(game, now)) ||
    null
  );
}

const describeOpponent = (game, id) => (game.home === id ? `vs ${game.away}` : `@ ${game.home}`);

function describeMargin(game, id) {
  const [awayRuns, homeRuns] = game.score;
  const margin = game.home === id ? homeRuns - awayRuns : awayRuns - homeRuns;
  if (margin === 0) return "Tied";
  return margin > 0 ? `Up ${margin}` : `Down ${-margin}`;
}

function describeGameUnderWay(game, id) {
  const opponent = describeOpponent(game, id);
  if (game.state === "pre") return game.delay ? `Today ${opponent}` : `Warmup ${opponent}`;
  const matchup = `${describeMargin(game, id)} ${opponent}`;
  return game.delay ? matchup : `${matchup} in the ${formatOrdinal(game.inning || 1)}`;
}

function describeGameUnderWayWithDelay(game, id) {
  const text = describeGameUnderWay(game, id);
  if (game.delay)
    return { text: html`${text} &mdash; ${game.delay}`, classes: ["live", "delayed"] };
  return { text, classes: ["live"] };
}

function describeComingGame(next, now) {
  const gameDay = readGameDay(next);
  if (!gameDay) return null;
  const day = nameDay(gameDay, new Date(now), {
    nearDays: [0],
    nameOtherDay: formatShortWeekday,
    isCapitalized: true,
  });
  const time = next.tbd ? "" : ` ${formatClockTimeWithoutMeridiem(new Date(next.at))}`;
  return { text: `${day}${time} ${next.home ? "vs" : "@"} ${next.opp || "TBD"}`, classes: [] };
}

/**
 * A club's game under way, or else its next game, in words, with whether it's under way or
 * delayed, or null when it has none to show.
 * @returns {{ text: import("#shared/html.js").Markup | string, classes: string[] } | null}
 */
function describeNextGame(row, { isOut = false, now = Date.now() } = {}) {
  const gameUnderWay = findGameUnderWay(row.id, now);
  if (gameUnderWay && (!isOut || gameUnderWay.postseason))
    return describeGameUnderWayWithDelay(gameUnderWay, row.id);
  const next = findNextGame(row, now);
  return isNextShown(next, isOut) ? describeComingGame(next, now) : null;
}

export function renderNextCell(row, options = {}) {
  const next = describeNextGame(row, options);
  if (!next) return EMPTY_NEXT_CELL;
  return html`<td class="${["next-cell", ...next.classes].join(" ")}">${next.text}</td>`;
}

const readSeed = (id) => session.state.teams[id] && session.state.teams[id].seed;

// An unranked club gets an empty slot, so every row is a rank tag's height and tables side by
// side line up whichever clubs are ranked.
function renderRankCell(id) {
  const isRanked = listRankedOrder().includes(id);
  return html`<td class="rank-cell">${isRanked ? renderRankTag(id) : html`<span class="rank-slot"></span>`}</td>`;
}

function renderStandingsRow(row, cells, { out = false, cut = false, groupEnd = false } = {}) {
  const rowClass = [out ? "eliminated" : "alive", cut && "cut", groupEnd && "group-end"]
    .filter(Boolean)
    .join(" ");
  const rowMarkup = html`<tr class="${rowClass}" data-team="${row.id}">
    ${renderRankCell(row.id)}
    <td class="seed-cell">${readSeed(row.id) || ""}</td>
    <td class="team row-button-cell">${renderClub(row.id)}</td>
    ${cells}
  </tr>`;
  // One cell spanning the table, so the dashes run at a single even pitch.
  return cut
    ? html`${rowMarkup}<tr class="cutline"><td colspan="${COLUMN_COUNT}"></td></tr>`
    : rowMarkup;
}

function renderRecordCells(row) {
  return html`<td class="tabular mid">${row.w}</td><td class="tabular mid">${row.l}</td><td class="tabular mid">${row.pct}</td>`;
}

function renderHeader(gamesBackLabel, eliminationLabel, eliminationTitle) {
  return html`<thead><tr>
        <th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>${gamesBackLabel}</th>
        <th class="mid" title="${eliminationTitle}">${eliminationLabel}</th><th class="left next-cell">Next</th>
      </tr></thead>`;
}

function renderDivisionTag(leader) {
  if (leader.clinched) return html`<span class="clinch-tag">clinched</span>`;
  if (/^\d+$/.test(leader.magic || ""))
    return html`<span class="magic-tag">magic ${leader.magic}</span>`;
  return html``;
}

function renderRaceCells(row, gamesBack, eliminationNumber, isOut) {
  return html`${renderRecordCells(row)}${renderGamesBackCell(gamesBack)}${renderEliminationCell(eliminationNumber)}${renderNextCell(row, { isOut })}`;
}

function renderTable(title, head, body) {
  return html`<div class="st-scroll" tabindex="0" role="region" aria-label="${title} standings"><div class="row-button-clip"><table class="st">
      ${COLUMNS}
      ${head}
      <tbody>${body}</tbody>
    </table></div></div>`;
}

export function renderDivisionBlock(name, rows) {
  const league = name.slice(0, 2);
  const renderRow = (row) => {
    const isOut = row.elim === "E";
    const cells = renderRaceCells(row, row.gb, row.elim, isOut);
    return renderStandingsRow(row, cells, { out: isOut });
  };
  return html`<div class="div-block" data-standings="${league}">
    <div class="div-title">
      <span class="${league}">${name}</span><span class="title-right">${renderDivisionTag(rows[0] || {})}</span>
    </div>
    ${renderTable(name, renderHeader("GB", "E#", DIVISION_ELIMINATION_TITLE), rows.map(renderRow))}
  </div>`;
}

const listLeagueDivisions = (league, divisions) =>
  DIVISION_ORDER.filter((division) => division.startsWith(league)).map(
    (division) => divisions[division] || [],
  );

const compareLeaders = (first, second) =>
  (readSeed(first.id) || 99) - (readSeed(second.id) || 99) ||
  Number(second.pct) - Number(first.pct);

function listLeaders(league, divisions) {
  return listLeagueDivisions(league, divisions)
    .flatMap((rows) => rows.filter((row) => row.lead))
    .sort(compareLeaders);
}

// Eliminated clubs go last: MLB's wildCardRank can rank one above a live
// club on a tiebreaker that no longer matters to the race.
function compareWildCardRows(first, second) {
  const firstOut = first.wce === "E" ? 1 : 0;
  const secondOut = second.wce === "E" ? 1 : 0;
  return firstOut - secondOut || Number(first.wcrank || 99) - Number(second.wcrank || 99);
}

function listWildCardPool(league, divisions) {
  return listLeagueDivisions(league, divisions)
    .flatMap((rows) => rows.filter((row) => !row.lead))
    .sort(compareWildCardRows);
}

// Every club still alive for a wild card, and never fewer than three, so the race below the
// line keeps its shape once most of it is out.
function listChasers(chasers) {
  const aliveCount = chasers.filter((row) => row.wce !== "E").length;
  return chasers.slice(0, Math.max(MIN_CHASERS, aliveCount));
}

// The leader's edge on the club behind it, which MLB gives only as that club's games back.
export function describeDivisionLead(leader, divisions) {
  const rows = Object.values(divisions).find((division) => division.includes(leader)) || [];
  const second = rows.find((row) => row !== leader);
  if (!second || !/^\d/.test(second.gb || "")) return second ? second.gb : null;
  return `+${second.gb}`;
}

function renderMagicCell(leader) {
  if (leader.clinched) return renderEliminationCell("-");
  if (/^\d+$/.test(leader.magic || "")) return renderEliminationCell(leader.magic);
  return html`<td class="elim-num mid"></td>`;
}

function renderFieldHead() {
  return html`<thead><tr>
        <th></th><th>Seed</th><th class="left">Division leaders</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>Lead</th>
        <th class="mid" title="${MAGIC_NUMBER_TITLE}">M#</th><th class="left next-cell">Next</th>
      </tr></thead>`;
}

const WILD_CARD_HEAD = html`<tr class="wild-card-head">
    <th></th><th></th><th class="left">Wild cards</th><th></th><th></th><th></th><th>WCGB</th>
    <th class="mid" title="${WILD_CARD_ELIMINATION_TITLE}">WCE</th><th></th>
  </tr>`;

export function renderFieldBlock(league, divisions) {
  const leaders = listLeaders(league, divisions);
  const pool = listWildCardPool(league, divisions);
  const holders = pool.slice(0, WILD_CARD_SPOTS);
  const chasers = listChasers(pool.slice(WILD_CARD_SPOTS));
  const renderLeaderRow = (row, index) => {
    const cells = html`${renderRecordCells(row)}${renderGamesBackCell(describeDivisionLead(row, divisions))}${renderMagicCell(row)}${renderNextCell(row)}`;
    return renderStandingsRow(row, cells, { groupEnd: index === leaders.length - 1 });
  };
  const renderWildCardRow = (row, { cut = false } = {}) => {
    const isOut = row.wce === "E";
    const cells = renderRaceCells(row, row.wcgb, row.wce, isOut);
    return renderStandingsRow(row, cells, { cut, out: isOut });
  };
  const body = html`${leaders.map(renderLeaderRow)}${WILD_CARD_HEAD}${holders.map((row, index) =>
    renderWildCardRow(row, { cut: index === holders.length - 1 && chasers.length > 0 }),
  )}${chasers.map((row) => renderWildCardRow(row))}`;
  const title = `${league} Playoff Field`;
  return html`<div class="div-block">
    <div class="div-title"><span class="${league}">${title}</span><span class="title-right"></span></div>
    ${renderTable(title, renderFieldHead(), body)}
  </div>`;
}

export function renderStandings() {
  const wrap = document.getElementById("standingsWrap");
  const divisions = session.standings && session.standings.divisions;
  if (!divisions || !Object.keys(divisions).length) {
    setHtml(
      wrap,
      html`<p class="stand-empty">No standings for this season yet. They
      appear here as soon as the page can reach MLB.</p>`,
    );
    return;
  }
  const fields = ["AL", "NL"]
    .filter((league) => listLeaders(league, divisions).length)
    .map((league) => renderFieldBlock(league, divisions));
  const blocks = DIVISION_ORDER.filter(
    (division) => divisions[division] && divisions[division].length,
  ).map((division) => renderDivisionBlock(division, divisions[division]));
  setHtml(
    wrap,
    html`
    <div class="field-grid">${fields}</div>
    <div class="stand-head">Divisions</div>
    <div class="div-grid">${blocks}</div>`,
  );
}

/**
 * Shows one of the tab's parts, as a search's row for it asks: the playoff fields, which lead the
 * tab, at its top, or a league's divisions, from its first.
 * @param {string} key "playoffs", or the league, as "AL"
 */
export function showStandingsPart(key) {
  const firstDivision = document.querySelector(`[data-standings="${CSS.escape(key)}"]`);
  if (firstDivision) firstDivision.scrollIntoView({ block: "start" });
  else scrollTo({ top: 0 });
}
