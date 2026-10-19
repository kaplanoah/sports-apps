import { html } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import {
  describeFinishedDay,
  describeSlate,
  isFullSlate,
  isWholeSlate,
  renderStampNow,
  renderStampTime,
} from "#shared/stamp.js";
import { nameSeries } from "./bracket.js";
import { TEAMS } from "./teams.js";

export function formatStampName(id) {
  return TEAMS[id] ? TEAMS[id].name : String(id ?? "");
}
/**
 * Where a playoff series stands after a final of it, as the header's line says it, or nothing for
 * a game of no series.
 * @param {{ id: string, teamA: string, teamB: string, winsA: number, winsB: number, winner?: string | null } | null} series
 */
export function describeSeriesNote(series) {
  if (!series) return "";
  const high = Math.max(series.winsA, series.winsB);
  const low = Math.min(series.winsA, series.winsB);
  const leader = series.winsA > series.winsB ? series.teamA : series.teamB;
  if (series.winner)
    return ` \u2014 ${formatStampName(series.winner)} win the ${nameSeries(series.id)} ${high}-${low}`;
  if (high === low) return ` \u2014 series even ${high}-${low}`;
  return ` \u2014 ${formatStampName(leader)} now lead ${high}-${low}`;
}

function describeFinal(game, day) {
  const [awayScore, homeScore] = game.score || [0, 0];
  const [winner, winnerScore, loser, loserScore] =
    awayScore > homeScore
      ? [game.away, awayScore, game.home, homeScore]
      : [game.home, homeScore, game.away, awayScore];
  const score = `${formatStampName(winner)} ${winnerScore} ${formatStampName(loser)} ${loserScore}`;
  return html`${score} final at ${renderStampTime(new Date(game.end), day)}`;
}
function describeLive(game) {
  const [awayScore, homeScore] = game.score || [0, 0];
  return `${formatStampName(game.away)} @ ${formatStampName(game.home)} ${awayScore}-${homeScore} in the ${formatOrdinal(game.inning || 1)}`;
}
function describeFirstPitch(game) {
  const matchup = `${formatStampName(game.away)} @ ${formatStampName(game.home)}`;
  return html`${matchup} first pitch at ${renderStampTime(new Date(game.start))}`;
}
function describeGame(game) {
  if (game.state === "final") return describeFinal(game);
  if (game.state === "live") return describeLive(game);
  return describeFirstPitch(game);
}

function describeDaySlate(games) {
  if (!isFullSlate(games.length)) return "";
  return describeSlate(games.length, isWholeSlate(games, "final") ? "over" : "under way");
}
const joinClause = (phrase, clause) => (clause ? html`${phrase}, ${clause}` : phrase);

function rankGame(game, context) {
  const ranks = [game.away, game.home]
    .map((id) => context.ranking.indexOf(id))
    .filter((index) => index >= 0);
  return ranks.length ? Math.min(...ranks) : Infinity;
}
const rankAlive = (game, context) => (context.alive(game.away) || context.alive(game.home) ? 0 : 1);
const parseTime = (iso) => Date.parse(iso);

function pickGame(games, context, order) {
  const sortKeys = {
    latestEnd: (game) => -parseTime(game.end),
    earliest: (game) => parseTime(game.start),
    latestStart: (game) => -parseTime(game.start),
    rank: (game) => rankGame(game, context),
    alive: (game) => rankAlive(game, context),
  };
  return games.slice().sort((first, second) => {
    for (const key of order) {
      const difference = sortKeys[key](first) - sortKeys[key](second);
      if (difference) return difference;
    }
    return 0;
  })[0];
}
const PICK_ENDED = ["latestEnd", "rank", "alive"];
const PICK_UNDER_WAY = ["rank", "alive", "latestStart"];
const PICK_STARTS = ["earliest", "rank", "alive"];

const describeFinalDay = (final, now) =>
  describeFinishedDay(new Date(final.end), new Date(final.start || final.end), now);

function describeLastFinal(lastFinal, now) {
  if (!lastFinal || !lastFinal.end) return "";
  return html`Last game ${describeFinal(lastFinal, describeFinalDay(lastFinal, now))}`;
}

// With three or more games, one leads the line: a fresh final, else a live game, else the latest final.
function pickLeadGame(slate, started, context) {
  const since = slate.since ? parseTime(slate.since) : -Infinity;
  const finals = started.filter((game) => game.state === "final");
  const fresh = finals.filter((game) => parseTime(game.end) > since);
  const live = started.filter((game) => game.state === "live");
  if (fresh.length) return pickGame(fresh, context, PICK_ENDED);
  if (live.length) return pickGame(live, context, PICK_UNDER_WAY);
  return pickGame(finals, context, PICK_ENDED);
}

const isLive = (game) => game.state === "live";
const markLive = (line, isOn) => (isOn ? html`${renderStampNow()} ${line}` : line);

// On a day of one or two games, each game under way is named, or once none is, each final.
function describeFewGames(started, describeWithNote) {
  const live = started.filter(isLive);
  const inOrder = (live.length ? live : started)
    .slice()
    .sort((first, second) => parseTime(first.start) - parseTime(second.start));
  const line = html`${inOrder.map((game, index) => html`${index ? ", " : ""}${describeWithNote(game)}`)}`;
  return markLive(line, live.length > 0);
}

export function describeLastStamp(slate, context) {
  const games = (slate.today && slate.today.games) || [];
  const started = games.filter((game) => game.state !== "pre");
  if (!started.length) return describeLastFinal(slate.lastFinal, context.now);
  const describeWithNote = (game) =>
    html`${describeGame(game)}${(game.state === "final" && context.seriesNote?.(game)) || ""}`;
  if (!isFullSlate(games.length)) return describeFewGames(started, describeWithNote);
  const lead = pickLeadGame(slate, started, context);
  return markLive(joinClause(describeWithNote(lead), describeDaySlate(games)), isLive(lead));
}

export function describeUpNextGame(slate, context) {
  const days = [slate.today, slate.nextDay].filter(Boolean);
  for (const day of days) {
    const games = day.games || [];
    const ahead = games.filter((game) => game.state === "pre");
    if (!ahead.length) continue;
    const game = pickGame(ahead, context, PICK_STARTS);
    const matchup = `${formatStampName(game.away)} @ ${formatStampName(game.home)}`;
    return {
      at: game.start,
      tbd: !!game.tbd,
      text: isWholeSlate(games, "pre")
        ? `${matchup}, ${describeSlate(games.length, "starts")}`
        : matchup,
    };
  }
  return null;
}
