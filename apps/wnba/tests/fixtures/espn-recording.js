import {
  nameScoreboardRequest,
  nameSummaryRequest,
  findEventId,
} from "../../worker/src/adapters/lead.js";
import { ESPN_HEADERS } from "../../worker/src/wnba.js";

// What the recorders share for reading a game from ESPN: its day's scoreboard, trimmed to how the
// Worker finds the game, and the game's summary, trimmed as each recorder needs.

export async function fetchEspnJson(url) {
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

export async function recordEspnGame(game, trimSummary) {
  const scoreboard = await fetchEspnJson(nameScoreboardRequest(game.start));
  const eventId = findEventId(scoreboard, game);
  if (!eventId) throw new Error(`ESPN has no ${game.away} at ${game.home} that day`);
  const summary = await fetchEspnJson(nameSummaryRequest(eventId));
  return { game, eventId, scoreboard: trimScoreboard(scoreboard), summary: trimSummary(summary) };
}
