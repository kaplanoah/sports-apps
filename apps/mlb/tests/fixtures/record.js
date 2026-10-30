import fs from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../../worker/src/adapters/mlb.js";

async function fetchJson(request) {
  const response = await fetch(MLBSnapshot.MLB_API + request);
  if (!response.ok) throw new Error(`${response.status} for ${request}`);
  return response.json();
}

async function recordFixture(season, name) {
  const now = Date.now();
  const responses = await MLBSnapshot.fetchResponses(fetchJson, season, now);
  const fixture = { season, now: new Date(now).toISOString(), responses };
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [season, name] = process.argv.slice(2);
if (!season || !name) {
  console.error("usage: node apps/mlb/tests/fixtures/record.js <season> <name>");
  process.exit(1);
}
recordFixture(Number(season), name).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
