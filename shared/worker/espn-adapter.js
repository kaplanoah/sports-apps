import { readNameLetters } from "./player-name.js";
export { readNameLetters } from "./player-name.js";
// Shared ESPN sports-data adapter; league mappings and basketball rules are supplied by callers.
import {
  ReportedPlayers,
  VendorGameIdentities,
  GameLead,
  Highlights,
  BasketballBoxScore,
  EspnGameState,
  GameListing,
  validateSportsData,
} from "./sports-schema.js";
import { fetchFeedJson } from "./upstream.js";
import { readEasternDay } from "#shared/days.js";
import { readStoryLead } from "./story-lead.js";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
// ESPN answers any caller, so it needs only to be asked for JSON.
const JSON_HEADERS = { accept: "application/json" };
// ESPN's word for a detail it doesn't know.
const NO_DETAIL = "Not Specified";
// Where ESPN's word isn't the league's.
const REASON_WORDS = { Personal: "Personal reasons" };
// A name that keeps its capital in the middle of a reason.
const PROPER_WORDS = new Set(["Achilles"]);

/** @typedef {import("./sports-schema.js").ReportedPlayerRecord} ReportedPlayer */

// ESPN's report lists today's injuries across a league, with RotoWire's sentence and its date.
// A league supplies team mappings and shown statuses, matching players by their names' letters.
/**
 * The address of a league's report.
 * @param {string} sport ESPN's sport and league, as "basketball/wnba"
 */
export const nameInjuryReportRequest = (sport) => `${ESPN_SITE}/${sport}/injuries`;

/**
 * A league's report of today.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} sport
 * @param {{ headers?: Record<string, string>, cacheSeconds?: number | null }} [options]
 */
export const fetchInjuryReport = (
  fetchImpl,
  sport,
  { headers = JSON_HEADERS, cacheSeconds = null } = {},
) =>
  fetchFeedJson(fetchImpl, nameInjuryReportRequest(sport), {
    feed: "ESPN",
    path: "its injury report",
    headers,
    cacheSeconds,
  });

// A word in capitals, like ACL, or a name keeps its capitals; any other drops its first.
/** @param {string} word */
const lowerWord = (word) =>
  PROPER_WORDS.has(word) || word === word.toUpperCase() ? word : word.toLowerCase();

/**
 * What's wrong, in a phrase that reads on its own: the side, what's hurt, and what's wrong with it,
 * as "Left knee surgery", or null when ESPN doesn't say.
 * @param {{ type?: string, side?: string, detail?: string } | undefined} details
 */
export function describeOutReason({ type, side, detail } = {}) {
  if (!type) return null;
  const words = [side, REASON_WORDS[/** @type {"Personal"} */ (type)] ?? type, detail]
    .filter((part) => part && part !== NO_DETAIL)
    .join(" ")
    .split(" ");
  return [words[0], ...words.slice(1).map(lowerWord)].join(" ");
}

// RotoWire's sentence for a player it knows nothing more about is the one word.
/** @param {unknown} comment */
function readSentence(comment) {
  const sentence = typeof comment === "string" ? comment.trim() : "";
  return sentence && sentence.toLowerCase() !== "out" ? sentence : null;
}

/** @param {unknown} date */
function readTime(date) {
  const time = Date.parse(String(date ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * @param {any} injury one of a team's injuries in ESPN's report
 * @returns {ReportedPlayer}
 */
const describeReportedPlayer = (injury) => ({
  name: readNameLetters(`${injury.athlete.firstName ?? ""} ${injury.athlete.lastName ?? ""}`),
  status: String(injury.status ?? ""),
  reason: describeOutReason(injury.details),
  fantasyStatus: injury.details?.fantasyStatus?.abbreviation ?? null,
  sentence: readSentence(injury.shortComment),
  updated: readTime(injury.date),
});

/**
 * The players a report lists with a status the league shows, by the league's own team codes,
 * leaving out a team the league doesn't know.
 * @param {any} report
 * @param {{ findTeam: (espnId: string) => string | null, isShown: (status: string) => boolean }} league
 * @returns {Record<string, ReportedPlayer[]>}
 */
export function listReportedPlayers(report, { findTeam, isShown }) {
  /** @type {Record<string, ReportedPlayer[]>} */
  const byTeam = {};
  for (const entry of report?.injuries ?? []) {
    const team = findTeam(String(entry.id));
    if (!team) continue;
    byTeam[team] = (entry.injuries ?? [])
      .filter((/** @type {any} */ injury) => injury.athlete && isShown(String(injury.status)))
      .map(describeReportedPlayer);
  }
  return validateSportsData(ReportedPlayers, byTeam);
}

const BACKUP_STATES = { pre: "pre", in: "live", post: "final" };

/**
 * A game's state as ESPN's status names it.
 * @param {any} status ESPN's status of a game
 */
const readEspnGameState = (status) => BACKUP_STATES[status?.type?.state] ?? "pre";

// ESPN's scoreboard gives each score as text, and a stand-in game takes one only as a number.
/** @param {unknown} score */
function readEspnScore(score) {
  const value = typeof score === "string" && score.trim() !== "" ? Number(score) : score;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// An ESPN scoreboard game's competition, when it starts, and its teams, home and away, each as
// `readCompetitorDetails` reads it.
/**
 * @param {any} event
 * @param {(competitor: any) => object} readCompetitorDetails
 */
function readEspnEvent(event, readCompetitorDetails, findTeam) {
  const competition = event.competitions?.[0] ?? {};
  const sides = Object.fromEntries(
    (competition.competitors ?? []).map((competitor) => [
      competitor.homeAway,
      { team: findTeam(competitor.id), ...readCompetitorDetails(competitor) },
    ]),
  );
  return { competition, start: competition.date ?? event.date, home: sides.home, away: sides.away };
}

/** @param {any} competitor */
const readScoredSide = (competitor) => ({ score: readEspnScore(competitor.score) });

/** @param {any} event */
function readBackupGame(event, findTeam) {
  const { competition, start, home, away } = readEspnEvent(event, readScoredSide, findTeam);
  const status = competition.status ?? event.status;
  const state = readEspnGameState(status);
  return validateSportsData(EspnGameState, {
    start,
    state,
    status: status?.type?.shortDetail?.trim() || "",
    period: state === "pre" ? null : (status?.period ?? null),
    clock: state === "live" ? (status?.displayClock ?? null) : null,
    home,
    away,
  });
}

/** @param {{ answers: any[] } | null | undefined} backup */
export const readBackupGames = (backup, findTeam) =>
  (backup?.answers ?? [])
    .flatMap((answer) => answer.events ?? [])
    .map((event) => readBackupGame(event, findTeam));

/** @param {any[]} answers @param {(id: string) => string | null} findTeam */
export function readIdentityGames(answers, findTeam) {
  return validateSportsData(
    VendorGameIdentities,
    answers
      .flatMap((answer) => answer?.events ?? [])
      .flatMap((event) => {
        if (event.id == null) return [];
        const { competition, start, home, away } = readEspnEvent(event, () => ({}), findTeam);
        return [
          {
            id: String(event.id),
            start,
            home: home?.team ?? null,
            away: away?.team ?? null,
            ...(Number.isInteger(competition.gameNumber) && { gameNumber: competition.gameNumber }),
          },
        ];
      }),
  );
}

const isNational = (broadcast) => broadcast.market === "national";
const isLocal = (broadcast) => !isNational(broadcast);

// What an ESPN scoreboard game is on, its national channels first.
export function readNetworkGame(event, findTeam) {
  const { competition, start, home, away } = readEspnEvent(event, () => ({}), findTeam);
  const broadcasts = competition.broadcasts ?? [];
  const ordered = [...broadcasts.filter(isNational), ...broadcasts.filter(isLocal)];
  return validateSportsData(GameListing, {
    start,
    isTimeSet: competition.timeValid === true,
    home,
    away,
    networks: [...new Set(ordered.flatMap((broadcast) => broadcast.names ?? []))],
  });
}

/** @param {any[]} answers @param {(id: string) => string | null} findTeam */
export const readNetworkGames = (answers, findTeam) =>
  answers.flatMap((answer) => answer.events ?? []).map((event) => readNetworkGame(event, findTeam));

// A stored month's listings need no scores, team profiles, links or media.
/** @param {any} answer */
export function trimNetworkAnswer(answer) {
  return {
    events: (answer.events ?? []).map((event) => ({
      id: event.id,
      date: event.date,
      competitions: (event.competitions ?? []).slice(0, 1).map((competition) => ({
        date: competition.date,
        gameNumber: competition.gameNumber,
        timeValid: competition.timeValid,
        competitors: (competition.competitors ?? []).map(({ id, homeAway }) => ({ id, homeAway })),
        broadcasts: (competition.broadcasts ?? []).map(({ market, names }) => ({ market, names })),
      })),
    })),
  };
}

/** @param {string} sport */
export const nameEspnSite = (sport) => `${ESPN_SITE}/${sport}`;
/** @param {number} ms */
export const formatEspnDay = (ms) => readEasternDay(ms).date.replaceAll("-", "");
/** @param {string} sport @param {string} day */
export const nameEspnDayRequest = (sport, day) => `${nameEspnSite(sport)}/scoreboard?dates=${day}`;
/** @param {string} sport @param {string} month */
export const nameEspnNetworksRequest = (sport, month) =>
  `${nameEspnSite(sport)}/scoreboard?dates=${month}&limit=200`;
/** @param {string} sport @param {string} eventId */
export const nameEspnSummaryRequest = (sport, eventId) =>
  `${nameEspnSite(sport)}/summary?event=${eventId}`;
/**
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {number} cacheSeconds
 * @param {Record<string, string>} headers
 */
export const fetchEspnJson = (fetchImpl, url, cacheSeconds, headers) =>
  fetchFeedJson(fetchImpl, url, { feed: "ESPN", headers, cacheSeconds });

/** @param {number} period */
const measurePeriod = (period, rules) =>
  period > rules.regulationPeriods ? rules.overtimeSeconds : rules.quarterSeconds;

/**
 * The seconds played when a period's clock reads `clock`, like 7:58 or, in its last minute, 45.2.
 * @param {number} period
 * @param {string} clock
 */
function countSecondsPlayed(period, clock, rules) {
  const [minutes, seconds] = String(clock).includes(":")
    ? String(clock).split(":").map(Number)
    : [0, Number(clock)];
  const before = Array.from({ length: period - 1 }, (_, index) =>
    measurePeriod(index + 1, rules),
  ).reduce((sum, length) => sum + length, 0);
  const left = Math.min(measurePeriod(period, rules), minutes * 60 + seconds);
  return Math.round(before + measurePeriod(period, rules) - left);
}

/**
 * @param {any} competition
 * @param {"away" | "home"} place
 */
const findCompetitorCode = (competition, place, findTeam) => {
  const competitor = competition?.competitors?.find((each) => each.homeAway === place);
  return findTeam(competitor?.team?.id ?? competitor?.id);
};

/**
 * The day's ESPN game between the two teams, home and away as asked.
 * @param {any} scoreboard
 * @param {{ away: string, home: string }} teams
 */
export function findEventId(scoreboard, { away, home }, findTeam) {
  const event = (scoreboard?.events ?? []).find((each) => {
    const [competition] = each.competitions ?? [];
    return (
      findCompetitorCode(competition, "away", findTeam) === away &&
      findCompetitorCode(competition, "home", findTeam) === home
    );
  });
  return event?.id == null ? null : String(event.id);
}

/**
 * Each scoring play's time in the game, in seconds from tip-off, with the score after it, from a
 * tied start. A game that went to overtime counts its periods past the fourth.
 * @param {any} summary ESPN's game summary
 */
export function describeBasketballLead(summary, rules) {
  const scores = (summary?.plays ?? [])
    .filter((play) => play.scoringPlay && play.period?.number && play.clock?.displayValue)
    .map((play) => [
      countSecondsPlayed(play.period.number, play.clock.displayValue, rules),
      play.awayScore,
      play.homeScore,
    ]);
  const lastPeriod = Math.max(
    rules.regulationPeriods,
    ...(summary?.plays ?? []).map((play) => play.period?.number ?? 0),
  );
  return validateSportsData(GameLead, {
    periods: lastPeriod,
    isOver: summary?.header?.competitions?.[0]?.status?.type?.completed === true,
    scores: [[0, 0, 0], ...scores],
  });
}

/**
 * When the game ended, from the time ESPN logged its last play, or null before ESPN has it.
 * @param {any} summary ESPN's game summary
 */
export const readEndTime = (summary) =>
  (summary?.plays ?? []).findLast((play) => play.type?.text === "End Game")?.wallclock ?? null;

const RECAP_TITLE = /game highlights$/i;

/** @param {any} video */
const findVideo = (video) => video.links?.source?.HD?.href ?? video.links?.source?.href ?? null;

/**
 * A clip as the sheet shows it, or null for one without a video the phone can play.
 * @param {any} video
 */
function describeClip(video) {
  const url = findVideo(video);
  const title = String(video.headline ?? "").trim();
  if (!url || !title) return null;
  return {
    title,
    length: Number.isFinite(video.duration) ? video.duration : null,
    still: video.thumbnail ?? null,
    video: url,
    expiresAt: video.timeRestrictions?.expirationDate ?? null,
  };
}

/** @param {any} video */
const isRecap = (video) => RECAP_TITLE.test(String(video.headline ?? "").trim());

/** @param {any} video */
const readPublished = (video) => Date.parse(video.originalPublishDate) || 0;

/** @param {any[]} videos */
function describeRecap(videos) {
  const video = videos.find(isRecap);
  const clip = video && describeClip(video);
  return clip ? { ...clip, blurb: String(video.description ?? "").trim() } : null;
}

/** @param {any[]} videos */
const listPlayClips = (videos) =>
  videos
    .filter((video) => !isRecap(video))
    .sort((first, second) => readPublished(first) - readPublished(second))
    .map(describeClip)
    .filter(Boolean);

/** @param {any} article ESPN's story on the game */
function describeStory(article) {
  const title = String(article?.headline ?? "").trim();
  const lead = readStoryLead(article?.story);
  const url = article?.links?.web?.href;
  if (article?.type !== "Recap" || !title || !lead || !url) return null;
  return { title, lead, url: String(url).replace(/^http:/, "https:"), outlet: "ESPN" };
}

/**
 * @param {string} id
 * @param {any} summary ESPN's game summary
 */
export function describeHighlights(id, summary) {
  const videos = summary?.videos ?? [];
  return validateSportsData(Highlights, {
    id,
    recap: describeRecap(videos),
    story: describeStory(summary?.article),
    plays: listPlayClips(videos),
  });
}

const ESPN_SOURCE = "espn";

/**
 * Whether a box score is ESPN's, standing in for the league's.
 * @param {any} boxScore
 */
export const isFromEspn = (boxScore) => boxScore?.source === ESPN_SOURCE;

// ESPN numbers players differently; match the league's season list by name and team.
// A player absent from that list keeps no league ID.
/**
 * A team's players on the season's list, by name.
 * @param {any} index the season's list of players (`player-index.js`), or null
 * @param {string | null} team
 */
const mapPlayersByName = (index, team) =>
  new Map(
    (index?.players ?? [])
      .filter((/** @type {any} */ player) => player.team === team)
      .map((/** @type {any} */ player) => [
        readNameLetters(`${player.firstName} ${player.lastName}`),
        player,
      ]),
  );

/**
 * @param {any[]} statistics a team's stats in ESPN's box score
 * @param {string} name
 */
const readStat = (statistics, name) => statistics.find((stat) => stat.name === name)?.displayValue;

/**
 * @param {any[]} statistics
 * @param {string} name
 */
const readCount = (statistics, name) => Number(readStat(statistics, name) ?? 0);

// ESPN writes shooting as made-attempted, like 22-70.
/**
 * @param {any[]} statistics
 * @param {string} name
 */
const readShooting = (statistics, name) =>
  String(readStat(statistics, name) ?? "0-0")
    .split("-")
    .map(Number);

// ESPN's team stats count only its players' rebounds, where the league's count the team's too, as
// ESPN's plays do.
/**
 * @param {any} summary ESPN's game summary
 * @param {string} espnId ESPN's id of the team
 */
const countRebounds = (summary, espnId) =>
  (summary.plays ?? []).filter(
    (/** @type {any} */ play) =>
      String(play.team?.id) === espnId && /^(Offensive|Defensive) Rebound$/.test(play.type?.text),
  ).length;

/**
 * @param {any} entry one of ESPN's players in its box score, with her stats in `keys`' order
 * @param {string[]} keys
 * @param {Map<string, any>} named the team's players on the season's list, by name
 */
function describeEspnPlayer({ athlete, stats }, keys, named) {
  /** @param {string} key */
  const read = (key) => Number(stats[keys.indexOf(key)] ?? 0);
  const listed = named.get(readNameLetters(athlete.displayName));
  const [firstName, ...lastNames] = athlete.displayName.split(" ");
  return {
    id: listed ? Number(listed.id) : null,
    ...(athlete.id != null && {
      espnIdentity: {
        id: String(athlete.id),
        facts: {
          firstName,
          lastName: lastNames.join(" "),
          number: athlete.jersey ?? null,
          birthdate: athlete.dateOfBirth?.slice(0, 10) ?? null,
        },
      },
    }),
    firstName: listed?.firstName ?? firstName,
    lastName: listed?.lastName ?? lastNames.join(" "),
    minutes: read("minutes"),
    points: read("points"),
    rebounds: read("rebounds"),
    assists: read("assists"),
    fouls: read("fouls"),
  };
}

/**
 * @param {any} summary ESPN's game summary
 * @param {any} competitor
 * @param {any} index
 */
function describeEspnTeam(summary, competitor, index, findTeam) {
  const espnId = String(competitor.team.id);
  const team = findTeam(espnId);
  const isTeam = (/** @type {any} */ entry) => String(entry.team?.id) === espnId;
  const statistics = summary.boxscore.teams?.find(isTeam)?.statistics ?? [];
  const [group] = summary.boxscore.players?.find(isTeam)?.statistics ?? [];
  const athletes = (group?.athletes ?? []).filter(
    (/** @type {any} */ entry) => !entry.didNotPlay && entry.stats?.length,
  );
  const named = mapPlayersByName(index, team);
  const players = athletes.map((/** @type {any} */ entry) =>
    describeEspnPlayer(entry, group.keys, named),
  );
  const benchPoints = players
    .filter((_, place) => !athletes[place].starter)
    .reduce((sum, player) => sum + player.points, 0);
  return {
    team,
    score: Number(competitor.score),
    periods: (competitor.linescores ?? []).map((/** @type {any} */ period) =>
      Number(period.displayValue),
    ),
    timeouts: null,
    stats: {
      fieldGoals: readShooting(statistics, "fieldGoalsMade-fieldGoalsAttempted"),
      threePointers: readShooting(
        statistics,
        "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
      ),
      freeThrows: readShooting(statistics, "freeThrowsMade-freeThrowsAttempted"),
      rebounds: countRebounds(summary, espnId),
      assists: readCount(statistics, "assists"),
      turnovers: readCount(statistics, "totalTurnovers"),
      paintPoints: readCount(statistics, "pointsInPaint"),
      benchPoints,
      biggestLead: readCount(statistics, "largestLead"),
    },
    players,
  };
}

/**
 * How many times a basket tied the game, from ESPN's plays.
 * @param {any} summary
 */
const countTimesTied = (summary) =>
  (summary.plays ?? []).filter(
    (/** @type {any} */ play) =>
      play.scoringPlay && play.awayScore === play.homeScore && play.awayScore > 0,
  ).length;

/**
 * ESPN's summary of a game as the league's box score of it, or null before ESPN has one.
 * @param {any} summary ESPN's game summary
 * @param {string} id the league's game id
 * @param {any} index the season's list of players (`player-index.js`), or null
 */
export function describeEspnBoxScore(summary, id, index, findTeam) {
  const competition = summary?.header?.competitions?.[0];
  const state = readEspnGameState(competition?.status);
  const sides = Object.fromEntries(
    (competition?.competitors ?? []).map((/** @type {any} */ competitor) => [
      competitor.homeAway,
      competitor,
    ]),
  );
  if (state === "pre" || !sides.away || !sides.home || !summary.boxscore) return null;
  const away = describeEspnTeam(summary, sides.away, index, findTeam);
  const home = describeEspnTeam(summary, sides.home, index, findTeam);
  const leadChanges = readStat(summary.boxscore.teams?.[0]?.statistics ?? [], "leadChanges");
  return validateSportsData(BasketballBoxScore, {
    id,
    source: ESPN_SOURCE,
    state,
    period: Math.max(away.periods.length, home.periods.length) || null,
    leadChanges: leadChanges === undefined ? null : Number(leadChanges),
    timesTied: countTimesTied(summary),
    away,
    home,
  });
}
