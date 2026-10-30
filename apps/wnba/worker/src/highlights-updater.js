import { createHighlightsJob } from "../../../../shared/worker/highlights-job.js";
import { nameScheduleKey } from "../../page/js/snapshot.js";
import { createHighlightsReader, nameHighlightsKey } from "./adapters/highlights.js";

// Keeps each of the current season's finals' highlights, as the shared job reads them over the
// hours after each game (highlights-job.js). A game from a season before is read on a tap.

// A game the store didn't see end ends about two and a half hours after it starts.
const GAME_LENGTH_MS = 2.5 * 60 * 60 * 1000;

/**
 * The current season's finals, each once, newest first: the season's own copy of a game, which
 * knows when it ended, before the schedule's.
 * @param {import("../../../../shared/worker/season-store.js").JobContext} context
 */
async function listCurrentFinals(context) {
  const season = (await context.docs.read("live/current"))?.season;
  if (!season) return null;
  const [record, schedule] = await Promise.all([
    context.docs.read(`seasons/${season}`),
    context.docs.read(nameScheduleKey(season)),
  ]);
  const byId = new Map();
  for (const game of [
    ...(schedule?.games ?? []),
    ...(record?.nearestGames ?? []),
    ...(record?.games ?? []),
  ])
    byId.set(game.id, game);
  const finals = [...byId.values()]
    .filter((game) => game.state === "final" && !game.allStar)
    .sort((first, second) => Date.parse(second.start) - Date.parse(first.start));
  return { season, games: finals };
}

export function createHighlightsUpdater() {
  return createHighlightsJob({
    listFinals: listCurrentFinals,
    gameLengthMs: GAME_LENGTH_MS,
    readHighlights: async (context, game) => ({
      highlights: await createHighlightsReader({ fetchImpl: context.fetchImpl })(
        {
          id: game.id,
          away: game.away.team,
          home: game.home.team,
          start: game.start,
        },
        context.docs.read,
      ),
      isFinished: true,
    }),
    nameKey: nameHighlightsKey,
  });
}
