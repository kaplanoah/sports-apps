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
const GameState = z.enum(["pre", "live", "final", "off"]);

const BasketballSide = z.looseObject({
  team: Identifier.nullable(),
  seed: NullableCount,
  score: NullableCount,
  isInBonus: z.boolean(),
});

export const BasketballGame = z.looseObject({
  id: Identifier,
  round: NullableCount,
  series: Identifier.nullable(),
  number: NullableCount,
  start: Start,
  state: z.enum(["pre", "live", "final"]),
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

export const BasketballSnapshot = z.looseObject({
  ...Season,
  games: z.array(BasketballGame),
  nearestGames: z.array(BasketballGame),
  schedule: z.array(BasketballGame),
  series: z.array(
    z.looseObject({ id: Identifier, round: Count, top: SeriesSide, bottom: SeriesSide }),
  ),
  standings: z.array(z.looseObject({ team: Identifier, wins: Count, losses: Count })),
});

const BaseballDay = z.looseObject({ games: z.array(BaseballGame) });

export const BaseballSnapshot = z.looseObject({
  ...Season,
  teams: z.record(z.string(), z.looseObject({ league: Identifier, seed: Count })),
  series: z.record(z.string(), z.looseObject({ winsA: Count, winsB: Count })),
  log: z.array(
    z.looseObject({
      at: Start,
      kind: z.enum(["game", "clinch"]),
      series: Identifier,
      score: z.tuple([Count, Count]),
      runs: z.tuple([Count, Count]),
    }),
  ),
  reminderCandidates: z.array(BaseballGame).nullable(),
  standings: z
    .looseObject({
      divisions: z.record(
        z.string(),
        z.array(z.looseObject({ id: Identifier, w: Count, l: Count })),
      ),
    })
    .nullable(),
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
    fieldGoals: z.tuple([Count, Count]),
    threePointers: z.tuple([Count, Count]),
    freeThrows: z.tuple([Count, Count]),
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
  source: z.literal("espn"),
  state: z.enum(["live", "final"]),
  period: NullableCount,
  leadChanges: NullableCount,
  timesTied: Count,
  away: BoxScoreSide,
  home: BoxScoreSide,
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
