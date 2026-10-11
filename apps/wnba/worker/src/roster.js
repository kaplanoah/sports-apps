import { TEAMS } from "../../page/js/teams.js";
import { normalizeName } from "../../page/js/player-names.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";
import { fetchInjuries, listOutPlayers } from "./injuries.js";
import { readKeptDoc } from "./store-docs.js";
import { SEASON_PARAM, fetchWnbaJson, hasTable, isCurrentSeason, readTable } from "./wnba.js";

// Reads a team's roster for a season, for its sheet's Roster page: each player's number, position,
// height, and age from the league's roster of that season, and where she came from and her first
// season from the league's list of every player it has had, which has a college or country for
// each. ESPN's injury report says who is out and why, and only for today's roster, so a past
// season's has no one out. The store keeps each season's rosters (player-updater.js), so a sheet
// reads the league itself only for a season the store doesn't keep. The page takes each player's
// averages from the store, which the season updater keeps.

const WNBA_STATS = "https://stats.wnba.com/stats";
// A roster changes with a signing or an injury, a past season's never, and the list of every
// player once a player joins the league.
const ROSTER_CACHE_SECONDS = 30 * 60;
const PAST_ROSTER_CACHE_SECONDS = 24 * 60 * 60;
const PLAYER_LIST_CACHE_SECONDS = 24 * 60 * 60;
// A sheet opened again soon, on this phone or another, reuses the roster just read.
const ROSTER_REUSE_MS = 5 * 60 * 1000;
// A past season's player is the age she was midway through it.
const MIDSEASON_MONTH = 6;

/**
 * @param {string} team
 * @param {number} season
 */
export const nameLeagueRosterRequest = (team, season) =>
  `${WNBA_STATS}/commonteamroster?LeagueID=10&Season=${season}&TeamID=${TEAMS[team].id}`;

// Every player the league has had, whatever season the list is asked for.
/** @param {number} season */
export const namePlayerListRequest = (season) =>
  `${WNBA_STATS}/playerindex?${new URLSearchParams({
    Active: "",
    AllStar: "",
    College: "",
    Country: "",
    DraftPick: "",
    DraftRound: "",
    DraftYear: "",
    Height: "",
    Historical: "1",
    LeagueID: "10",
    Season: String(season),
    TeamID: "0",
    Weight: "",
  })}`;

/**
 * Where the store keeps a team's roster for a season.
 * @param {number} season
 * @param {string} team
 */
export const nameRosterKey = (season, team) => `rosters/${season}-${team}`;

// The league writes a height as 6-4.
/** @param {string | null | undefined} height */
function formatHeight(height) {
  const [feet, inches] = String(height ?? "").split("-");
  return feet && inches !== undefined ? `${feet}'${inches}"` : null;
}

// The list writes a player with no college as a dash, or as spaces.
/** @param {string | null | undefined} value */
const readText = (value) => {
  const text = String(value ?? "").trim();
  return text && text !== "-" ? text : null;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The roster writes a birthday as MAR 02, 1997.
/** @param {string | null | undefined} birthday */
function readBirthday(birthday) {
  const [, month, day, year] =
    String(birthday ?? "").match(/^([A-Z]{3}) (\d{1,2}), (\d{4})$/) ?? [];
  const monthIndex = MONTHS.indexOf(month);
  return monthIndex < 0 ? null : { year: Number(year), month: monthIndex, day: Number(day) };
}

/**
 * Her age on a day, given as its year, month from 0, and day.
 * @param {{ year: number, month: number, day: number } | null} birthday
 * @param {{ year: number, month: number, day: number }} on
 */
function measureAge(birthday, on) {
  if (!birthday) return null;
  const hasHadBirthday =
    on.month > birthday.month || (on.month === birthday.month && on.day >= birthday.day);
  return on.year - birthday.year - (hasHadBirthday ? 0 : 1);
}

/**
 * The day a roster's ages are counted on: today for the current season, or midway through a past
 * one.
 * @param {number} season
 * @param {number} now
 */
function chooseAgeDay(season, now) {
  const today = new Date(now);
  if (isCurrentSeason(season, now))
    return { year: today.getUTCFullYear(), month: today.getUTCMonth(), day: today.getUTCDate() };
  return { year: season, month: MIDSEASON_MONTH, day: 1 };
}

/**
 * The player's first and last names: the list's, or her roster name split at its first space.
 * @param {any} row the league roster's row for her
 * @param {any} listed the list's row for her
 */
function readNames(row, listed) {
  if (listed) return { firstName: listed.PLAYER_FIRST_NAME, lastName: listed.PLAYER_LAST_NAME };
  const [firstName, ...rest] = String(row.PLAYER).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

/**
 * @param {any} row the league roster's row for a player
 * @param {Map<number, any>} listed every player the league has had, by id
 * @param {{ outByName: Map<string, import("./injuries.js").OutReason>, ageDay: { year: number, month: number, day: number } }} context
 */
function describePlayer(row, listed, { outByName, ageDay }) {
  const entry = listed.get(row.PLAYER_ID);
  const names = readNames(row, entry);
  const debut = Number(entry?.FROM_YEAR);
  return {
    id: String(row.PLAYER_ID),
    number: readText(row.NUM),
    ...names,
    position: readText(row.POSITION),
    height: formatHeight(row.HEIGHT),
    age: measureAge(readBirthday(row.BIRTH_DATE), ageDay),
    college: readText(entry?.COLLEGE),
    country: readText(entry?.COUNTRY),
    out: outByName.get(normalizeName(names)) ?? null,
    debut: Number.isFinite(debut) && debut > 0 ? debut : null,
  };
}

/** @param {any} leagueRoster */
function nameHeadCoach(leagueRoster) {
  const coach = readTable(leagueRoster, "Coaches").find((row) => row.COACH_TYPE === "Head Coach");
  return coach ? readText(coach.COACH_NAME) : null;
}

/**
 * @param {{ team: string, season: number, leagueRoster: any, playerList: any, outPlayers: import("./injuries.js").OutPlayer[], now: number }} reads
 *   `outPlayers` are the team's players ESPN lists as out
 */
export function describeRoster({ team, season, leagueRoster, playerList, outPlayers, now }) {
  const listed = new Map(readTable(playerList, "PlayerIndex").map((row) => [row.PERSON_ID, row]));
  const outByName = new Map(outPlayers.map(({ name, ...out }) => [name, out]));
  const context = { outByName, ageDay: chooseAgeDay(season, now) };
  return {
    team,
    season,
    coach: nameHeadCoach(leagueRoster),
    players: readTable(leagueRoster, "CommonTeamRoster").map((row) =>
      describePlayer(row, listed, context),
    ),
  };
}

/** @param {URLSearchParams} searchParams */
function readTeam(searchParams) {
  const team = searchParams.get("team") ?? "";
  return Object.hasOwn(TEAMS, team) ? team : null;
}

export function createRosterServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  /** @param {string} team */
  const readOutPlayers = (team) =>
    fetchInjuries(fetchImpl, ROSTER_CACHE_SECONDS).then(
      (report) => listOutPlayers(report)[team] ?? [],
      () => [],
    );

  // Who is out is today's news, so only today's roster reads it, and a report ESPN doesn't answer
  // shows no one out rather than holding up the roster.
  /** @param {string} key a team and season, as NYL:2026 */
  async function readRoster(key) {
    const [team, seasonText] = key.split(":");
    const season = Number(seasonText);
    const isCurrent = isCurrentSeason(season, now());
    const [leagueRoster, playerList, outPlayers] = await Promise.all([
      fetchWnbaJson(
        fetchImpl,
        nameLeagueRosterRequest(team, season),
        isCurrent ? ROSTER_CACHE_SECONDS : PAST_ROSTER_CACHE_SECONDS,
        hasTable("CommonTeamRoster"),
      ),
      fetchWnbaJson(
        fetchImpl,
        namePlayerListRequest(season),
        PLAYER_LIST_CACHE_SECONDS,
        hasTable("PlayerIndex"),
      ),
      isCurrent ? readOutPlayers(team) : [],
    ]);
    return describeRoster({ team, season, leagueRoster, playerList, outPlayers, now: now() });
  }

  const loadRoster = createReusedLoader(readRoster, ROSTER_REUSE_MS, now);

  /**
   * @param {URL} url
   * @param {import("./store-docs.js").ReadDoc} [readDoc] the store's documents, when the Worker
   *   has a store
   */
  async function serveRoster(url, readDoc) {
    const team = readTeam(url.searchParams);
    if (!team) return respondJson({ error: "team must name a WNBA team" }, 400);
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_PARAM.rule }, 400);
    try {
      const saved = await readKeptDoc(readDoc, nameRosterKey(season, team));
      return respondJson(saved ?? (await loadRoster(`${team}:${season}`)));
    } catch (error) {
      return respondJson({ error: `Couldn't read the WNBA: ${describeError(error)}` }, 502);
    }
  }

  return { loadRoster, serveRoster };
}
