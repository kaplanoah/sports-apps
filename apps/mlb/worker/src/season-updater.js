import { settleDivisionRaces } from "../../page/js/standings-rules.js";
import {
  SCHEDULE_EDITION,
  nameScheduleCollection,
  nameScheduleKey,
} from "../../page/js/snapshot.js";
import { isSameJson } from "#shared/compare.js";
import { readEasternDay } from "#shared/days.js";
import * as Readings from "./readings.js";
import { guessSeasonYear, hasSpringStarted } from "../../page/js/session.js";
import { sortInScheduleOrder } from "../../page/js/schedule-order.js";
import * as MLBSnapshot from "./adapters/mlb.js";

// Keeps the current season's saved data up to date from MLB, whether or not a page is open.
// `docs` reads and writes the store's documents: read(key), list(collection), write(key, doc),
// and remove(key).

// Before April the new season starts on the day MLB says spring training does.
export async function loadCurrentSnapshot(loadSnapshot, now) {
  const guess = guessSeasonYear(now);
  const { year } = readEasternDay(now);
  if (year !== guess) {
    const upcoming = await loadSnapshot(year);
    if (hasSpringStarted(upcoming.springStart, now)) return upcoming;
  }
  return loadSnapshot(guess);
}

const nameSeasonKey = (year) => `seasons/${year}`;

const SAVED_FIELDS = [
  "version",
  "teams",
  "series",
  "projected",
  "springStart",
  "standings",
  "slate",
];

// A field is saved only when the feed it comes from answered, so a partial read leaves it as the
// last full one had it.
function listAnsweredFields(snapshot) {
  const hasField = MLBSnapshot.hasKnownField(snapshot);
  const answered = {
    version: true,
    teams: hasField,
    series: hasField,
    projected: hasField,
    springStart: !!snapshot.springStart,
    standings: !!snapshot.standings,
    slate: !!snapshot.slate,
  };
  return SAVED_FIELDS.filter((field) => answered[field]);
}

function collectChangedFields(doc, snapshot, log) {
  const changed = listAnsweredFields(snapshot).filter(
    (field) => !isSameJson(doc[field], snapshot[field]),
  );
  const fields = Object.fromEntries(changed.map((field) => [field, snapshot[field]]));
  if (!isSameJson(doc.log, log)) fields.log = log;
  return fields;
}

/**
 * The finals the record's slate lists before the slate's day: its clubs' last games, and the
 * finals of its own day once MLB's day has moved on past it.
 * @param {any} saved the record's slate
 * @param {string} day
 */
function listPlayedBefore(saved, day) {
  const savedDay = saved?.today?.date;
  const savedToday = (saved?.today?.games ?? [])
    .filter((/** @type {any} */ game) => game.state === "final")
    .map((/** @type {any} */ game) => ({ date: savedDay, ...game }));
  return sortInScheduleOrder(
    [...(saved?.previous ?? []), ...savedToday].filter((game) => game.date < day),
  );
}

/**
 * The slate to save: a read without the standings lists no club's last and next games, so the
 * record keeps those it has that still come before or after the slate's day, since MLB's day may
 * have moved on since they were read.
 * @param {any} snapshot
 * @param {any} saved the record's slate
 */
function keepClubGames({ slate, isSeriesKnown }, saved) {
  if (!slate || isSeriesKnown) return slate;
  const day = slate.today.date;
  return {
    ...slate,
    previous: listPlayedBefore(saved, day),
    next: (saved?.next ?? []).filter((/** @type {any} */ game) => game.date > day),
  };
}

// The season's one record, which the page reads whole: its field, standings, games, and updates,
// rebuilt from the readings as each update saves them.
async function saveSeason(docs, year, snapshot, parts) {
  const doc = (await docs.read(nameSeasonKey(year))) ?? { year };
  const log = Readings.composeLog(doc.log ?? [], parts, snapshot.log);
  const shown = { ...snapshot, slate: keepClubGames(snapshot, doc.slate) };
  const fields = collectChangedFields(doc, shown, log);
  if (!Object.keys(fields).length) return;
  await docs.write(nameSeasonKey(year), { ...doc, ...fields, updatedAt: snapshot.asOf });
}

// A snapshot without standings came from a partial answer, not a change in them.
async function saveReading(docs, year, snapshot) {
  const collection = Readings.nameReadingsCollection(year);
  const parts = Readings.sortParts(await docs.list(collection));
  if (!snapshot.standings) return parts;
  const dayName = Readings.readReadingDay(snapshot);
  const changed = Readings.addReading(parts, dayName, Readings.createReading(snapshot));
  if (!changed) return parts;
  await docs.write(`${collection}/${changed.id}`, changed);
  return Readings.sortParts([...parts.filter((part) => part.id !== changed.id), changed]);
}

// The season's record already holds the expired parts' updates, so the parts can go.
async function removeExpiredReadings(docs, year, snapshot, parts) {
  const expired = Readings.findExpiredParts(parts, Readings.readReadingDay(snapshot));
  const collection = Readings.nameReadingsCollection(year);
  for (const part of expired) await docs.remove(`${collection}/${part.id}`);
}

/**
 * @param {any} doc a month of the season's games as the store keeps it
 * @param {any} snapshot
 * @param {any[]} games the month's games now
 */
const isSavedSchedule = (doc, snapshot, games) =>
  doc?.version === snapshot.version &&
  doc.edition === SCHEDULE_EDITION &&
  isSameJson(doc.games, games);

/**
 * A month's games to save: a read without the standings lists none of its playoff games, so the
 * month keeps those it has.
 * @param {any} snapshot
 * @param {any[]} games the month's games the snapshot lists
 * @param {any} doc the month as the store keeps it
 */
const keepPlayoffGames = (snapshot, games, doc) =>
  snapshot.isSeriesKnown
    ? games
    : sortInScheduleOrder([
        ...games,
        ...(doc?.games ?? []).filter((/** @type {any} */ game) => game.postseason),
      ]);

/** @param {any} snapshot @param {Map<string, any>} saved */
function listScheduleWrites(snapshot, saved) {
  return Object.entries(snapshot.schedule).flatMap(([month, listed]) => {
    const previous = saved.get(month);
    const games = keepPlayoffGames(snapshot, listed, previous);
    return isSavedSchedule(previous, snapshot, games)
      ? []
      : [
          {
            key: nameScheduleKey(snapshot.season, month),
            document: {
              version: snapshot.version,
              edition: SCHEDULE_EDITION,
              year: snapshot.season,
              month,
              games,
              updatedAt: snapshot.asOf,
            },
          },
        ];
  });
}

/** @param {any} doc a month of the season's games as the store keeps it */
const holdsOnlyPlayoffGames = (doc) => (doc.games ?? []).every((game) => game.postseason);

// Only playoff-only months can disappear when a series ends; a partial standings read keeps them.
/** @param {any} snapshot @param {Map<string, any>} saved */
function listDroppedMonths(snapshot, saved) {
  if (!snapshot.isSeriesKnown) return [];
  return [...saved]
    .filter(
      ([month, document]) =>
        !Object.hasOwn(snapshot.schedule, month) && holdsOnlyPlayoffGames(document),
    )
    .map(([month]) => nameScheduleKey(snapshot.season, month));
}

// Each month has its own document so a game update sends open pages only that month.
// A publication revision lets historical consumers skip completed schedules, and an interrupted
// publication remains incomplete so the past-season job repairs it.
async function saveSchedule(docs, snapshot) {
  if (!snapshot.schedule) return;
  const saved = new Map(
    (await docs.list(nameScheduleCollection(snapshot.season))).map((doc) => [doc.month, doc]),
  );
  const writes = listScheduleWrites(snapshot, saved);
  const removed = listDroppedMonths(snapshot, saved);
  const key = nameScheduleRevisionKey(snapshot.season);
  const previous = await docs.read(key);
  const isWhole =
    !snapshot.missing?.length ||
    (previous?.isWhole === true && previous.edition === SCHEDULE_EDITION);
  const changed = writes.length > 0 || removed.length > 0;
  if (!changed && previous?.isWhole === isWhole && previous.edition === SCHEDULE_EDITION) return;
  const revision = (previous?.revision ?? 0) + 1;
  if (changed) await docs.write(key, { edition: SCHEDULE_EDITION, revision, isWhole: false });
  for (const { key, document } of writes) await docs.write(key, document);
  for (const key of removed) await docs.remove(key);
  await docs.write(key, { edition: SCHEDULE_EDITION, revision, isWhole });
}

/**
 * The snapshot with each club's season's games as the record has them where a read without the
 * season's whole schedule couldn't count them, and each division's race settled from them.
 * @param {any} snapshot
 * @param {any} saved the record's standings
 */
function keepScheduledGames(snapshot, saved) {
  if (!snapshot.standings || !saved) return snapshot;
  const savedRows = new Map(
    Object.values(saved.divisions ?? {})
      .flat()
      .map((/** @type {any} */ row) => [row.id, row]),
  );
  const keepRow = (/** @type {any} */ row) => {
    const scheduled = savedRows.get(row.id)?.scheduled;
    return row.scheduled == null && scheduled != null ? { ...row, scheduled } : row;
  };
  const divisions = Object.fromEntries(
    Object.entries(snapshot.standings.divisions).map(([name, rows]) => [
      name,
      /** @type {any[]} */ (rows).map(keepRow),
    ]),
  );
  return {
    ...snapshot,
    standings: { ...snapshot.standings, divisions: settleDivisionRaces(divisions) },
  };
}

export async function saveSnapshot(docs, read) {
  const year = read.season;
  const snapshot = keepScheduledGames(read, (await docs.read(nameSeasonKey(year)))?.standings);
  const parts = await saveReading(docs, year, snapshot);
  await saveSeason(docs, year, snapshot, parts);
  await saveSchedule(docs, snapshot);
  await removeExpiredReadings(docs, year, snapshot, parts);
}

// A season before the current one, read whole, is saved in its record as the current one is, with
// the updates its readings still rebuild, and its games.
export async function savePastSeason(docs, snapshot) {
  const year = snapshot.season;
  const parts = Readings.sortParts(await docs.list(Readings.nameReadingsCollection(year)));
  await saveSeason(docs, year, snapshot, parts);
  await saveSchedule(docs, snapshot);
}

// Whether the store keeps a season's games as the page reads them now, which a season saved before
// it kept them, or before they held what they hold now, lacks.
export async function hasCurrentSchedule(docs, year) {
  const revision = await docs.read(nameScheduleRevisionKey(year));
  if (revision && !revision.isWhole) return false;
  const months = await docs.list(nameScheduleCollection(year));
  return months.length > 0 && months.every((month) => month.edition === SCHEDULE_EDITION);
}

// The updates the page lists, which the season's record keeps rebuilt from the readings.
export async function readUpdates(docs, year) {
  const doc = await docs.read(nameSeasonKey(year));
  return doc?.log ?? [];
}

export function describeSnapshotStatus(snapshot) {
  const missing = snapshot.missing || [];
  return { error: missing.length ? "mlb_fields_missing" : "", detail: missing.join(", ") };
}

/** @param {number} year */
const nameScheduleRevisionKey = (year) => `schedule-revisions/${year}`;

/**
 * Reads a completed schedule's small publication revision. Legacy complete schedules acquire
 * their initial revision once; a missing or obsolete schedule remains unfilled.
 * @param {import("../../../../shared/worker/season-store.js").SeasonDocuments} docs
 * @param {number} year
 * @returns {Promise<string | null>}
 */
export async function ensureScheduleRevision(docs, year) {
  const key = nameScheduleRevisionKey(year);
  let revision = await docs.read(key);
  if (!revision) {
    if (!(await hasCurrentSchedule(docs, year))) return null;
    revision = { edition: SCHEDULE_EDITION, revision: 0, isWhole: true };
    await docs.write(key, revision);
  }
  return revision.isWhole && revision.edition === SCHEDULE_EDITION
    ? `${revision.edition}:${revision.revision}`
    : null;
}
