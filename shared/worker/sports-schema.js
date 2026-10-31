// App-owned sports records, validated only in the Worker before persistence.
import { z } from "zod";

z.config({ jitless: true });

const Identifier = z.string().min(1);
const Count = z.number().int().nonnegative();
const NullableCount = Count.nullable();
const Start = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .nullable();
const BasketballState = z.enum(["pre", "live", "final"]);
const GameState = z.enum(["pre", "live", "final", "off"]);
const BaseballRound = z.enum(["WC", "DS", "CS", "WS"]);
const BaseballLeague = z.enum(["AL", "NL"]).nullable();

export const IDENTITY_TYPES = /** @type {const} */ (["game", "player"]);

const IdentityEvidence = z.looseObject({
  method: z.enum(["existing-id", "discovery", "teams-day", "game-number", "player-facts"]),
});
export const IdentityEntry = z.looseObject({
  id: Identifier,
  league: Identifier,
  type: z.enum(IDENTITY_TYPES),
  vendors: z.record(Identifier, Identifier),
  evidence: z.record(Identifier, IdentityEvidence),
});
export const IdentityObservation = z.looseObject({
  type: z.enum(IDENTITY_TYPES),
  vendor: Identifier,
  vendorId: Identifier,
  internalId: Identifier.optional(),
  evidence: IdentityEvidence,
  decisive: z.boolean().optional(),
  disputed: z.boolean().optional(),
  preserveProblem: z.boolean().optional(),
  facts: z.record(z.string(), z.unknown()).optional(),
});
export const VendorGameIdentities = z.array(
  z.object({
    id: Identifier,
    start: Start.optional(),
    away: Identifier.nullable(),
    home: Identifier.nullable(),
    gameNumber: Count.positive().optional(),
  }),
);

const BasketballSide = z.looseObject({
  team: Identifier.nullable(),
  seed: NullableCount,
  score: NullableCount,
  isInBonus: z.boolean(),
});

export const BasketballGame = z.looseObject({
  id: Identifier,
  season: Count.optional(),
  isCupFinal: z.boolean().optional(),
  round: NullableCount,
  series: Identifier.nullable(),
  number: NullableCount,
  start: Start,
  state: BasketballState,
  status: z.string(),
  isTimeSet: z.boolean(),
  period: NullableCount,
  clock: z.string().nullable(),
  isIfNeeded: z.boolean(),
  away: BasketballSide,
  home: BasketballSide,
});

const BaseballSide = z.union([
  Identifier.nullable(),
  z.looseObject({ id: Identifier.nullable(), score: Count.optional() }),
]);

export const BaseballGame = z.looseObject({
  id: Identifier,
  season: Count.optional(),
  round: BaseballRound.nullable().optional(),
  league: BaseballLeague.optional(),
  gameNumber: Count.positive().optional(),
  state: GameState,
  start: Start,
  away: BaseballSide,
  home: BaseballSide,
  score: z.tuple([Count, Count]).optional(),
  inning: Count.optional(),
  outs: Count.optional(),
});

const Season = {
  version: Count,
  season: Count,
  asOf: z.string(),
  missing: z.array(z.string()),
};

const SeriesSide = z.looseObject({ team: Identifier, wins: Count }).nullable();
export const BasketballSeries = z.array(
  z.looseObject({ id: Identifier, round: Count, top: SeriesSide, bottom: SeriesSide }),
);
export const BasketballStandings = z.array(
  z.looseObject({ team: Identifier, wins: Count, losses: Count }),
);
export const BasketballGames = z.array(BasketballGame);

export const BasketballSnapshot = z.looseObject({
  ...Season,
  games: BasketballGames,
  nearestGames: BasketballGames,
  schedule: BasketballGames,
  series: BasketballSeries,
  standings: BasketballStandings,
});

const BaseballDay = z.looseObject({ games: z.array(BaseballGame) });
export const BaseballStandings = z.looseObject({
  divisions: z.record(z.string(), z.array(z.looseObject({ id: Identifier, w: Count, l: Count }))),
});
export const BaseballSeasonDates = z.object({ springStart: Start, regularSeasonEnd: Start });
export const StartingPitchers = z.array(
  z.looseObject({
    id: z.union([Count, Identifier]),
    name: z.string().optional(),
    firstName: z.string().optional(),
    hand: z.string().optional(),
  }),
);
export const BaseballLiveState = z.object({
  state: GameState,
  inning: NullableCount.optional(),
  outs: NullableCount.optional(),
  awayScore: NullableCount.optional(),
  homeScore: NullableCount.optional(),
});

const EspnSide = z.looseObject({ team: Identifier.nullable() });
export const EspnGameState = z.object({
  start: Start.optional(),
  state: BasketballState,
  status: z.string(),
  period: NullableCount,
  clock: z.string().nullable(),
  home: EspnSide.extend({ score: NullableCount }).optional(),
  away: EspnSide.extend({ score: NullableCount }).optional(),
});
export const GameListing = z.object({
  start: Start.optional(),
  isTimeSet: z.boolean(),
  home: EspnSide.optional(),
  away: EspnSide.optional(),
  networks: z.array(z.string()),
});

export const BaseballSnapshot = z.looseObject({
  ...Season,
  springStart: Start,
  teams: z.record(z.string(), z.looseObject({ league: Identifier, seed: Count })),
  series: z.record(
    z.string(),
    z.looseObject({
      winsA: Count,
      winsB: Count,
      round: BaseballRound.optional(),
      league: BaseballLeague.optional(),
    }),
  ),
  log: z.array(
    z.looseObject({
      at: Start,
      kind: z.enum(["game", "clinch"]),
      series: Identifier,
      round: BaseballRound.optional(),
      league: BaseballLeague.optional(),
      score: z.tuple([Count, Count]),
      runs: z.tuple([Count, Count]),
    }),
  ),
  reminderCandidates: z.array(BaseballGame).nullable(),
  standings: BaseballStandings.nullable(),
  slate: z
    .looseObject({
      today: BaseballDay.nullable().optional(),
      lastNight: BaseballDay.nullable().optional(),
      nextDay: BaseballDay.nullable().optional(),
      previous: z.array(BaseballGame).optional(),
      next: z.array(BaseballGame).optional(),
      lastFinal: BaseballGame.nullable().optional(),
      allStar: BaseballGame.nullable().optional(),
    })
    .nullable(),
  schedule: z.record(z.string(), z.array(BaseballGame)).nullable(),
});

export const GameLead = z.object({
  periods: Count,
  isOver: z.boolean(),
  scores: z.array(z.tuple([Count, Count, Count])),
});

const Clip = z.looseObject({
  title: Identifier,
  length: z.number().nonnegative().nullable(),
  still: z.string().nullable(),
  video: Identifier,
  expiresAt: z.string().nullable(),
});

export const Highlights = z.object({
  id: Identifier,
  recap: Clip.nullable(),
  story: z
    .object({ title: Identifier, lead: Identifier, url: Identifier, outlet: Identifier })
    .nullable(),
  plays: z.array(Clip),
});

const BoxScoreSide = z.looseObject({
  team: Identifier.nullable(),
  score: Count,
  periods: z.array(Count),
  stats: z.object({
    fieldGoals: z.tuple([Count, Count]).refine(([made, attempted]) => made <= attempted),
    threePointers: z.tuple([Count, Count]).refine(([made, attempted]) => made <= attempted),
    freeThrows: z.tuple([Count, Count]).refine(([made, attempted]) => made <= attempted),
    rebounds: Count,
    assists: Count,
    turnovers: Count,
    paintPoints: Count,
    benchPoints: Count,
    biggestLead: Count,
  }),
  players: z.array(
    z.looseObject({
      id: Count.nullable(),
      firstName: z.string(),
      lastName: z.string(),
      minutes: z.number().nonnegative(),
      points: Count,
      rebounds: Count,
      assists: Count,
      fouls: Count,
    }),
  ),
});

export const BasketballBoxScore = z.looseObject({
  id: Identifier,
  season: Count.optional(),
  isCupFinal: z.boolean().optional(),
  source: z.literal("espn").optional(),
  state: BasketballState,
  period: NullableCount,
  leadChanges: NullableCount,
  timesTied: NullableCount,
  away: BoxScoreSide,
  home: BoxScoreSide,
});

const BaseballBatter = z.object({
  id: Count,
  name: z.string(),
  position: z.string(),
  isSub: z.boolean(),
  atBats: Count,
  runs: Count,
  hits: Count,
  rbi: Count,
  walks: Count,
  strikeOuts: Count,
});
const BaseballLineupBatter = z.object({
  id: Count,
  name: z.string(),
  position: z.string(),
  average: z
    .string()
    .regex(/^(?:0?\.\d+|1\.0+)$/)
    .nullable(),
  homeRuns: NullableCount,
  rbi: NullableCount,
});
const BaseballPitcher = z.object({
  id: Count,
  name: z.string(),
  decision: z.enum(["W", "L", "S"]).nullable(),
  inningsPitched: z.string().regex(/^\d+(?:\.[012])?$/),
  pitches: Count,
  hits: Count,
  runs: Count,
  earnedRuns: Count,
  walks: Count,
  strikeOuts: Count,
});
const BaseballTotals = z.object({ runs: Count, hits: Count, errors: Count });
const ScoringPlay = z.object({
  batter: z.string(),
  event: z.string(),
  reached: z.boolean(),
  filledBases: z.boolean(),
  scorers: z.array(
    z.object({ name: z.string(), event: z.string(), pinchRunnerFor: z.string().nullable() }),
  ),
  score: z.object({ away: Count, home: Count }).nullable(),
});
const BaseballClub = z.object({
  batters: z.array(z.union([BaseballBatter, BaseballLineupBatter])),
  pitchers: z.array(BaseballPitcher),
});
export const BaseballBoxScore = z.object({
  id: Identifier,
  season: Count.optional(),
  state: GameState,
  innings: z.array(z.object({ away: NullableCount, home: NullableCount })),
  totals: z.object({ away: BaseballTotals, home: BaseballTotals }),
  away: BaseballClub,
  home: BaseballClub,
  scoringHalves: z
    .array(
      z.object({
        side: z.enum(["away", "home"]),
        inning: Count.positive(),
        plays: z.array(ScoringPlay),
      }),
    )
    .nullable(),
  bases: z
    .object({
      half: z.enum(["top", "middle", "bottom", "end"]),
      inning: Count.positive(),
      outs: Count.max(3),
      runners: z.array(
        z.object({
          base: z.enum(["1B", "2B", "3B"]),
          name: z.string(),
          reached: z.string().nullable(),
          pinchRunnerFor: z.string().nullable(),
        }),
      ),
      batter: z.string(),
      pitcher: z.string(),
    })
    .nullable(),
});

export const ReportedPlayers = z.record(
  z.string(),
  z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      reason: z.string().nullable(),
      fantasyStatus: z.string().nullable(),
      sentence: z.string().nullable(),
      updated: z.string().nullable(),
    }),
  ),
);

/** @typedef {z.infer<typeof BasketballGame>} BasketballGameRecord */
/** @typedef {z.infer<typeof BaseballGame>} BaseballGameRecord */
/** @typedef {z.infer<typeof ReportedPlayers>[string][number]} ReportedPlayerRecord */

/**
 * Reject invalid adapter output without putting vendor payloads in health or logs.
 * @template RecordType
 * @param {z.ZodType} schema
 * @param {RecordType} record
 * @returns {RecordType}
 */
export function validateSportsData(schema, record) {
  const result = schema.safeParse(record);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid sports data at ${issue.path.join(".") || "record"}: ${issue.code}`);
  }
  return record;
}
