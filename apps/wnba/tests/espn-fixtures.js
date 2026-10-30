import { readFileSync } from "node:fs";
import { ESPN_DAY_REQUEST } from "../page/js/snapshot.js";

// ESPN's scoreboards of Sep 30 and Oct 1 the next morning, with both games of Sep 30 finished.
const ESPN = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-days.json`, "utf8"),
);

const SEP_30 = ESPN_DAY_REQUEST("20260930");

const SCHEDULED = {
  clock: 0,
  displayClock: "0.0",
  period: 0,
  type: { name: "STATUS_SCHEDULED", state: "pre", completed: false, shortDetail: "Scheduled" },
};

/** @param {any} event */
function unplayEvent(event) {
  const [competition] = event.competitions;
  for (const competitor of competition.competitors) competitor.score = "0";
  competition.status = SCHEDULED;
  event.status = SCHEDULED;
}

/**
 * ESPN's scoreboard of Sep 30 as it stood that afternoon, before either game tipped off, by its
 * URL, and with `changeEvents` applied to its games.
 * @param {(events: any[]) => any[]} [changeEvents]
 */
export function readAfternoonEspn(changeEvents = (events) => events) {
  const answer = structuredClone(ESPN.answers[SEP_30]);
  answer.events.forEach(unplayEvent);
  answer.events = changeEvents(answer.events);
  return { [SEP_30]: answer };
}
