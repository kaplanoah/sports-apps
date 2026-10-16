import { REQUESTS } from "../../page/js/snapshot.js";
import { TEAMS } from "../../page/js/teams.js";
import { respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

// The two teams' meetings this regular season, for the game sheet of a game that hasn't started.
// The store keeps each upcoming game's, from the schedule the season's updates read, so the route
// reads the league only for a game the store doesn't keep them for. The sheet takes how their
// seasons compare and their leading scorers from the store too, so opening it never waits on the
// slow stats site.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

// The schedule changes at most a few times a day, so its answer is kept an hour once it's checked.
// Cloudflare's edge would keep a refusal for the hour too, and the page's snapshot reads the same
// address.
const SCHEDULE_REUSE_MS = 60 * 60 * 1000;
// Regular-season games, Commissioner's Cup games among them. The game sheet's header already counts
// a playoff series, and the preseason, the All-Star Game, and the Cup's final aren't meetings that
// count.
const MEETING_ID = /^102/;

const hasGameDates = (answer) => Array.isArray(answer?.leagueSchedule?.gameDates);

const describeMeetingSide = (side) => ({ team: side.teamTricode, score: side.score });

const describeMeeting = (game) => ({
  id: String(game.gameId),
  start: game.gameDateTimeUTC ?? game.gameTimeUTC ?? null,
  away: describeMeetingSide(game.awayTeam),
  home: describeMeetingSide(game.homeTeam),
});

// The schedule only ever holds the current season, so another season's meetings aren't in it.
function listMeetings(schedule, season, teams) {
  if (schedule?.leagueSchedule?.seasonYear !== String(season)) return null;
  const isMeeting = (game) =>
    MEETING_ID.test(String(game.gameId)) &&
    game.gameStatus === 3 &&
    [game.awayTeam.teamTricode, game.homeTeam.teamTricode].sort().join() ===
      [...teams].sort().join();
  return schedule.leagueSchedule.gameDates
    .flatMap((day) => day.games)
    .filter(isMeeting)
    .map(describeMeeting)
    .sort((first, second) => Date.parse(second.start) - Date.parse(first.start));
}

/**
 * @param {any} schedule
 * @param {{ season: number, away: string, home: string }} game
 */
export const describePreview = (schedule, { season, away, home }) => ({
  season,
  away,
  home,
  meetings: listMeetings(schedule, season, [away, home]),
});

/**
 * Where the store keeps a season's meetings of two teams, whichever is home.
 * @param {number} season
 * @param {string[]} teams
 */
export const nameMeetingsKey = (season, teams) =>
  `meetings/${season}-${[...teams].sort().join("-")}`;

/**
 * The meetings of the two teams of each game in the snapshot that hasn't started, a playoff game or
 * a team's next, once for each pair, or none when the schedule didn't answer or holds another
 * season.
 * @param {any} schedule
 * @param {{ season: number, games: any[], nearestGames?: any[] }} snapshot
 */
export function listUpcomingMeetings(schedule, { season, games, nearestGames = [] }) {
  const pairs = [...games, ...nearestGames]
    .filter((game) => game.state === "pre" && game.away.team && game.home.team)
    .map((game) => [game.away.team, game.home.team].sort());
  const uniquePairs = [...new Map(pairs.map((teams) => [teams.join(), teams])).values()];
  return uniquePairs
    .map((teams) => ({ season, teams, meetings: listMeetings(schedule, season, teams) }))
    .filter((pair) => pair.meetings);
}

/** @param {URLSearchParams} searchParams */
function readTeams(searchParams) {
  const teams = ["away", "home"].map((place) => searchParams.get(place) ?? "");
  const isValid = teams.every((team) => Object.hasOwn(TEAMS, team)) && teams[0] !== teams[1];
  return isValid ? teams : null;
}

export function createPreviewServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  let kept = null;

  async function readSchedule() {
    if (kept && now() - kept.at < SCHEDULE_REUSE_MS) return kept.answer;
    const answer = await fetchWnbaJson(fetchImpl, REQUESTS.schedule, null, hasGameDates);
    kept = { at: now(), answer };
    return answer;
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function servePreview(url, readDoc) {
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondError(400, "invalid_argument", SEASON_PARAM.rule);
    const teams = readTeams(url.searchParams);
    if (!teams)
      return respondError(400, "invalid_argument", "away and home must be two WNBA teams");
    const [away, home] = teams;
    const kept = await readKeptDoc(readDoc, nameMeetingsKey(season, teams));
    if (kept) return respondJson({ season, away, home, meetings: kept.meetings });
    const schedule = await readSchedule().catch(() => null);
    if (!schedule)
      return respondError(
        502,
        "upstream_error",
        "Couldn't read the WNBA: its schedule didn't answer",
      );
    return respondJson(describePreview(schedule, { season, away, home }));
  }

  return { servePreview };
}
