import { ROUND_LABEL, buildBracket, listSlotCandidates } from "./bracket.js";
import { listRankedOrder, renderRankTag, nameTeam, renderClub } from "./clubs.js";
import { readGameDay } from "./dates.js";
import { formatClockTime, formatShortDate, formatShortWeekday, nameDay } from "#shared/days.js";
import { describeInning, renderOutLights } from "./games-view.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { findOpeningRound, watchOpeningRound } from "#shared/opening-round.js";
import { markScrolledRound, renderRoundDots } from "#shared/round-dots.js";
import { session } from "./session.js";

const findRank = (id) => {
  const index = listRankedOrder().indexOf(id);
  return index === -1 ? Infinity : index;
};

function listSideCandidates(series, side) {
  const team = side === "A" ? series.teamA : series.teamB;
  return team ? [team] : listSlotCandidates(session.state, series.id, side);
}

// A side is preferred only when every club that could fill it is ranked above every club on the other.
function findPreferredSide(series) {
  const ranksA = listSideCandidates(series, "A").map(findRank);
  const ranksB = listSideCandidates(series, "B").map(findRank);
  if (!ranksA.length || !ranksB.length) return null;
  if (Math.max(...ranksA) < Math.min(...ranksB)) return "A";
  if (Math.max(...ranksB) < Math.min(...ranksA)) return "B";
  return null;
}

const renderSeriesWins = (wins, isWinner = false) =>
  html`<span class="nscore tabular ${isWinner ? "lead" : ""}">${wins ?? ""}</span>`;

export function renderMatchupRow(series, side) {
  const id = side === "A" ? series.teamA : series.teamB;
  const wins = side === "A" ? series.winsA : series.winsB;
  if (!id)
    return html`<div class="matchup-row"><span class="tbd">TBD</span>${renderSeriesWins(null)}</div>`;
  const isWinner = series.winner === id;
  const isLoser = series.winner && series.winner !== id;
  const isPreferred = findPreferredSide(series) === side;
  // A score stays empty until the series' first game starts, and counts from 0 after.
  const shownWins = series.started ? wins : null;
  return html`<div class="matchup-row ${isWinner ? "winner" : ""} ${isLoser ? "eliminated" : ""}">
    <div class="team-id">${renderRankTag(id, isPreferred)}${renderClub(id)}</div>
    ${renderSeriesWins(shownWins, isWinner)}
  </div>`;
}

// Card metrics must match styles.css.
const CARD = { width: 209, height: 90, topSlotY: 41, dividerY: 57 };
// Room beside a card for a seed's label, from styles.css's .seed-labels.
const SEED_LABEL_ROOM = 51;

/* Desktop: AL on the left and NL on the right under their league bars, meeting at the World
   Series in the middle. Each wild card card sits dividerY - topSlotY above its division card, so
   its connector runs straight into the top slot. Seeds' labels sit on each league's outer side,
   with wider gaps beside the wild card columns for the division cards' byes. */
const WIDE = {
  inset: SEED_LABEL_ROOM,
  columnGaps: [56, 20, 20, 20, 20, 56],
  stageHeight: 343, // room for a next-game note under the lowest cards
  wildCard1Y: 37,
  division1Y: 53,
  middleY: 138,
  division2Y: 223,
  wildCard2Y: 207,
};

// Screens too narrow for the whole wide bracket: AL above NL, rounds left to right, swiped sideways.
const STACKED = {
  inset: SEED_LABEL_ROOM,
  columnGaps: [56, 32, 32],
  worldSeriesWidth: 240,
  noteHeight: 22,
  lineHeight: 19,
  // Room above the tab bar for the round dots, which chrome.css pins there, and a gap above them.
  // It matches what --tab-bar-clearance in chrome.css adds to the bar, so a bracket that fills the
  // screen leaves the page nothing to scroll.
  tabBarClearance: 24,
  minGrowth: 0.5,
  maxGrowth: 3,
};
/* The spaces, which all grow or shrink by one factor to fit the screen's height. The header's
   margin in styles.css supplies the first aboveLeague, which never shrinks, since the stage can't
   reach above its scroller. The NL's line sits betweenRows below the AL's last note. */
const SPACES = { aboveLeague: 13, belowLine: 11, betweenRows: 13 };
// A row of level cards and their notes.
const SERIES_HEIGHT = CARD.height + STACKED.noteHeight;

const sumGaps = (layout, index) =>
  layout.columnGaps.slice(0, index).reduce((total, gap) => total + gap, 0);
const findColumnLeft = (layout, index) =>
  layout.inset + index * CARD.width + sumGaps(layout, index);
const findColumnRight = (layout, index) => findColumnLeft(layout, index) + CARD.width;
const WIDE_STAGE_WIDTH = findColumnRight(WIDE, 6) + WIDE.inset;
const STACKED_LINES_WIDTH = findColumnLeft(STACKED, 3) + STACKED.worldSeriesWidth;

const PAGE_GUTTER = 18; // body's side padding in styles.css
const NARROW_QUERY = `(max-width: ${WIDE_STAGE_WIDTH + 2 * PAGE_GUTTER - 1}px)`;
const isNarrow = () => matchMedia(NARROW_QUERY).matches;
const alignToPixel = (value) => Math.round(value) + 0.5; // a 1px stroke centered on .5 fills one pixel row

function drawConnector(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${alignToPixel(x1)} ${alignToPixel(y1)} H ${alignToPixel(midX)} V ${alignToPixel(y2)} H ${alignToPixel(x2)}`;
}

const formatWeekdayBeforeDate = (day) => `${formatShortWeekday(day)} ${formatShortDate(day)}`;

const describeGameDay = (day, now) =>
  nameDay(day, now, {
    nearDays: [0, 1],
    nameOtherDay: formatWeekdayBeforeDate,
    isCapitalized: true,
  });

function describeStartTime(game) {
  const start = new Date(game.at);
  if (game.tbd || Number.isNaN(start.getTime())) return "time TBD";
  return formatClockTime(start);
}

function describeNextGame(series) {
  const next = (session.state.series[series.id] || {}).next;
  if (series.winner || !next) return "";
  const day = readGameDay(next);
  if (!day) return "";
  return joinWithSeparator([describeGameDay(day, new Date()), describeStartTime(next)]);
}

const readWinningPercentage = (team) =>
  team.w != null && team.l != null && team.w + team.l > 0 ? team.w / (team.w + team.l) : null;

// The higher seed hosts within a league; the World Series goes to the better record.
function findHomeSide(series) {
  if (!series.teamA || !series.teamB) return null;
  const teamA = session.state.teams[series.teamA];
  const teamB = session.state.teams[series.teamB];
  if (!teamA || !teamB) return null;

  if (series.round === "WS") {
    const percentageA = readWinningPercentage(teamA);
    const percentageB = readWinningPercentage(teamB);
    if (percentageA == null || percentageB == null) return null;
    return percentageA >= percentageB ? "A" : "B";
  }
  return teamA.seed <= teamB.seed ? "A" : "B";
}

// The host goes on the bottom, as in a line score. In the WC and DS, teamA is the higher seed.
function orderRows(series) {
  const home = findHomeSide(series);
  if (home) return home === "A" ? ["B", "A"] : ["A", "B"];
  return series.round === "WC" || series.round === "DS" ? ["B", "A"] : ["A", "B"];
}

const isPlayedBetween = (game, series) =>
  !!series.teamA &&
  !!series.teamB &&
  [game.away, game.home].sort().join() === [series.teamA, series.teamB].sort().join();

// The series and the slate come from separate MLB feeds, so a game the series already counts can
// still read as under way on the slate for a while.
function findNextSlateGame(series) {
  const next = (session.state.series[series.id] || {}).next;
  if (series.winner || !next) return null;
  const games = session.state.slate?.today?.games || [];
  return games.find((game) => isPlayedBetween(game, series) && game.start === next.at) || null;
}

const FIRST_PITCH_COUNTDOWN_MS = 30 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const renderFirstPitchPart = (text, isDelayed = false) =>
  html`<div class="card-note live ${isDelayed ? "delayed" : ""}"><span class="live-part">${text}</span></div>`;

// First pitch often comes a few minutes after the scheduled start.
function renderFirstPitchNote(game, now) {
  if (game.tbd) return null;
  const msToStart = Date.parse(game.start) - now;
  if (msToStart > FIRST_PITCH_COUNTDOWN_MS) return null;
  if (game.delay) return renderFirstPitchPart(game.delay, true);
  if (msToStart <= 0) return renderFirstPitchPart("Warmup");
  return renderFirstPitchPart(`First pitch in ${Math.ceil(msToStart / MS_PER_MINUTE)} min`);
}

// The runs read in the card's row order, top row first.
function describeLiveScore(series, game) {
  const [firstSide, secondSide] = orderRows(series);
  const readRuns = (side) => {
    const id = side === "A" ? series.teamA : series.teamB;
    return game.away === id ? game.score[0] : game.score[1];
  };
  return `${readRuns(firstSide)}-${readRuns(secondSide)}`;
}

function renderLiveNote(series, game) {
  return html`<div class="card-note live ${game.delay ? "delayed" : ""}"><span class="live-part tabular">${describeLiveScore(series, game)}</span> <span class="live-part">${game.delay || describeInning(game)}</span>${renderOutLights(game)}</div>`;
}

export function renderCardNote(series, champLine) {
  if (champLine) return html`<div class="card-note champ">${champLine}</div>`;
  const game = findNextSlateGame(series);
  if (game?.state === "live") return renderLiveNote(series, game);
  const firstPitchNote = game?.state === "pre" && renderFirstPitchNote(game, Date.now());
  if (firstPitchNote) return firstPitchNote;
  const note = describeNextGame(series);
  return note ? html`<div class="card-note">${note}</div>` : html``;
}

// A seed shows only where its club enters the bracket: both Wild Card slots, and the bye's slot in
// each Division Series, which is teamA.
const isEntrySlot = (series, side) =>
  series.round === "WC" || (series.round === "DS" && side === "A");

function renderSeedLabel(series, side) {
  const id = side === "A" ? series.teamA : series.teamB;
  const seed = isEntrySlot(series, side) && session.state.teams[id]?.seed;
  return seed
    ? html`<span class="seed-label"><span class="seed-number tabular">${seed}</span> seed</span>`
    : html`<span></span>`;
}

// The labels sit beside the card's rows, outside the card, on the side its lines don't leave from.
function renderSeedLabels(series, sides, seedSide) {
  if (series.round !== "WC" && series.round !== "DS") return html``;
  return html`<div class="seed-labels ${seedSide}">${sides.map((side) => renderSeedLabel(series, side))}</div>`;
}

function renderSeriesCard(
  series,
  top,
  left,
  { champLine = "", width = CARD.width, seedSide = "left" } = {},
) {
  const [first, second] = orderRows(series);
  return html`<div class="box" data-round="${series.round}" style="left:${left}px; top:${top}px; width:${width}px;">
    ${renderSeedLabels(series, [first, second], seedSide)}
    <div class="series ${series.round === "WS" ? "world" : ""}">
      <div class="bestof"><span>${ROUND_LABEL[series.round]}</span><span>BO${series.bestOf}</span></div>
      ${renderMatchupRow(series, first)}${renderMatchupRow(series, second)}
    </div>
    ${renderCardNote(series, champLine)}
  </div>`;
}

const describeAdvance = (champion) => (champion ? `${nameTeam(champion)} advance` : "");

function drawWideConnectors() {
  const left = (index) => findColumnLeft(WIDE, index);
  const right = (index) => findColumnRight(WIDE, index);
  const wildCard1Out = WIDE.wildCard1Y + CARD.dividerY;
  const wildCard2Out = WIDE.wildCard2Y + CARD.dividerY;
  const division1Out = WIDE.division1Y + CARD.dividerY;
  const division2Out = WIDE.division2Y + CARD.dividerY;
  const middleOut = WIDE.middleY + CARD.dividerY;
  const division1Slot = WIDE.division1Y + CARD.topSlotY;
  const division2Slot = WIDE.division2Y + CARD.topSlotY;

  return [
    drawConnector(right(0), wildCard1Out, left(1), division1Slot),
    drawConnector(right(0), wildCard2Out, left(1), division2Slot),
    drawConnector(right(1), division1Out, left(2), middleOut),
    drawConnector(right(1), division2Out, left(2), middleOut),
    drawConnector(right(2), middleOut, left(3), middleOut),
    drawConnector(left(6), wildCard1Out, right(5), division1Slot),
    drawConnector(left(6), wildCard2Out, right(5), division2Slot),
    drawConnector(left(5), division1Out, right(4), middleOut),
    drawConnector(left(5), division2Out, right(4), middleOut),
    drawConnector(left(4), middleOut, right(3), middleOut),
  ].map((path) => html`<path d="${path}"/>`);
}

// wc[1] (4/5) feeds DS1 and wc[0] (3/6) feeds DS2, so each sits beside the card it feeds.
function renderWideCards(bracket) {
  const { al, nl, ws } = bracket;
  const left = (index) => findColumnLeft(WIDE, index);
  const nlSide = { seedSide: "right" };
  return [
    renderSeriesCard(al.wc[1], WIDE.wildCard1Y, left(0)),
    renderSeriesCard(al.wc[0], WIDE.wildCard2Y, left(0)),
    renderSeriesCard(al.ds[0], WIDE.division1Y, left(1)),
    renderSeriesCard(al.ds[1], WIDE.division2Y, left(1)),
    renderSeriesCard(al.cs[0], WIDE.middleY, left(2), { champLine: describeAdvance(al.champion) }),
    renderSeriesCard(ws, WIDE.middleY, left(3)),
    renderSeriesCard(nl.cs[0], WIDE.middleY, left(4), { champLine: describeAdvance(nl.champion) }),
    renderSeriesCard(nl.ds[0], WIDE.division1Y, left(5), nlSide),
    renderSeriesCard(nl.ds[1], WIDE.division2Y, left(5), nlSide),
    renderSeriesCard(nl.wc[1], WIDE.wildCard1Y, left(6), nlSide),
    renderSeriesCard(nl.wc[0], WIDE.wildCard2Y, left(6), nlSide),
  ];
}

const LEAGUE_NAMES = { al: "American League", nl: "National League" };

// The stage's edge past a league's outer column, where its seeds' labels sit.
function findOuterEdge(layout, column) {
  if (column === 0) return 0;
  return column === layout.columnGaps.length
    ? findColumnRight(layout, column) + layout.inset
    : null;
}

// Each bar spans its league's three columns, and its seeds' labels beside the outer one. Its name
// sticks to the left edge while the bar scrolls past, and leaves with the bar.
function renderLeagueHeader(league, layout, top, firstColumn = 0) {
  const lastColumn = firstColumn + 2;
  const left = findOuterEdge(layout, firstColumn) ?? findColumnLeft(layout, firstColumn);
  const right = findOuterEdge(layout, lastColumn) ?? findColumnRight(layout, lastColumn);
  const width = right - left;
  return html`<div class="league-head ${league}" style="top:${top}px; left:${left}px; width:${width}px;"><span class="league-name">${LEAGUE_NAMES[league]}</span></div>`;
}

function renderWideStage(bracket) {
  const width = WIDE_STAGE_WIDTH;
  return html`<div class="bracket-stage" style="width:${width}px; height:${WIDE.stageHeight}px;">
    <svg class="bracket-lines" width="${width}" height="${WIDE.stageHeight}" viewBox="0 0 ${width} ${WIDE.stageHeight}">${drawWideConnectors()}</svg>
    ${renderLeagueHeader("al", WIDE, 0)}
    ${renderLeagueHeader("nl", WIDE, 0, 4)}
    ${renderWideCards(bracket)}
  </div>`;
}

const isShown = (element) => element.getClientRects().length > 0;

let renderedGrowth = 0;
let renderedFits = false;

// A floating tab bar's transform is left out, since the bar stretches while it moves.
function findSpaceBottom() {
  const tabBar = document.getElementById("tabBar");
  const tabBarStyle = getComputedStyle(tabBar);
  if (tabBarStyle.position !== "fixed")
    return innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom);
  const tabBarTop = innerHeight - parseFloat(tabBarStyle.bottom) - tabBar.offsetHeight;
  return tabBarTop - STACKED.tabBarClearance;
}

const INNER_SPACES_HEIGHT = 2 * SPACES.belowLine + 3 * SPACES.betweenRows;

// Solves the stage's spaces for the room they have: grown, the margin above grows with them.
const solveGrowth = (room) =>
  room < INNER_SPACES_HEIGHT
    ? room / INNER_SPACES_HEIGHT
    : (room + SPACES.aboveLeague) / (SPACES.aboveLeague + INNER_SPACES_HEIGHT);

// Solves the stage's height, the sized spaces plus the lines and rows, for the space it has.
function measureGrowth(wrap) {
  if (!isShown(wrap)) return renderedGrowth || 1;
  const top = wrap.getBoundingClientRect().top + scrollY;
  const fixedHeight = 2 * STACKED.lineHeight + 4 * SERIES_HEIGHT;
  const growth = solveGrowth(findSpaceBottom() - top - fixedHeight);
  const bounded = Math.min(STACKED.maxGrowth, Math.max(STACKED.minGrowth, growth));
  return Math.floor(bounded * 100) / 100;
}

// A stacked bracket as wide as the screen or narrower has nothing to scroll to.
/** @param {HTMLElement} wrap */
const measureFit = (wrap) =>
  isShown(wrap) ? STACKED_LINES_WIDTH <= wrap.clientWidth : renderedFits;

function sizeSpaces(growth) {
  return {
    top: Math.max(0, Math.floor(SPACES.aboveLeague * (growth - 1))),
    belowLine: Math.floor(SPACES.belowLine * growth),
    betweenRows: Math.floor(SPACES.betweenRows * growth),
  };
}

// Each wild card card sits level with the division card it feeds.
function placeLeague(top, spaces) {
  const firstY = top + STACKED.lineHeight + spaces.belowLine;
  const rowY = [firstY, firstY + SERIES_HEIGHT + spaces.betweenRows];
  const championshipY = Math.round((rowY[0] + rowY[1]) / 2);
  return { top, rowY, championshipY, bottom: rowY[1] + SERIES_HEIGHT };
}

function drawLeagueConnectors(place) {
  const left = (index) => findColumnLeft(STACKED, index);
  const right = (index) => findColumnRight(STACKED, index);
  const championshipIn = place.championshipY + CARD.dividerY;
  return place.rowY.flatMap((y) => [
    drawConnector(right(0), y + CARD.dividerY, left(1), y + CARD.topSlotY),
    drawConnector(right(1), y + CARD.dividerY, left(2), championshipIn),
  ]);
}

function drawStackedConnectors(places, worldSeriesY) {
  const worldSeriesIn = worldSeriesY + CARD.dividerY;
  return [
    ...places.flatMap(drawLeagueConnectors),
    ...places.map((place) =>
      drawConnector(
        findColumnRight(STACKED, 2),
        place.championshipY + CARD.dividerY,
        findColumnLeft(STACKED, 3),
        worldSeriesIn,
      ),
    ),
  ].map((path) => html`<path d="${path}"/>`);
}

function renderLeague(key, league, place) {
  const left = (index) => findColumnLeft(STACKED, index);
  return [
    renderLeagueHeader(key, STACKED, place.top),
    renderSeriesCard(league.wc[1], place.rowY[0], left(0)),
    renderSeriesCard(league.wc[0], place.rowY[1], left(0)),
    renderSeriesCard(league.ds[0], place.rowY[0], left(1)),
    renderSeriesCard(league.ds[1], place.rowY[1], left(1)),
    renderSeriesCard(league.cs[0], place.championshipY, left(2), {
      champLine: describeAdvance(league.champion),
    }),
  ];
}

function renderStackedStage(bracket, growth, fits) {
  const spaces = sizeSpaces(growth);
  const al = placeLeague(spaces.top, spaces);
  const nl = placeLeague(al.bottom + spaces.betweenRows, spaces);
  const worldSeriesY = Math.round((al.championshipY + nl.championshipY) / 2);
  const worldSeriesLeft = findColumnLeft(STACKED, 3);
  const height = nl.bottom;
  // Running half the scroller's width past the World Series card's middle lets the card scroll to
  // the screen's middle.
  const worldSeriesMiddle = worldSeriesLeft + STACKED.worldSeriesWidth / 2;
  const stageWidth = fits
    ? `${STACKED_LINES_WIDTH}px`
    : `max(${STACKED_LINES_WIDTH}px, calc(${worldSeriesMiddle}px + 50%))`;
  return html`<div class="bracket-stage" style="width:${stageWidth}; height:${height}px;">
    <svg class="bracket-lines" width="${STACKED_LINES_WIDTH}" height="${height}" viewBox="0 0 ${STACKED_LINES_WIDTH} ${height}">${drawStackedConnectors([al, nl], worldSeriesY)}</svg>
    ${renderLeague("al", bracket.al, al)}
    ${renderSeriesCard(bracket.ws, worldSeriesY, worldSeriesLeft, {
      width: STACKED.worldSeriesWidth,
    })}
    ${renderLeague("nl", bracket.nl, nl)}
  </div>`;
}

const ROUND_ORDER = ["WC", "DS", "CS", "WS"];

/** @param {any} bracket */
function findOpeningRoundCode(bracket) {
  const { al, nl, ws } = bracket;
  const rounds = [[...al.wc, ...nl.wc], [...al.ds, ...nl.ds], [...al.cs, ...nl.cs], [ws]];
  return ROUND_ORDER[findOpeningRound(rounds, (series) => !!series.winner)];
}

/** @type {ReturnType<typeof watchOpeningRound> | null} */
let placeBracket = null;

// Only a stacked bracket wider than the screen scrolls sideways, so only it has round dots.
function markRoundScrolledTo() {
  const wrap = /** @type {HTMLElement} */ (document.getElementById("bracketWrap"));
  const dots = /** @type {HTMLElement | null} */ (wrap.querySelector(".round-dots"));
  if (!dots) return;
  const scroller = /** @type {HTMLElement} */ (wrap.querySelector(".tree-scroll"));
  const anchors = ROUND_ORDER.map(
    (round) => /** @type {HTMLElement} */ (scroller.querySelector(`.box[data-round="${round}"]`)),
  );
  markScrolledRound(scroller, anchors, dots);
}

export function renderBracket() {
  const wrap = document.getElementById("bracketWrap");
  const noFieldNote = document.getElementById("noFieldNote");
  const bracket = buildBracket(session.state);
  const hasField = !!bracket.al && !!bracket.nl;
  noFieldNote.hidden = hasField;
  if (!hasField) {
    setHtml(wrap, html``);
    renderedGrowth = 0;
    return;
  }

  const isStacked = isNarrow();
  const growth = isStacked ? measureGrowth(wrap) : 0;
  const fits = !isStacked || measureFit(wrap);
  const stage = isStacked ? renderStackedStage(bracket, growth, fits) : renderWideStage(bracket);
  const scrollLeft = wrap.querySelector(".tree-scroll")?.scrollLeft ?? 0;
  const hadFocus = wrap.contains(document.activeElement);
  setHtml(
    wrap,
    html`<div class="tree-scroll ${isStacked ? "stacked" : ""}" tabindex="0" role="region" aria-label="Bracket">${stage}</div>
      ${!fits && renderRoundDots(ROUND_ORDER)}`,
  );
  const scroller = /** @type {HTMLElement} */ (wrap.querySelector(".tree-scroll"));
  const openingRound = findOpeningRoundCode(bracket);
  const target = /** @type {HTMLElement} */ (
    scroller.querySelector(`.box[data-round="${openingRound}"]`)
  );
  placeBracket ??= watchOpeningRound(wrap);
  placeBracket({
    scroller,
    target,
    round: ROUND_ORDER.indexOf(openingRound),
    keptLeft: scrollLeft,
  });
  if (hadFocus) scroller.focus({ preventScroll: true });
  markRoundScrolledTo();
  renderedGrowth = growth;
  renderedFits = fits;
}

/* Redraws when the whole wide bracket starts or stops fitting, and while stacked when the spaces'
   share of the screen changes or the stacked bracket starts or stops fitting its width: the screen
   resizes, the bracket tab shows, or content above the bracket grows or shrinks. */
export function watchBracketSpace() {
  const wrap = document.getElementById("bracketWrap");
  const redrawIfResized = () => {
    if (!isNarrow() || !renderedGrowth || !isShown(wrap)) return;
    if (measureGrowth(wrap) !== renderedGrowth || measureFit(wrap) !== renderedFits)
      renderBracket();
  };
  matchMedia(NARROW_QUERY).addEventListener("change", renderBracket);
  addEventListener("resize", redrawIfResized);
  wrap.addEventListener("scroll", markRoundScrolledTo, { capture: true, passive: true });
  new ResizeObserver(markRoundScrolledTo).observe(wrap);
  // A redraw resizes the body, so it waits a frame rather than loop the observer, and only while
  // the bracket shows.
  new ResizeObserver(() => {
    if (isShown(wrap)) requestAnimationFrame(redrawIfResized);
  }).observe(document.body);
}
