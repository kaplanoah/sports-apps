// A player's sheet, which a tap on her name opens wherever it shows: her name and team, her facts,
// then, while she is out and her team still plays, a box saying why, then her last game beside her
// season's averages, her playoff games with her points in each, and where her regular season's
// averages rank in the WNBA, each on a small curve of how every ranked player's numbers spread.

import { describeDay, formatShortDate, readCalendarDate } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderRankRow } from "#shared/rank-curve.js";
import { renderRetryBlock } from "#shared/retry.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTeamDetail } from "#shared/team-sheet.js";
import { renderDot, renderTeamName } from "./clubs.js";
import { formatMarkColors } from "./sheet-colors.js";
import { renderSheetMessage } from "./sheet-parts.js";
import { readTeamPlayoffs, renderChip, renderFinishedGame, renderNextGame } from "./team-view.js";

/** @typedef {import("#shared/html.js").Markup} Markup */
/** @typedef {import("./roster-view.js").RosterPlayer} RosterPlayer */
/** @typedef {import("./roster-view.js").OutReason} OutReason */
/** @typedef {import("./team-view.js").Season} Season */
/**
 * @typedef {object} PlayerGame
 * @property {string} gameId
 * @property {string} day the league's day, as 2026-10-04
 * @property {boolean} isPlayoffs
 * @property {boolean} isWin
 * @property {number | null} teamScore
 * @property {number | null} opponentScore
 * @property {number} points
 * @property {number} rebounds
 * @property {number} assists
 * @property {number} minutes
 * @property {number} steals
 * @property {number} blocks
 * @property {number} [turnovers] missing from a game the store saved before it kept them
 * @property {number} fieldGoalsMade
 * @property {number} fieldGoalsAttempted
 * @property {number} threesMade
 * @property {number} threesAttempted
 * @property {number} freeThrowsMade
 * @property {number} freeThrowsAttempted
 */
/** @typedef {{ key: string, value: number | null, rank: number | null, count: number, values: number[] }} RankedStat */
/**
 * @typedef {object} RegularSeason
 * @property {number} games
 * @property {number} gamesNeeded how many games the WNBA's rule for its leaders asks for so far
 * @property {{ points: number, rebounds: number, assists: number, minutes: number }} averages
 * @property {RankedStat[]} stats
 */
/**
 * @typedef {object} Player
 * @property {string} id
 * @property {string} team
 * @property {number} season
 * @property {string} firstName
 * @property {string} lastName
 * @property {RosterPlayer | null} facts
 * @property {PlayerGame | null} lastGame
 * @property {Record<string, number>} playoffPoints her points in each playoff game she played
 * @property {RegularSeason | null} regularSeason
 */
/** @typedef {{ id: string, team: string, name: string }} PlayerSubject */

const POSITION_WORDS = { G: "Guard", F: "Forward", C: "Center" };

// A shooting percentage is a share, of the shots `shots` names. Turnovers rank from the fewest,
// so their curve runs from the most to the fewest, and her mark sits further right the better she
// ranks, as on every other row.
/** @type {{ key: string, label: string, isShare?: boolean, shots?: string, isFewestFirst?: boolean }[]} */
const RANKED_STATS = [
  { key: "points", label: "Pts" },
  { key: "rebounds", label: "Reb" },
  { key: "assists", label: "Ast" },
  { key: "steals", label: "Stl" },
  { key: "blocks", label: "Blk" },
  { key: "turnovers", label: "TO", isFewestFirst: true },
  { key: "fieldGoalShare", label: "FG%", isShare: true, shots: "field goals" },
  { key: "threeShare", label: "3P%", isShare: true, shots: "3-pointers" },
  { key: "freeThrowShare", label: "FT%", isShare: true, shots: "free throws" },
];

const OUT_CHIP = html`<span class="foul-chip"><span class="foul-chip-words">Out</span></span>`;
// Who wrote the sentence ESPN carries on a player who is out.
const OUT_SOURCE = "RotoWire";
const REST_OF_SEASON = "Rest of season";

/**
 * A position as the league writes it, like G-F, in words.
 * @param {string | null} position
 */
export const describePosition = (position) =>
  position &&
  position
    .split("-")
    .map((letter) => POSITION_WORDS[/** @type {"G" | "F" | "C"} */ (letter)] ?? letter)
    .join("-");

/** @param {number} value */
const formatAverage = (value) => value.toFixed(1);

/** @param {number | null} value */
function formatStat(value, isShare = false) {
  if (value == null) return "-";
  return isShare ? (value * 100).toFixed(1) : value.toFixed(1);
}

/**
 * Her dot and name.
 * @param {PlayerSubject} subject
 * @param {Player | null} player
 */
export const renderPlayerHeading = (subject, player) =>
  html`${renderDot(subject.team)}<span>${player ? `${player.firstName} ${player.lastName}` : subject.name}</span>`;

/**
 * Her team, her number, and her college, or her country for a player who skipped college, or just
 * her team until her facts load.
 * @param {PlayerSubject} subject
 * @param {Player | null} player
 */
export function describePlayerNote(subject, player) {
  const facts = player?.facts;
  return joinWithSeparator(
    [
      renderTeamName(subject.team),
      facts?.number && `#${facts.number}`,
      facts && (facts.college ?? facts.country),
    ].filter(Boolean),
  );
}

/**
 * Her position, height, age, and first season, each under its label, leaving out any the league
 * doesn't have.
 * @param {Player | null} player
 * @param {boolean} isLoading
 */
export function renderPlayerFacts(player, isLoading) {
  if (!player)
    return (
      isLoading &&
      html`<div class="player-facts">${renderPlaceholder("Position 0'0\" 00 0000")}</div>`
    );
  const facts = player.facts;
  /** @type {[string, string | number | null | undefined][]} */
  const cells = [
    ["Position", describePosition(facts?.position ?? null)],
    ["Height", facts?.height],
    ["Age", facts?.age],
    ["Debut", facts?.debut],
  ];
  const shown = cells.filter(([, value]) => value != null);
  return (
    shown.length > 0 &&
    html`<dl class="player-facts">
      ${shown.map(
        ([label, value]) =>
          html`<div class="player-fact"><dt>${label}</dt><dd class="tabular">${value}</dd></div>`,
      )}
    </dl>`
  );
}

/**
 * Why she is out, and Rest of season after an en dash when it's for the season.
 * @param {OutReason} out
 */
function renderOutWords({ reason, isForSeason }) {
  const words = [reason, isForSeason && REST_OF_SEASON].filter(Boolean);
  return html`${words.map((word, index) => html`${index > 0 && html`<span class="out-dash">\u2013</span>`}${word}`)}`;
}

/**
 * Her Out chip and why she is out, then RotoWire's sentence on it, with the day ESPN last changed
 * it, when it says more.
 * @param {OutReason} out
 */
const renderOutBox = (out) =>
  html`<section class="out-box">
    <p class="out-line">${OUT_CHIP}<span class="out-words">${renderOutWords(out)}</span></p>
    ${
      out.sentence &&
      html`<p class="out-sentence" data-quoted>${out.sentence}</p>
      <p class="out-source">${joinWithSeparator(
        [OUT_SOURCE, out.updated && formatShortDate(new Date(out.updated))].filter(Boolean),
      )}</p>`
    }
  </section>`;

/**
 * How her last game ended: its day and the score, or just whether her team won while the league's
 * log of the score is behind.
 * @param {PlayerGame} game
 * @param {number} now
 */
function describeLastGame(game, now) {
  const result = game.isWin ? "W" : "L";
  const score =
    game.teamScore == null || game.opponentScore == null
      ? result
      : `${result} ${game.teamScore}-${game.opponentScore}`;
  return joinWithSeparator([
    describeDay(readCalendarDate(game.day), now),
    html`<span class="tabular">${score}</span>`,
  ]);
}

/**
 * A count over its unit, as 12-23 FG.
 * @param {string | number} count
 * @param {string} unit
 */
const renderCount = (count, unit) =>
  html`<span class="player-count tabular">${count}</span> ${unit}`;

/**
 * Her points, rebounds, assists, and minutes in her last game, and her season's averages under
 * them, then how she shot, what she took away, and what she gave away.
 * @param {Player} player
 * @param {number} now
 */
function renderLastGame({ lastGame: game, regularSeason }, now) {
  if (!game) return false;
  const averages = regularSeason?.averages;
  const cells = [
    { label: "Pts", title: "Points", game: game.points, average: averages?.points },
    { label: "Reb", title: "Rebounds", game: game.rebounds, average: averages?.rebounds },
    { label: "Ast", title: "Assists", game: game.assists, average: averages?.assists },
    {
      label: "Min",
      title: "Minutes",
      game: formatAverage(game.minutes),
      average: averages?.minutes,
    },
  ];
  const table = html`<table class="player-game tabular">
    <thead>
      <tr>
        ${cells.map((cell) => html`<th scope="col" title="${cell.title}">${cell.label}</th>`)}
      </tr>
    </thead>
    <tbody>
      <tr class="player-game-line">
        ${cells.map((cell) => html`<td>${cell.game}</td>`)}
      </tr>
      ${
        averages &&
        html`<tr class="player-average">
        ${cells.map(
          (cell, index) =>
            html`<td>${index === 0 && html`<span class="player-average-label">Avg</span>`}${formatAverage(cell.average ?? 0)}</td>`,
        )}
      </tr>`
      }
    </tbody>
  </table>`;
  const shooting = joinWithSeparator([
    renderCount(`${game.fieldGoalsMade}-${game.fieldGoalsAttempted}`, "FG"),
    renderCount(`${game.threesMade}-${game.threesAttempted}`, "3PT"),
    renderCount(`${game.freeThrowsMade}-${game.freeThrowsAttempted}`, "FT"),
  ]);
  const defense = joinWithSeparator([
    renderCount(game.steals, "STL"),
    renderCount(game.blocks, "BLK"),
  ]);
  const turnovers =
    game.turnovers != null &&
    renderTeamDetail(
      "Turnovers",
      html`<span class="player-count tabular">${game.turnovers}</span>`,
    );
  return renderSheetPart(
    "Last game",
    html`<div class="player-last-game">
      ${table}
      <div class="player-lines">
        ${renderTeamDetail("Shooting", shooting)}${renderTeamDetail("Defense", defense)}${turnovers}
      </div>
    </div>`,
    describeLastGame(game, now),
  );
}

/**
 * Her points in a playoff game, or DNP for one she didn't play.
 * @param {number | undefined} points
 */
const renderPoints = (points) =>
  points == null
    ? html`<span class="player-points player-dnp">DNP</span>`
    : html`<span class="player-points tabular">${points}<small>Pts</small></span>`;

/**
 * Her team's playoff games with her points in each, and its next while it still plays, under the
 * chip that says how far it has got.
 * @param {Player} player
 * @param {Season | null} season
 * @param {number} now
 */
function renderPlayoffs(player, season, now) {
  const { games, isPlaying, chip, run } = readTeamPlayoffs(season, player.team);
  const next = isPlaying && games.next;
  if (!run || (!games.finished.length && !next)) return false;
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-playoffs">
      ${games.finished.map((game) =>
        renderFinishedGame(game, player.team, () => renderPoints(player.playoffPoints[game.id])),
      )}
      ${next && renderNextGame(next, player.team, now)}
    </div>`,
    renderChip(chip),
  );
}

/**
 * The shooting percentages she has no rank in, in the sheet's order.
 * @param {RegularSeason} season
 */
const listUnrankedShares = (season) =>
  RANKED_STATS.filter(
    ({ key, isShare }) =>
      isShare && season.stats.some((stat) => stat.key === key && stat.rank == null),
  );

/**
 * Words joined as either one, as "3-pointers or free throws".
 * @param {string[]} words
 */
const listEither = (words) => new Intl.ListFormat("en", { type: "disjunction" }).format(words);

/**
 * Why a stat may have no rank, or why the number ranked varies by stat.
 * @param {RegularSeason} season
 * @param {boolean} isPastSeason
 */
export function describeRankNote(season, isPastSeason) {
  if (season.stats.every((stat) => stat.rank != null))
    return `The number of ranked players varies by stat because the WNBA only ranks players who've played ${season.gamesNeeded} games or, for shooting percentages, made a certain number of shots`;
  if (season.games < season.gamesNeeded)
    return `The WNBA only ranks players who've played ${season.gamesNeeded} games or, for shooting percentages, made a certain number of shots. She's played ${season.games} ${season.games === 1 ? "game" : "games"}.`;
  const unranked = listUnrankedShares(season);
  const shots = listEither(unranked.map((stat) => stat.shots ?? ""));
  const shares = listEither(unranked.map((stat) => stat.label));
  const shortfall = isPastSeason
    ? `She didn't make enough ${shots} to be ranked in ${shares}.`
    : `She hasn't made enough ${shots} to be ranked in ${shares}.`;
  return `${shortfall} The WNBA only ranks shooting percentages for players who've made a certain number of shots.`;
}

/**
 * @param {string} team
 * @param {RegularSeason} season
 * @param {boolean} isPastSeason
 */
function renderRegularSeason(team, season, isPastSeason) {
  const shown = RANKED_STATS.filter(({ key }) => season.stats.some((each) => each.key === key));
  const rows = shown.map(({ key, label, isShare, isFewestFirst }) => {
    const stat = /** @type {RankedStat} */ (season.stats.find((each) => each.key === key));
    return renderRankRow({ label, shown: formatStat(stat.value, isShare), stat, isFewestFirst });
  });
  const isRankedInTurnovers = season.stats.some(
    (stat) => stat.key === "turnovers" && stat.rank != null,
  );
  return renderSheetPart(
    "Regular season",
    html`<div class="player-ranks" style="${formatMarkColors(team)}">
      ${rows}
      <div class="player-rank-notes">
        ${isRankedInTurnovers && html`<p class="player-rank-note">Turnovers ranked by fewest</p>`}
        <p class="player-rank-note">${describeRankNote(season, isPastSeason)}</p>
      </div>
    </div>`,
    `${season.games} ${season.games === 1 ? "game" : "games"}`,
  );
}

const renderPending = () =>
  renderSheetPart(
    "Last game",
    html`<div class="player-last-game">${renderPlaceholder("Pts Reb Ast Min")}${renderPlaceholder("00 0 0 00.0")}${renderPlaceholder("Avg 00.0 0.0 0.0 00.0")}</div>`,
  );

/**
 * The sheet's parts under her name, or stand-ins while they load, or why they didn't.
 * @param {{ player: Player | null, isLoading: boolean, failure?: import("#shared/retry.js").ReadFailure | null, season: Season | null, isPastSeason: boolean, showsOut: boolean, now: number }} shown
 *   `showsOut` says whether she shows as out, as she does only while her team still plays
 */
export function renderPlayerBody({
  player,
  isLoading,
  failure,
  season,
  isPastSeason,
  showsOut,
  now,
}) {
  if (!player && isLoading) return renderPending();
  if (!player) return renderRetryBlock("her numbers", failure ?? "unreachable");
  const hasPlayed = !!(player.lastGame || player.regularSeason);
  const noGames = isPastSeason ? "No games this season" : "No games yet this season";
  const out = showsOut && player.facts?.out;
  return html`${out && renderOutBox(out)}
  ${hasPlayed ? renderLastGame(player, now) : renderSheetMessage(noGames)}
  ${renderPlayoffs(player, season, now)}
  ${player.regularSeason && renderRegularSeason(player.team, player.regularSeason, isPastSeason)}`;
}
