import { nameSeries } from "./bracket.js";
import { html, joinItems, joinNames } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import {
  describeSeriesGame,
  describeSeriesStanding,
  describeSeriesWin,
  renderSeriesWins,
} from "#shared/series-text.js";
import { nameTeam, TEAMS } from "./teams.js";
import { describeGame, findCommonGames, isResult, listResults } from "./update-groups.js";

// The sentence for an update. The page shows each club as a chip and a notification as its
// name, so the caller says how to show one; `teams` and `standings` fill in a spot the entry
// doesn't name.

const BERTHS = {
  bye: "a first-round bye",
  wildcard: "a wild card spot",
  playoff: "a playoff spot",
};

const findLeague = (id) => (TEAMS[id] ? TEAMS[id].league : "");

const isPair = (value) => Array.isArray(value) && value.length === 2;
const renderSeriesScore = (score) => renderSeriesWins(score[0], score[1]);
function formatGameScore(score) {
  return isPair(score) ? `${score[0]}-${score[1]}` : "";
}

// `via` entries are { team, won, opp, score: [own, opp] }, own score first even in a loss.
function describeResult(result) {
  const opponent = nameTeam(result.opp);
  return result.won
    ? `beat the ${opponent} ${formatGameScore(result.score)}`
    : `lost to the ${opponent} ${formatGameScore([result.score[1], result.score[0]])}`;
}

function describeVia(entry, mover, other) {
  const results = Array.isArray(entry.via) ? entry.via : [];
  const own = results.find((result) => result && result.team === mover);
  const theirs = results.find((result) => result && result.team === other);
  if (own && own.won && own.opp === other) return `beat them ${formatGameScore(own.score)}`;
  const parts = [];
  if (own && TEAMS[own.opp]) parts.push(describeResult(own));
  if (theirs && TEAMS[theirs.opp] && TEAMS[other])
    parts.push(`${nameTeam(other)} ${describeResult(theirs)}`);
  return joinNames(parts, "and");
}

function appendVia(sentence, entry, mover, other, also = "") {
  const tail = [describeVia(entry, mover, other), also].filter(Boolean).join(", ");
  return tail ? html`${sentence} &mdash; ${tail}` : sentence;
}

function findDivision(id, standings) {
  const divisions = standings && standings.divisions;
  if (!divisions) return "";
  return (
    Object.keys(divisions).find((division) => divisions[division].some((row) => row.id === id)) ||
    ""
  );
}

function describeSpot(entry, context) {
  const league = findLeague(entry.in);
  let spot = entry.spot;
  let division = entry.div;
  if (!spot) {
    const seed = context.teams?.[entry.in]?.seed;
    if (!seed) return `the last ${league} spot`;
    spot = seed <= 3 ? "division" : "wildcard";
    division = division || findDivision(entry.in, context.standings);
  }
  // "an AL", "an NL": both are said letter by letter.
  if (spot === "division") return division ? `the ${division} lead` : `an ${league} division lead`;
  return `an ${league} wild card spot`;
}

function describeGamesBack(value) {
  const games = parseFloat(value);
  if (isNaN(games) || games <= 0) return "even, behind on the tiebreaker";
  const whole = Math.floor(games);
  const hasHalf = games - whole >= 0.5;
  const count = (whole ? String(whole) : "") + (hasHalf ? "\u00bd" : "");
  return `${count} game${games > 1 ? "s" : ""} back`;
}

function describeOutBack(entry) {
  if (entry.outAlive === false || entry.outBack == null) return "";
  return `${nameTeam(entry.out)} ${describeGamesBack(entry.outBack)}`;
}

function describeFieldEntry(entry, context) {
  const { renderClub } = context;
  if (entry.in && entry.out) {
    const sentence = html`${renderClub(entry.in)} take ${describeSpot(entry, context)} from the ${renderClub(entry.out)}`;
    return appendVia(sentence, entry, entry.in, entry.out, describeOutBack(entry));
  }
  if (entry.in) return html`${renderClub(entry.in)} into the projected field`;
  if (entry.out) return html`${renderClub(entry.out)} out of the projected field`;
  return null;
}

function describeSeedEntry(entry, { renderClub }) {
  const where = `the ${findLeague(entry.team)} ${entry.to} seed`;
  if (entry.over) {
    const sentence = html`${renderClub(entry.team)} passed the ${renderClub(entry.over)} for ${where}`;
    return appendVia(sentence, entry, entry.team, entry.over);
  }
  const sentence = html`${renderClub(entry.team)} up to ${where}, from ${entry.from}`;
  return appendVia(sentence, entry, entry.team, null);
}

// Updates saved before games kept their score say only who took the game.
function describeSavedGameEntry(entry, { renderClub }) {
  const game = entry.game ? html`Game&nbsp;${entry.game}` : "a game";
  const series = nameSeries(entry.series);
  const tail = isPair(entry.score)
    ? html`, ${describeSeriesStanding(entry.score[0], entry.score[1])} the ${series} ${renderSeriesScore(entry.score)}`
    : ` of the ${series}`;
  const result =
    entry.lost && isPair(entry.runs)
      ? html`beat the ${renderClub(entry.lost)} ${formatGameScore(entry.runs)} in ${game}`
      : html`took ${game}`;
  return html`${renderClub(entry.won)} ${result}${tail}`;
}

function describeGameEntry(entry, context) {
  const { renderClub } = context;
  const isScored = entry.game && entry.lost && isPair(entry.runs) && isPair(entry.score);
  if (!isScored) return describeSavedGameEntry(entry, context);
  return describeSeriesGame({
    result: html`${renderClub(entry.won)} beat the ${renderClub(entry.lost)} ${formatGameScore(entry.runs)}`,
    number: entry.game,
    series: nameSeries(entry.series),
    own: entry.score[0],
    theirs: entry.score[1],
  });
}

function describeClinchEntry(entry, { renderClub }) {
  const series = nameSeries(entry.series);
  if (entry.over && isPair(entry.runs) && isPair(entry.score))
    return describeSeriesWin({
      result: html`${renderClub(entry.team)} beat the ${renderClub(entry.over)} ${formatGameScore(entry.runs)}`,
      series,
      own: entry.score[0],
      theirs: entry.score[1],
    });
  const over = entry.over && html` over the ${renderClub(entry.over)}`;
  const score = isPair(entry.score) && html`, ${renderSeriesScore(entry.score)}`;
  return html`${renderClub(entry.team)} win the ${series}${score}${over}`;
}

// A win of its own that day doesn't save a club, and saying so heads off the question.
function describeEliminationEntry(entry, { renderClub }) {
  const chaser = listResults(entry).find((result) => result.team !== entry.team);
  const via = describeVia(entry, entry.team, chaser ? chaser.team : null);
  const sentence = html`${renderClub(entry.team)} eliminated`;
  if (!via) return sentence;
  const despite = isResult(entry.despite) ? `${describeResult(entry.despite)}, but ` : "";
  return html`${sentence} &mdash; ${despite}${via}`;
}

function describeBerthHeadline(entry, { renderClub }) {
  const berth =
    entry.what === "division"
      ? `the ${entry.div || `${findLeague(entry.team)} division`}`
      : BERTHS[entry.what] || BERTHS.playoff;
  return html`${renderClub(entry.team)} clinch ${berth}`;
}

// A division clinch can name the rivals' losses beside the club's own win.
function describeBerthEntry(entry, context) {
  const results = listResults(entry).map((result) =>
    result.team === entry.team
      ? describeResult(result)
      : `${nameTeam(result.team)} ${describeResult(result)}`,
  );
  const headline = describeBerthHeadline(entry, context);
  return results.length ? html`${headline} &mdash; ${results.join(", ")}` : headline;
}

const DESCRIBE_ENTRY = {
  field: describeFieldEntry,
  seed: describeSeedEntry,
  game: describeGameEntry,
  clinch: describeClinchEntry,
  elim: describeEliminationEntry,
  berth: describeBerthEntry,
  lock: () => html`The official bracket is set`,
};

/**
 * Markup for an entry, or null for one there is nothing to say about.
 * @param {Record<string, any>} entry
 * @param {{ renderClub: (id: string) => unknown, teams?: object, standings?: object }} context
 */
export function describeEntry(entry, context) {
  const describe = DESCRIBE_ENTRY[entry.kind];
  return describe ? describe(entry, context) : null;
}

const joinMarkup = (items, separator) =>
  items.flatMap((item, index) => (index ? [separator, item] : [item]));

const formatWinnerFirst = (score) => formatGameScore([Math.max(...score), Math.min(...score)]);

// "an 8-7 loss", "an 11-2 loss": the article goes by how the score is said.
function chooseArticle(score) {
  const first = Math.max(...score);
  return String(first).startsWith("8") || first === 11 || first === 18 ? "an" : "a";
}

const describeLoss = (result) =>
  `${formatWinnerFirst(result.score)} loss to the ${nameTeam(result.opp)}`;

const findOwnLoss = (entry) =>
  listResults(entry).find((result) => result.team === entry.team && !result.won);

const listOtherWins = (entry) =>
  listResults(entry).filter((result) => result.team !== entry.team && result.won);

function describeDespite(entry) {
  if (!isResult(entry.despite)) return "";
  const { score, opp } = entry.despite;
  return ` despite their ${formatWinnerFirst(score)} win over the ${nameTeam(opp)}`;
}

const isFinitePair = (entry) => Number.isFinite(entry.most) && Number.isFinite(entry.target);

// Win totals explain a win that put out more than one club, so they show only then, and only
// when every club's numbers are against the winner's.
function readWinTarget(eliminations, win) {
  if (eliminations.length < 2) return null;
  const { target } = eliminations[0];
  const isAgainstWinner = (entry) =>
    isFinitePair(entry) &&
    entry.target === target &&
    entry.most <= target &&
    listOtherWins(entry).some((result) => result.team === win.team);
  return eliminations.every(isAgainstWinner) ? target : null;
}

const describeTiebreaker = (entry) => (entry.most === entry.target ? ", loses the tiebreaker" : "");

const isCreditedTo = (entry, win) =>
  entry.decider !== entry.team &&
  listResults(entry).some((result) => describeGame(result) === describeGame(win));

// The win comes first, so how an eliminated club's own day went is told after it: a loss
// that counted before the win, or one taken in with it.
function describeOwnDay(entry, win) {
  const loss = findOwnLoss(entry);
  if (!loss || describeGame(loss) === describeGame(win)) return describeDespite(entry);
  if (entry.decider === win.team) return ` after their ${describeLoss(loss)}`;
  const score = formatWinnerFirst(loss.score);
  return `, who also lost ${score} to the ${nameTeam(loss.opp)}`;
}

function describeCredited(entry, index, win, target, { renderClub }) {
  const name = entry.team === win.opp ? "them" : html`the ${renderClub(entry.team)}`;
  const wins = index === 0 ? " wins" : "";
  const most = target ? ` (${entry.most}${wins} at most${describeTiebreaker(entry)})` : "";
  return html`${name}${most}${describeOwnDay(entry, win)}`;
}

function describeWinningPart(win, credited, context) {
  const opponent = credited.some((entry) => entry.team === win.opp)
    ? context.renderClub(win.opp)
    : nameTeam(win.opp);
  const target = readWinTarget(credited, win);
  const total = target ? ` for their ${formatOrdinal(target)} win` : "";
  const beat = html`beat the ${opponent} ${formatGameScore(win.score)}${total}`;
  if (!credited.length) return beat;
  const phrases = credited.map((entry, index) =>
    describeCredited(entry, index, win, target, context),
  );
  return html`${beat}, eliminating ${joinItems(phrases, "and")}`;
}

// An elimination the lead club's win didn't decide keeps its club first.
function describeUncredited(entry, win, { renderClub }) {
  const loss = findOwnLoss(entry);
  const stated = win ? describeGame(win) : null;
  const wins = listOtherWins(entry).filter((result) => describeGame(result) !== stated);
  const withLoss = loss ? ` with ${chooseArticle(loss.score)} ${describeLoss(loss)}` : "";
  const byWins = wins.map(
    (result) =>
      `the ${nameTeam(result.team)}' ${formatWinnerFirst(result.score)} win over the ${nameTeam(result.opp)}`,
  );
  const by = byWins.length ? `${loss ? " and" : " by"} ${joinNames(byWins, "and")}` : "";
  return html`${renderClub(entry.team)} eliminated${withLoss}${by}${describeDespite(entry)}`;
}

const listCredited = (eliminations, win) =>
  eliminations
    .filter((entry) => isCreditedTo(entry, win))
    .sort((first, second) => Number(second.team === win.opp) - Number(first.team === win.opp));

function describeClinchGroup(berth, eliminations, context) {
  const results = listResults(berth);
  const win = results.find((result) => result.team === berth.team && result.won);
  const credited = win ? listCredited(eliminations, win) : [];
  const eliminated = new Set(eliminations.map((entry) => entry.team));
  const rivalLosses = results
    .filter((result) => result.team !== berth.team && !eliminated.has(result.team))
    .map((result) => `${nameTeam(result.team)} ${describeResult(result)}`);
  const uncredited = eliminations
    .filter((entry) => !credited.includes(entry))
    .map((entry) => describeUncredited(entry, win, context));
  const parts = [win && describeWinningPart(win, credited, context), ...rivalLosses, ...uncredited];
  const reason = joinMarkup(parts.filter(Boolean), ", ");
  return html`${describeBerthHeadline(berth, context)} &mdash; ${reason}`;
}

const describeRacePlace = (race) =>
  race === "wildcard" ? ", in the last wild card spot" : `, atop the ${race}`;

function describeTotals(eliminations, win) {
  const target = readWinTarget(eliminations, win);
  if (!target) return "";
  const races = new Set(eliminations.map((entry) => entry.race));
  const [race] = races;
  const place = races.size === 1 && typeof race === "string" ? describeRacePlace(race) : "";
  const reaches = eliminations.map((entry, index) => {
    const tiebreaker = entry.most === entry.target ? " and lose the tiebreaker" : "";
    const most = index === 0 ? `can reach ${entry.most} wins at most` : entry.most;
    return `${nameTeam(entry.team)} ${most}${tiebreaker}`;
  });
  return `for their ${formatOrdinal(target)} win${place}; ${reaches.join(", ")}`;
}

const convertToWinnerSide = (result) =>
  result.won
    ? result
    : { team: result.opp, won: true, opp: result.team, score: [result.score[1], result.score[0]] };

// With no clinch, the eliminated clubs lead, the one that played the game first.
function describeEliminationGroup(eliminations, context) {
  const [game] = findCommonGames(eliminations);
  const shared = eliminations
    .flatMap((entry) => listResults(entry))
    .find((result) => describeGame(result) === game);
  if (!shared) return describeEntry(eliminations[0], context);
  const win = convertToWinnerSide(shared);
  const ordered = [...eliminations].sort(
    (first, second) => Number(second.team === win.opp) - Number(first.team === win.opp),
  );
  const clubs = joinItems(
    ordered.map((entry) => context.renderClub(entry.team)),
    "and",
  );
  const beat = `${nameTeam(win.team)} beat the ${nameTeam(win.opp)} ${formatGameScore(win.score)}`;
  const totals = describeTotals(ordered, win);
  return html`${clubs} eliminated &mdash; ${beat}${totals && ` ${totals}`}`;
}

/**
 * Markup for a group from update-groups.js: one entry, or a lead with the eliminations it
 * brought.
 * @param {Record<string, any>[]} entries
 * @param {{ renderClub: (id: string) => unknown, teams?: object, standings?: object }} context
 */
export function describeUpdate(entries, context) {
  const [lead, ...eliminations] = entries;
  if (!eliminations.length) return describeEntry(lead, context);
  if (lead.kind === "berth") return describeClinchGroup(lead, eliminations, context);
  return describeEliminationGroup(entries, context);
}
