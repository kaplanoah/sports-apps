import { findSeries } from "../../page/js/bracket.js";
import { describeKey, isFoundEntry } from "../../page/js/changes.js";
import { nameTeam } from "../../page/js/teams.js";
import { describeUpdate } from "../../page/js/entry-text.js";
import { groupUpdates } from "../../page/js/update-groups.js";
import {
  capNotifications,
  describeAsNotification,
} from "../../../../shared/worker/notifications.js";

// Which new updates become notifications, and what they say.

// A rebuild can find an old change again after changes.js improves, and that is not news.
const RECENT_MS = 60 * 60 * 1000;
// A game's time is when it should have ended, which a delay can put hours before its final.
const RECENT_GAME_MS = 24 * 60 * 60 * 1000;

// The clubs an update is about, or null when it is about the whole field.
function listEntryClubs(entry, state) {
  switch (entry.kind) {
    case "lock":
      return null;
    case "game": {
      const series = findSeries(state, entry.series);
      return [entry.won, series?.teamA, series?.teamB];
    }
    case "field":
      return [entry.in, entry.out];
    default:
      return [entry.team, entry.over];
  }
}

// Every device's ranking lists every club in the field, so an update about any of them is news.
function isAboutField(entry, state) {
  const clubs = listEntryClubs(entry, state);
  return clubs === null || clubs.some((id) => id && state.teams[id]);
}

const isRecent = (entry, now) =>
  Date.parse(entry.at) >= now - (isFoundEntry(entry) ? RECENT_MS : RECENT_GAME_MS);

// Grouped before the field is checked, so a club's update brings along the eliminations it caused.
/**
 * @param {object} options
 * @param {Record<string, any>[]} options.before the updates before this snapshot was saved
 * @param {Record<string, any>[]} options.after the updates after
 * @param {{ teams: object, series: object }} options.state
 * @param {number} options.now
 */
export function findNotableUpdates({ before, after, state, now }) {
  const known = new Set(before.map(describeKey));
  const fresh = after.filter((entry) => !known.has(describeKey(entry)) && isRecent(entry, now));
  return groupUpdates(fresh).filter((group) => group.some((entry) => isAboutField(entry, state)));
}

export function describeNotification(group, context) {
  const markup = describeUpdate(group, { renderClub: nameTeam, ...context });
  return markup ? describeAsNotification(markup, describeKey(group[0])) : null;
}

export function listNotifications(groups, context) {
  const messages = groups.map((group) => describeNotification(group, context)).filter(Boolean);
  return capNotifications(messages, (count) => `${count} more updates`);
}
