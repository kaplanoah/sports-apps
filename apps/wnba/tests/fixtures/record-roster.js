import fs from "node:fs";
import path from "node:path";
import { TEAMS } from "../../page/js/teams.js";
import {
  nameLeagueRosterRequest,
  namePlayerListRequest,
} from "../../worker/src/adapters/roster.js";
import { FEED_HEADERS } from "../../worker/src/wnba.js";

// Records what a team's Roster page reads from the league for the teams and seasons named: the
// league's roster of each, and its list of every player trimmed to theirs. ESPN's injury report,
// which says who is out, has its own recorder in record-injuries.js. Run with
// NODE_USE_ENV_PROXY=1 behind a proxy.

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

/**
 * The list of every player, keeping only the rows of the players named.
 * @param {any} list
 * @param {Set<number>} ids
 */
function trimPlayerList(list, ids) {
  const table = list.resultSets[0];
  const idColumn = table.headers.indexOf("PERSON_ID");
  return {
    resultSets: [{ ...table, rowSet: table.rowSet.filter((row) => ids.has(row[idColumn])) }],
  };
}

/** @param {any} roster */
function listRosterIds(roster) {
  const table = roster.resultSets.find((set) => set.name === "CommonTeamRoster");
  const idColumn = table.headers.indexOf("PLAYER_ID");
  return table.rowSet.map((row) => row[idColumn]);
}

async function recordFixture(name, teamSeasons) {
  const rosters = {};
  const ids = new Set();
  for (const [team, season] of teamSeasons) {
    const roster = await fetchJson(nameLeagueRosterRequest(team, season), FEED_HEADERS);
    rosters[`${team}:${season}`] = roster;
    listRosterIds(roster).forEach((id) => ids.add(id));
  }
  const latest = Math.max(...teamSeasons.map(([, season]) => season));
  const playerList = trimPlayerList(
    await fetchJson(namePlayerListRequest(latest), FEED_HEADERS),
    ids,
  );
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ recordedAt: new Date().toISOString(), rosters, playerList }),
  );
  console.log(`Wrote ${file}`);
}

const [name, ...pairs] = process.argv.slice(2);
const teamSeasons = pairs.map((pair) => {
  const [team, season] = pair.split(":");
  return /** @type {[string, number]} */ ([team, Number(season)]);
});
const isValid = teamSeasons.every(
  ([team, season]) => Object.hasOwn(TEAMS, team) && Number.isInteger(season),
);
if (!name || !teamSeasons.length || !isValid) {
  console.error(
    "usage: node apps/wnba/tests/fixtures/record-roster.js <name> <team:season> [team:season ...]",
  );
  process.exit(1);
}
recordFixture(name, teamSeasons).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
