import { countSeasonGames, hasWonDivision } from "./standings-rules.js";
import { readEasternDay } from "#shared/days.js";
import { isPlayedBy } from "#shared/game-clubs.js";
import { sortInScheduleOrder } from "./schedule-order.js";

export const MAX_LOG = 50;

const isOutOfIt = (row) => !!row && row.elim === "E" && row.wce === "E";
const parseGamesBack = (value) => {
  const games = parseFloat(String(value).replace("+", ""));
  return isNaN(games) ? 0 : games;
};

function findClosestRoute(row) {
  const routes = [];
  if (row.elim !== "E") routes.push(parseGamesBack(row.gb));
  if (row.wce !== "E") routes.push(parseGamesBack(row.wcgb));
  return routes.length ? Math.min(...routes).toFixed(1) : null;
}

// The club's latest final is the one that moved it.
function findResult(games, club) {
  const game = games.findLast(
    (candidate) => candidate.state === "final" && club && isPlayedBy(candidate, club),
  );
  if (!game) return null;
  const [awayScore, homeScore] = game.score;
  const [own, theirs, opponent] =
    game.away === club ? [awayScore, homeScore, game.home] : [homeScore, awayScore, game.away];
  return { team: club, won: own > theirs, opp: opponent, score: [own, theirs], end: game.end };
}

// A game explains a change only in the direction it pushed: a win for a club that gained, a
// loss for one that lost ground.
function findWin(games, club) {
  const result = findResult(games, club);
  return result && result.won ? result : null;
}

function findLoss(games, club) {
  const result = findResult(games, club);
  return result && !result.won ? result : null;
}

function findLatestEnd(games) {
  const ends = games.map((game) => game.end).filter((end) => !Number.isNaN(Date.parse(end)));
  return ends.sort((first, second) => Date.parse(first) - Date.parse(second)).pop() || null;
}

const dropEnd = ({ end, ...result }) => result;

// `at` is when the change was noticed, so a change found after the last dismissal still
// shows as new. `ended` is when the last game behind it ended: when the change happened.
function createEntry(fields, results, at) {
  const games = results.filter(Boolean);
  const entry = { ...fields };
  if (games.length) entry.via = games.map(dropEnd);
  const ended = findLatestEnd(games);
  if (ended) entry.ended = ended;
  entry.at = new Date(at).toISOString().replace(".000Z", "Z");
  return entry;
}

function findLastWildCard(rows, league) {
  const holders = Object.values(rows)
    .filter((row) => row.div.startsWith(league) && row.wcrank && !row.lead)
    .sort((first, second) => Number(first.wcrank) - Number(second.wcrank));
  return holders.length >= 3 ? holders[2].id : null;
}

function describeSwap(id, gone, newTeams, rows, games, at) {
  const fields = { kind: "field", in: id, out: gone };
  if (newTeams[id].seed <= 3)
    Object.assign(fields, { spot: "division", div: (rows[id] || {}).div || "" });
  else fields.spot = "wildcard";
  const goneRow = rows[gone];
  if (goneRow) {
    fields.outAlive = !isOutOfIt(goneRow);
    const back = findClosestRoute(goneRow);
    if (back != null) fields.outBack = back;
  }
  return createEntry(fields, [findWin(games, id), findLoss(games, gone)], at);
}

function findSeedRises(leagueTeams, oldTeams, games, at) {
  const moved = leagueTeams.filter(([id, team]) => team.seed < oldTeams[id].seed);
  return moved.map(([id, team]) => {
    const fields = { kind: "seed", team: id, from: oldTeams[id].seed, to: team.seed };
    const passed = leagueTeams.filter(
      ([other, otherTeam]) =>
        other !== id && oldTeams[other].seed === team.seed && otherTeam.seed === oldTeams[id].seed,
    );
    const isSwapOnly = moved.length === 1 && passed.length === 1;
    if (isSwapOnly) fields.over = passed[0][0];
    const overLoss = isSwapOnly ? findLoss(games, fields.over) : null;
    return createEntry(fields, [findWin(games, id), overLoss], at);
  });
}

// Seed moves are logged only when the field is unchanged, since a swap moves seeds too,
// and only upward, since every rise implies a fall.
function findFieldChanges(oldTeams, newTeams, rows, games, at, logSeeds) {
  const changes = [];
  for (const league of ["AL", "NL"]) {
    const listLeague = (teams) =>
      Object.entries(teams).filter(([, team]) => team.league === league);
    const sortBySeed = (teams, ids) =>
      ids.sort((first, second) => teams[first].seed - teams[second].seed);
    const arrivals = sortBySeed(
      newTeams,
      listLeague(newTeams)
        .map(([id]) => id)
        .filter((id) => !oldTeams[id]),
    );
    const departures = sortBySeed(
      oldTeams,
      listLeague(oldTeams)
        .map(([id]) => id)
        .filter((id) => !newTeams[id]),
    );

    arrivals.forEach((id, index) => {
      const gone = departures[index];
      changes.push(
        gone
          ? describeSwap(id, gone, newTeams, rows, games, at)
          : createEntry({ kind: "field", in: id }, [], at),
      );
    });
    for (const id of departures.slice(arrivals.length))
      changes.push(createEntry({ kind: "field", out: id }, [], at));

    if (logSeeds && !arrivals.length && !departures.length)
      changes.push(...findSeedRises(listLeague(newTeams), oldTeams, games, at));
  }
  return changes;
}

// Each step up is its own news. A wild card after a playoff spot only rules out the
// division, so it shares the playoff spot's rank.
const BERTH_RANKS = { playoff: 1, wildcard: 1, division: 2, bye: 3 };
const CLINCH_MARKERS = new Set(["x", "w", "y", "z"]);

// MLB's clinch marker says a club is in, but the division comes from the standings.
function readBerth(row, rows) {
  const divisionRows = Object.values(rows).filter((other) => other.div === row.div);
  if (hasWonDivision(row, divisionRows)) return row.clinch === "z" ? "bye" : "division";
  if (row.clinch === "w") return "wildcard";
  return CLINCH_MARKERS.has(row.clinch) ? "playoff" : null;
}

function findBerthWon(before, after, id) {
  const now = readBerth(after[id], after);
  const was = readBerth(before[id], before);
  return now && BERTH_RANKS[now] > (was ? BERTH_RANKS[was] : 0) ? now : null;
}

const DIVISION_BERTHS = new Set(["division", "bye"]);

// A division is won once the last rival is out of it, so a rival's loss can win it for a
// club that didn't play.
function findRivalLosses(before, after, id, games) {
  const rivals = Object.values(after).filter(
    (row) =>
      row.id !== id &&
      row.div === after[id].div &&
      row.elim === "E" &&
      before[row.id]?.elim !== "E",
  );
  return rivals.map((row) => findLoss(games, row.id));
}

function findBerth(id, before, after, games, at) {
  const berth = findBerthWon(before, after, id);
  if (!berth) return null;
  const fields = { kind: "berth", team: id, what: berth };
  if (berth === "division") fields.div = after[id].div;
  const rivalLosses = DIVISION_BERTHS.has(berth) ? findRivalLosses(before, after, id, games) : [];
  return createEntry(fields, [findWin(games, id), ...rivalLosses], at);
}

function findChaser(oldRow, row, after) {
  if (oldRow.wce !== "E") return findLastWildCard(after, row.div.slice(0, 2));
  if (oldRow.elim !== "E")
    return (Object.values(after).find((other) => other.div === row.div && other.lead) || {}).id;
  return null;
}

// The race a club went out of, and the most wins it can reach against the chaser's.
function describeRace(oldRow, after, id, chaser) {
  if (!chaser) return {};
  const race = oldRow.wce !== "E" ? "wildcard" : after[id].div;
  const most = countSeasonGames(after[id]) - Number(after[id].l);
  const target = Number(after[chaser].w);
  return Number.isFinite(most) && Number.isFinite(target) ? { race, most, target } : { race };
}

const countPlayed = (row) => (row ? Number(row.w) + Number(row.l) : NaN);
const hasNewResult = (before, after, id) => countPlayed(after[id]) > countPlayed(before[id]);

// When a club's loss and its chaser's win both counted, the one the standings took in last
// decided it. Taken in together, neither did.
function findDecider(before, after, loss, chaserWin) {
  if (!loss || !chaserWin || loss.opp === chaserWin.team) return {};
  const isLossNew = hasNewResult(before, after, loss.team);
  if (isLossNew === hasNewResult(before, after, chaserWin.team)) return {};
  return { decider: isLossNew ? loss.team : chaserWin.team };
}

function findElimination(id, before, after, games, at) {
  const chaser = findChaser(before[id], after[id], after);
  const loss = findLoss(games, id);
  const chaserWin = findWin(games, chaser);
  /** @type {Record<string, any>} */
  const fields = {
    kind: "elim",
    team: id,
    ...describeRace(before[id], after, id, chaser),
    ...findDecider(before, after, loss, chaserWin),
  };
  const ownWin = findWin(games, id);
  if (ownWin) fields.despite = dropEnd(ownWin);
  return createEntry(fields, [loss, chaserWin], at);
}

function findStandingsChanges(before, after, games, at) {
  const clubs = Object.keys(after).filter((id) => before[id]);
  const berths = clubs.map((id) => findBerth(id, before, after, games, at));
  const eliminated = clubs.filter((id) => isOutOfIt(after[id]) && !isOutOfIt(before[id]));
  const eliminations = eliminated.map((id) => findElimination(id, before, after, games, at));
  return [...berths.filter(Boolean), ...eliminations];
}

const listGames = (reading) => sortInScheduleOrder(Object.values(reading.games));

// The news between two readings from the Worker's readings.js, stamped with the later one's time.
export function findChanges(before, after) {
  const games = listGames(after);
  const changes = [];

  const hadField = Object.keys(before.teams).length > 0;
  const locked = before.projected !== false && after.projected === false;
  if (locked && hadField) changes.push(createEntry({ kind: "lock" }, [], after.at));
  if (hadField && (after.projected !== false || locked)) {
    changes.push(
      ...findFieldChanges(before.teams, after.teams, after.rows, games, after.at, !locked),
    );
  }
  changes.push(...findStandingsChanges(before.rows, after.rows, games, after.at));
  return changes;
}

const FOUND_KINDS = new Set(["lock", "field", "seed", "berth", "elim"]);

// Whether findChanges made this entry, so a rebuild from readings can make it again.
export const isFoundEntry = (entry) => FOUND_KINDS.has(entry.kind);

// MLB's day, which runs past midnight UTC through the evening's games.
function readEntryDay(entry) {
  const at = Date.parse(entry.at);
  return Number.isNaN(at) ? String(entry.at) : readEasternDay(at).date;
}

// A field or seed change can recur on a later day, so its key carries the day.
export function describeKey(entry) {
  switch (entry.kind) {
    case "game":
      return `game:${entry.series}:${entry.game}`;
    case "clinch":
      return `clinch:${entry.series}`;
    case "lock":
      return "lock";
    case "elim":
      return `elim:${entry.team}`;
    case "berth":
      return `berth:${entry.team}:${entry.what}`;
    case "field":
      return `field:${entry.in || ""}:${entry.out || ""}:${readEntryDay(entry)}`;
    case "seed":
      return `seed:${entry.team}:${entry.to}:${readEntryDay(entry)}`;
    default:
      return `${entry.kind}:${entry.at}`;
  }
}

export function mergeLog(log, entries) {
  const seen = new Set();
  const merged = [...(log || []), ...entries].filter((entry) => {
    if (!entry || !entry.kind) return false;
    const key = describeKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  merged.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
  return merged.slice(-MAX_LOG);
}
