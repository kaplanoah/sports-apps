import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { composeState, session } from "../page/js/session.js";
import { renderDivisionBlock, renderFieldBlock, renderNextCell } from "../page/js/standings.js";
import { describeTeamStatus, findSeries, nameSeries } from "../page/js/bracket.js";
import { renderCardNote, renderMatchupRow } from "../page/js/bracket-view.js";
import { describeDrought, listRankedOrder, listTitles } from "../page/js/clubs.js";
import { keepRanking } from "../page/js/kept-on-device.js";
import { describeRace, isSeedFinal } from "../page/js/race.js";
import { listSeasonDays, renderGameFaceOff } from "../page/js/games-view.js";
import { listSlateGames } from "../page/js/slate.js";
import { LOOKS } from "../page/js/looks.js";
import { html } from "../../../shared/page/html.js";
import { renderUpdates as renderUpdateBox } from "../../../shared/page/updates.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { formatStampName } from "../page/js/stamp.js";
import {
  findUpdateGame,
  listFreshUpdates,
  listUpdates,
  renderEntryText,
  renderUpdateText,
} from "../page/js/updates.js";
import { normalizeSpaces, stripTags } from "../../../tests/text.js";
import { readFontFaces } from "../../../tests/css-rules.js";
import { EASTERN, checkInTimeZone, useTimeZone } from "../../../tests/time-zone.js";
import { dropSavedStorage, useKeptChoices } from "../../../tests/saved-storage.js";
import { WILD_CARD_SERIES } from "./browser/bracket-rounds.mjs";
import { TWO_UPDATES, readUpdateBox } from "./update-box.js";

// The expected times below are what a viewer in Eastern time sees.
useTimeZone(EASTERN);

function checkAt(isoTime, check) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(isoTime) });
  try {
    return check();
  } finally {
    mock.timers.reset();
  }
}

const describeEntry = (entry) => stripTags(String(renderEntryText(entry)));
const describeUpdate = (entries) =>
  stripTags(String(renderUpdateText(entries)))
    .replace(/&mdash;/g, "--")
    .replace(/&#39;/g, "'");

beforeEach(() => {
  session.state = { teams: {} };
  session.standings = null;
});

const NOON = "2026-09-24T16:00:00Z"; // Thursday, 12:00 PM ET

test("Next column: today, another day, home and away", () =>
  checkAt(NOON, () => {
    const renderCell = (next) => normalizeSpaces(renderNextCell({ next }));
    assert.equal(
      renderCell({ at: "2026-09-25T01:40:00Z", home: false, opp: "ATH" }),
      '<td class="next-cell">Today 9:40 @ ATH</td>',
    );
    assert.equal(
      renderCell({ at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" }),
      '<td class="next-cell">Fri 7:05 vs NYY</td>',
    );
    assert.equal(renderCell(null), '<td class="next-cell">&mdash;</td>');
  }));

test("Next column: a club that's out shows only a postseason game", () =>
  checkAt(NOON, () => {
    const renderCell = (next) => normalizeSpaces(renderNextCell({ next }, { isOut: true }));
    const friday = { at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" };
    assert.equal(renderCell(friday), '<td class="next-cell">&mdash;</td>');
    assert.equal(
      renderCell({ ...friday, postseason: true }),
      '<td class="next-cell">Fri 7:05 vs NYY</td>',
    );
  }));

test("Next column: a postseason opponent not yet known", () =>
  checkAt(NOON, () => {
    const next = { at: "2026-09-25T23:05:00Z", home: true, postseason: true };
    assert.equal(
      normalizeSpaces(renderNextCell({ next })),
      '<td class="next-cell">Fri 7:05 vs TBD</td>',
    );
  }));

test("Next column: shown with a dash when no club has a game left", () => {
  const block = String(
    renderDivisionBlock("AL East", [{ id: "NYY", w: 94, l: 68, pct: ".580", gb: "-" }]),
  );
  assert.match(block, /<th class="left next-cell">Next<\/th>/);
  assert.match(block, /<td class="next-cell">&mdash;<\/td>/);
});

test("update log: a seed pass, with the game behind it", () => {
  const text = describeEntry({
    kind: "seed",
    team: "SD",
    over: "PHI",
    to: 5,
    from: 6,
    via: [{ team: "PHI", won: false, opp: "MIL", score: [1, 4] }],
  });
  assert.equal(
    text,
    "Padres passed the Phillies for the NL 5 seed &mdash; Phillies lost to the Brewers 4-1",
  );
});

const clinchDivision = (team, div, at, ended) => ({
  kind: "berth",
  team,
  what: "division",
  div,
  at,
  ...(ended && { ended }),
});
const listFreshTeams = () =>
  listFreshUpdates().flatMap((group) => group.map((entry) => entry.team));

/**
 * A device's own storage, holding what it kept, for the test.
 * @param {import("node:test").TestContext} t
 * @param {[string, unknown][]} kept
 */
function useDeviceStorage(t, kept) {
  useKeptChoices(kept);
  t.after(dropSavedStorage);
}

const FIRST_TWO_CLINCHES = [
  clinchDivision("TB", "AL East", "2026-09-27T23:00:00Z"),
  clinchDivision("MIL", "NL Central", "2026-09-26T22:00:00Z"),
];

test("Updates box: a new device's first look lists none of the updates already out, and each one after it, whatever its clock says", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T00:00:00Z") });
  useDeviceStorage(t, []);
  session.state = { teams: {}, log: FIRST_TWO_CLINCHES };
  assert.deepEqual(listFreshTeams(), []);

  session.state = {
    teams: {},
    log: [clinchDivision("LAD", "NL West", "2026-09-28T01:00:00Z"), ...FIRST_TWO_CLINCHES],
  };
  assert.deepEqual(listFreshTeams(), ["LAD"]);
});

test("Updates box: a new device's first look before any update lists every update after it", (t) => {
  useDeviceStorage(t, []);
  session.state = { teams: {}, log: [] };
  assert.deepEqual(listFreshTeams(), []);

  session.state = { teams: {}, log: FIRST_TWO_CLINCHES };
  assert.deepEqual(listFreshTeams(), ["TB", "MIL"]);
});

test("Updates box: a new device whose first read of the season failed starts once a read succeeds", (t) => {
  useDeviceStorage(t, []);
  t.after(() => Object.assign(session, { problem: "" }));
  Object.assign(session, { problem: "unreachable", state: { teams: {}, log: [] } });
  assert.deepEqual(listFreshTeams(), []);

  Object.assign(session, { problem: "", state: { teams: {}, log: FIRST_TWO_CLINCHES } });
  assert.deepEqual(listFreshTeams(), []);

  session.state = {
    teams: {},
    log: [clinchDivision("LAD", "NL West", "2026-09-28T01:00:00Z"), ...FIRST_TWO_CLINCHES],
  };
  assert.deepEqual(listFreshTeams(), ["LAD"]);
});

test("Updates box: a device that dismissed an earlier season's box lists every update of this one", (t) => {
  useDeviceStorage(t, [["updatesSeenAt", { [session.activeYear - 1]: Date.parse("2025-09-28") }]]);
  session.state = { teams: {}, log: FIRST_TWO_CLINCHES };
  assert.deepEqual(listFreshTeams(), ["TB", "MIL"]);
});

test("Updates box: after a dismissal, everything noticed since, however long ago it happened", (t) => {
  useDeviceStorage(t, [
    ["updatesSeenAt", { [session.activeYear]: Date.parse("2026-09-27T00:00:00Z") }],
  ]);
  session.state = {
    teams: {},
    log: [
      clinchDivision("TB", "AL East", "2026-09-27T23:00:00Z"),
      clinchDivision("MIL", "NL Central", "2026-09-26T22:00:00Z"),
      clinchDivision("CWS", "AL Central", "2026-09-27T23:00:00Z", "2026-09-20T02:00:00Z"),
    ],
  };
  assert.deepEqual(listFreshTeams(), ["TB", "CWS"]);
});

test("Updates box: a game that ends past midnight names the night it was played", (t) => {
  useDeviceStorage(t, [["updatesSeenAt", { [session.activeYear]: 0 }]]);
  const brewersWin = (game, ended) => ({
    at: ended,
    kind: "game",
    series: "NL_DS1",
    won: "MIL",
    lost: "SD",
    game,
    score: [game, 0],
    runs: [3, 2],
  });
  session.state = {
    teams: {},
    // Saturday's ended at 12:06 AM Sunday, Eastern, and Sunday's that afternoon.
    log: [brewersWin(1, "2026-10-04T04:06:00Z"), brewersWin(2, "2026-10-04T23:22:00Z")],
  };

  const monday = new Date(2026, 9, 5);
  const box = renderUpdateBox(listUpdates(), [], monday).text;
  assert.deepEqual(
    [...box.matchAll(/<span class="when">([^<]*)<\/span>/g)].map((match) => match[1]),
    ["Yesterday", "Saturday night"],
  );
});

test("series names", () => {
  assert.equal(nameSeries("NL_DS2"), "NLDS");
  assert.equal(nameSeries("AL_WC1"), "AL Wild Card Series");
  assert.equal(nameSeries("WS"), "World Series");
});

test("update log: a field change names the spot and how far back the club that dropped out is", () => {
  session.state = { teams: { TEX: { seed: 3 }, BAL: { seed: 5 } } };
  session.standings = {
    divisions: { "AL West": [{ id: "TEX" }, { id: "HOU" }], "AL East": [{ id: "BAL" }] },
  };
  const describeFieldChange = (entry) => describeEntry({ kind: "field", ...entry });
  assert.equal(
    describeFieldChange({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.5",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros \u00bd game back",
  );
  assert.equal(
    describeFieldChange({
      in: "DET",
      out: "BAL",
      spot: "wildcard",
      outBack: "2.0",
      outAlive: true,
      via: [{ team: "DET", won: true, opp: "KC", score: [5, 3] }],
    }),
    "Tigers take an AL wild card spot from the Orioles &mdash; beat the Royals 5-3, Orioles 2 games back",
  );
  // Out altogether: its own "eliminated" entry says so.
  assert.equal(
    describeFieldChange({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.5",
      outAlive: false,
    }),
    "Rangers take the AL West lead from the Astros",
  );
  assert.equal(
    describeFieldChange({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.0",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros even, behind on the tiebreaker",
  );
  assert.equal(
    describeFieldChange({ in: "TEX", out: "HOU" }),
    "Rangers take the AL West lead from the Astros",
  );
  assert.equal(
    describeFieldChange({ in: "BAL", out: "TOR" }),
    "Orioles take an AL wild card spot from the Blue Jays",
  );
});

test("update log: an elimination is plain words", () => {
  assert.equal(describeEntry({ kind: "elim", team: "BAL" }), "Orioles eliminated");
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "Orioles eliminated &mdash; White Sox beat the Royals 9-1",
  );
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      via: [
        { team: "BAL", won: false, opp: "NYY", score: [2, 4] },
        { team: "CWS", won: true, opp: "KC", score: [9, 1] },
      ],
    }),
    "Orioles eliminated &mdash; lost to the Yankees 4-2 and White Sox beat the Royals 9-1",
  );
});

test("update log: an elimination the club's own win didn't prevent says so", () => {
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      despite: { team: "BAL", won: true, opp: "NYY", score: [4, 2] },
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "Orioles eliminated &mdash; beat the Yankees 4-2, but White Sox beat the Royals 9-1",
  );
});

test("update log: a series game's result and where the series stands join with a comma", () => {
  const describeGame = (entry) => describeEntry({ kind: "game", series: "AL_DS1", ...entry });
  assert.equal(
    describeGame({ won: "NYY", lost: "TOR", runs: [5, 3], game: 2, score: [2, 0] }),
    "Yankees beat the Blue Jays 5-3 in Game&nbsp;2, lead the ALDS 2-0",
  );
  assert.equal(
    describeGame({ won: "TOR", lost: "NYY", runs: [4, 1], game: 3, score: [1, 2] }),
    "Blue Jays beat the Yankees 4-1 in Game&nbsp;3, trail the ALDS 1-2",
  );
});

test("update log: each club is its name in bold, without its rank or dot", () => {
  session.state = { teams: { NYY: {}, TOR: {} } };
  const rendered = String(
    renderEntryText({
      kind: "game",
      series: "AL_DS1",
      won: "NYY",
      lost: "TOR",
      runs: [5, 3],
      game: 2,
      score: [2, 0],
    }),
  );
  assert.deepEqual(
    [
      ...rendered.matchAll(
        /<b><button [^>]*>([^<]+)<span class="spoken-only">, team details<\/span><\/button><\/b>/g,
      ),
    ].map(([, name]) => name),
    ["Yankees", "Blue Jays"],
  );
  assert.doesNotMatch(rendered, /rank-tag|class="dot"/);
});

test("update log: clinches", () => {
  const describeBerth = (entry) => describeEntry({ kind: "berth", ...entry });
  assert.equal(
    describeBerth({
      team: "CWS",
      what: "playoff",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "White Sox clinch a playoff spot &mdash; beat the Royals 9-1",
  );
  assert.equal(describeBerth({ team: "NYY", what: "wildcard" }), "Yankees clinch a wild card spot");
  assert.equal(
    describeBerth({ team: "TB", what: "division", div: "AL East" }),
    "Rays clinch the AL East",
  );
  assert.equal(describeBerth({ team: "TB", what: "bye" }), "Rays clinch a first-round bye");
  assert.equal(
    describeBerth({
      team: "HOU",
      what: "division",
      div: "AL West",
      via: [
        { team: "HOU", won: true, opp: "PHI", score: [1, 0] },
        { team: "TEX", won: false, opp: "NYY", score: [7, 8] },
      ],
    }),
    "Astros clinch the AL West &mdash; beat the Phillies 1-0, Rangers lost to the Yankees 8-7",
  );
});

const AT = "2026-09-27T21:43:00Z";
const createResult = (team, won, opp, score) => ({ team, won, opp, score });
const PHILLIES_WIN = createResult("PHI", true, "TB", [7, 3]);
const PHILLIES_CLINCH = {
  kind: "berth",
  team: "PHI",
  what: "playoff",
  via: [PHILLIES_WIN],
  at: AT,
};
const eliminateDiamondbacks = (fields) => ({ kind: "elim", team: "ARI", at: AT, ...fields });
const DIAMONDBACKS_LOSS = createResult("ARI", false, "SF", [2, 5]);

test("grouped updates: a clinch credits its win with the eliminations it decided", () => {
  assert.equal(
    describeUpdate([PHILLIES_CLINCH, eliminateDiamondbacks({ via: [PHILLIES_WIN] })]),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks",
  );
  const padresLoss = createResult("SD", false, "LAD", [2, 6]);
  const dodgersWin = createResult("LAD", true, "SD", [6, 2]);
  assert.equal(
    describeUpdate([
      {
        kind: "berth",
        team: "LAD",
        what: "division",
        div: "NL West",
        via: [dodgersWin, padresLoss],
      },
      { kind: "elim", team: "SD", via: [padresLoss, dodgersWin], at: AT },
    ]),
    "Dodgers clinch the NL West -- beat the Padres 6-2, eliminating them",
  );
});

test("grouped updates: an eliminated club's own loss says whether it counted and when", () => {
  const describeWithLoss = (fields) =>
    describeUpdate([
      PHILLIES_CLINCH,
      eliminateDiamondbacks({ via: [DIAMONDBACKS_LOSS, PHILLIES_WIN], ...fields }),
    ]);
  assert.equal(
    describeWithLoss({ decider: "PHI" }),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks after their 5-2 loss to the Giants",
  );
  assert.equal(
    describeWithLoss({ decider: "ARI" }),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, Diamondbacks eliminated with a 5-2 loss to the Giants",
  );
  assert.equal(
    describeWithLoss({}),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks, who also lost 5-2 to the Giants",
  );
  assert.equal(
    describeUpdate([
      PHILLIES_CLINCH,
      eliminateDiamondbacks({
        via: [PHILLIES_WIN],
        despite: createResult("ARI", true, "SF", [4, 1]),
      }),
    ]),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks despite their 4-1 win over the Giants",
  );
});

test("grouped updates: a club that clinched without winning, and the losses behind it", () => {
  const rangersLoss = createResult("TEX", false, "MIN", [4, 6]);
  const astrosClinch = (via) => ({
    kind: "berth",
    team: "HOU",
    what: "division",
    div: "AL West",
    via,
  });
  assert.equal(
    describeUpdate([
      astrosClinch([rangersLoss]),
      { kind: "elim", team: "TEX", via: [rangersLoss] },
    ]),
    "Astros clinch the AL West -- Rangers eliminated with a 6-4 loss to the Twins",
  );
  const lateLoss = createResult("TEX", false, "NYY", [7, 8]);
  const astrosWin = createResult("HOU", true, "PHI", [1, 0]);
  assert.equal(
    describeUpdate([
      astrosClinch([astrosWin, lateLoss]),
      { kind: "elim", team: "TEX", via: [lateLoss] },
    ]),
    "Astros clinch the AL West -- beat the Phillies 1-0, Rangers eliminated with an 8-7 loss to the Yankees",
  );
  const marinersWin = createResult("SEA", true, "TB", [3, 2]);
  assert.equal(
    describeUpdate([astrosClinch([]), { kind: "elim", team: "TEX", via: [marinersWin] }]),
    "Astros clinch the AL West -- Rangers eliminated by the Mariners' 3-2 win over the Rays",
  );
});

test("grouped updates: one win that put out two clubs shows the win totals", () => {
  const metsWin = createResult("NYM", true, "ATL", [5, 2]);
  const race = { race: "wildcard", target: 89, at: AT };
  const braves = {
    kind: "elim",
    team: "ATL",
    most: 87,
    via: [createResult("ATL", false, "NYM", [2, 5]), metsWin],
    ...race,
  };
  const reds = { kind: "elim", team: "CIN", most: 88, via: [metsWin], ...race };
  const metsClinch = { kind: "berth", team: "NYM", what: "wildcard", via: [metsWin], at: AT };
  assert.equal(
    describeUpdate([metsClinch, braves, reds]),
    "Mets clinch a wild card spot -- beat the Braves 5-2 for their 89th win, eliminating them (87 wins at most) and the Reds (88 at most)",
  );
  assert.equal(
    describeUpdate([metsClinch, braves, { ...reds, most: 89 }]),
    "Mets clinch a wild card spot -- beat the Braves 5-2 for their 89th win, eliminating them (87 wins at most) and the Reds (89 at most, loses the tiebreaker)",
  );
  assert.equal(
    describeUpdate([metsClinch, braves]),
    "Mets clinch a wild card spot -- beat the Braves 5-2, eliminating them",
  );
});

test("grouped updates: eliminations one game decided, with no clinch", () => {
  const metsWin = createResult("NYM", true, "CHC", [4, 3]);
  const giants = {
    kind: "elim",
    team: "SF",
    race: "wildcard",
    most: 88,
    target: 89,
    via: [metsWin],
  };
  const cubs = {
    kind: "elim",
    team: "CHC",
    race: "wildcard",
    most: 87,
    target: 89,
    via: [createResult("CHC", false, "NYM", [3, 4]), metsWin],
  };
  assert.equal(
    describeUpdate([giants, cubs]),
    "Cubs and Giants eliminated -- Mets beat the Cubs 4-3 for their 89th win, in the last wild card spot; Cubs can reach 87 wins at most, Giants 88",
  );
  const { most, target, ...giantsWithoutCounts } = giants;
  assert.equal(
    describeUpdate([cubs, giantsWithoutCounts]),
    "Cubs and Giants eliminated -- Mets beat the Cubs 4-3",
  );
});

test("Next column: a game that has started gives way to the one after it", () =>
  checkAt(NOON, () => {
    const renderCell = (row) => normalizeSpaces(renderNextCell(row));
    const today = { at: "2026-09-24T14:05:00Z", home: true, opp: "MIL" }; // 10:05 AM ET
    const friday = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
    assert.equal(
      renderCell({ next: today, then: friday }),
      '<td class="next-cell">Fri 1:05 @ BOS</td>',
    );
    assert.equal(renderCell({ next: today }), '<td class="next-cell">&mdash;</td>');
  }));

const MORNING_START = "2026-09-24T15:05:00Z"; // 11:05 AM ET, before NOON

function renderCellDuring(slateGames, row = {}, options = {}) {
  session.state = { teams: {}, slate: { today: { date: "2026-09-24", games: slateGames } } };
  return checkAt(NOON, () =>
    normalizeSpaces(renderNextCell({ id: "DET", ...row }, options)).replace(/&mdash;/g, "--"),
  );
}

test("Next column: a game under way reads as the club up, down or tied, and the inning", () => {
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, inning: 5 };
  assert.equal(
    renderCellDuring([{ ...game, score: [2, 4] }]),
    '<td class="next-cell live">Down 2 @ CLE in the 5th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, away: "CLE", home: "DET", score: [2, 4] }]),
    '<td class="next-cell live">Up 2 vs CLE in the 5th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, score: [0, 0], inning: 1 }]),
    '<td class="next-cell live">Tied @ CLE in the 1st</td>',
  );
});

test("Next column: a game under way shows in place of the club's next game", () => {
  const friday = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, inning: 7 };
  assert.equal(
    renderCellDuring([{ ...game, score: [3, 2] }], { next: friday }),
    '<td class="next-cell live">Up 1 @ CLE in the 7th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, state: "final", score: [3, 2] }], { next: friday }),
    '<td class="next-cell">Fri 1:05 @ BOS</td>',
  );
});

test("Next column: a delay reads after the score", () =>
  assert.equal(
    renderCellDuring([
      {
        away: "HOU",
        home: "DET",
        state: "live",
        start: MORNING_START,
        score: [1, 3],
        inning: 6,
        delay: "Delayed: Rain",
      },
    ]),
    '<td class="next-cell live delayed">Up 2 vs HOU -- Delayed: Rain</td>',
  ));

test("Next column: before first pitch, a game past its start reads as warmup", () => {
  const game = { away: "DET", home: "BAL", state: "pre" };
  assert.equal(
    renderCellDuring([{ ...game, start: MORNING_START }]),
    '<td class="next-cell live">Warmup @ BAL</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, start: "2026-09-24T17:05:00Z" }], {
      next: { at: "2026-09-24T17:05:00Z", home: false, opp: "BAL" },
    }),
    '<td class="next-cell">Today 1:05 @ BAL</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, start: MORNING_START, tbd: true }]),
    '<td class="next-cell">--</td>',
  );
});

test("Next column: a delayed start shows before the scheduled time comes", () =>
  assert.equal(
    renderCellDuring([
      {
        away: "DET",
        home: "BAL",
        state: "pre",
        start: "2026-09-24T17:05:00Z",
        delay: "Delayed: Rain",
      },
    ]),
    '<td class="next-cell live delayed">Today @ BAL -- Delayed: Rain</td>',
  ));

test("Next column: in a doubleheader, the game under way counts, not the one that's over", () => {
  const game = { away: "DET", home: "CLE", start: MORNING_START };
  assert.equal(
    renderCellDuring([
      { ...game, state: "final", score: [5, 1] },
      { ...game, state: "live", score: [0, 1], inning: 2, doubleheader: 2 },
    ]),
    '<td class="next-cell live">Down 1 @ CLE in the 2nd</td>',
  );
});

test("Next column: a club that's out shows only a postseason game under way", () => {
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, score: [2, 4] };
  assert.equal(renderCellDuring([game], {}, { isOut: true }), '<td class="next-cell">--</td>');
  assert.equal(
    renderCellDuring([{ ...game, inning: 9, postseason: true }], {}, { isOut: true }),
    '<td class="next-cell live">Down 2 @ CLE in the 9th</td>',
  );
});

test("division header: a magic number only when there is a number", () => {
  const renderHead = (leader) =>
    String(renderDivisionBlock("AL Central", [{ id: "CLE", lead: true, ...leader }]));
  assert.match(renderHead({ magic: "3" }), /magic 3/);
  assert.doesNotMatch(renderHead({ magic: "-" }), /magic/);
  assert.doesNotMatch(renderHead({ magic: null }), /magic/);
  assert.match(renderHead({ clinched: true, magic: "3" }), /clinched/);
});

const AL_SEEDS = { TB: 1, CLE: 2, TEX: 3, NYY: 4, BOS: 5, CWS: 6 };

function buildAlStandings(changes = {}) {
  const row = (id, w, l, fields) => ({
    id,
    w,
    l,
    pct: (w / (w + l)).toFixed(3).slice(1),
    ...fields,
    ...changes[id],
  });
  return {
    "AL East": [
      row("TB", 95, 60, { gb: "-", elim: "-", lead: true, magic: "2", clinch: "x" }),
      row("NYY", 89, 66, { gb: "6.0", elim: "2", wcgb: "+9.5", wce: "-", wcrank: "1" }),
      row("BOS", 84, 72, { gb: "11.5", elim: "E", wcgb: "+4.0", wce: "-", wcrank: "2" }),
      row("TOR", 77, 79, { gb: "18.5", elim: "E", wcgb: "3.0", wce: "3", wcrank: "4" }),
      row("BAL", 75, 81, { gb: "20.5", elim: "E", wcgb: "5.0", wce: "2", wcrank: "6" }),
    ],
    "AL Central": [
      row("CLE", 81, 75, { gb: "-", elim: "-", lead: true, magic: "6" }),
      row("CWS", 80, 76, { gb: "1.0", elim: "6", wcgb: "-", wce: "-", wcrank: "3" }),
      row("MIN", 73, 83, { gb: "8.0", elim: "E", wcgb: "7.0", wce: "E", wcrank: "7" }),
    ],
    "AL West": [
      row("TEX", 78, 78, { gb: "-", elim: "-", lead: true, magic: "2" }),
      row("HOU", 77, 79, { gb: "1.0", elim: "6", wcgb: "3.0", wce: "4", wcrank: "5" }),
    ],
  };
}

const listFieldRows = (rendered) =>
  [
    ...String(rendered).matchAll(/class="team-name">([^<]+)<|>(Wild cards)<|class="(cutline)"/g),
  ].map(([, name, label, cutline]) => name || label || cutline);

test("playoff field: division leaders by seed, then the wild cards, then the clubs still chasing", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  assert.deepEqual(listFieldRows(renderFieldBlock("AL", buildAlStandings())), [
    "Rays",
    "Guardians",
    "Rangers",
    "Wild cards",
    "Yankees",
    "Red Sox",
    "White Sox",
    "cutline",
    "Blue Jays",
    "Astros",
    "Orioles",
  ]);
});

test("playoff field: every live chaser shows, and eliminated clubs fill in to three", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  const listChasers = (changes) =>
    listFieldRows(renderFieldBlock("AL", buildAlStandings(changes))).slice(8);
  assert.deepEqual(listChasers({ MIN: { wce: "5" } }), ["Blue Jays", "Astros", "Orioles", "Twins"]);
  const withOneAlive = listChasers({ HOU: { wce: "E" }, BAL: { wce: "E" } });
  assert.deepEqual(withOneAlive, ["Blue Jays", "Astros", "Orioles"]);
  const rendered = String(
    renderFieldBlock("AL", buildAlStandings({ HOU: { wce: "E" }, BAL: { wce: "E" } })),
  );
  assert.equal(rendered.match(/<tr class="eliminated"/g)?.length, 2);
});

test("playoff field: each leader's lead over second place and its magic number", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  // Seed through M#, one entry per cell.
  const describeLeader = (rendered, name) => {
    const row = String(rendered)
      .split("<tr")
      .find((markup) => markup.includes(`>${name}<`));
    return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, cell]) => stripTags(cell).trim())
      .slice(1, 8);
  };
  const rendered = renderFieldBlock("AL", buildAlStandings({ CLE: { clinched: true } }));
  assert.deepEqual(describeLeader(rendered, "Rays"), [
    "1",
    "Rays",
    "95",
    "60",
    ".613",
    "+6.0",
    "2",
  ]);
  assert.deepEqual(describeLeader(rendered, "Guardians"), [
    "2",
    "Guardians",
    "81",
    "75",
    ".519",
    "+1.0",
    "&mdash;",
  ]);
  assert.match(String(rendered), /<td class="elim-num clinched mid">&mdash;<\/td>/);
  const tied = renderFieldBlock("AL", buildAlStandings({ HOU: { gb: "-" } }));
  assert.deepEqual(describeLeader(tied, "Rangers").slice(5), ["&mdash;", "2"]);
});

test("standings rows keep room for a rank tag whether or not the club is ranked", () => {
  session.state = { teams: { TB: { seed: 1 } } };
  const rendered = String(renderDivisionBlock("AL East", buildAlStandings()["AL East"]));
  assert.equal(rendered.match(/<td class="rank-cell"><span class="rank-slot">/g)?.length, 5);
  assert.equal(rendered.match(/class="chip numbers outlined rank-tag"/g)?.length, 1);
});

test("text from the shared store or MLB is shown as text, never as markup", () => {
  const markup = '<img src=x onerror="alert(1)">';
  const shown = [
    renderEntryText({ kind: "berth", team: "NYY", what: "division", div: markup }),
    renderEntryText({ kind: "game", won: "NYY", series: markup, game: markup, score: [markup, 1] }),
    renderEntryText({ kind: "seed", team: "NYY", from: markup, to: markup }),
    renderEntryText({ kind: "unknown", text: markup }),
    renderNextCell({ next: { at: "2026-09-25T23:05:00Z", home: true, opp: markup } }),
    renderDivisionBlock("AL East", [{ id: "NYY", w: markup, l: 1, pct: markup, gb: markup }]),
    html`<span>${formatStampName(markup)}</span>`,
  ];
  for (const rendered of shown) assert.doesNotMatch(String(rendered), /<img/);
});

test("html escapes every value except markup it built", () => {
  const club = html`<b>${"Red Sox & Co."}</b>`;
  assert.equal(String(club), "<b>Red Sox &amp; Co.</b>");
  assert.equal(
    String(html`<li>${club} ${'"quoted" <tag>'}</li>`),
    "<li><b>Red Sox &amp; Co.</b> &quot;quoted&quot; &lt;tag&gt;</li>",
  );
  assert.equal(String(html`<ul>${["<a>", html`<i>b</i>`]}</ul>`), "<ul>&lt;a&gt;<i>b</i></ul>");
  assert.equal(String(html`[${false}${null}${undefined}${0}]`), "[0]");
});

test("a club that has never won counts its drought from its first season", () => {
  session.trackedTitles = {};
  assert.equal(describeDrought("TB"), "Since 1998");
  assert.equal(describeDrought("COL"), "Since 1993");
  assert.equal(describeDrought("MIL"), "Since 1969");
});

test("a club that has won counts its drought in years since its last title", () => {
  const { currentSeason } = session;
  try {
    Object.assign(session, { currentSeason: 2026, trackedTitles: {} });
    assert.equal(describeDrought("NYY"), "17 yrs ago");
    assert.equal(describeDrought("MIA"), "23 yrs ago");
  } finally {
    Object.assign(session, { currentSeason });
  }
});

test("the page shows the season's record, with a final fresh for ten minutes after the time it's shown", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-30T01:00:00Z") });
  const standings = { divisions: {} };
  const slate = { today: { date: "2026-09-29", games: [] } };
  const { season } = session;
  try {
    session.season = { year: 2026, teams: {}, series: {}, log: [], standings, slate };
    composeState();
    assert.deepEqual(session.state.slate, { ...slate, since: "2026-09-30T00:50:00.000Z" });
    assert.equal(session.standings, standings);

    session.season = { year: 2025, teams: {}, series: {}, log: [], standings };
    composeState();
    assert.equal(session.state.slate, undefined);
  } finally {
    Object.assign(session, { season });
  }
});

test("this year's champion has its title, and is reigning, as soon as the season's bracket crowns it, without reading the seasons again", () => {
  const final2025 = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
  );
  const shown2025 = buildSnapshot(final2025.responses, {
    season: 2025,
    now: Date.parse(final2025.now),
  });
  const bluejaysWin = {
    ...shown2025,
    series: { ...shown2025.series, WS: { winsA: 4, winsB: 3, started: true } },
  };
  const { currentSeason, activeYear, state } = session;
  try {
    Object.assign(session, {
      currentSeason: 2025,
      activeYear: 2025,
      state: bluejaysWin,
      trackedTitles: {},
    });
    assert.equal(listTitles("TOR")[0], 2025);
    assert.equal(describeDrought("TOR"), "Reigning");
    assert.equal(describeDrought("NYY"), "16 yrs ago");
  } finally {
    Object.assign(session, { currentSeason, activeYear, state, trackedTitles: {} });
  }
});

test("last year's champion is defending while this year's is undecided, whatever year is shown", () => {
  const final2025 = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
  );
  const shown2025 = buildSnapshot(final2025.responses, {
    season: 2025,
    now: Date.parse(final2025.now),
  });
  const { currentSeason, activeYear } = session;
  try {
    Object.assign(session, { currentSeason: 2026, trackedTitles: { LAD: 2025 } });
    Object.assign(session, { activeYear: 2025, state: shown2025 });
    assert.equal(describeDrought("LAD"), "Defending");
    Object.assign(session, { activeYear: 2026, state: { teams: {}, series: {} } });
    assert.equal(describeDrought("LAD"), "Defending");
  } finally {
    Object.assign(session, { currentSeason, activeYear, trackedTitles: {} });
  }
});

const RANKED_FIELD = {
  teams: {
    ATL: { league: "NL", seed: 1 },
    NYY: { league: "AL", seed: 4 },
    SEA: { league: "AL", seed: 2 },
    TB: { league: "AL", seed: 1 },
  },
};

test("before a device's first drag, its ranking lists the clubs by name", () => {
  session.state = RANKED_FIELD;
  assert.deepEqual(listRankedOrder(), ["ATL", "SEA", "TB", "NYY"]);
});

test("clubs never dragged into place follow the ranked ones by name", (t) => {
  keepRanking(session.activeYear, ["SEA", "BAL"]);
  t.after(() => keepRanking(session.activeYear, []));
  session.state = RANKED_FIELD;
  assert.deepEqual(listRankedOrder(), ["SEA", "ATL", "TB", "NYY"]);
});

// Detroit went out in the Wild Card Series and New York in the Division Series.
function buildPostseasonState() {
  const teams = {};
  const clubs = {
    AL: ["NYY", "TOR", "SEA", "BOS", "DET", "CLE"],
    NL: ["LAD", "MIL", "PHI", "CHC", "SD", "CIN"],
  };
  for (const [league, ids] of Object.entries(clubs))
    ids.forEach((id, index) => (teams[id] = { league, seed: index + 1 }));
  return {
    teams,
    series: { AL_WC2: { winsA: 2, winsB: 0 }, AL_DS1: { winsA: 1, winsB: 3 } },
  };
}

test("a club is out whichever round it lost in, and alive until then", () => {
  const state = buildPostseasonState();
  assert.equal(describeTeamStatus(state, "DET"), "out");
  assert.equal(describeTeamStatus(state, "NYY"), "out");
  assert.equal(describeTeamStatus(state, "BOS"), "alive");
});

const SEASON_NOW = Date.parse("2026-09-24T16:00:00Z");

/**
 * One day of the Games view's whole season, from the slate and the season's schedule, or what the
 * view says while it has no days. Today is the slate's.
 * @param {any} slate
 * @param {string} [day]
 * @param {any[] | null} [schedule]
 */
function renderGameDay(slate, day = slate?.today.date, schedule = null) {
  const { days, emptyNote } = listSeasonDays(slate, schedule, SEASON_NOW);
  if (!days.length) return html`<p class="empty-note">${emptyNote}</p>`;
  return days.find((listed) => listed.day === day)?.markup ?? html``;
}

// One line of text per game, after the day's heading, with a space wherever a tag was.
const describeGameList = (slate, day, schedule) =>
  String(renderGameDay(slate, day, schedule))
    .split(/<li|<h2/)
    .map((part) =>
      normalizeSpaces(part.replace(/<[^>]*>|^[^>]*>/g, " "))
        .replace(/&bull;/g, "•")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

const ALL_STAR_GAME = {
  date: "2026-07-14",
  id: "823443",
  away: "AL",
  home: "NL",
  state: "final",
  start: "2026-07-15T00:00:00Z",
  score: [4, 0],
  allStar: true,
};

/**
 * @param {string} date
 * @param {"pre" | "final"} state
 */
const listClubGame = (date, state) => ({
  date,
  id: date,
  away: "NYY",
  home: "BOS",
  state,
  start: `${date}T17:05:00Z`,
  ...(state === "final" && { score: [3, 2] }),
});

/**
 * A slate over the All-Star break, on `today`.
 * @param {string} today
 * @param {string} lastPlayed
 * @param {string} nextPlayed
 */
const buildBreakSlate = (today, lastPlayed, nextPlayed) => ({
  today: { date: today, games: [] },
  previous: [listClubGame(lastPlayed, "final")],
  next: [listClubGame(nextPlayed, "pre")],
  allStar: ALL_STAR_GAME,
});

test("games list: the All-Star Game shows on its day, its leagues' stars beside their names, and opens nothing", () =>
  checkInTimeZone(EASTERN, () => {
    const slate = buildBreakSlate("2026-07-14", "2026-07-12", "2026-07-17");
    assert.deepEqual(describeGameList(slate), [
      "Today • Tue, Jul 14",
      "American League All-Star Game 4 - 0 Final National League",
    ]);
    const rendered = String(renderGameDay(slate));
    assert.match(
      rendered,
      /class="game-side away won"><span class="club"><svg class="all-star-mark"[^>]*--all-star-color: var\(--al\)/,
    );
    assert.match(
      rendered,
      /class="game-side home"><span class="club"><svg class="all-star-mark"[^>]*--all-star-color: var\(--nl\)/,
    );
    assert.doesNotMatch(rendered, /game-open|class="dot/);
  }));

test("games list: the All-Star Game shows on its day over the break, among the clubs' games, but the store reads box scores for the clubs' games only", () =>
  checkInTimeZone(EASTERN, () => {
    const slate = buildBreakSlate("2026-07-16", "2026-07-12", "2026-07-17");
    const days = listSeasonDays(slate, null, SEASON_NOW).days.map(({ day }) => day);
    assert.deepEqual(days, ["2026-07-12", "2026-07-14", "2026-07-16", "2026-07-17"]);
    assert.deepEqual(describeGameList(slate, "2026-07-14"), [
      "Tue, Jul 14",
      "American League All-Star Game 4 - 0 Final National League",
    ]);
    const onItsDay = buildBreakSlate("2026-07-14", "2026-07-12", "2026-07-17");
    assert.deepEqual(
      listSlateGames(onItsDay).map((game) => game.id),
      ["2026-07-12", "2026-07-17"],
    );
  }));

test("games list: live halves, a doubleheader in game order, a postponement, an unknown opponent", () => {
  const slate = {
    today: {
      date: "2026-09-25",
      games: [
        {
          id: "900001",
          away: "BAL",
          home: "NYY",
          state: "pre",
          start: "2026-09-25T20:10:00Z",
          tbd: true,
          doubleheader: 2,
        },
        {
          id: "900002",
          away: "BAL",
          home: "NYY",
          state: "final",
          start: "2026-09-25T17:05:00Z",
          score: [4, 2],
          doubleheader: 1,
        },
        {
          id: "900003",
          away: "CLE",
          home: "BOS",
          state: "live",
          start: "2026-09-25T22:45:00Z",
          score: [1, 0],
          inning: 7,
          half: "bottom",
        },
      ],
      postponed: [
        {
          id: "900004",
          away: "TOR",
          home: "BAL",
          state: "off",
          start: "2026-09-25T22:35:00Z",
          detail: "Postponed",
        },
      ],
    },
    next: [
      {
        id: "900005",
        date: "2026-10-03",
        away: null,
        home: "TB",
        state: "pre",
        start: "2026-10-03T17:08:00Z",
      },
    ],
  };
  assert.deepEqual(describeGameList(slate), [
    "Today • Fri, Sep 25",
    "Orioles 4 - 2 Final Yankees",
    "Orioles After 1st game Yankees TBD TBD",
    "Blue Jays Postponed Orioles",
    "Guardians 1 - 0 Bot 7th Red Sox",
  ]);
  assert.deepEqual(describeGameList(slate, "2026-10-03"), ["Sat, Oct 3", "TBD 1:08 PM Rays"]);
});

const eveningFixture = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const eveningSnapshot = buildSnapshot(eveningFixture.responses, {
  season: eveningFixture.season,
  now: Date.parse(eveningFixture.now),
});
const SEASON_FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-09-season.json`, "utf8"),
);
const SEASON_FIXTURE_NOW = Date.parse(SEASON_FIXTURE.now);
const seasonSnapshot = buildSnapshot(SEASON_FIXTURE.responses, {
  season: SEASON_FIXTURE.season,
  now: SEASON_FIXTURE_NOW,
});
const seasonSchedule = Object.values(seasonSnapshot.schedule).flat();

test("every playoff game listed before its clubs are known keeps a row and a button of its own", () => {
  const responses = {
    ...eveningFixture.responses,
    seasonGames: eveningFixture.responses.postseason,
  };
  const now = Date.parse(eveningFixture.now);
  const snapshot = buildSnapshot(responses, { season: eveningFixture.season, now });
  session.state = snapshot;
  const schedule = Object.values(snapshot.schedule).flat();
  const wildCardDay = schedule.filter((game) => game.date === "2026-09-29");
  assert.equal(wildCardDay.length, 4);
  const { days } = listSeasonDays(snapshot.slate, schedule, now);
  const markup = String(days.find((listed) => listed.day === "2026-09-29")?.markup ?? "");
  const keys = [...markup.matchAll(/data-game="([^"]*)"/g)].map(([, key]) => key);
  assert.equal(keys.length, 4);
  assert.equal(new Set(keys).size, 4);
});

/** @param {string} row @param {RegExp} pattern */
const readRowText = (row, pattern) => normalizeSpaces(stripTags(pattern.exec(row)?.[1] ?? ""));

/**
 * Each game's label over its time or score, and status under it, on a day of MLB's 2026
 * postseason as the store kept it on Oct 9, with any of its games changed.
 * @param {string} day
 * @param {(game: any) => any} [change]
 */
function readPostseasonDay(day, change = (game) => game) {
  session.state = seasonSnapshot;
  const schedule = seasonSchedule.map(change);
  const { days } = listSeasonDays(seasonSnapshot.slate, schedule, SEASON_FIXTURE_NOW);
  const markup = String(days.find((listed) => listed.day === day)?.markup ?? "");
  return markup
    .split("<li")
    .slice(1)
    .map((row) => ({
      label: readRowText(
        row,
        /<span class="game-label">([\s\S]*?)<\/span><span class="game-headline">/,
      ),
      status: readRowText(row, /<span class="game-status">([\s\S]*?)<\/span><\/span/),
      isDecided: row.includes('class="series-label decided"'),
    }));
}

test("games list: every postseason game says its series as it stood after it, away wins first, gold once it's decided", () => {
  assert.deepEqual(readPostseasonDay("2026-09-30"), [
    { label: "NL WC 1-1", status: "Final/10", isDecided: false },
    { label: "AL WC 2-0", status: "Final", isDecided: true },
    { label: "AL WC 0-2", status: "Final", isDecided: true },
    { label: "NL WC 0-2", status: "Final", isDecided: true },
  ]);
  assert.deepEqual(
    readPostseasonDay("2026-10-07").map(({ label }) => label),
    ["ALDS 1-2", "NLDS 3-1", "ALDS 3-0", "NLDS 3-1"],
  );
});

test("games list: a game still to play says its series as it stands, or its game until both clubs are known", () => {
  assert.deepEqual(readPostseasonDay("2026-10-10"), [
    { label: "ALDS 2-2", status: "", isDecided: false },
  ]);
  assert.deepEqual(readPostseasonDay("2026-10-12"), [
    { label: "NLCS 0-0", status: "", isDecided: false },
    { label: "ALCS G1", status: "", isDecided: false },
  ]);
  assert.equal(readPostseasonDay("2026-10-23")[0].label, "WS G1");
});

test("games list: a game under way says its series as it stood at first pitch", () => {
  const isGameTwo = (game) => game.date === "2026-10-05" && game.away === "CWS";
  const [final] = readPostseasonDay("2026-10-05");
  assert.deepEqual(final, { label: "ALDS 2-0", status: "Final", isDecided: false });
  const [live] = readPostseasonDay("2026-10-05", (game) =>
    isGameTwo(game) ? { ...game, state: "live", inning: 5, half: "top" } : game,
  );
  assert.deepEqual(live, { label: "ALDS 1-0", status: "Top 5th", isDecided: false });
});

test("games list: a game MLB marks If Necessary says so under its time until it's played", () => {
  const isGameFive = (game) => game.series === "NL_CS" && game.number === 5;
  const rows = readPostseasonDay("2026-10-16", (game) =>
    isGameFive(game) ? { ...game, ifNecessary: true } : game,
  );
  const gameFive = rows.find((row) => row.label === "NLCS 0-0");
  assert.equal(gameFive?.status, "If necessary");
  const markup = String(
    listSeasonDays(seasonSnapshot.slate, seasonSchedule, SEASON_FIXTURE_NOW).days.find(
      (listed) => listed.day === "2026-10-16",
    )?.markup,
  );
  assert.doesNotMatch(markup, /If necessary/);
});

test("games list: a regular season final that went extra innings, or was called short, says in which inning it ended", () => {
  const countStatuses = (day, change) =>
    readPostseasonDay(day, change).reduce(
      (counts, { status }) => counts.set(status, (counts.get(status) ?? 0) + 1),
      new Map(),
    );
  const lastDay = countStatuses("2026-09-27");
  assert.equal(lastDay.get("Final/10"), 1);
  assert.equal(lastDay.get("Final"), 13);

  const [called] = seasonSchedule.filter((game) => game.date === "2026-07-01");
  const july = countStatuses("2026-07-01", (game) =>
    game === called ? { ...game, innings: 7 } : game,
  );
  assert.equal(july.get("Final/7"), 1);
});

test("games list: a game still to play names its starters with their arm, leaving the ERA to the matchup", () => {
  const slate = {
    today: {
      date: "2026-09-29",
      games: [
        {
          id: "900006",
          away: "BOS",
          home: "NYY",
          state: "pre",
          start: "2026-09-30T00:08:00Z",
          starters: [
            { id: 801139, name: "Tolle", hand: "L" },
            { id: 693645, name: "Schlittler", hand: "R" },
          ],
        },
        {
          id: "900007",
          away: "CHC",
          home: "SD",
          state: "pre",
          start: "2026-09-30T02:08:00Z",
          starters: [{ id: 571510 }, { id: 650633, name: "King", hand: "R" }],
        },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate), [
    "Today • Tue, Sep 29",
    "Red Sox 8:08 PM Yankees Tolle L Schlittler R",
    "Cubs 10:08 PM Padres King R",
  ]);
  const rendered = String(renderGameDay(slate));
  assert.match(rendered, /title="Throws left-handed">L</);
  assert.match(rendered, /<span class="starter home" title="Starting pitcher">/);
  assert.deepEqual(
    [...rendered.matchAll(/class="game-extra (\w+)"/g)].map(([, place]) => place),
    ["away", "home", "home"],
  );
  const button =
    /<button type="button" class="game-open" aria-label="([^"]*)" data-game="([^"]*)">/.exec(
      rendered,
    );
  assert.equal(button[1], "Game details: Red Sox at Yankees, Tue, Sep 29");
  assert.equal(button[2], "900006 2026-09-29");
});

test("a game's sheet heads its Game section with the game's row, whose clubs open their sheets, without its starters or the button that opens it", () => {
  session.state = { teams: {}, standings: { divisions: {} } };
  const game = {
    date: "2026-09-24",
    away: "MIL",
    home: "PHI",
    state: "live",
    start: "2026-09-24T22:05:00Z",
    score: [4, 1],
    inning: 9,
    half: "top",
    outs: 1,
    starters: [
      { id: 1, name: "Peralta", hand: "R" },
      { id: 2, name: "Wheeler", hand: "R" },
    ],
  };
  const rendered = String(renderGameFaceOff(game));
  assert.match(rendered, /^<ul class="game-list game-faceoff"><li class="game-row live">/);
  assert.deepEqual(
    [...rendered.matchAll(/class="club team-open" data-team="(\w+)"/g)].map(([, team]) => team),
    ["MIL", "PHI"],
  );
  assert.equal(stripTags(rendered).replace(/\s+/g, " ").trim(), "Brewers 4-1Top 9th Phillies");
  assert.doesNotMatch(rendered, /game-open|game-extra|Peralta/);
});

test("games list: a starter MLB can't name yet leaves his line out, rather than calling him TBD, and the game still opens", () => {
  const slate = {
    today: {
      date: "2026-09-29",
      games: [
        {
          away: "CHC",
          home: "SD",
          state: "pre",
          start: "2026-09-30T02:08:00Z",
          starters: [{ id: 571510 }, { id: 669373 }],
        },
      ],
    },
  };
  const rendered = String(renderGameDay(slate));
  assert.match(rendered, /class="game-row press-tint press-reach pre"/);
  assert.doesNotMatch(rendered, /class="starter/);
  assert.doesNotMatch(rendered, /class="game-extra/);
  assert.match(
    rendered,
    /class="game-open" aria-label="Game details: Cubs at Padres, Tue, Sep 29"/,
  );
});

test("games list: a club yet to name today's starter says TBD, and every game opens", () => {
  const game = { away: "PHI", home: "ATL", state: "pre", start: "2026-10-02T00:08:00Z" };
  const slate = {
    today: { date: "2026-10-01", games: [game] },
    next: [{ date: "2026-10-02", ...game }],
  };
  assert.deepEqual(describeGameList(slate), [
    "Today • Thu, Oct 1",
    "Phillies 8:08 PM Braves TBD TBD",
  ]);
  assert.match(
    String(renderGameDay(slate)),
    /class="game-open" aria-label="Game details: Phillies at Braves, Thu, Oct 1"/,
  );
  const later = String(renderGameDay(slate, "2026-10-02"));
  assert.doesNotMatch(later, /TBD/);
  assert.match(
    later,
    /class="game-open" aria-label="Game details: Phillies at Braves, Fri, Oct 2"/,
  );
});

test("games list: a season without games says so without a closing period", () => {
  const { activeYear, currentSeason } = session;
  try {
    Object.assign(session, { activeYear: 2026, currentSeason: 2026 });
    const slate = { today: { date: "2026-09-29", games: [] }, previous: [], next: [] };
    assert.deepEqual(describeGameList(slate), ["No games scheduled yet"]);
  } finally {
    Object.assign(session, { activeYear, currentSeason });
  }
});

test("games list: a day without games inside the season says so at today's place", () => {
  const slate = {
    today: { date: "2026-09-29", games: [] },
    previous: [{ ...listClubGame("2026-09-27", "final") }],
    next: [{ ...listClubGame("2026-10-01", "pre") }],
  };
  const { days, startDay } = listSeasonDays(slate, null, SEASON_NOW);
  assert.deepEqual(
    days.map(({ day }) => day),
    ["2026-09-27", "2026-09-29", "2026-10-01"],
  );
  assert.equal(startDay, "2026-09-29");
  assert.deepEqual(describeGameList(slate), ["Today • Tue, Sep 29 No games today"]);
});

test("games list: a delay shows under the start time or the score", () => {
  const slate = {
    today: {
      date: "2026-09-27",
      games: [
        {
          id: "900008",
          away: "BAL",
          home: "NYY",
          state: "pre",
          start: "2026-09-27T17:05:00Z",
          delay: "Delayed: Rain",
        },
        {
          id: "900009",
          away: "TB",
          home: "PHI",
          state: "live",
          start: "2026-09-27T17:35:00Z",
          score: [0, 4],
          inning: 3,
          half: "bottom",
          delay: "Delayed",
        },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate), [
    "Today • Sun, Sep 27",
    "Orioles 1:05 PM Delayed: Rain Yankees TBD TBD",
    "Rays 0 - 4 Delayed Phillies",
  ]);
  assert.match(String(renderGameDay(slate)), /class="game-row press-tint press-reach pre delayed"/);
});

test("games list: each club's seed, record, and race, without its rank", () => {
  session.state = { teams: { NYY: { league: "AL", seed: 4 } } };
  session.standings = {
    divisions: {
      "AL East": [
        {
          id: "NYY",
          w: 93,
          l: 68,
          gb: "5.0",
          wcgb: "+10.0",
          elim: "E",
          wce: "-",
          clinch: "w",
          wcrank: "1",
        },
        { id: "BAL", w: 79, l: 82, gb: "19.0", wcgb: "4.0", elim: "E", wce: "E", wcrank: "5" },
      ],
    },
  };
  const slate = {
    today: {
      date: "2026-09-26",
      games: [
        { away: "BAL", home: "NYY", state: "final", start: "2026-09-26T17:05:00Z", score: [3, 7] },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate), [
    "Today • Sat, Sep 26",
    "Orioles 79-82 3 - 7 Final Yankees 4 seed 93-68 w",
  ]);
  const rendered = String(renderGameDay(slate));
  assert.doesNotMatch(rendered, /rank-tag/);
  assert.equal(rendered.match(/class="seed-lock"/g)?.length, 1);
  assert.match(rendered, /title="Clinched a wild card spot">w</);
});

const listSideClasses = (rendered) =>
  [...String(rendered).matchAll(/class="game-side ([^"]*)"/g)].map(([, classes]) =>
    classes.split(/\s+/).filter(Boolean),
  );

test("games list: a finished game marks its winner and dims only the losing score", () => {
  const slate = {
    today: {
      date: "2026-09-26",
      games: [
        {
          id: "900010",
          away: "BAL",
          home: "NYY",
          state: "final",
          start: "2026-09-26T17:05:00Z",
          score: [3, 7],
        },
        {
          id: "900011",
          away: "TB",
          home: "BOS",
          state: "live",
          start: "2026-09-26T17:10:00Z",
          score: [5, 1],
          inning: 6,
          half: "top",
        },
      ],
    },
  };
  const rendered = renderGameDay(slate);
  assert.deepEqual(listSideClasses(rendered), [["away"], ["home", "won"], ["away"], ["home"]]);
  assert.match(String(rendered), /<span class="lost">3<\/span>/);
});

test("games list: a club out of the race or knocked out of the postseason shows as any other club", () => {
  session.state = buildPostseasonState();
  session.standings = {
    divisions: {
      "AL East": [
        { id: "BAL", w: 75, l: 87, gb: "19.0", wcgb: "9.0", elim: "E", wce: "E", wcrank: "8" },
      ],
    },
  };
  const slate = {
    today: {
      date: "2026-10-01",
      games: [
        {
          id: "900012",
          away: "DET",
          home: "BOS",
          state: "final",
          start: "2026-10-01T17:05:00Z",
          score: [1, 4],
        },
        { id: "900013", away: "BAL", home: "TOR", state: "pre", start: "2026-10-01T23:07:00Z" },
      ],
    },
  };
  assert.deepEqual(listSideClasses(renderGameDay(slate)), [
    ["away"],
    ["home", "won"],
    ["away"],
    ["home"],
  ]);
});

test("a club's race: clinched, still racing, or out", () => {
  const describe = (row) => describeRace({ gb: "-", wcgb: "-", elim: "-", wce: "-", ...row });
  assert.deepEqual(describe({ clinch: "z", clinched: true, lead: true }), {
    label: "z",
    standing: "clinched",
  });
  assert.equal(describe({ clinch: "y", clinched: true, lead: true }).label, "y");
  assert.equal(describe({ clinched: true, lead: true }).label, "y");
  assert.equal(describe({ clinch: "x", lead: true, magic: "3" }).label, "x");
  assert.equal(
    describe({ gb: "5.0", wcgb: "+10.0", elim: "E", clinch: "w", wcrank: "1" }).label,
    "w",
  );
  assert.deepEqual(describe({ lead: true, magic: "2" }), { label: "M#2", standing: "racing" });
  assert.equal(describe({ lead: true }).label, "1st");
  assert.equal(describe({ wcgb: "3.0", wce: "E" }).label, "Tied");
  assert.equal(describe({ gb: "3.5", elim: "12" }).label, "3.5 GB");
  assert.equal(describe({ gb: "7.0", elim: "E", wcrank: "3" }).label, "WC3");
  assert.equal(describe({ gb: "9.0", wcgb: "+1.0", elim: "E", wcrank: "2" }).label, "WC2");
  assert.deepEqual(describe({ gb: "13.0", wcgb: "1.0", elim: "E", wce: "1" }), {
    label: "1.0 WC",
    standing: "racing",
  });
  assert.deepEqual(describe({ gb: "19.0", wcgb: "4.0", elim: "E", wce: "E" }), {
    label: null,
    standing: "out",
  });
  assert.equal(describeRace(null), null);
});

// The last day of 2026: one game left each, so a club's wins can grow by one at most.
const FINAL_DAY_STANDINGS = {
  divisions: {
    "AL East": [
      { id: "TB", w: 98, l: 63, elim: "-", wce: "-", clinch: "z", clinched: true, lead: true },
      { id: "NYY", w: 93, l: 68, elim: "E", wce: "-", clinch: "w" },
    ],
    "AL Central": [
      { id: "CLE", w: 85, l: 76, elim: "-", wce: "-", clinch: "y", clinched: true, lead: true },
      { id: "CWS", w: 83, l: 78, elim: "E", wce: "-", clinch: "w" },
    ],
    "AL West": [
      { id: "HOU", w: 80, l: 81, elim: "-", wce: "-", lead: true },
      { id: "TEX", w: 80, l: 81, elim: "-", wce: "E" },
    ],
    "NL Central": [
      { id: "CHC", w: 88, l: 73, elim: "E", wce: "-", clinch: "w" },
      { id: "MIL", w: 102, l: 59, elim: "-", wce: "-", clinch: "z", clinched: true, lead: true },
    ],
    "NL East": [
      { id: "PHI", w: 87, l: 74, elim: "E", wce: "-" },
      { id: "ATL", w: 94, l: 67, elim: "-", wce: "-", clinch: "y", clinched: true, lead: true },
    ],
  },
};

test("a seed is final only once no club can still pass or tie it", () => {
  const seeds = { TB: 1, CLE: 2, HOU: 3, NYY: 4, CWS: 6, MIL: 1, ATL: 3, CHC: 5, PHI: 6 };
  session.state = {
    teams: Object.fromEntries(Object.entries(seeds).map(([id, seed]) => [id, { seed }])),
  };
  session.standings = FINAL_DAY_STANDINGS;
  assert.equal(isSeedFinal("TB"), true);
  assert.equal(isSeedFinal("CLE"), true);
  assert.equal(isSeedFinal("NYY"), true);
  assert.equal(isSeedFinal("CHC"), false, "the Phillies can still tie the Cubs");
  assert.equal(isSeedFinal("HOU"), false, "not clinched");
  assert.equal(isSeedFinal("PHI"), false, "not clinched");
  assert.equal(isSeedFinal("TEX"), false, "not in the field");

  session.state = { ...session.state, projected: false };
  assert.equal(isSeedFinal("CHC"), true, "MLB has set the bracket");
});

test("a division winner's seed is final once a rival a game short for a rainout MLB cancelled can no longer reach it", () => {
  session.state = { teams: { TB: { seed: 1 }, CLE: { seed: 2 }, HOU: { seed: 3 } } };
  const listStandings = (scheduled) => ({
    divisions: {
      ...FINAL_DAY_STANDINGS.divisions,
      "AL West": [
        { id: "HOU", w: 84, l: 77, elim: "-", wce: "-", lead: true, ...scheduled },
        { id: "TEX", w: 80, l: 81, elim: "-", wce: "E", ...scheduled },
      ],
    },
  });
  session.standings = listStandings({ scheduled: 161 });
  assert.equal(isSeedFinal("CLE"), true, "the Astros can win 84 at most, under the Guardians' 85");
  session.standings = listStandings({});
  assert.equal(isSeedFinal("CLE"), false, "over 162 games the Astros could still tie");
});

test("games list: a season with no live data says why", () => {
  const { activeYear, currentSeason } = session;
  try {
    session.currentSeason = 2026;
    session.activeYear = 2025;
    assert.deepEqual(describeGameList(null), ["No games saved for this season yet"]);
    session.activeYear = 2026;
    assert.deepEqual(describeGameList(null), [
      "Games appear here as soon as the page can reach MLB",
    ]);
  } finally {
    Object.assign(session, { activeYear, currentSeason });
  }
});

const listTeamButtons = (rendered) =>
  [
    ...String(rendered).matchAll(
      /<button type="button" class="[^"]*team-open" data-team="(\w+)">([\s\S]*?)<\/button>/g,
    ),
  ].map(([, id, content]) => `${id} ${content.replace(/<[^>]*>/g, "").trim()}`);

test("a club's name in the standings and the updates opens its sheet, and in a game's row, which opens the matchup wherever it's tapped, it's plain", () => {
  session.state = { teams: { NYY: { league: "AL", seed: 4 } } };
  const yankees = { id: "NYY", w: 93, l: 68, gb: "-", elim: "-", lead: true };
  const orioles = { id: "BAL", w: 79, l: 82, gb: "14.0", elim: "E", wce: "E" };
  const slate = {
    today: {
      date: "2026-09-26",
      games: [
        { away: "BAL", home: "NYY", state: "final", start: "2026-09-26T17:05:00Z", score: [3, 7] },
      ],
    },
  };
  const standings = String(renderDivisionBlock("AL East", [yankees, orioles]));
  const update = renderEntryText({ kind: "elim", team: "BAL" });

  const games = String(renderGameDay(slate));
  assert.deepEqual(listTeamButtons(games), []);
  assert.equal([...games.matchAll(/<span class="club">/g)].length, 2);
  assert.deepEqual(listTeamButtons(standings), [
    "NYY Yankees, team details",
    "BAL Orioles, team details",
  ]);
  assert.deepEqual(
    [...standings.matchAll(/<tr class="[^"]*" data-team="(\w+)">/g)].map(([, id]) => id),
    ["NYY", "BAL"],
  );
  assert.deepEqual(listTeamButtons(update), ["BAL Orioles, team details"]);
});

const GAMES_VIEW = {
  today: { date: "2026-10-04", games: [] },
  previous: [
    {
      date: "2026-10-03",
      away: "NYY",
      home: "TB",
      state: "final",
      score: [0, 1],
      end: "2026-10-04T01:08:00Z",
      starters: [{ id: 1, name: "Cole" }],
    },
    {
      date: "2026-10-03",
      away: "CWS",
      home: "CLE",
      state: "final",
      score: [3, 0],
      end: "2026-10-03T23:40:00Z",
    },
  ],
};

test("a series game's update finds its final in the Games view, whichever club is home, and none for a game it doesn't list", () => {
  const update = [
    {
      at: "2026-10-04T01:08:00Z",
      kind: "game",
      series: "AL_DS1",
      won: "TB",
      lost: "NYY",
      game: 1,
      score: [1, 0],
      runs: [1, 0],
    },
  ];

  assert.equal(findUpdateGame(update, GAMES_VIEW)?.away, "NYY");
  assert.equal(findUpdateGame([{ ...update[0], game: 2, runs: [5, 2] }], GAMES_VIEW), null);
});

test("an update finds the one game all its entries came from, and none when they came from several or no longer show", () => {
  const berth = {
    at: "2026-10-03T23:45:00Z",
    kind: "berth",
    team: "CWS",
    what: "playoff",
    via: [{ team: "CWS", won: true, opp: "CLE", score: [3, 0] }],
  };
  const fromTwo = {
    ...berth,
    via: [...berth.via, { team: "NYY", won: false, opp: "TB", score: [0, 1] }],
  };

  assert.equal(findUpdateGame([berth], GAMES_VIEW)?.home, "CLE");
  assert.equal(findUpdateGame([fromTwo], GAMES_VIEW), null);
  assert.equal(findUpdateGame([{ at: berth.at, kind: "lock" }], GAMES_VIEW), null);
  assert.equal(findUpdateGame([berth], { today: { date: "2026-10-09", games: [] } }), null);
});

test("games list: a game under way shows its outs as two lights beside the inning", () => {
  const live = (away, outs) => ({
    id: `${away}-NYY`,
    away,
    home: "NYY",
    state: "live",
    inning: 5,
    half: "top",
    outs,
  });
  const slate = {
    today: { date: "2026-09-24", games: [live("BOS", 1), live("TB", 2), live("TOR", 0)] },
  };
  const lights = [
    ...String(renderGameDay(slate)).matchAll(
      /<span class="out-lights" role="img" aria-label="([^"]+)">([\s\S]*?)<\/span><\/span>/g,
    ),
  ].map(([, label, spans]) => ({
    label,
    on: [...spans.matchAll(/class="out-light on"/g)].length,
    off: [...spans.matchAll(/class="out-light "/g)].length,
  }));
  assert.deepEqual(lights, [
    { label: "1 out", on: 1, off: 1 },
    { label: "2 outs", on: 2, off: 0 },
    { label: "0 outs", on: 0, off: 2 },
  ]);
});

const SERIES_IDS = ["WC1", "WC2", "DS1", "DS2", "CS"]
  .flatMap((round) => [`AL_${round}`, `NL_${round}`])
  .concat("WS");

/**
 * The evening's season, with these series and today's games added to what MLB had.
 * @param {Record<string, object>} [series]
 * @param {object[]} [games]
 */
function showEvening(series = {}, games = []) {
  const { slate } = eveningSnapshot;
  session.state = {
    ...eveningSnapshot,
    series: { ...eveningSnapshot.series, ...series },
    slate: { ...slate, today: { ...slate.today, games: [...slate.today.games, ...games] } },
  };
}

/** Each bracket row's score, by series, top side first. */
const readBracketScores = (seriesIds) =>
  seriesIds.map((id) => {
    const series = findSeries(session.state, id);
    return ["A", "B"].map((side) => {
      const row = String(renderMatchupRow(series, side));
      return {
        isTbd: row.includes('class="tbd"'),
        score: row.match(/class="nscore[^"]*">([^<]*)</)[1],
      };
    });
  });

/** What each series' card says under it, in the order of `seriesIds`, without its markup. */
const readCardNotes = (seriesIds = SERIES_IDS) =>
  seriesIds.map((id) => {
    const note = String(renderCardNote(findSeries(session.state, id)));
    return {
      text: stripTags(normalizeSpaces(note).replace(/&bull;/g, "•")),
      classes:
        note
          .match(/^<div class="([^"]*)"/)?.[1]
          .trim()
          .split(/\s+/) ?? [],
    };
  });

/** @param {{ text: string }[]} notes */
const listNoteTexts = (notes) => notes.map((note) => note.text);

test("bracket: a score stays empty until its series' first game starts, and each TBD row has one too", () => {
  showEvening();
  const rows = readBracketScores(SERIES_IDS).flat();
  assert.equal(rows.length, 22);
  assert.equal(rows.filter((row) => row.isTbd).length, 10);
  assert.deepEqual(new Set(rows.map((row) => row.score)), new Set([""]));
});

test("bracket: a club's score shows its wins, and a swept club's shows 0", () => {
  const final2025 = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
  );
  session.state = buildSnapshot(final2025.responses, {
    season: 2025,
    now: Date.parse(final2025.now),
  });
  const wildCard = findSeries(session.state, "NL_WC1");
  assert.deepEqual([wildCard.teamA, wildCard.teamB], ["LAD", "CIN"]);
  assert.deepEqual(readBracketScores(["NL_WC1"]), [
    [
      { isTbd: false, score: "2" },
      { isTbd: false, score: "0" },
    ],
  ]);
});

test("bracket: a series saved without being marked started still shows 0 beside a club's wins", () => {
  showEvening({ AL_WC1: { winsA: 1, winsB: 0 } });
  assert.deepEqual(readBracketScores(["AL_WC1"]), [
    [
      { isTbd: false, score: "1" },
      { isTbd: false, score: "0" },
    ],
  ]);
});

const nextGame = (at, date, tbd = false, game = 1) => ({ at, date, tbd, game });

test("bracket: under each card, the next game shows its day, as today or tomorrow when it can, and its start time", () =>
  checkAt(eveningFixture.now, () => {
    showEvening({
      AL_WC1: {
        ...eveningSnapshot.series.AL_WC1,
        next: nextGame("2026-09-25T01:10:00Z", "2026-09-24"),
      },
      AL_WC2: {
        ...eveningSnapshot.series.AL_WC2,
        next: nextGame("2026-09-25T23:08:00Z", "2026-09-25"),
      },
      NL_WC1: {
        ...eveningSnapshot.series.NL_WC1,
        next: nextGame("2026-09-25T07:33:00Z", "2026-09-25", true),
      },
      NL_DS1: {
        ...eveningSnapshot.series.NL_DS1,
        next: nextGame("2026-10-03T20:08:00Z", "2026-10-03"),
      },
    });
    assert.deepEqual(
      listNoteTexts(readCardNotes(["AL_WC1", "AL_WC2", "NL_WC1", "NL_DS1", "NL_WC2", "AL_DS1"])),
      [
        "Today•9:10 PM",
        "Tomorrow•7:08 PM",
        "Tomorrow•time TBD",
        "Sat Oct 3•4:08 PM",
        "Tue Sep 29•time TBD",
        "Sat Oct 3•time TBD",
      ],
    );
  }));

test("bracket: a card's next game reads its day and time by the viewer's own clock", () =>
  checkInTimeZone("Europe/London", () =>
    checkAt(eveningFixture.now, () => {
      showEvening({
        AL_WC1: {
          ...eveningSnapshot.series.AL_WC1,
          next: nextGame("2026-09-25T17:10:00Z", "2026-09-25"),
        },
      });
      assert.deepEqual(listNoteTexts(readCardNotes(["AL_WC1"])), ["Today•6:10 PM"]);
    }),
  ));

/**
 * The evening with each Wild Card's next game at `start`, and one of them on today's slate.
 * @param {string} start
 * @param {object} slateGame
 * @param {number} [game] the next game's number in its series
 */
function showWildCardsAt(start, slateGame, game = 1) {
  const series = Object.fromEntries(
    WILD_CARD_SERIES.map((id) => [
      id,
      { ...eveningSnapshot.series[id], next: nextGame(start, start.slice(0, 10), false, game) },
    ]),
  );
  showEvening(series, [slateGame]);
}

const NYY_AT_BOS = { away: "NYY", home: "BOS", state: "pre" };

test("bracket: under a card whose series already counts the game, the next game shows even while the slate reads it as under way", () =>
  checkAt(eveningFixture.now, () => {
    const live = { away: "PHI", home: "ATL", state: "live", start: "2026-09-24T23:08:00Z" };
    showWildCardsAt(
      "2026-09-25T23:08:00Z",
      { ...live, score: [3, 5], inning: 9, half: "middle" },
      2,
    );
    assert.deepEqual(
      readCardNotes(WILD_CARD_SERIES),
      Array(4).fill({ text: "Tomorrow•7:08 PM", classes: ["card-note"] }),
    );
  }));

test("bracket: more than a half hour before first pitch, a card shows its next game", () =>
  checkAt(eveningFixture.now, () => {
    const start = "2026-09-25T01:20:00Z";
    showWildCardsAt(start, { ...NYY_AT_BOS, start });
    assert.deepEqual(
      readCardNotes(WILD_CARD_SERIES),
      Array(4).fill({ text: "Today•9:20 PM", classes: ["card-note"] }),
    );
  }));

test("bracket: past its start, a game still before its first pitch reads as warmup", () =>
  checkAt(eveningFixture.now, () => {
    const start = "2026-09-25T00:40:00Z";
    showWildCardsAt(start, { ...NYY_AT_BOS, start });
    const warmups = readCardNotes(WILD_CARD_SERIES).filter((note) => note.text === "Warmup");
    assert.deepEqual(warmups, [{ text: "Warmup", classes: ["card-note", "live"] }]);
  }));

test("bracket: a delayed start shows its delay instead of a countdown", () =>
  checkAt(eveningFixture.now, () => {
    const start = "2026-09-25T01:02:00Z";
    showWildCardsAt(start, { ...NYY_AT_BOS, start, delay: "Delayed: Rain" });
    const delayed = readCardNotes(WILD_CARD_SERIES).filter((note) => note.classes.includes("live"));
    assert.deepEqual(delayed, [
      { text: "Delayed: Rain", classes: ["card-note", "live", "delayed"] },
    ]);
  }));

test("Chivo Mono draws a little smaller than its size, so its numbers look as big as Libre Franklin's words", () => {
  const readAdjusts = (/** @type {string} */ family) =>
    readFontFaces(`${import.meta.dirname}/../page/styles.css`)
      .filter((face) => face["font-family"] === family)
      .map((face) => face["size-adjust"] ?? "100%");
  assert.deepEqual(readAdjusts("Chivo Mono"), ["97.48%", "97.48%"]);
  assert.deepEqual(readAdjusts("Libre Franklin"), ["100%", "100%"]);
});

test("Updates box: each update shows when it happened, not when the page noticed it", () => {
  const { count, whens } = readUpdateBox(TWO_UPDATES, Date.parse("2026-09-24T20:00:00Z"));
  assert.equal(count, "2 updates since yesterday");
  assert.deepEqual(whens, ["8:30 PM", "Yesterday"]);
});

test("Updates box: a clinch and the elimination it brought are one update, at the game's time", () => {
  const rangersLoss = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
  const found = { ended: "2026-09-25T00:10:00Z", at: "2026-09-25T00:40:00Z" };
  const { count, whats, whens } = readUpdateBox([
    { kind: "berth", team: "HOU", what: "division", div: "AL West", via: [rangersLoss], ...found },
    { kind: "elim", team: "TEX", via: [rangersLoss], ...found },
  ]);
  assert.equal(count, "1 update since earlier today");
  assert.deepEqual(whats, [
    "Astros clinch the AL West — Rangers eliminated with a 6-4 loss to the Twins",
  ]);
  assert.deepEqual(whens, ["8:10 PM"]);
});

const SEASON_SLATE = {
  today: {
    date: "2026-09-24",
    games: [{ away: "BAL", home: "NYY", state: "pre", start: "2026-09-24T23:05:00Z", id: "3" }],
  },
  previous: [],
  next: [],
};

/**
 * A game of the season's schedule, as the store keeps it.
 * @param {object} game
 */
const listScheduledGame = (game) => ({
  id: "1",
  away: "BAL",
  home: "NYY",
  state: "final",
  start: "2026-09-23T23:05:00Z",
  ...game,
});

test("games list: away from today, a game played shows each club's record as of the game, one still to come its record now from the standings, as today's rows do, and each starter with his arm, but no seed or race", () =>
  checkInTimeZone(EASTERN, () => {
    session.state = { teams: { NYY: { league: "AL", seed: 4 } } };
    session.standings = {
      divisions: {
        "AL East": [
          { id: "NYY", w: 93, l: 68, gb: "-", wcgb: "-", elim: "-", wce: "-", clinch: "y" },
          { id: "BAL", w: 80, l: 81, gb: "13", wcgb: "9", elim: "E", wce: "E" },
        ],
      },
    };
    const schedule = [
      listScheduledGame({
        date: "2026-09-23",
        score: [2, 5],
        records: ["79-81", "93-67"],
        starters: [
          { id: 1, name: "Rogers", hand: "L" },
          { id: 2, name: "Fried", hand: "L" },
        ],
      }),
      listScheduledGame({
        id: "2",
        date: "2026-09-26",
        state: "pre",
        start: "2026-09-26T17:05:00Z",
        starters: [null, { id: 3, name: "Rodón", hand: "L" }],
      }),
    ];
    assert.deepEqual(describeGameList(SEASON_SLATE, "2026-09-23", schedule), [
      "Yesterday • Wed, Sep 23",
      "Orioles 79-81 2 - 5 Final Yankees 93-67 Rogers L Fried L",
    ]);
    assert.deepEqual(describeGameList(SEASON_SLATE, "2026-09-26", schedule), [
      "Sat, Sep 26",
      "Orioles 80-81 1:05 PM Yankees 93-68 Rodón L",
    ]);
    assert.deepEqual(describeGameList(SEASON_SLATE, "2026-09-24", schedule), [
      "Today • Thu, Sep 24",
      "Orioles 80-81 7:05 PM Yankees 4 seed 93-68 y TBD TBD",
    ]);
  }));

test("games list: away from today, a postseason game shows each club's seed, which never changes", () =>
  checkInTimeZone(EASTERN, () => {
    session.state = {
      teams: { NYY: { league: "AL", seed: 4 }, BOS: { league: "AL", seed: 5 } },
      series: {},
    };
    session.standings = { divisions: {} };
    const schedule = [
      listScheduledGame({
        date: "2026-09-30",
        away: "BOS",
        start: "2026-09-30T23:08:00Z",
        score: [1, 3],
        postseason: true,
      }),
    ];
    assert.deepEqual(describeGameList(SEASON_SLATE, "2026-09-30", schedule), [
      "Wed, Sep 30",
      "Red Sox 5 seed 1 - 3 Final Yankees 4 seed",
    ]);
  }));

test("games list: a game the slate carries keeps the schedule's records under the slate's own copy", () =>
  checkInTimeZone(EASTERN, () => {
    session.state = { teams: {} };
    session.standings = { divisions: {} };
    const slate = {
      ...SEASON_SLATE,
      previous: [
        {
          date: "2026-09-23",
          id: "1",
          away: "BAL",
          home: "NYY",
          state: "final",
          start: "2026-09-23T23:05:00Z",
          score: [2, 6],
        },
      ],
    };
    const schedule = [
      listScheduledGame({ date: "2026-09-23", score: [2, 5], records: ["79-81", "93-67"] }),
    ];
    assert.deepEqual(describeGameList(slate, "2026-09-23", schedule), [
      "Yesterday • Wed, Sep 23",
      "Orioles 79-81 2 - 6 Final Yankees 93-67",
    ]);
  }));

test("a coming game's sheet heads its Game section with each club's record now, from the standings, as its row does", () =>
  checkInTimeZone(EASTERN, () => {
    session.state = { teams: {}, slate: SEASON_SLATE };
    session.standings = {
      divisions: {
        "AL East": [
          { id: "NYY", w: 93, l: 68, gb: "-", wcgb: "-", elim: "-", wce: "-" },
          { id: "BAL", w: 80, l: 81, gb: "13", wcgb: "9", elim: "E", wce: "E" },
        ],
      },
    };
    const game = listScheduledGame({
      date: "2026-09-26",
      state: "pre",
      start: "2026-09-26T17:05:00Z",
    });
    assert.equal(
      stripTags(String(renderGameFaceOff(game)))
        .replace(/\s+/g, " ")
        .trim(),
      "Orioles80-81 1:05 PM Yankees93-68",
    );
  }));

test("a past game's sheet heads its Game section with each club's record as of the game", () => {
  session.state = { teams: {} };
  session.standings = {
    divisions: {
      "AL East": [{ id: "NYY", w: 93, l: 68, gb: "-", wcgb: "-", elim: "-", wce: "-" }],
    },
  };
  const game = listScheduledGame({
    date: "2026-09-23",
    score: [2, 5],
    records: ["79-81", "93-67"],
  });
  assert.equal(
    stripTags(String(renderGameFaceOff(game)))
      .replace(/\s+/g, " ")
      .trim(),
    "Orioles79-81 2-5Final Yankees93-67",
  );
  assert.match(
    stripTags(String(renderGameFaceOff({ ...game, today: true }))).replace(/\s+/g, " "),
    /Yankees93-68/,
  );
});

test("games list: a game away from its home club's own ballpark names the city in its label, and one at home names nothing", () => {
  const [abroad, atHome] = seasonSchedule.filter((game) => game.date === "2026-06-14");
  const london = { name: "London Stadium", city: "London", state: "", timeZone: "Europe/London" };
  const labels = readPostseasonDay("2026-06-14", (game) => {
    if (game === abroad) return { ...game, ballpark: london, neutral: true };
    if (game === atHome) return { ...game, ballpark: london };
    return game;
  }).map((row) => row.label);
  assert.equal(labels.filter((label) => label === "In London").length, 1);
  assert.equal(labels.filter(Boolean).length, 1);
});

test("each appearance choice shows the home-screen icon it offers", () => {
  const page = readFileSync(`${import.meta.dirname}/../page/index.html`, "utf8");
  const choices = Object.fromEntries(
    [...page.matchAll(/<label class="appearance-choice">([\s\S]*?)<\/label>/g)].map(
      ([, choice]) => [
        choice.match(/<span>([^<]+)<\/span>\s*$/)[1],
        choice.match(/class="appearance-icon (appearance-icon-[a-z]+)"/)[1],
      ],
    ),
  );
  assert.deepEqual(choices, {
    System: "appearance-icon-halves",
    Ball: "appearance-icon-light",
    "Night Game": "appearance-icon-dark",
  });
});

test("each look offers icons the page has, and Ball's is Night Game's ball on cream", () => {
  const folder = `${import.meta.dirname}/../page/`;
  for (const { tabIcon, homeScreenIcon } of Object.values(LOOKS))
    for (const icon of [tabIcon, homeScreenIcon]) assert.ok(existsSync(folder + icon), icon);
  const night = readFileSync(folder + "icon.svg", "utf8");
  const ball = readFileSync(folder + "icon-light.svg", "utf8");
  assert.equal(ball, night.replace('fill="#173524"', 'fill="#e3dac6"'));
});
