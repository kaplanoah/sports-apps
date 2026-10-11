import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describePlayerNote, renderPlayerBody, renderPlayerFacts } from "../page/js/player-view.js";
import {
  describeHitters,
  describeLastGames,
  describePlayer,
  indexPeople,
  listPeopleRequest,
} from "../worker/src/players.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import {
  indexSeasonStats,
  listRosterRequest,
  listSeasonStatsRequest,
} from "../worker/src/rosters.js";

// What MLB answered early on Oct 8: the Guardians' and Dodgers' rosters, their players' seasons and
// facts, and the hitters MLB ranks.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-08-rosters.json`, "utf8"),
);
const { season, answers } = FIXTURE;
useTimeZone(EASTERN);
/** @param {"hitting" | "pitching"} group @param {object} [options] */
const index = (group, options) =>
  indexSeasonStats(answers[listSeasonStatsRequest(season, group, options)]);
const NUMBERS = {
  hitting: index("hitting"),
  pitching: index("pitching"),
  postseasonHitting: index("hitting", { gameType: "P" }),
  postseasonPitching: index("pitching", { gameType: "P" }),
};
const PEOPLE = indexPeople(answers[listPeopleRequest(season)]);
const HITTERS = describeHitters(
  answers[listSeasonStatsRequest(season, "hitting", { pool: "qualified" })],
);
// Four qualified starters, the first standing in for Tanner Bibee.
const STARTERS = {
  starters: [
    { id: 676440, era: 4.36, k9: 7.1, bb9: 2.6, speed: 94 },
    { id: 1, era: 3.1, k9: 9.5, bb9: 2.1, speed: 96.2 },
    { id: 2, era: 4.9, k9: 6.8, bb9: 3.4, speed: 91.5 },
    { id: 3, era: 5.5, k9: 6, bb9: 4, speed: 90 },
  ],
};
const BIBEE_SIDE = {
  line: { starts: 33, era: "4.36", k9: 7.1, bb9: 2.6, speed: 94 },
  pitches: [{ code: "FF", name: "Four-Seam Fastball", share: 0.24, mph: 94.2 }],
};

/**
 * Markup's text as it reads: each tag a space, runs of space one, and its separators as dots.
 * @param {unknown} markup
 */
const readText = (markup) =>
  String(markup)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "•")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {number} mlbTeamId
 * @param {string} club
 * @param {string} name
 */
function describeRostered(mlbTeamId, club, name) {
  const entry = answers[listRosterRequest(mlbTeamId, season)].roster.find(
    (/** @type {any} */ each) => each.person.fullName === name,
  );
  const id = entry.person.id;
  const lastGames = describeLastGames(FIXTURE.gameLogs[id]);
  return describePlayer({ ...NUMBERS, entry, club, season, person: PEOPLE.get(id), lastGames });
}

/**
 * @param {any} player
 * @param {{ starters?: any, side?: any, clubGames?: number | null }} [ranked]
 */
const renderText = (player, { starters = null, side = null, clubGames = null } = {}) =>
  readText(
    renderPlayerBody({
      player,
      hitters: HITTERS,
      starters,
      side,
      isUnkept: false,
      isLoading: false,
      clubGames,
    }),
  );

test("a hitter's sheet notes his club and number, and lists his facts in a row", () => {
  const kwan = describeRostered(114, "CLE", "Steven Kwan");
  assert.equal(readText(describePlayerNote(kwan)), "Guardians • #38");
  assert.equal(
    readText(renderPlayerFacts(kwan, false)),
    `Pos LF B/T L/L Age 29 Ht 5'8" Wt 170 Debut 2022`,
  );
});

test("a hitter's season shows his totals, then each ranked number with his rank among the qualified hitters", () => {
  const text = renderText(describeRostered(114, "CLE", "Steven Kwan"));
  assert.match(text, /Season 637 PA H 152 R 80 RBI 32 BB 85 K 62/);
  assert.match(text, /AVG \.282 20th of 135/);
  assert.match(text, /OBP \.382 7th of 135/);
  assert.match(text, /BB% 13\.3% 13th of 135/);
  assert.match(text, /K% 9\.7% 5th of 135/);
  assert.match(
    text,
    /K% ranked by fewest Rank among qualified hitters \(3\.1 plate appearances per team game\)/,
  );
});

test("his postseason shows over his season, as one line", () => {
  const text = renderText(describeRostered(114, "CLE", "Steven Kwan"));
  assert.match(text, /^Postseason 3 games 2-13 • \.154 AVG • 2 R • 1 RBI • 1 BB • 1 K Season/);
});

test("a hitter MLB doesn't rank shows where he would rank in each rate, but not in a count, once he has a quarter of the plate appearances he needs, and his plate appearances against them", () => {
  const genao = describeRostered(114, "CLE", "Angel Genao");
  const text = renderText(genao, { clubGames: 162 });
  assert.match(text, /AVG \.213 would be 129th OBP \.281 would be 130th /);
  assert.match(text, / HR 2 RBI 6 R 15 SB 1 BB% 7\.9% would be 92nd K% 15\.1% would be 31st /);
  assert.doesNotMatch(text, / of 135|ranked by fewest/);
  assert.match(renderText(genao, { clubGames: 200 }), /AVG \.213 OBP \.281 SLG/);
  assert.match(
    text,
    new RegExp(
      `He has ${genao.hitting.plateAppearances} of the 502 plate appearances needed to qualify Last games Oct 7 @ White Sox 1-1, 2B, RBI `,
    ),
  );
  assert.match(renderText(genao), /He hasn't had the plate appearances needed to qualify/);
});

test("a starter's season ranks his numbers among the qualified starters, and shows what he throws", () => {
  const text = renderText(describeRostered(114, "CLE", "Tanner Bibee"), {
    starters: STARTERS,
    side: BIBEE_SIDE,
  });
  assert.match(text, /Season 33 starts W-L 7-15 IP 188 ERA 4\.36 K 148 BB 55/);
  assert.match(
    text,
    /ERA 4\.36 2nd of 4 K\/9 7\.1 2nd of 4 BB\/9 2\.6 2nd of 4 Velo 94\.0 2nd of 4/,
  );
  assert.match(
    text,
    /ERA and BB\/9 ranked by fewest Rank among qualified starters \(1 inning per team game\)/,
  );
  assert.match(text, /What he throws/);
});

test("a starter outside the qualified starters has his innings set against the ones he needs, and where he would rank once he has a quarter of them", () => {
  const ohtani = describeRostered(119, "LAD", "Shohei Ohtani");
  const side = { line: { starts: 14, era: "1.79", k9: 10.5, bb9: 2.4, speed: 98.4 } };
  const text = renderText(ohtani, { starters: STARTERS, side, clubGames: 162 });
  assert.match(text, /He has pitched 85 2\/3 of the 162 innings needed to qualify/);
  assert.match(
    text,
    /ERA 1\.79 would be 1st K\/9 10\.5 would be 1st BB\/9 2\.4 would be 2nd Velo 98\.4 would be 1st/,
  );
  assert.doesNotMatch(renderText(ohtani, { starters: STARTERS, side, clubGames: 400 }), /would be/);
  const unknown = renderText(ohtani, { starters: STARTERS, side });
  assert.match(unknown, /He hasn't pitched the innings needed to qualify/);
  assert.doesNotMatch(unknown, /would be/);
});

test("a reliever's season shows his totals alone", () => {
  const text = renderText(describeRostered(114, "CLE", "Cade Smith"));
  assert.match(text, /Season 69 games ERA 1\.95 SV 41 IP 74 K 107 BB 23 Last games/);
  assert.doesNotMatch(text, /Rank among/);
});

test("a two-way player's sheet shows his hitting season, then his pitching under its own title", () => {
  const text = renderText(describeRostered(119, "LAD", "Shohei Ohtani"));
  assert.match(text, /Season 618 PA .* Pitching 14 starts W-L 8-2 IP 85 2\/3 ERA 1\.79/);
});

test("a sheet still loading holds its shape, and one that didn't load says so", () => {
  const loading = String(
    renderPlayerBody({
      player: null,
      hitters: null,
      starters: null,
      side: null,
      isUnkept: false,
      isLoading: true,
    }),
  );
  assert.match(loading, /placeholder/);
  const failed = renderPlayerBody({
    player: null,
    hitters: null,
    starters: null,
    side: null,
    isUnkept: false,
    isLoading: false,
    failure: "server",
  });
  assert.equal(
    readText(failed),
    "The server had a problem Try again to load his numbers Try again",
  );
  assert.match(String(failed), /class="retry-block"/);
  assert.match(String(failed), /class="retry-button filled" data-retry/);
});

test("a hitter's last games follow his season, newest first, each with whom he played, where, and his line", () => {
  const text = renderText(describeRostered(114, "CLE", "Steven Kwan"));
  assert.match(text, /Last games Oct 7 @ White Sox 1-6, RBI Oct 5 vs White Sox 1-4 /);
});

test("a starter's last starts follow what he throws, and a reliever's last games follow his totals", () => {
  const bibee = renderText(describeRostered(114, "CLE", "Tanner Bibee"), {
    starters: STARTERS,
    side: BIBEE_SIDE,
  });
  assert.match(bibee, /What he throws .* Last starts Sep 26 @ Royals 6 IP, 3 R, 6 K/);
  const smith = renderText(describeRostered(114, "CLE", "Cade Smith"));
  assert.match(
    smith,
    /BB 23 Last games Oct 7 @ White Sox 2 IP, 0 R, 5 K .* Sep 26 @ Royals 2\/3 IP, 0 R, 0 K /,
  );
});

test("a player the store keeps no sheet for says his numbers show while he's on a roster", () => {
  const text = readText(
    renderPlayerBody({
      player: null,
      hitters: null,
      starters: null,
      side: null,
      isUnkept: true,
      isLoading: false,
    }),
  );
  assert.equal(text, "His numbers show while he's on a club's roster");
});

const TREINEN_OUT = {
  reason: "Right shoulder inflammation",
  sentence:
    "President of baseball operations Andrew Friedman said Saturday that Treinen (shoulder) hasn't been ruled out for a return in the postseason, Jon Paul Hoornstra of Newsweek.com reports.",
  updated: "2026-10-03T18:34:00.000Z",
};

/** @param {any} [out] what ESPN's report says of him */
function describeTreinen(out = TREINEN_OUT) {
  const entry = answers[listRosterRequest(119, season)].roster.find(
    (/** @type {any} */ each) => each.person.fullName === "Blake Treinen",
  );
  return describePlayer({
    ...NUMBERS,
    entry,
    club: "LAD",
    season,
    person: PEOPLE.get(entry.person.id),
    out,
  });
}

test("a player on the injured list opens on a box with his stay, what's wrong, RotoWire's sentence on it, and the day ESPN changed it, before his season", () => {
  const markup = String(
    renderPlayerBody({
      player: describeTreinen(),
      hitters: HITTERS,
      starters: null,
      side: null,
      isUnkept: false,
      isLoading: false,
    }),
  );

  assert.match(markup, /^<section class="out-box">/);
  assert.equal(
    readText(markup.slice(0, markup.indexOf("</section>"))),
    `15-day IL Right shoulder inflammation ${TREINEN_OUT.sentence} RotoWire • Oct 3`,
  );
  assert.match(markup, /<p class="out-sentence" data-quoted>/);
  assert.ok(markup.indexOf("out-box") < markup.indexOf("<h3>Season</h3>"));
});

test("a player on the injured list ESPN says nothing of shows his stay alone, and one off it shows no box", () => {
  const unexplained = describeTreinen(null);
  assert.equal(unexplained.injury, "15-day IL");
  const markup = String(
    renderPlayerBody({
      player: unexplained,
      hitters: HITTERS,
      starters: null,
      side: null,
      isUnkept: false,
      isLoading: false,
    }),
  );
  assert.equal(readText(markup.slice(0, markup.indexOf("</section>"))), "15-day IL");
  assert.doesNotMatch(markup, /out-sentence/);

  const kwan = describeRostered(114, "CLE", "Steven Kwan");
  assert.equal(kwan.injury, null);
  assert.equal(kwan.out, null);
  assert.doesNotMatch(renderText(kwan), /IL/);
});

test("a player on the injured list without a game this season still shows his box, over the note that he has none", () => {
  const player = {
    ...describeTreinen(),
    hitting: null,
    pitching: null,
    postseasonHitting: null,
    postseasonPitching: null,
  };
  assert.equal(
    renderText(player),
    `15-day IL Right shoulder inflammation ${TREINEN_OUT.sentence} RotoWire • Oct 3 No games yet this season`,
  );
});
