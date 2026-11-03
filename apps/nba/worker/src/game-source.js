import { createGameAdapter } from "./adapters/games.js";
import { requireIdentityLookup } from "./identity-policy.js";
import {
  BasketballGameFacts,
  validateSportsData,
} from "../../../../shared/worker/sports-schema.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";
import {
  RequestBudgetExhausted,
  HISTORY_REQUESTS_PER_RUN,
} from "../../../../shared/worker/request-budget.js";

const nameMonthKey = (season, day) => `nbaMonths/${season}-${day.slice(0, 7)}`;

/**
 * Independent source records are not a merged snapshot or reminder confirmation.
 * @param {object} options
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} options.storage
 * @param {import("../../../../shared/worker/season-store.js").SeasonDocuments} options.docs
 * @param {import("./identity-policy.js").IdentityLookup | null} options.identityLookup
 * @param {typeof fetch} options.fetchImpl
 * @param {() => number} options.now
 */
export function createGameSourceReader({ storage, docs, identityLookup, fetchImpl, now }) {
  const identities = requireIdentityLookup(identityLookup);
  const readAdapter = createGameAdapter(fetchImpl);
  const keeper = createFeedKeeper({
    storage,
    now,
    feeds: { games: { maxAgeMs: 60_000, changesWithGames: false } },
  });

  async function validateGames(games, season, day) {
    if (!Array.isArray(games)) throw new Error("Invalid NBA saved games");
    for (const game of games) {
      validateSportsData(BasketballGameFacts, game);
      const entry = await identities.readEntry("game", game.id);
      if (
        game.season !== season ||
        game.day !== day ||
        !/^g_[a-z0-9]{12}$/.test(game.id) ||
        entry?.league !== "nba" ||
        !entry.vendors.espn
      )
        throw new Error("Invalid NBA saved identity");
    }
  }

  async function registerGames(games) {
    const result = [];
    for (const game of games) {
      const vendorId = game.id;
      const facts = {
        season: game.season,
        day: game.day,
        date: game.day,
        start: game.start,
        away: game.away.team,
        home: game.home.team,
        competition: game.competition,
        round: game.round,
        gameNumber: game.gameNumber,
        isCupFinal: game.isCupFinal,
      };
      const id = await identities.discover({ type: "game", vendor: "espn", vendorId, facts });
      const [association] = await identities.save([
        {
          type: "game",
          vendor: "espn",
          vendorId,
          internalId: id,
          facts,
          evidence: { method: "existing-id" },
          preserveProblem: true,
        },
      ]);
      if (association.disputed) throw new Error("NBA game identity is disputed");
      result.push({ ...game, id });
    }
    return result;
  }

  const load = createReusedLoader(
    async (requestKey) => {
      const [season, day] = JSON.parse(requestKey);
      let failure = "";
      let nextReadAt = Infinity;
      let games = null;
      const key = nameMonthKey(season, day);
      try {
        games = await keeper.readFeed(
          "games",
          `${season}-${day}`,
          async () => registerGames(await readAdapter(season, day)),
          {
            validate: (answer) => validateGames(answer, season, day),
            onFailure: (reason) => {
              failure = reason;
            },
            onNextRead: (at) => {
              nextReadAt = at;
            },
          },
        );
      } catch (error) {
        if (error instanceof RequestBudgetExhausted) throw error;
        const saved = (await docs.read(key))?.days?.[day];
        if (saved) {
          try {
            await validateGames(saved, season, day);
            games = saved;
          } catch {
            games = null;
          }
        }
      }
      if (games)
        await docs.update(key, (stored) => ({ season, days: { ...stored?.days, [day]: games } }));
      return { season, day, games, failure, nextReadAt };
    },
    5000,
    now,
  );
  return { read: (season, day) => load(JSON.stringify([season, day])) };
}

/** @param {{ docs: import("../../../../shared/worker/season-store.js").SeasonDocuments, identityLookup: import("./identity-policy.js").IdentityLookup | null }} context */
export function createStoredGameReader({ docs, identityLookup }) {
  const identities = requireIdentityLookup(identityLookup);
  return async function readGame(id) {
    if (!/^g_[a-z0-9]{12}$/.test(id)) return null;
    const entry = await identities.readEntry("game", id);
    if (entry?.league !== "nba" || !entry.facts?.season || !entry.facts?.day) return null;
    const month = await docs.read(nameMonthKey(entry.facts.season, entry.facts.day));
    const game = month?.days?.[entry.facts.day]?.find((record) => record.id === id) ?? null;
    return game ? validateSportsData(BasketballGameFacts, game) : null;
  };
}

/**
 * The store supplies its already-budgeted fetch only after live work and reminders.
 * @param {{ days: { season: number, day: string }[], createReader: (fetchImpl: typeof fetch, identityLookup: import("./identity-policy.js").IdentityLookup) => ReturnType<typeof createGameSourceReader> }} options
 */
export function createGameHistory({ days, createReader }) {
  const ordered = [...days].sort((first, second) => second.day.localeCompare(first.day));
  if (new Set(ordered.map((entry) => entry.day)).size !== ordered.length)
    throw new Error("Duplicate NBA history day");
  const plan = JSON.stringify(ordered);
  /** @param {import("../../../../shared/worker/season-store.js").JobContext & { identityLookup?: import("./identity-policy.js").IdentityLookup | null }} context */
  return async function updateHistory({
    storage,
    fetchImpl,
    remainingRequests = () => 0,
    now,
    identityLookup,
  }) {
    if (!remainingRequests()) return;
    const identities = requireIdentityLookup(identityLookup);
    const saved = await storage.get("nba-game-history");
    const progress = saved?.plan === plan ? saved : { plan, index: 0, retryAt: 0 };
    if (progress.retryAt > now()) return;
    const reader = createReader(fetchImpl, identities);
    for (
      let count = 0;
      count < HISTORY_REQUESTS_PER_RUN && progress.index < ordered.length && remainingRequests();
      count += 1
    ) {
      const { season, day } = ordered[progress.index];
      const result = await reader.read(season, day);
      if (!result.games || result.failure) {
        progress.retryAt = result.nextReadAt;
        await storage.put("nba-game-history", progress);
        return;
      }
      progress.index += 1;
      progress.retryAt = 0;
      await storage.put("nba-game-history", progress);
    }
  };
}
