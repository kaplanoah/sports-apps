import { readGameState } from "../../page/js/snapshot.js";
import { fetchMlbJson } from "./mlb.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";

// One game's box score for the Game section of its sheet, read from MLB's live feed in one request
// trimmed to what the sheet shows: each club's runs by inning, its runs, hits, and errors, each
// batter and pitcher who got in, each half inning that scored, play by play, and, while a half
// inning is under way, who's on base and how each got there, and who's up. Before first pitch, once
// a club posts its lineup, its batters are that lineup, each with his season so far. The store
// keeps each game's (game-details-updater.js), so the route reads MLB only for a game the store
// hasn't kept yet.

/** @typedef {(key: string) => Promise<any>} ReadDoc */

// A live game's box score changes with every play, so it's kept as briefly as the scoreboard.
const BOX_SCORE_CACHE_SECONDS = 5;
const GAME_ID = /^\d{1,9}$/;
const FEED_FIELDS = [
  "gameData",
  "status",
  "abstractGameState",
  "codedGameState",
  "detailedState",
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
  "numberOfPitches",
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
  "awayScore",
  "homeScore",
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
// A pitcher's note reads like "(W, 4-2)" or "(S, 3)"; the sheet shows only the decision.
const DECISIONS = new Set(["W", "L", "S"]);
const SIDES_BATTING = { top: "away", bottom: "home" };
// MLB's linescore names the half being played; between halves it's "Middle" or "End".
const HALVES_UNDER_WAY = { Top: "top", Bottom: "bottom" };
const BASES = /** @type {const} */ (["first", "second", "third"]);
const BASE_CODES = { first: "1B", second: "2B", third: "3B" };
const BASE_SET = new Set(Object.values(BASE_CODES));

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
    pitches: line.numberOfPitches ?? 0,
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
 * The game's plays by half inning, in the order they came.
 * @param {any[]} allPlays
 */
function groupHalves(allPlays) {
  /** @type {Map<string, any[]>} */
  const halves = new Map();
  for (const play of allPlays) {
    const key = `${play.about?.inning} ${play.about?.halfInning}`;
    halves.set(key, [...(halves.get(key) ?? []), play]);
  }
  return [...halves.values()];
}

/**
 * Where each runner a play moved ended up: the last base he reached, or none once he scored or
 * was out. A runner moves once for each thing that moved him, like a steal and then a hit.
 * @param {any} play
 */
function findRunnersEnds(play) {
  /** @type {Map<number, string | null>} */
  const ends = new Map();
  for (const runner of play.runners ?? []) {
    const { end, isOut } = runner.movement ?? {};
    const id = runner.details?.runner?.id;
    ends.set(id, isOut || ends.get(id) === null || !BASE_SET.has(end) ? null : end);
  }
  return ends;
}

/**
 * Moves each runner a play moved, on the half inning's bases, by base. Every base a runner left is
 * cleared before any is taken, since a pinch runner leaves the base under an id other than that of
 * the runner he replaced.
 * @param {Map<string, number>} bases
 * @param {any} play
 */
function moveRunners(bases, play) {
  for (const runner of play.runners ?? []) bases.delete(runner.movement?.start);
  for (const [id, end] of findRunnersEnds(play)) if (end) bases.set(end, id);
}

/**
 * Each runner who scored on a play, with what scored him: the play itself, like a single, or
 * something during it, like a wild pitch. A batter who scored on his own homer isn't one.
 * @param {any} play
 * @param {(id: number) => string} lastNameOf
 */
function listScorers(play, lastNameOf) {
  const batter = play.matchup?.batter?.id;
  return (play.runners ?? [])
    .filter(
      (/** @type {any} */ runner) => runner.movement?.end === "score" && !runner.movement?.isOut,
    )
    .map((/** @type {any} */ runner) => ({
      id: runner.details?.runner?.id,
      event: runner.details?.event ?? play.result?.event ?? "",
    }))
    .filter((scorer) => !(scorer.id === batter && scorer.event === play.result?.event))
    .map((scorer) => ({ name: lastNameOf(scorer.id), event: scorer.event }));
}

/**
 * A half inning that scored: each play that put its batter on base or scored a run, in order, with
 * who batted, what he did, whether he stayed on base, whether that filled the bases, who scored and
 * how, and the score after a play that scored.
 * @param {any[]} halfPlays
 * @param {(id: number) => string} lastNameOf
 */
function describeHalf(halfPlays, lastNameOf) {
  /** @type {Map<string, number>} */
  const bases = new Map();
  const plays = [];
  for (const play of halfPlays) {
    const wereFull = bases.size === BASE_SET.size;
    moveRunners(bases, play);
    const batter = play.matchup?.batter?.id;
    const reached = [...bases.values()].includes(batter);
    const scored = Boolean(play.about?.isScoringPlay);
    if (!reached && !scored) continue;
    plays.push({
      batter: lastNameOf(batter),
      event: play.result?.event ?? "",
      reached,
      filledBases: !wereFull && bases.size === BASE_SET.size,
      scorers: listScorers(play, lastNameOf),
      score: scored ? { away: play.result?.awayScore, home: play.result?.homeScore } : null,
    });
  }
  const [first] = halfPlays;
  return { side: SIDES_BATTING[first.about?.halfInning], inning: first.about?.inning, plays };
}

/**
 * Each half inning that scored, in the order they came, or null when the feed has no plays to read.
 * @param {any} plays MLB's plays for the game
 * @param {(id: number) => string} lastNameOf
 */
function describeScoringHalves(plays, lastNameOf) {
  if (!plays?.allPlays) return null;
  return groupHalves(plays.allPlays)
    .filter((half) => half.some((/** @type {any} */ play) => play.about?.isScoringPlay))
    .map((half) => describeHalf(half, lastNameOf));
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
  const state = readGameState(feed?.gameData?.status ?? {});
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
    scoringHalves: hasStarted ? describeScoringHalves(plays, lastNameOf) : null,
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
