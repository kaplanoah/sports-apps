import test from "node:test";
import assert from "node:assert/strict";
import { html } from "../shared/page/html.js";
import { renderSeasonSeries } from "../shared/page/season-series.js";
import { EASTERN, checkInTimeZone } from "./time-zone.js";

/** @type {import("../shared/page/season-series.js").TeamLooks} */
const LOOKS = {
  renderWinner: (team) => html`<b>${team}</b>`,
  renderLoser: (team) => team,
  nameTeam: (team) => team,
};

/**
 * @param {string} day
 * @param {[string, number]} away
 * @param {[string, number]} home
 */
const makeMeeting = (day, [awayTeam, awayScore], [homeTeam, homeScore]) => ({
  day: new Date(`${day}T00:00:00`),
  away: { team: awayTeam, score: awayScore },
  home: { team: homeTeam, score: homeScore },
});

/** @param {unknown} markup */
const listRows = (markup) =>
  [...String(markup).matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, row]) =>
    row
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

/** @param {unknown} markup */
const readSummary = (markup) =>
  String(markup).match(/<span>((?:Tied|Split|\w+ (?:lead|won)) [^<]+)<\/span>/)?.[1];

test("a season series lists its meetings first to last, a day's meetings in the order they're given", () =>
  checkInTimeZone(EASTERN, () => {
    const meetings = [
      makeMeeting("2026-07-09", ["MIL", 3], ["SD", 1]),
      makeMeeting("2026-05-20", ["MIL", 1], ["SD", 4]),
      makeMeeting("2026-05-20", ["MIL", 5], ["SD", 2]),
      makeMeeting("2026-04-02", ["SD", 6], ["MIL", 0]),
    ];
    const markup = renderSeasonSeries(meetings, { away: "MIL", home: "SD", isOver: false }, LOOKS);
    assert.deepEqual(listRows(markup), [
      "Apr 2 SD 6-0 at MIL",
      "May 20 SD 4-1 vs MIL",
      "May 20 MIL 5-2 at SD",
      "Jul 9 MIL 3-1 at SD",
    ]);
  }));

test("a season series still going reads as a playoff series does, and one that's over says who won it", () => {
  const meetings = [
    makeMeeting("2026-05-20", ["MIL", 5], ["SD", 2]),
    makeMeeting("2026-06-20", ["MIL", 1], ["SD", 4]),
  ];
  const series = { away: "MIL", home: "SD" };
  assert.equal(
    readSummary(renderSeasonSeries(meetings, { ...series, isOver: false }, LOOKS)),
    "Tied 1-1",
  );
  assert.equal(
    readSummary(renderSeasonSeries(meetings, { ...series, isOver: true }, LOOKS)),
    "Split 1-1",
  );
  const sweep = [meetings[0], makeMeeting("2026-06-20", ["MIL", 4], ["SD", 1])];
  assert.equal(
    readSummary(renderSeasonSeries(sweep, { ...series, isOver: false }, LOOKS)),
    "MIL lead 2-0",
  );
  assert.equal(
    readSummary(renderSeasonSeries(sweep, { ...series, isOver: true }, LOOKS)),
    "MIL won 2-0",
  );
});
