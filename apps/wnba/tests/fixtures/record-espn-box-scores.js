import fs from "node:fs";
import path from "node:path";
import { ESPN_SITE } from "../../page/js/snapshot.js";
import { TEAMS } from "../../page/js/teams.js";
import { nameScoreboardRequest, nameSummaryRequest, findEventId } from "../../worker/src/lead.js";
import { ESPN_HEADERS } from "../../worker/src/wnba.js";

// Records what the box score reads from ESPN while the league doesn't answer, for the games whose
// league box scores 2026-10-01-games.json holds: each day's scoreboard and each game's summary,
// trimmed to what the Worker reads, and every team's roster on ESPN, by the names ESPN gives.

const GAMES = {
  1042600122: { away: "LVA", home: "IND", start: "2026-09-29T22:30:00Z" },
  1042600112: { away: "GSV", home: "DAL", start: "2026-10-01T01:00:00Z" },
};

// The team stats the box score reads, by ESPN's names.
const TEAM_STATS = [
  "fieldGoalsMade-fieldGoalsAttempted",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted",
  "assists",
  "totalTurnovers",
  "pointsInPaint",
  "largestLead",
  "leadChanges",
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: ESPN_HEADERS });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

const trimScoreboard = ({ events }) => ({
  events: events.map(({ id, competitions }) => ({
    id,
    competitions: competitions.map(({ competitors }) => ({
      competitors: competitors.map(({ homeAway, team }) => ({ homeAway, team: { id: team.id } })),
    })),
  })),
});

const trimCompetition = ({ status, competitors }) => ({
  status: { type: { state: status.type.state, completed: status.type.completed } },
  competitors: competitors.map(({ homeAway, team, score, linescores }) => ({
    homeAway,
    team: { id: team.id },
    score,
    linescores: (linescores ?? []).map(({ displayValue }) => ({ displayValue })),
  })),
});

const trimBoxScore = ({ teams, players }) => ({
  teams: teams.map(({ team, statistics }) => ({
    team: { id: team.id },
    statistics: statistics
      .filter(({ name }) => TEAM_STATS.includes(name))
      .map(({ name, displayValue }) => ({ name, displayValue })),
  })),
  players: players.map(({ team, statistics }) => ({
    team: { id: team.id },
    statistics: statistics.map(({ keys, athletes }) => ({
      keys,
      athletes: athletes.map(({ athlete, starter, didNotPlay, stats }) => ({
        athlete: { displayName: athlete.displayName },
        starter,
        didNotPlay,
        stats,
      })),
    })),
  })),
});

const trimSummary = ({ header, boxscore, plays }) => ({
  header: { competitions: header.competitions.map(trimCompetition) },
  boxscore: trimBoxScore(boxscore),
  plays: plays.map(({ type, team, period, clock, awayScore, homeScore, scoringPlay }) => ({
    type: { text: type?.text },
    team: team && { id: team.id },
    period: { number: period.number },
    clock: { displayValue: clock.displayValue },
    awayScore,
    homeScore,
    scoringPlay,
  })),
});

async function recordGame(game) {
  const scoreboard = await fetchJson(nameScoreboardRequest(game.start));
  const eventId = findEventId(scoreboard, game);
  if (!eventId) throw new Error(`ESPN has no ${game.away} at ${game.home} that day`);
  const summary = await fetchJson(nameSummaryRequest(eventId));
  return { game, eventId, scoreboard: trimScoreboard(scoreboard), summary: trimSummary(summary) };
}

async function recordRoster({ espnId }) {
  const { athletes } = await fetchJson(`${ESPN_SITE}/teams/${espnId}/roster`);
  return athletes.map(({ displayName }) => displayName);
}

async function recordFixture() {
  const games = {};
  for (const [id, game] of Object.entries(GAMES)) games[id] = await recordGame(game);
  const rosters = {};
  for (const [code, team] of Object.entries(TEAMS)) rosters[code] = await recordRoster(team);
  const recordedAt = new Date().toISOString();
  const file = path.join(import.meta.dirname, `${recordedAt.slice(0, 10)}-espn-box-scores.json`);
  fs.writeFileSync(file, JSON.stringify({ recordedAt, games, rosters }));
  console.log(`Wrote ${file}`);
}

recordFixture().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
