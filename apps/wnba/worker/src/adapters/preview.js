import { REQUESTS } from "./wnba.js";
import { TEAMS } from "../../../page/js/teams.js";
import { fetchWnbaJson } from "../wnba.js";

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
    .map(describeMeeting);
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
export function readTeams(searchParams) {
  const teams = ["away", "home"].map((place) => searchParams.get(place) ?? "");
  const isValid = teams.every((team) => Object.hasOwn(TEAMS, team)) && teams[0] !== teams[1];
  return isValid ? teams : null;
}

export function createScheduleReader({
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

  return readSchedule;
}
