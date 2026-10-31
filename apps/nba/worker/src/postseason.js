import { createPostseasonAdapter } from "./adapters/postseason.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KINDS = /** @type {const} */ (["playoffs", "play-in"]);

/**
 * Store-owned source documents remain independent until the shared vendor merge selects facts.
 * @param {object} options
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} options.storage
 * @param {import("../../../../shared/worker/season-store.js").SeasonDocuments} options.docs
 * @param {ReturnType<typeof import("../../../../shared/worker/identity.js").createIdentityLookup>} options.identities
 * @param {typeof fetch} options.fetchImpl
 * @param {() => number} options.now
 */
export function createPostseasonReader({ storage, docs, identities, fetchImpl, now }) {
  const readAdapter = createPostseasonAdapter(fetchImpl);
  const keeper = createFeedKeeper({
    storage,
    now,
    feeds: Object.fromEntries(
      KINDS.map((kind) => [kind, { maxAgeMs: MAX_AGE_MS, changesWithGames: true }]),
    ),
  });

  async function registerGames(answer) {
    if (!("matchups" in answer)) return answer;
    const matchups = [];
    for (const matchup of answer.matchups) {
      if (!matchup.game) {
        matchups.push(matchup);
        continue;
      }
      const { id: vendorId, ...facts } = matchup.game;
      const id = await identities.discover({ type: "game", vendor: "nba", vendorId, facts });
      const [association] = await identities.save([
        {
          type: "game",
          vendor: "nba",
          vendorId,
          internalId: id,
          facts,
          evidence: { method: "existing-id" },
          preserveProblem: true,
        },
      ]);
      if (association.disputed) throw new Error("NBA game identity is disputed");
      matchups.push({ ...matchup, game: { ...matchup.game, id } });
    }
    return { ...answer, matchups };
  }

  /** @param {number} season @param {"playoffs" | "play-in"} kind */
  async function readField(season, kind) {
    let failure = "";
    let nextReadAt = Infinity;
    let data;
    const key = `postseason/${season}-${kind}`;
    try {
      data = await keeper.readFeed(
        kind,
        String(season),
        async () => registerGames(await readAdapter(season, kind)),
        {
          onFailure: (reason) => {
            failure = reason;
          },
          onNextRead: (at) => {
            nextReadAt = at;
          },
        },
      );
    } catch {
      data = await docs.read(key);
    }
    if (data) await docs.write(key, data);
    return { kind, data, failure, nextReadAt };
  }

  const read = createReusedLoader(
    async (/** @type {number} */ season) => {
      const fields = await Promise.all(KINDS.map((kind) => readField(season, kind)));
      return {
        season,
        playoffs: fields[0].data,
        playIn: fields[1].data,
        failures: Object.fromEntries(
          fields.filter((field) => field.failure).map((field) => [field.kind, field.failure]),
        ),
        nextReadAt: Math.min(...fields.map((field) => field.nextReadAt)),
      };
    },
    5000,
    now,
  );
  return { read, noteFinalCount: keeper.noteFinalCount };
}
