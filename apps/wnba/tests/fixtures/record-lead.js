import fs from "node:fs";
import path from "node:path";
import { recordEspnGame } from "./espn-recording.js";

// Records what the game sheet's lead chart reads from ESPN for one game: the day's scoreboard and
// the game's summary, each trimmed to what the Worker reads.

const trimSummary = ({ header, plays }) => ({
  header: {
    competitions: header.competitions.map(({ status }) => ({
      status: { type: { completed: status.type.completed } },
    })),
  },
  plays: plays.map(({ period, clock, awayScore, homeScore, scoringPlay }) => ({
    period: { number: period.number },
    clock: { displayValue: clock.displayValue },
    awayScore,
    homeScore,
    scoringPlay,
  })),
});

async function recordFixture(name, game) {
  const fixture = await recordEspnGame(game, trimSummary);
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [name, away, home, start] = process.argv.slice(2);
if (!name || !away || !home || !start) {
  console.error("usage: node apps/wnba/tests/fixtures/record-lead.js <name> <away> <home> <start>");
  process.exit(1);
}
recordFixture(name, { away, home, start }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
