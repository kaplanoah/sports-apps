import { renderClubName } from "./clubs.js";
import { isPastMidnight, readMlbDay } from "./dates.js";
import { describeEntry, describeUpdate } from "./entry-text.js";
import { readCalendarDate } from "#shared/days.js";
import { isTouchDevice } from "#shared/device.js";
import { html } from "#shared/html.js";
import { dismissNotes, listNotesToShow, showUpdates } from "#shared/updates.js";
import { keepSeenAt, readSeenAt } from "./kept-on-device.js";
import { RELEASE_NOTES } from "./release-notes.js";
import { session, readSeasonYear } from "./session.js";
import { TEAMS } from "./teams.js";
import { renderGameButton } from "./games-view.js";
import { describeGame, findCommonGames, groupUpdates, isResult } from "./update-groups.js";

function renderUpdateClub(id) {
  return TEAMS[id] ? html`<b>${renderClubName(id)}</b>` : html``;
}

const readTextContext = () => ({
  renderClub: renderUpdateClub,
  teams: session.state?.teams,
  standings: session.standings,
});

// Markup for an entry, or null for one there is nothing to say about.
export const renderEntryText = (entry) => describeEntry(entry, readTextContext());

export const renderUpdateText = (entries) => describeUpdate(entries, readTextContext());

// Freshness goes by when a change was noticed; the list shows when it happened, which for a
// group is when its last game ended.
const readHappenedAt = (entry) => Date.parse(entry.ended || entry.at);

const findHappenedAt = (group) => Math.max(...group.map(readHappenedAt));

const readNoticedAt = (entry) => Date.parse(entry.at);

const FIRST_VISIT_SPAN_MS = 24 * 60 * 60 * 1000;

const readActiveSeenAt = () => readSeenAt(session.activeYear);

const isCurrentSeason = () => session.activeYear === readSeasonYear();

// Until its first dismissal, the box lists the day of updates up to the newest, not the whole
// season, which a new store notices all at once.
function listFirstVisitEntries(entries) {
  const newest = Math.max(...entries.map(readHappenedAt));
  return entries.filter((entry) => newest - readHappenedAt(entry) < FIRST_VISIT_SPAN_MS);
}

function listUnseenEntries(entries) {
  const seen = readActiveSeenAt();
  return seen
    ? entries.filter((entry) => readNoticedAt(entry) > seen)
    : listFirstVisitEntries(entries);
}

export function listFreshUpdates() {
  const described = (session.state.log || []).filter((entry) => entry && renderEntryText(entry));
  return groupUpdates(listUnseenEntries(described)).sort(
    (first, second) => findHappenedAt(second) - findHappenedAt(first),
  );
}

// A series game's entry has its own result, winner first, and any other update is about one game
// only when every entry in it came from the same one.
function readSeriesResult(entry) {
  if (entry.kind === "game") return { team: entry.won, opp: entry.lost, score: entry.runs };
  if (entry.kind === "clinch") return { team: entry.team, opp: entry.over, score: entry.runs };
  return null;
}

function nameUpdateGame(group) {
  const result = readSeriesResult(group[0]);
  if (result) return isResult(result) ? describeGame(result) : null;
  const games = findCommonGames(group);
  return games.length === 1 ? games[0] : null;
}

const describeSlateGame = (game) =>
  describeGame({ team: game.away, opp: game.home, score: game.score });

function listSlateFinals(slate) {
  const today = slate.today.games.map((game) => ({ date: slate.today.date, ...game }));
  return [...today, ...(slate.previous || [])].filter(
    (game) => game.state === "final" && game.score,
  );
}

/**
 * The final in the Games view that an update is about, or null for an update about no one game,
 * or one the Games view no longer lists. The same clubs with the same score again is the latest.
 */
export function findUpdateGame(group, slate) {
  const name = nameUpdateGame(group);
  if (!name || !slate) return null;
  const matches = listSlateFinals(slate).filter((game) => describeSlateGame(game) === name);
  return (
    matches.sort((first, second) => Date.parse(first.end) - Date.parse(second.end)).pop() ?? null
  );
}

function renderUpdateAction(group) {
  const { slate } = session.state;
  const game = findUpdateGame(group, slate);
  return Boolean(game) && renderGameButton(game);
}

// An update's day is MLB's, as the Games view's are, so it counts from MLB's today too.
function describeUpdateGroup(group) {
  const at = findHappenedAt(group);
  return {
    at,
    day: readCalendarDate(readMlbDay(at)),
    endedNextDay: isPastMidnight(at),
    text: renderUpdateText(group),
    action: renderUpdateAction(group),
  };
}

/** What the box lists, newest first. */
export const listUpdates = () => listFreshUpdates().map(describeUpdateGroup);

// Each device keeps its own dismissal, so the box shows only on phones and tablets, not again on
// each computer.
export function renderUpdates() {
  const isShown = isTouchDevice() && isCurrentSeason();
  const updates = isShown ? listUpdates() : [];
  showUpdates(/** @type {HTMLElement} */ (document.getElementById("updates")), updates, {
    dismiss: dismissUpdates,
    notes: isShown ? listNotesToShow(RELEASE_NOTES, readActiveSeenAt()) : [],
    today: readCalendarDate(readMlbDay(Date.now())),
  });
}

// Updates are stamped by the Worker's clock, so the dismissal goes by the newest of them, not by
// this device's clock, which can be off.
function dismissUpdates() {
  const noticed = listFreshUpdates().flatMap((group) => group.map(readNoticedAt));
  if (noticed.length) keepSeenAt(session.activeYear, Math.max(...noticed));
  dismissNotes(RELEASE_NOTES);
  renderUpdates();
}
