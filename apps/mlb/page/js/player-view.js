// A player's sheet: his name over his club and number, and where he was born, his facts in a row
// in the sheet's top, then, while he's on the injured list, a box with his stay and why, then his
// postseason while he has one, then his regular season: a hitter's totals over each number MLB's
// ranked hitters are ranked in, and a starter's over each number MLB's qualified starters are, with
// what he throws, or a reliever's totals alone, each followed by his last few games. A two-way
// player shows both, his pitching under its own title.

import { formatShortDate, readCalendarDate } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { rankAmong, renderRankRow } from "#shared/rank-curve.js";
import { renderRetryBlock } from "#shared/retry.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTeamStats } from "#shared/team-sheet.js";
import { nameTeam, renderTeamDot } from "./clubs.js";
import { renderPitchMix } from "./pitch-mix.js";
import {
  describeInningsToQualify,
  describePlateAppearancesToQualify,
  measureInningsProgress,
  measurePlateAppearancesProgress,
} from "./qualifying.js";
import { formatInnings } from "./stat-table.js";

/**
 * A player as the store keeps him.
 * @typedef {{ id: number, season: number, club: string, name: string, number: string, position: string, facts: PlayerFacts | null, injury?: string | null, out?: OutReason | null, hitting: any, pitching: any, postseasonHitting: any, postseasonPitching: any, lastGames?: { hitting: any[], pitching: any[] } | null }} Player
 * @typedef {{ bats: string | null, throws: string | null, age: number | null, height: string | null, weight: number | null, debut: number | null, birthplace: string | null }} PlayerFacts
 * @typedef {{ reason: string | null, sentence: string | null, updated: string | null }} OutReason
 */
/**
 * What the sheet shows of him, and what it ranks him among: the hitters MLB ranks, and for a
 * starter, the qualified starters and his side of a pitching matchup. `isUnkept` says the store
 * keeps no sheet for him, as for a player on no club's roster. `clubGames` counts his club's games,
 * which a starter needs as many innings as to qualify.
 * @typedef {{ player: Player | null, hitters: any, starters: any, side: any, isUnkept: boolean, isLoading: boolean, failure?: import("#shared/retry.js").ReadFailure | null, clubGames?: number | null }} ShownPlayer
 */

/**
 * A hitter's ranked numbers: how the sheet labels each, writes his, and reads it from the ranked
 * hitters' list. Strikeouts rank from the fewest.
 * @type {{ label: string, key: string, write: (hitting: any) => string | number, isFewestFirst?: boolean }[]}
 */
const HITTER_RANKS = [
  { label: "AVG", key: "avg", write: (hitting) => hitting.avg },
  { label: "OBP", key: "obp", write: (hitting) => hitting.obp },
  { label: "SLG", key: "slg", write: (hitting) => hitting.slg },
  { label: "OPS", key: "ops", write: (hitting) => hitting.ops },
  { label: "HR", key: "homeRuns", write: (hitting) => hitting.homeRuns },
  { label: "RBI", key: "rbi", write: (hitting) => hitting.rbi },
  { label: "R", key: "runs", write: (hitting) => hitting.runs },
  { label: "SB", key: "stolenBases", write: (hitting) => hitting.stolenBases },
  { label: "BB%", key: "walkRate", write: (hitting) => formatShare(hitting.baseOnBalls, hitting) },
  {
    label: "K%",
    key: "strikeoutRate",
    write: (hitting) => formatShare(hitting.strikeOuts, hitting),
    isFewestFirst: true,
  },
];
/**
 * A starter's ranked numbers, as his matchup side writes them. A lower ERA and fewer walks rank
 * first.
 * @type {{ label: string, key: string, write: (value: number) => string, isFewestFirst?: boolean }[]}
 */
const STARTER_RANKS = [
  { label: "ERA", key: "era", write: (value) => value.toFixed(2), isFewestFirst: true },
  { label: "K/9", key: "k9", write: (value) => value.toFixed(1) },
  { label: "BB/9", key: "bb9", write: (value) => value.toFixed(1), isFewestFirst: true },
  { label: "Velo", key: "speed", write: (value) => value.toFixed(1) },
];

/**
 * A count as a share of a hitter's plate appearances, as "13.3%".
 * @param {number} count
 * @param {any} hitting
 */
function formatShare(count, hitting) {
  if (!hitting.plateAppearances) return "-";
  return `${((count / hitting.plateAppearances) * 100).toFixed(1)}%`;
}

/**
 * @param {number} count
 * @param {string} word
 */
const countWord = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

/**
 * A pitcher who has started at least half the games he has pitched in.
 * @param {any} pitching
 */
export const isStarter = (pitching) =>
  (pitching?.gamesStarted ?? 0) > 0 && pitching.gamesStarted * 2 >= pitching.gamesPlayed;

/** @param {{ club: string, name: string }} player */
export const renderPlayerHeading = (player) =>
  html`${renderTeamDot(player.club)}<span>${player.name}</span>`;

/** @param {{ club: string, number: string }} player */
export const describePlayerNote = (player) =>
  joinWithSeparator([nameTeam(player.club), player.number && `#${player.number}`].filter(Boolean));

/**
 * His facts in a row, short labels over values, leaving out any MLB hasn't listed.
 * @param {Player | null} player
 * @param {boolean} isLoading
 */
export function renderPlayerFacts(player, isLoading) {
  if (!player)
    return (
      isLoading &&
      html`<dl class="player-facts">${renderPlaceholder("Pos B/T Age Ht Wt Debut")}</dl>`
    );
  const facts = player.facts;
  const handedness = facts?.bats && facts.throws ? `${facts.bats}/${facts.throws}` : null;
  /** @type {[string, string | number | null | undefined][]} */
  const cells = [
    ["Pos", player.position],
    ["B/T", handedness],
    ["Age", facts?.age],
    ["Ht", facts?.height],
    ["Wt", facts?.weight],
    ["Debut", facts?.debut],
  ];
  const shown = cells.filter(([, value]) => value != null && value !== "");
  return html`<dl class="player-facts">
    ${shown.map(
      ([label, value]) =>
        html`<div class="player-fact"><dt>${label}</dt><dd class="tabular">${value}</dd></div>`,
    )}
  </dl>`;
}

/**
 * A row of totals, each label over its number, in the box a club's sheet shows its season in.
 * @param {[string, import("#shared/html.js").Markup | string | number][]} totals
 */
const renderTotals = (totals) => html`${renderTeamStats(totals, 5)}`;

/** @param {any} hitting */
const describeHittingLine = (hitting) =>
  joinWithSeparator([
    `${hitting.hits}-${hitting.atBats}`,
    `${hitting.avg} AVG`,
    `${hitting.runs} R`,
    `${hitting.rbi} RBI`,
    `${hitting.baseOnBalls} BB`,
    `${hitting.strikeOuts} K`,
  ]);

/** @param {any} pitching */
const describePitchingLine = (pitching) =>
  joinWithSeparator([
    `${pitching.wins}-${pitching.losses}`,
    `${formatInnings(pitching.inningsPitched)} IP`,
    `${pitching.era} ERA`,
    `${pitching.strikeOuts} K`,
    `${pitching.baseOnBalls} BB`,
  ]);

/**
 * His playoffs at the plate and on the mound, while he has them.
 * @param {Player} player
 */
function renderPostseason(player) {
  const { postseasonHitting: hitting, postseasonPitching: pitching } = player;
  if (!hitting && !pitching) return html``;
  const games = Math.max(hitting?.gamesPlayed ?? 0, pitching?.gamesPlayed ?? 0);
  return renderSheetPart(
    "Playoffs",
    html`${hitting && html`<p class="season-line tabular">${describeHittingLine(hitting)}</p>`}
    ${pitching && html`<p class="season-line tabular">${describePitchingLine(pitching)}</p>`}`,
    countWord(games, "game"),
  );
}

/**
 * @param {string[]} labels the stats ranked by fewest
 */
const renderFewestNote = (labels) =>
  labels.length > 0 &&
  html`<p class="player-rank-note">${labels.join(" and ")} ranked by fewest</p>`;

/**
 * A hitter's rates as the ranked hitters' list keeps them, from his season's line, for a hitter
 * the list doesn't hold. Only his rates: a count grows with his plate appearances, so where a
 * hitter short of them would rank in one says nothing.
 * @param {any} hitting
 * @returns {Record<string, number>}
 */
const readHitterRates = (hitting) => ({
  avg: Number(hitting.avg),
  obp: Number(hitting.obp),
  slg: Number(hitting.slg),
  ops: Number(hitting.ops),
  walkRate: hitting.plateAppearances ? hitting.baseOnBalls / hitting.plateAppearances : 0,
  strikeoutRate: hitting.plateAppearances ? hitting.strikeOuts / hitting.plateAppearances : 0,
});

/**
 * A hitter's season: his totals, then each number the ranked hitters are ranked in.
 * @param {Player} player
 * @param {any} hitters the store's ranked hitters, or null while they load
 * @param {number | null} clubGames
 */
function renderHitting(player, hitters, clubGames) {
  const { hitting } = player;
  const ranked = hitters?.hitters ?? [];
  const isRanked = ranked.some((/** @type {any} */ hitter) => hitter.id === player.id);
  const own = ranked.find((/** @type {any} */ hitter) => hitter.id === player.id);
  const numbers = own ?? readHitterRates(hitting);
  const progress = measurePlateAppearancesProgress(hitting.plateAppearances, clubGames);
  const rows = HITTER_RANKS.map(({ label, key, write, isFewestFirst }) =>
    renderRankRow({
      label,
      shown: write(hitting),
      stat: rankAmong(
        ranked.map((/** @type {any} */ hitter) => hitter[key]),
        hitters ? (numbers[key] ?? null) : null,
        { isRanked, isFewestFirst, progress },
      ),
      isFewestFirst,
    }),
  );
  const note = isRanked
    ? "Rank among qualified hitters (3.1 plate appearances per team game)"
    : describePlateAppearancesToQualify(hitting.plateAppearances, clubGames);
  return renderSheetPart(
    "Regular season",
    html`${renderTotals([
      ["H", hitting.hits],
      ["R", hitting.runs],
      ["RBI", hitting.rbi],
      ["BB", hitting.baseOnBalls],
      ["K", hitting.strikeOuts],
    ])}
      <div class="player-ranks">
        ${rows}
        <div class="player-rank-notes">
          ${isRanked && renderFewestNote(["K%"])}
          <p class="player-rank-note">${note}</p>
        </div>
      </div>`,
    `${hitting.plateAppearances} PA`,
  );
}

/**
 * A starter's ranked numbers, among the qualified starters, from his matchup side.
 * @param {Player} player
 * @param {any} starters the store's qualified starters
 * @param {any} side his matchup side
 * @param {number | null} clubGames
 */
function renderStarterRanks(player, starters, side, clubGames) {
  const pool = starters?.starters ?? [];
  const isRanked = pool.some((/** @type {any} */ starter) => starter.id === player.id);
  const progress = measureInningsProgress(player.pitching.inningsPitched, clubGames);
  const rows = STARTER_RANKS.flatMap(({ label, key, write, isFewestFirst }) => {
    const value = side?.line?.[key] == null ? null : Number(side.line[key]);
    if (value == null || Number.isNaN(value)) return [];
    const values = pool
      .map((/** @type {any} */ starter) => starter[key])
      .filter((/** @type {number | null} */ each) => each != null);
    return [
      renderRankRow({
        label,
        shown: write(value),
        stat: rankAmong(values, value, { isRanked, isFewestFirst, progress }),
        isFewestFirst,
      }),
    ];
  });
  if (!rows.length) return html``;
  const note = isRanked
    ? "Rank among qualified starters (1 inning per team game)"
    : describeInningsToQualify("He", player.pitching.inningsPitched, clubGames);
  return html`<div class="player-ranks">
    ${rows}
    <div class="player-rank-notes">
      ${isRanked && renderFewestNote(["ERA", "BB/9"])}
      <p class="player-rank-note">${note}</p>
    </div>
  </div>`;
}

/**
 * A count of something in a game line, as "2 RBI", or just "RBI" for one, or nothing for none.
 * @param {number | undefined} count
 * @param {string} label
 */
const countInLine = (count, label) => (!count ? null : count === 1 ? label : `${count} ${label}`);

/** @param {any} game a game in his log at the plate */
const describeBattingGame = (game) =>
  [
    `${game.hits}-${game.atBats}`,
    countInLine(game.doubles, "2B"),
    countInLine(game.triples, "3B"),
    countInLine(game.homeRuns, "HR"),
    countInLine(game.rbi, "RBI"),
    countInLine(game.baseOnBalls, "BB"),
  ]
    .filter(Boolean)
    .join(", ");

/** @param {any} game a game in his log on the mound */
const describePitchingGame = (game) =>
  `${formatInnings(game.inningsPitched)} IP, ${game.runs} R, ${game.strikeOuts} K`;

/**
 * His last few games, newest first, each with its day, its opponent, and his line in it, or
 * nothing while the store hasn't read them.
 * @param {string} title
 * @param {any[] | undefined} games
 * @param {(game: any) => string} describe
 */
function renderLastGames(title, games, describe) {
  if (!games?.length) return html``;
  return renderSheetPart(
    title,
    html`<ul class="recent-starts">
      ${games.map(
        (game) =>
          html`<li>
            <span class="tabular">${formatShortDate(readCalendarDate(game.date))}</span
            ><span>${game.opponent ? `${game.isHome ? "vs" : "@"} ${nameTeam(game.opponent)}` : ""}</span
            ><span class="tabular">${describe(game)}</span>
          </li>`,
      )}
    </ul>`,
  );
}

/**
 * A pitcher's season: a starter's totals over his ranked numbers and what he throws, or a
 * reliever's totals.
 * @param {Player} player
 * @param {ShownPlayer} shown
 * @param {string} title
 */
function renderPitching(player, { starters, side, clubGames = null }, title) {
  const { pitching } = player;
  const games = player.lastGames?.pitching;
  if (!isStarter(pitching))
    return html`${renderSheetPart(
      title,
      renderTotals([
        ["ERA", pitching.era],
        ["SV", pitching.saves],
        ["IP", formatInnings(pitching.inningsPitched)],
        ["K", pitching.strikeOuts],
        ["BB", pitching.baseOnBalls],
      ]),
      countWord(pitching.gamesPlayed, "game"),
    )}${renderLastGames("Last games", games, describePitchingGame)}`;
  const pitches = side?.pitches?.length
    ? renderSheetPart("What he throws", renderPitchMix(side.pitches))
    : html``;
  return html`${renderSheetPart(
    title,
    html`${renderTotals([
      ["W-L", `${pitching.wins}-${pitching.losses}`],
      ["IP", formatInnings(pitching.inningsPitched)],
      ["ERA", pitching.era],
      ["K", pitching.strikeOuts],
      ["BB", pitching.baseOnBalls],
    ])}${renderStarterRanks(player, starters, side, clubGames)}`,
    countWord(pitching.gamesStarted, "start"),
  )}${pitches}${renderLastGames("Last starts", games, describePitchingGame)}`;
}

const OUT_SOURCE = "RotoWire";

/**
 * His stay on the injured list and why he's there, then RotoWire's sentence on it, with the day
 * ESPN last changed it, or nothing while he isn't on the list.
 * @param {Player} player
 */
function renderOutBox({ injury, out }) {
  if (!injury) return html``;
  return html`<section class="out-box">
    <p class="out-line"><span class="status-chip injured">${injury}</span>${out?.reason && html`<span class="out-words">${out.reason}</span>`}</p>
    ${
      out?.sentence &&
      html`<p class="out-sentence" data-quoted>${out.sentence}</p>
      <p class="out-source">${joinWithSeparator(
        [OUT_SOURCE, out.updated && formatShortDate(new Date(out.updated))].filter(Boolean),
      )}</p>`
    }
  </section>`;
}

const renderPending = () =>
  renderSheetPart(
    "Regular season",
    renderTotals(["H", "R", "RBI", "BB", "K"].map((label) => [label, renderPlaceholder("000")])),
  );

/**
 * The sheet's parts under his name, or stand-ins while they load, or why they didn't.
 * @param {ShownPlayer} shown
 */
export function renderPlayerBody(shown) {
  const { player, isLoading } = shown;
  if (!player && isLoading) return renderPending();
  if (!player && shown.isUnkept)
    return html`<p class="sheet-message">His numbers show while he's on a club's roster</p>`;
  if (!player) return renderRetryBlock("his numbers", shown.failure ?? "unreachable");
  const isTwoWay = Boolean(player.hitting && player.pitching && player.position !== "P");
  const hitting =
    player.hitting && player.position !== "P"
      ? html`${renderHitting(player, shown.hitters, shown.clubGames ?? null)}${renderLastGames("Last games", player.lastGames?.hitting, describeBattingGame)}`
      : html``;
  const pitching = player.pitching
    ? renderPitching(player, shown, isTwoWay ? "Pitching" : "Regular season")
    : html``;
  if (
    !player.hitting &&
    !player.pitching &&
    !player.postseasonHitting &&
    !player.postseasonPitching
  )
    return html`${renderOutBox(player)}<p class="sheet-message">No games yet this season</p>`;
  return html`${renderOutBox(player)}${renderPostseason(player)}${hitting}${pitching}`;
}
