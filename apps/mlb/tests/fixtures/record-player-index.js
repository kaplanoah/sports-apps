import fs from "node:fs";
import path from "node:path";
import { MLB_API, listClubs, readMlbTeamId } from "../../page/js/snapshot.js";
import { indexRosters } from "../../worker/src/player-index.js";
import { indexPeople, listPeopleRequest } from "../../worker/src/players.js";
import { listRosterRequest } from "../../worker/src/rosters.js";

// Records the list of every player on a club's roster this season, as the store keeps it beside
// its rosters, from every club's 40-man roster and MLB's list of every player. Run with
// NODE_USE_ENV_PROXY=1 behind a proxy.

/** @param {string} request */
async function fetchJson(request) {
  const response = await fetch(MLB_API + request);
  if (!response.ok) throw new Error(`${response.status} for ${request}`);
  return response.json();
}

/**
 * @param {string} name
 * @param {number} season
 */
async function recordFixture(name, season) {
  const rosters = await Promise.all(
    listClubs().map(async (club) => ({
      club,
      roster: await fetchJson(
        listRosterRequest(/** @type {number} */ (readMlbTeamId(club)), season),
      ),
    })),
  );
  const people = indexPeople(await fetchJson(listPeopleRequest(season)));
  const file = path.join(import.meta.dirname, `${name}.json`);
  const index = indexRosters(season, rosters, people);
  fs.writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), index }));
  console.log(`Wrote ${file} with ${index.players.length} players`);
}

const [name, season] = process.argv.slice(2);
if (!name || !season) {
  console.error("usage: node apps/mlb/tests/fixtures/record-player-index.js <name> <season>");
  process.exit(1);
}
recordFixture(name, Number(season)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
