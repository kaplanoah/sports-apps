import {
  PositiveId,
  BasketballRosterFacts,
  BasketballRoster,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { describeError } from "../../../../../shared/worker/responses.js";
import { readNameLetters } from "../../../../../shared/worker/player-name.js";
import { TEAMS } from "../../../page/js/teams.js";
import { createReusedLoader } from "../../../../../shared/worker/upstream.js";
import { fetchInjuries, listOutPlayers } from "../injuries.js";
import { splitName } from "../season-averages.js";
import { fetchWnbaJson, hasTable, isCurrentSeason, readRequiredTable, readTable } from "../wnba.js";

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
 * @param {any} answer
 * @param {string} table
 * @param {{ season: number, now: number }} context
 */
export function validateRosterFeed(answer, table, { season, now }) {
  const rows = readRequiredTable(answer, table);
  if (table === "CommonTeamRoster") {
    const context = { outByName: new Map(), ageDay: chooseAgeDay(season, now) };
    for (const row of rows) {
      validateSportsData(PositiveId, row.PLAYER_ID);
      validateSportsData(BasketballRosterFacts, describePlayer(row, new Map(), context));
    }
  } else {
    for (const row of rows) validateSportsData(PositiveId, row.PERSON_ID);
  }
  return answer;
}

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

/** @param {unknown} value */
function readDebut(value) {
  const text = readText(/** @type {string | null | undefined} */ (value));
  return text == null || Number(text) === 0 ? null : Number(text);
}

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
  return splitName(row.PLAYER);
}

/** @param {{ firstName: string, lastName: string }} names @param {Map<string, any>} outByName */
const readOut = (names, outByName) =>
  outByName.get(readNameLetters(`${names.firstName} ${names.lastName}`)) ?? null;

/** @param {any} player */
function readListFacts(player) {
  const { firstName, lastName, college, country, debut } = player;
  return { firstName, lastName, college, country, debut };
}

/**
 * @param {any} row the league roster's row for a player
 * @param {Map<number, any>} listed every player the league has had, by id
 * @param {{ outByName: Map<string, import("../injuries.js").OutReason>, ageDay: { year: number, month: number, day: number } }} context
 */
function describePlayer(row, listed, { outByName, ageDay }) {
  const entry = listed.get(row.PLAYER_ID);
  const names = readNames(row, entry);
  return {
    id: String(row.PLAYER_ID),
    number: readText(row.NUM),
    ...names,
    position: readText(row.POSITION),
    height: formatHeight(row.HEIGHT),
    age: measureAge(readBirthday(row.BIRTH_DATE), ageDay),
    college: readText(entry?.COLLEGE),
    country: readText(entry?.COUNTRY),
    out: readOut(names, outByName),
    debut: readDebut(entry?.FROM_YEAR),
  };
}

/** @param {any} row @param {Map<number, any>} listed @param {any} context */
function describeRosterPlayer(row, listed, context) {
  try {
    return validateSportsData(
      BasketballRoster.shape.players.element,
      describePlayer(row, listed, context),
    );
  } catch (error) {
    if (!listed.has(row.PLAYER_ID)) throw error;
    context.onPlayerFailure(error, String(row.PLAYER_ID));
    const kept = context.kept?.players.find((player) => player.id === String(row.PLAYER_ID));
    const current = describePlayer(row, new Map(), context);
    const player = { ...current, ...readListFacts(kept ?? current) };
    return validateSportsData(BasketballRoster.shape.players.element, {
      ...player,
      out: readOut(player, context.outByName),
    });
  }
}

/** @param {any} leagueRoster */
function nameHeadCoach(leagueRoster) {
  const coach = readTable(leagueRoster, "Coaches").find((row) => row.COACH_TYPE === "Head Coach");
  return coach ? readText(coach.COACH_NAME) : null;
}

/**
 * @param {{ team: string, season: number, leagueRoster: any, playerList: any, outPlayers: import("../injuries.js").OutPlayer[], now: number, kept?: any, onPlayerFailure: (error: unknown, id: string) => void }} reads
 *   `outPlayers` are the team's players ESPN lists as out
 */
export function describeRoster({
  team,
  season,
  leagueRoster,
  playerList,
  outPlayers,
  now,
  kept,
  onPlayerFailure,
}) {
  const rosterRows = readRequiredTable(leagueRoster, "CommonTeamRoster");
  for (const row of rosterRows) validateSportsData(PositiveId, row.PLAYER_ID);
  if (playerList) validateRosterFeed(playerList, "PlayerIndex", { season, now });
  const listed = new Map(
    (playerList ? readRequiredTable(playerList, "PlayerIndex") : []).map((row) => [
      row.PERSON_ID,
      row,
    ]),
  );
  const outByName = new Map(outPlayers.map(({ name, ...out }) => [name, out]));
  const context = { outByName, ageDay: chooseAgeDay(season, now), kept, onPlayerFailure };
  return validateSportsData(BasketballRoster, {
    team,
    season,
    coach: nameHeadCoach(leagueRoster),
    players: rosterRows.map((row) => describeRosterPlayer(row, listed, context)),
  });
}

/**
 * The team a request names, or null when it names none of the league's.
 * @param {URLSearchParams} searchParams
 */
export function readTeam(searchParams) {
  const team = searchParams.get("team") ?? "";
  return Object.hasOwn(TEAMS, team) ? team : null;
}

export function createRosterReader({
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
    return describeRoster({
      team,
      season,
      leagueRoster,
      playerList,
      outPlayers,
      now: now(),
      onPlayerFailure: (error, id) =>
        console.error(
          `Reading ${team}'s ${season} roster player ${id} failed: ${describeError(error)}`,
        ),
    });
  }

  const loadRoster = createReusedLoader(readRoster, ROSTER_REUSE_MS, now);

  return loadRoster;
}
