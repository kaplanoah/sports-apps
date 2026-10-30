import { RequestBudgetExhausted } from "../../../../shared/worker/request-budget.js";
import { listPastSeasons } from "../../../../shared/worker/background-job.js";
import { noteFailure, runWithStatus } from "../../../../shared/worker/job-status.js";
import { createHighlightsJob } from "../../../../shared/worker/highlights-job.js";
import { listCurrentFinals, listFinals } from "./game-details-updater.js";
import { findHeadlineStills, forgetOtherSeasonsStills } from "./headline-stills.js";
import {
  describeHighlights,
  fetchGameMedia,
  listStillsToCheck,
  nameHighlightsKey,
} from "./adapters/highlights.js";

// Keeps each of the current season's finals' highlights, as the shared job reads them over the
// hours after each game (highlights-job.js), with each still that has a headline on it swapped
// for the moment (headline-stills.js), a few stills a run, so a game's highlights are kept at once
// and its last stills swapped over the runs after. Past seasons fill from the remaining historical request budget.

// How MLB's highlights are read; raising it reads each kept final once more (highlights-job.js).
const HIGHLIGHTS_VERSION = 1;
// A game MLB hasn't timed yet ends about three hours after it starts.
const GAME_LENGTH_MS = 3 * 60 * 60 * 1000;
const HISTORY_RETRY_MS = 10 * 60 * 1000;

/**
 * @param {import("../../../../shared/worker/job-status.js").RunContext} context
 * @param {any} game
 * @param {number} season
 */
async function readHighlights(context, game, season) {
  const { content, feed } = await fetchGameMedia(context.fetchImpl, game.id);
  const { withHeadlines, isFinished, hasMisses } = await findHeadlineStills(
    context,
    { season, id: String(game.id) },
    listStillsToCheck(content, feed),
  );
  return {
    highlights: describeHighlights(game.id, content, feed, withHeadlines),
    isFinished,
    hasMisses,
  };
}

function createLiveJob() {
  return createHighlightsJob({
    listFinals: listCurrentFinals,
    forgetOtherSeasons: forgetOtherSeasonsStills,
    gameLengthMs: GAME_LENGTH_MS,
    readHighlights,
    nameKey: nameHighlightsKey,
    version: HIGHLIGHTS_VERSION,
  });
}

/** @param {import("../../../../shared/worker/job-status.js").RunContext} context */
async function fillHistory(context) {
  const current = (await context.docs.read("live/current"))?.season;
  if (!Number.isInteger(current)) return;
  for (const season of await listPastSeasons(context.docs, current)) {
    for (const game of await listFinals(context, season)) {
      const key = nameHighlightsKey(game.id);
      if (await context.docs.read(key)) continue;
      const triedKey = `history-tried:${game.id}`;
      if (context.now() - ((await context.storage.get(triedKey)) ?? -Infinity) < HISTORY_RETRY_MS)
        continue;
      try {
        const { content, feed } = await fetchGameMedia(context.fetchImpl, game.id);
        await context.docs.write(key, describeHighlights(game.id, content, feed));
      } catch (error) {
        if (error instanceof RequestBudgetExhausted) return;
        await context.storage.put(triedKey, context.now());
        noteFailure(context.failures, "Reading historical highlights", error);
      }
    }
  }
}

export function createHighlightsUpdater() {
  return {
    ...createLiveJob(),
    updateHistory: (context) =>
      runWithStatus(context, {
        statusKey: "highlights-history/status",
        updateStore: fillHistory,
      }),
  };
}
