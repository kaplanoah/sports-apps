import { findSeriesBetween, isEliminated } from "./bracket.js";
import { renderCatchUpLines } from "#shared/catch-up-note.js";
import { nameDay } from "#shared/days.js";
import { html } from "#shared/html.js";
import { fillStamp, renderStampLine, renderStampWhen } from "#shared/stamp.js";
import { readRanking } from "./kept-on-device.js";
import { findStandingsRow } from "./race.js";
import { isFieldSet, session } from "./session.js";
import { describeLastStamp, describeSeriesNote, describeUpNextGame } from "./stamp.js";

function isAliveInStandings(id) {
  const row = findStandingsRow(id);
  return !row || !(row.elim === "E" && row.wce === "E");
}

const describeSeriesAfter = (game) =>
  describeSeriesNote(findSeriesBetween(session.state, game.away, game.home));

function buildStampContext() {
  const projected = !isFieldSet();
  const isAliveInBracket = (id) =>
    !!(session.state.teams && session.state.teams[id]) && !isEliminated(session.state, id);
  return {
    ranking: readRanking(session.activeYear),
    alive: projected ? isAliveInStandings : isAliveInBracket,
    seriesNote: projected ? () => "" : describeSeriesAfter,
    now: new Date(),
  };
}

function renderLiveLines() {
  if (!session.state.slate) return [];
  const context = buildStampContext();
  const latest = describeLastStamp(session.state.slate, context);
  const lines = latest ? [html`<span>${latest}</span>`] : [];
  const next = describeUpNextGame(session.state.slate, context);
  if (next) {
    const at = new Date(next.at);
    lines.push(
      renderStampLine(
        "Next first pitch",
        next.tbd ? nameDay(at, context.now) : renderStampWhen(at, context.now),
        next.text,
      ),
    );
  }
  return lines;
}

// A season with no games to follow, like a past one, says only when its record was saved.
function renderSavedLines() {
  const savedAt = Date.parse(session.season?.updatedAt);
  return Number.isNaN(savedAt)
    ? []
    : [renderStampLine("Saved", renderStampWhen(new Date(savedAt)))];
}

function renderStampLines() {
  if (!session.state) return [];
  return session.state.slate ? renderLiveLines() : renderSavedLines();
}

// The store's status is about the current season's updates, so another season's page leaves it out.
function describeStatusProblem() {
  const { status } = session;
  if (session.activeYear !== session.currentSeason) return "";
  if (status?.error === "mlb_fields_missing")
    return `MLB stopped sending ${status.detail}, so some details may be blank`;
  if (status?.error === "upstream_error")
    return "Couldn't reach live scores. Trying again shortly.";
  return "";
}

export function renderStamp() {
  const problems = [session.problem, describeStatusProblem()].filter(Boolean);
  fillStamp(
    document.getElementById("stamp"),
    [...renderCatchUpLines(), ...renderStampLines()],
    problems,
  );
}
