import { fetchMlbJson } from "./mlb.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";

// One game's box score for the Game section of its sheet, read from MLB's live feed in one request
// trimmed to what the sheet shows: each club's runs by inning, its runs, hits, and errors, each
// batter and pitcher who got in, each run-scoring play, and, while a half inning is under way,
// who's on base and how each got there, and who's up. Before first pitch, once a club posts its
// lineup, its batters are that lineup, each with his season so far. The store keeps each game's
// (game-details-updater.js), so the route reads MLB only for a game the store hasn't kept yet.

/** @typedef {(key: string) => Promise<any>} ReadDoc */

// A live game's box score changes with every play, so it's kept as briefly as the scoreboard.
const BOX_SCORE_CACHE_SECONDS = 5;
const GAME_ID = /^\d{1,9}$/;
const FEED_FIELDS = [
  "gameData",
  "status",
  "abstractGameState",
  "players",
  "boxscoreName",
  "lastName",
  "liveData",
  "linescore",
  "innings",
  "num",
  "away",
  "home",
  "runs",
  "hits",
  "errors",
  "teams",
  "boxscore",
  "batters",
  "pitchers",
  "position",
  "abbreviation",
  "battingOrder",
  "stats",
  "batting",
  "atBats",
  "rbi",
  "baseOnBalls",
  "strikeOuts",
  "pitching",
  "note",
  "inningsPitched",
  "earnedRuns",
  "seasonStats",
  "avg",
  "homeRuns",
  "plays",
  "allPlays",
  "about",
  "inning",
  "halfInning",
  "isScoringPlay",
  "result",
  "event",
  "matchup",
  "batter",
  "pitcher",
  "runners",
  "movement",
  "start",
  "end",
  "isOut",
  "details",
  "runner",
  "id",
  "inningState",
  "currentInning",
  "outs",
  "offense",
  "defense",
  "first",
  "second",
  "third",
].join(",");
const STATES = { Preview: "pre", Live: "live", Final: "final" };
// A pitcher's note reads like "(W, 4-2)" or "(S, 3)"; the sheet shows only the decision.
const DECISIONS = new Set(["W", "L", "S"]);
const SIDES_BATTING = { top: "away", bottom: "home" };
// MLB's linescore names the half being played; between halves it's "Middle" or "End".
const HALVES_UNDER_WAY = { Top: "top", Bottom: "bottom" };
const BASES = /** @type {const} */ (["first", "second", "third"]);
const BASE_CODES = { first: "1B", second: "2B", third: "3B" };

// Where the store keeps each game's box score.
export const GAME_DETAILS_COLLECTION = "games";

/** @param {string} id */
export const nameGameDetailsKey = (id) => `${GAME_DETAILS_COLLECTION}/${id}`;

/** @param {string} id */
export const nameFeedRequest = (id) => `/api/v1.1/game/${id}/feed/live?fields=${FEED_FIELDS}`;

/** @param {any} note */
function readDecision(note) {
  const decision = /^\(([A-Z]+),/.exec(note ?? "")?.[1];
  return decision && DECISIONS.has(decision) ? decision : null;
}

/**
 * A batter's line in the game.
 * @param {number} id
 * @param {any} player
 * @param {string} name
 */
function describeBatter(id, player, name) {
  const game = player.stats?.batting ?? {};
  return {
    id,
    name,
    position: player.position?.abbreviation ?? "",
    isSub: Number(player.battingOrder) % 100 !== 0,
    atBats: game.atBats ?? 0,
    runs: game.runs ?? 0,
    hits: game.hits ?? 0,
    rbi: game.rbi ?? 0,
    walks: game.baseOnBalls ?? 0,
    strikeOuts: game.strikeOuts ?? 0,
  };
}

/**
 * A batter in a lineup posted before first pitch, with his season so far.
 * @param {number} id
 * @param {any} player
 * @param {string} name
 */
function describeLineupBatter(id, player, name) {
  const season = player.seasonStats?.batting ?? {};
  return {
    id,
    name,
    position: player.position?.abbreviation ?? "",
    average: season.avg ?? null,
    homeRuns: season.homeRuns ?? null,
    rbi: season.rbi ?? null,
  };
}

/**
 * @param {number} id
 * @param {any} player
 * @param {string} name
 */
function describePitcher(id, player, name) {
  const line = player.stats?.pitching ?? {};
  return {
    id,
    name,
    decision: readDecision(line.note),
    inningsPitched: line.inningsPitched ?? "0.0",
    hits: line.hits ?? 0,
    runs: line.runs ?? 0,
    earnedRuns: line.earnedRuns ?? 0,
    walks: line.baseOnBalls ?? 0,
    strikeOuts: line.strikeOuts ?? 0,
  };
}

/**
 * A club's batters in batting order, each sub after the batter he replaced, and its pitchers in the
 * order they pitched, but for a game still to start, which has only its lineup.
 * @param {any} team the club's side of MLB's box score
 * @param {(id: number) => string} nameOf
 * @param {boolean} hasStarted
 */
function describeClub(team, nameOf, hasStarted) {
  const playerOf = (/** @type {number} */ id) => team.players?.[`ID${id}`] ?? {};
  const describe = hasStarted ? describeBatter : describeLineupBatter;
  const batters = (team.batters ?? [])
    .filter((/** @type {number} */ id) => playerOf(id).battingOrder)
    .sort(
      (/** @type {number} */ first, /** @type {number} */ second) =>
        Number(playerOf(first).battingOrder) - Number(playerOf(second).battingOrder),
    )
    .map((/** @type {number} */ id) => describe(id, playerOf(id), nameOf(id)));
  const pitchers = hasStarted
    ? (team.pitchers ?? []).map((/** @type {number} */ id) =>
        describePitcher(id, playerOf(id), nameOf(id)),
      )
    : [];
  return { batters, pitchers };
}

/** @param {any} side a club's runs, hits, and errors in MLB's line score */
const describeTotals = (side) => ({
  runs: side?.runs ?? 0,
  hits: side?.hits ?? 0,
  errors: side?.errors ?? 0,
});

/**
 * The runners who scored on a play, grouped by what scored them: the play itself, like a single,
 * or something else during it, like a wild pitch.
 * @param {any} play
 */
function groupRunsByEvent(play) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const runner of play.runners ?? []) {
    if (runner.movement?.end !== "score" || runner.movement?.isOut) continue;
    const event = runner.details?.event ?? play.result?.event ?? "";
    groups.set(event, [...(groups.get(event) ?? []), runner]);
  }
  return groups;
}

/**
 * Each way a play scored runs: what scored them, who's credited, the batter for the play's own
 * result or the runner for anything else, the batter's runs batted in, and how many scored.
 * @param {any} play
 * @param {(id: number) => string} lastNameOf
 */
function describeScoringPlay(play, lastNameOf) {
  const side = SIDES_BATTING[play.about?.halfInning];
  const inning = play.about?.inning;
  return [...groupRunsByEvent(play)].map(([event, runners]) => {
    const isPlayResult = event === play.result?.event;
    const player = isPlayResult ? play.matchup?.batter?.id : runners[0].details?.runner?.id;
    return {
      side,
      inning,
      event,
      player: lastNameOf(player),
      rbi: isPlayResult ? (play.result?.rbi ?? 0) : 0,
      runs: runners.length,
    };
  });
}

/**
 * Every run-scoring play in the order they came, or null when the feed has no plays to read.
 * @param {any} plays MLB's plays for the game
 * @param {(id: number) => string} lastNameOf
 */
function describeScoring(plays, lastNameOf) {
  if (!plays?.allPlays) return null;
  return plays.allPlays
    .filter((/** @type {any} */ play) => play.about?.isScoringPlay)
    .flatMap((/** @type {any} */ play) => describeScoringPlay(play, lastNameOf));
}

/**
 * What put each batter who reached base in the half inning on it, by his id.
 * @param {any[]} halfPlays
 */
function listWaysOn(halfPlays) {
  /** @type {Map<number, string>} */
  const waysOn = new Map();
  for (const play of halfPlays)
    for (const runner of play.runners ?? []) {
      const { start, end, isOut } = runner.movement ?? {};
      const id = runner.details?.runner?.id;
      if (start == null && end && end !== "score" && !isOut && id != null)
        waysOn.set(id, runner.details?.event ?? play.result?.event);
    }
  return waysOn;
}

/**
 * While a half inning is under way, who's on each base and what put him on it, how many are out,
 * and who's up against whom; otherwise null.
 * @param {any} linescore MLB's line score for the game
 * @param {any} plays MLB's plays for the game
 * @param {(id: number) => string} lastNameOf
 */
function describeBases(linescore, plays, lastNameOf) {
  const half = HALVES_UNDER_WAY[linescore?.inningState];
  const inning = linescore?.currentInning;
  if (!half || !inning) return null;
  const halfPlays = (plays?.allPlays ?? []).filter(
    (/** @type {any} */ play) => play.about?.inning === inning && play.about?.halfInning === half,
  );
  const waysOn = listWaysOn(halfPlays);
  const runners = BASES.filter((base) => linescore.offense?.[base]?.id != null).map((base) => {
    const id = linescore.offense[base].id;
    return { base: BASE_CODES[base], name: lastNameOf(id), reached: waysOn.get(id) ?? null };
  });
  return {
    half,
    inning,
    outs: linescore.outs ?? 0,
    runners,
    batter: lastNameOf(linescore.offense?.batter?.id),
    pitcher: lastNameOf(linescore.defense?.pitcher?.id),
  };
}

/**
 * @param {string} id
 * @param {any} feed MLB's live feed for the game, trimmed to FEED_FIELDS
 */
export function describeBoxScore(id, feed) {
  const state = STATES[feed?.gameData?.status?.abstractGameState] ?? "pre";
  const players = feed?.gameData?.players ?? {};
  const nameOf = (/** @type {number} */ playerId) => players[`ID${playerId}`]?.boxscoreName ?? "";
  const lastNameOf = (/** @type {number} */ playerId) =>
    players[`ID${playerId}`]?.lastName ?? nameOf(playerId);
  const linescore = feed?.liveData?.linescore ?? {};
  const plays = feed?.liveData?.plays;
  const teams = feed?.liveData?.boxscore?.teams ?? {};
  const hasStarted = state !== "pre";
  return {
    id,
    state,
    innings: (hasStarted ? (linescore.innings ?? []) : []).map((/** @type {any} */ inning) => ({
      away: inning.away?.runs ?? null,
      home: inning.home?.runs ?? null,
    })),
    totals: {
      away: describeTotals(linescore.teams?.away),
      home: describeTotals(linescore.teams?.home),
    },
    away: describeClub(teams.away ?? {}, nameOf, hasStarted),
    home: describeClub(teams.home ?? {}, nameOf, hasStarted),
    scoring: hasStarted ? describeScoring(plays, lastNameOf) : null,
    bases: state === "live" ? describeBases(linescore, plays, lastNameOf) : null,
  };
}

/**
 * MLB's box score for one game, read afresh.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} id
 */
export async function fetchBoxScore(fetchImpl, id) {
  return describeBoxScore(
    id,
    await fetchMlbJson(fetchImpl, nameFeedRequest(id), BOX_SCORE_CACHE_SECONDS),
  );
}

// A finished game's box score never changes, so the one the store keeps is served as it is.
export function createBoxScoreServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {string} id
   * @param {ReadDoc} readDoc
   */
  async function readKept(id, readDoc) {
    try {
      return await readDoc(nameGameDetailsKey(id));
    } catch (error) {
      console.error(`Reading game ${id} from the store failed: ${describeError(error)}`);
      return null;
    }
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveBoxScore(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id)) return respondJson({ error: "id must be an MLB game id" }, 400);
    try {
      const kept = readDoc ? await readKept(id, readDoc) : null;
      return respondJson(kept?.state === "final" ? kept : await fetchBoxScore(fetchImpl, id));
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  return { serveBoxScore };
}
