import { readCalendarDate } from "#shared/days.js";
import { readMlbDay } from "../page/js/dates.js";
import { keepSeenAt } from "../page/js/kept-on-device.js";
import { session } from "../page/js/session.js";
import { listUpdates } from "../page/js/updates.js";
import { renderUpdates } from "../../../shared/page/updates.js";
import { normalizeSpaces, stripTags } from "../../../tests/text.js";

// A season's log with two updates, the Mariners' elimination, noticed at 8:40 PM Eastern on
// Sep 24 though their game ended the night before, and the field's lock at 8:30 PM, as the page
// reads it at 8:44 PM.
export const TWO_UPDATES = [
  {
    kind: "elim",
    team: "SEA",
    via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }],
    ended: "2026-09-24T00:55:00Z",
    at: "2026-09-25T00:40:00Z",
  },
  { kind: "lock", at: "2026-09-25T00:30:00Z" },
];

const READ_AT = Date.parse("2026-09-25T00:44:00Z");

/**
 * The Updates box's count, and each update's time and text, for a season with this log, on a
 * device that has used the app before.
 * @param {object[]} log
 * @param {number} [seenAt] when the device last dismissed the season's box, or 0 for never
 */
export function readUpdateBox(log, seenAt = 0) {
  keepSeenAt(session.activeYear, seenAt);
  session.state = { teams: {}, series: {}, log };
  const box = normalizeSpaces(
    renderUpdates(listUpdates(), [], readCalendarDate(readMlbDay(READ_AT))),
  );
  const items = [
    ...box.matchAll(
      /<li><span class="when">([^<]*)<\/span><span class="what">([\s\S]*?)<\/span><\/li>/g,
    ),
  ];
  return {
    count: box.match(/<span class="updates-count">([^<]*)<\/span>/)[1],
    whens: items.map(([, when]) => when),
    whats: items.map(([, , what]) => stripTags(what).replace(/&mdash;/g, "\u2014")),
  };
}
