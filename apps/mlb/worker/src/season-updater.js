import { isSameJson } from "#shared/compare.js";
import { readEasternDay } from "#shared/days.js";
import * as Readings from "./readings.js";
import { guessSeasonYear, hasSpringStarted } from "../../page/js/session.js";
import * as MLBSnapshot from "../../page/js/snapshot.js";

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
 * The slate to save: a read without the standings lists no club's last and next games, so the
 * record keeps those it has.
 * @param {any} slate
 * @param {any} saved the record's
 */
const keepClubGames = (slate, saved) =>
  !slate || MLBSnapshot.hasClubGames(slate)
    ? slate
    : { ...slate, previous: saved?.previous ?? [], next: saved?.next ?? [] };

// The season's one record, which the page reads whole: its field, standings, games, and updates,
// rebuilt from the readings as each update saves them.
async function saveSeason(docs, year, snapshot, parts) {
  const doc = (await docs.read(nameSeasonKey(year))) ?? { year };
  const log = Readings.composeLog(doc.log ?? [], parts, snapshot.log);
  const shown = { ...snapshot, slate: keepClubGames(snapshot.slate, doc.slate) };
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
  doc.edition === MLBSnapshot.SCHEDULE_EDITION &&
  isSameJson(doc.games, games);

// Each month of the season's games keeps a document of its own, saved only when its games change,
// so a game's end sends open pages only its month.
async function saveSchedule(docs, snapshot) {
  if (!snapshot.schedule) return;
  const year = snapshot.season;
  const collection = MLBSnapshot.nameScheduleCollection(year);
  const saved = new Map((await docs.list(collection)).map((doc) => [doc.month, doc]));
  for (const [month, games] of Object.entries(snapshot.schedule)) {
    const doc = saved.get(month);
    if (isSavedSchedule(doc, snapshot, games)) continue;
    await docs.write(MLBSnapshot.nameScheduleKey(year, month), {
      version: snapshot.version,
      edition: MLBSnapshot.SCHEDULE_EDITION,
      year,
      month,
      games,
      updatedAt: snapshot.asOf,
    });
  }
}

export async function saveSnapshot(docs, snapshot) {
  const year = snapshot.season;
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
  const months = await docs.list(MLBSnapshot.nameScheduleCollection(year));
  return (
    months.length > 0 && months.every((month) => month.edition === MLBSnapshot.SCHEDULE_EDITION)
  );
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
