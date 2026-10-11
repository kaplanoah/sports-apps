import fs from "node:fs";
import path from "node:path";
import { nameInjuriesRequest } from "../../worker/src/injuries.js";
import { ESPN_HEADERS } from "../../worker/src/wnba.js";

// Records ESPN's injury report of today, trimmed to what the rosters keep of it. Run with
// NODE_USE_ENV_PROXY=1 behind a proxy.

/** @param {any} injury */
const trimInjury = ({ status, date, shortComment, athlete, details }) => ({
  status,
  date,
  shortComment,
  athlete: { firstName: athlete.firstName, lastName: athlete.lastName },
  details: {
    type: details?.type,
    side: details?.side,
    detail: details?.detail,
    fantasyStatus: { abbreviation: details?.fantasyStatus?.abbreviation },
  },
});

/** @param {any} report */
const trimReport = (report) => ({
  injuries: report.injuries.map((/** @type {any} */ team) => ({
    id: team.id,
    injuries: team.injuries.map(trimInjury),
  })),
});

async function recordFixture(name) {
  const response = await fetch(nameInjuriesRequest(), { headers: ESPN_HEADERS });
  if (!response.ok) throw new Error(`${response.status} for ${nameInjuriesRequest()}`);
  const file = path.join(import.meta.dirname, `${name}.json`);
  const report = trimReport(await response.json());
  fs.writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), report }));
  console.log(`Wrote ${file}`);
}

const [name] = process.argv.slice(2);
if (!name) {
  console.error("usage: node apps/wnba/tests/fixtures/record-injuries.js <name>");
  process.exit(1);
}
recordFixture(name).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
