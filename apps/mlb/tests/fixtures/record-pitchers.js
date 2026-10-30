import fs from "node:fs";
import path from "node:path";
import { addDays, readEasternDay } from "#shared/days.js";
import { MLB_API, readMlbTeamId } from "../../worker/src/adapters/mlb.js";
import {
  fetchPeople,
  listAppearancesRequest,
  listGameLogRequest,
  listPeopleRequest,
  listQualifiedIds,
  listQualifiedRequest,
  readLeagueRows,
} from "../../worker/src/pitchers.js";
import {
  LOOKBACK_DAYS,
  listClubStarterIds,
  listScheduleRequest,
} from "../../worker/src/rotations.js";

// Records what the matchup sheet reads this season and last for the clubs named: the league's
// tables, the last two weeks of every club's games and of each named club's, and the pitchers the
// sheet reads, who stand in for every pitcher: this season's qualified starters and the named
// clubs' recent starters, and last season's qualified starters. Each pitcher's game log keeps his
// last six games, and the tables of every pitcher's games keep only the pitchers recorded. Run
// with NODE_USE_ENV_PROXY=1 behind a proxy.

const GAMES_KEPT = 6;

async function fetchJson(request) {
  const response = await fetch(MLB_API + request);
  if (!response.ok) throw new Error(`${response.status} for ${request}`);
  return response.json();
}

const keepLastGames = (person) => ({
  ...person,
  stats: person.stats?.map((entry) => ({ ...entry, splits: entry.splits.slice(-GAMES_KEPT) })),
});

function keepRecordedRows(table, ids) {
  const rows = readLeagueRows(table).filter((row) => ids.has(row.player.id));
  return { stats: [{ splits: rows }] };
}

async function recordFixture(name, clubs) {
  const now = Date.now();
  const { date: today, year: season } = readEasternDay(now);
  const answers = {};
  const record = async (request) => {
    answers[request] = await fetchJson(request);
    return answers[request];
  };
  const qualified = await record(listQualifiedRequest(season));
  const pastQualified = await record(listQualifiedRequest(season - 1));
  await record(listScheduleRequest(null, addDays(today, -LOOKBACK_DAYS), today));
  const clubStarters = [];
  for (const club of clubs)
    for (const date of [today, addDays(today, 1)]) {
      const schedule = await record(
        listScheduleRequest(readMlbTeamId(club), addDays(date, -LOOKBACK_DAYS), addDays(date, -1)),
      );
      clubStarters.push(...listClubStarterIds(schedule, club));
    }
  const ids = [...new Set([...listQualifiedIds(qualified), ...clubStarters])];
  const pastIds = listQualifiedIds(pastQualified);
  for (const gameType of /** @type {const} */ (["R", "P"])) {
    const request = listAppearancesRequest(season, gameType);
    answers[request] = keepRecordedRows(await fetchJson(request), new Set(ids));
  }
  const people = {
    [season]: await fetchPeople(fetchJson, (batch) => listPeopleRequest(season, batch), ids),
    [season - 1]: await fetchPeople(
      fetchJson,
      (batch) => listPeopleRequest(season - 1, batch),
      pastIds,
    ),
  };
  const gameLogs = {
    [season]: (await fetchPeople(fetchJson, (batch) => listGameLogRequest(season, batch), ids)).map(
      keepLastGames,
    ),
    [season - 1]: (
      await fetchPeople(fetchJson, (batch) => listGameLogRequest(season - 1, batch), pastIds)
    ).map(keepLastGames),
  };
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ recordedAt: new Date(now).toISOString(), answers, people, gameLogs }),
  );
  console.log(`Wrote ${file}`);
}

const [name, ...clubs] = process.argv.slice(2);
if (!name || !clubs.length || !clubs.every(readMlbTeamId)) {
  console.error("usage: node apps/mlb/tests/fixtures/record-pitchers.js <name> <club> [...]");
  process.exit(1);
}
recordFixture(name, clubs).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
