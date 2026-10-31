// Shared sports contracts and detail records, validated only in Workers before persistence.
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
});

const Story = z.object({
  title: Identifier,
  lead: Identifier,
  url: Identifier,
  outlet: Identifier,
});
const HighlightFields = {
  id: Identifier,
  story: Story.nullable(),
};
const EspnClip = Clip.extend({ expiresAt: z.string().nullable() });
export const Highlights = z.object({
  ...HighlightFields,
  recap: EspnClip.nullable(),
  plays: z.array(EspnClip),
});
export const BaseballHighlights = z.object({
  ...HighlightFields,
  recap: Clip.extend({ blurb: z.string() }).nullable(),
  plays: z.array(
    Clip.extend({
      half: z.enum(["top", "bottom"]),
      inning: Count.positive().nullable(),
      score: z.tuple([Count, Count]).nullable(),
      scorer: z.enum(["away", "home"]).nullable(),
    }),
  ),
});

const Day = z.iso.date();
export const PositiveId = Count.positive();
export const PlayerId = z.string().regex(/^\d{1,12}$/);
const Nonnegative = z.number().nonnegative();
const Innings = z.string().regex(/^\d+(?:\.[012])?$/);
export const BaseballRate = z
  .union([
    Nonnegative,
    z
      .string()
      .regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/)
      .refine((value) => Number.isFinite(Number(value))),
    z.enum(["-.--", "--", "*.**", ".---"]),
  ])
  .nullable();
const PitcherStart = z.object({
  date: Day,
  opp: Identifier.nullable(),
  home: z.boolean(),
  ip: Innings,
  runs: Count,
  k: Count,
  pitches: NullableCount,
});
export const BaseballPitcherDetails = z.object({
  id: PositiveId,
  firstName: Identifier.nullable(),
  lastName: Identifier,
  hand: z.string().nullable(),
  birthDate: Day.nullable(),
  line: z
    .object({
      starts: Count,
      ip: Innings.nullable(),
      era: BaseballRate,
      k9: Nonnegative.nullable(),
      bb9: Nonnegative.nullable(),
      speed: Nonnegative.nullable(),
    })
    .nullable(),
  pitches: z.array(
    z.object({
      code: Identifier,
      name: Identifier,
      share: Nonnegative.max(1).nullable(),
      mph: Nonnegative.nullable(),
    }),
  ),
  starts: z.array(PitcherStart),
});
export const BaseballQualifiedStarters = z.object({
  starters: z.array(
    z.object({
      id: PositiveId,
      era: Nonnegative.nullable(),
      k9: Nonnegative.nullable(),
      bb9: Nonnegative.nullable(),
      speed: Nonnegative.nullable(),
    }),
  ),
});
const RotationStart = PitcherStart.pick({ date: true, ip: true, pitches: true });
export const BaseballRotationPitcher = z.object({
  id: PositiveId,
  name: Identifier,
  hand: z.string().nullable(),
  starts: z.array(RotationStart),
});
export const BaseballClubStarts = z.object({
  club: Identifier,
  from: Day,
  through: Day,
  games: z.array(z.object({ date: Day, id: PositiveId })),
  pitchers: z.array(BaseballRotationPitcher),
});

const PlayerNameFields = { firstName: z.string(), lastName: z.string() };
/** @param {{ firstName: string, lastName: string }} name */
const hasPlayerName = ({ firstName, lastName }) => !!(firstName.trim() || lastName.trim());
const BasketballPlayerName = z.object(PlayerNameFields).refine(hasPlayerName);
export const BasketballRosterFacts = z.object({
  id: PlayerId,
  number: z.string().nullable(),
  position: z.string().nullable(),
  height: z.string().nullable(),
  age: NullableCount,
  college: z.string().nullable(),
  country: z.string().nullable(),
  debut: Count.positive().nullable(),
  out: z
    .object({
      reason: z.string().nullable(),
      isForSeason: z.boolean(),
      sentence: z.string().nullable(),
      updated: z.string().nullable(),
    })
    .nullable(),
});
const RosterPlayer = BasketballRosterFacts.extend(PlayerNameFields).refine(hasPlayerName);
export const BasketballRoster = z.object({
  team: Identifier,
  season: Count.positive(),
  coach: z.string().nullable(),
  players: z.array(RosterPlayer),
});
export const BasketballPlayerTotals = z
  .object({
    PLAYER_ID: PositiveId,
    PLAYER_NAME: Identifier,
    GP: Count,
    MIN: Nonnegative,
    PTS: Count,
    REB: Count,
    AST: Count,
    STL: Count.nullish(),
    BLK: Count.nullish(),
    TOV: Count.nullish(),
    FGM: Count.nullish(),
    FGA: Count.nullish(),
    FG3M: Count.nullish(),
    FG3A: Count.nullish(),
    FTM: Count.nullish(),
    FTA: Count.nullish(),
  })
  .refine((line) =>
    [
      [line.FGM, line.FGA],
      [line.FG3M, line.FG3A],
      [line.FTM, line.FTA],
    ].every(([made, attempted]) => made == null || attempted == null || made <= attempted),
  );
export const BasketballPlayerGame = z.object({
  gameId: Identifier,
  day: Day,
  isPlayoffs: z.boolean(),
  isWin: z.boolean(),
  teamScore: NullableCount,
  opponentScore: NullableCount,
  points: Count,
  rebounds: Count,
  assists: Count,
  minutes: Nonnegative,
  steals: Count.nullish(),
  blocks: Count.nullish(),
  turnovers: Count.nullish(),
  fieldGoalsMade: Count.nullish(),
  fieldGoalsAttempted: Count.nullish(),
  threesMade: Count.nullish(),
  threesAttempted: Count.nullish(),
  freeThrowsMade: Count.nullish(),
  freeThrowsAttempted: Count.nullish(),
});
export const BasketballTeamGame = z.object({
  teamId: PositiveId,
  gameId: Identifier,
  points: Count,
  plusMinus: z.number().int(),
  opponentPoints: Count,
  minutes: Nonnegative,
});
export const BasketballPlayerNumbers = z.object({
  name: BasketballPlayerName.nullable(),
  totals: BasketballPlayerTotals.nullable(),
  lastGame: BasketballPlayerGame.nullable(),
  playoffPoints: z.record(Identifier, Count),
});
export const BasketballRanks = z.object({
  seasonGames: Count,
  values: z.object({
    points: z.array(Nonnegative),
    rebounds: z.array(Nonnegative),
    assists: z.array(Nonnegative),
    steals: z.array(Nonnegative),
    blocks: z.array(Nonnegative),
    turnovers: z.array(Nonnegative),
    fieldGoalShare: z.array(Nonnegative.max(1)),
    threeShare: z.array(Nonnegative.max(1)),
    freeThrowShare: z.array(Nonnegative.max(1)),
  }),
});

const BaseballHitting = z.object({
  plateAppearances: Count.nullish(),
  gamesPlayed: Count.nullish(),
  atBats: Count.nullish(),
  hits: Count.nullish(),
  doubles: Count.nullish(),
  triples: Count.nullish(),
  homeRuns: Count.nullish(),
  rbi: Count.nullish(),
  runs: Count.nullish(),
  baseOnBalls: Count.nullish(),
  strikeOuts: Count.nullish(),
  stolenBases: Count.nullish(),
  avg: BaseballRate.optional(),
  obp: BaseballRate.optional(),
  slg: BaseballRate.optional(),
  ops: BaseballRate.optional(),
});
const BaseballPitching = z.object({
  gamesPlayed: Count.nullish(),
  gamesStarted: Count.nullish(),
  wins: Count.nullish(),
  losses: Count.nullish(),
  strikeOuts: Count.nullish(),
  saves: Count.nullish(),
  baseOnBalls: Count.nullish(),
  inningsPitched: Innings.nullish(),
  era: BaseballRate.optional(),
});
const BaseballRosterPlayer = z.object({
  id: PositiveId,
  name: z.string(),
  number: z.string(),
  position: z.string(),
  injury: z.string().nullable(),
  hitting: BaseballHitting.optional(),
  pitching: BaseballPitching.optional(),
});
export const BaseballRoster = z.object({
  club: Identifier,
  season: Count.positive(),
  players: z.array(BaseballRosterPlayer),
});
const PlayerGameFacts = z.object({
  date: Day,
  opponent: Identifier.nullable(),
  isHome: z.boolean(),
});
export const BaseballLastGames = z.object({
  hitting: z.array(
    PlayerGameFacts.extend(
      BaseballHitting.pick({
        atBats: true,
        hits: true,
        doubles: true,
        triples: true,
        homeRuns: true,
        rbi: true,
        baseOnBalls: true,
      }).shape,
    ),
  ),
  pitching: z.array(
    PlayerGameFacts.extend({
      inningsPitched: Innings.nullish(),
      numberOfPitches: Count.nullish(),
      runs: Count.nullish(),
      strikeOuts: Count.nullish(),
    }),
  ),
});
export const BaseballPlayer = BaseballRosterPlayer.omit({ hitting: true, pitching: true }).extend({
  season: Count.positive(),
  club: Identifier,
  facts: z
    .object({
      bats: z.string().nullable(),
      throws: z.string().nullable(),
      age: NullableCount,
      height: z.string().nullable(),
      weight: NullableCount,
      debut: Count.positive().nullable(),
      birthplace: z.string().nullable(),
    })
    .nullable(),
  out: z
    .object({
      reason: z.string().nullable(),
      sentence: z.string().nullable(),
      updated: z.string().nullable(),
    })
    .nullable(),
  hitting: BaseballHitting.nullable(),
  pitching: BaseballPitching.nullable(),
  postseasonHitting: BaseballHitting.nullable(),
  postseasonPitching: BaseballPitching.nullable(),
  lastGames: BaseballLastGames.nullable(),
});
export const BaseballHitters = z.object({
  hitters: z.array(
    z.object({
      id: PositiveId,
      avg: Nonnegative.nullable(),
      obp: Nonnegative.nullable(),
      slg: Nonnegative.nullable(),
      ops: Nonnegative.nullable(),
      homeRuns: Count,
      rbi: Count,
      runs: Count,
      stolenBases: Count,
      walkRate: Nonnegative.max(1),
      strikeoutRate: Nonnegative.max(1),
    }),
  ),
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
  inningsPitched: Innings,
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
/** @typedef {z.infer<typeof BaseballRotationPitcher>} RotationPitcherRecord */
/** @typedef {z.infer<typeof BasketballRanks>} BasketballRanksRecord */
/** @typedef {z.infer<typeof BasketballPlayerNumbers>} PlayerNumbersRecord */

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
