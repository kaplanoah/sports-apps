import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { listSides, renderMatchupBody, updateSides } from "../page/js/matchup.js";
import { Markup, convertToText } from "../../../shared/page/html.js";
import { normalizeSpaces } from "../../../tests/text.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";

useTimeZone(EASTERN);

// Every qualified starter's number in each measure, from the lowest, as the Worker sends it.
const SPREAD = {
  era: [2.1, 3.0, 3.66, 4.02, 4.6, 5.3],
  k9: [6.1, 7.7, 8.4, 9.1, 10.2, 11.5],
  bb9: [1.8, 2.4, 2.9, 3.1, 3.4, 4.2],
  speed: [88.9, 90.8, 92.5, 94.0, 95.4, 97.8],
};

// What the Worker answers for Astros at Athletics' starters, Blubaugh and Springs.
const describePitcher = (id, [firstName, lastName], line, ranks, pitches) => ({
  id,
  firstName,
  lastName,
  hand: "R",
  age: 27,
  line,
  ranks,
  starters: { count: 46, values: SPREAD },
  pitches,
  starts: [
    { date: "2026-09-19", opp: "SEA", home: true, ip: "5.2", runs: 2, k: 6 },
    { date: "2026-09-13", opp: "TEX", home: false, ip: "6.0", runs: 0, k: 8 },
  ],
});
const BLUBAUGH = describePitcher(
  1,
  ["AJ", "Blubaugh"],
  { starts: 28, ip: "165.1", era: "3.66", k9: 9.1, bb9: 3.4, speed: 95.4 },
  {
    era: { rank: 17, of: 46 },
    k9: { rank: 3, of: 46 },
    bb9: { rank: 33, of: 46 },
    speed: { rank: 10, of: 46 },
  },
  [
    { code: "FF", name: "Four-seam FB", share: 0.52, mph: 95.4 },
    { code: "SL", name: "Slider", share: 0.3, mph: 86.1 },
    { code: "CH", name: "Changeup", share: 0.17, mph: 87.0 },
  ],
);
const SPRINGS = describePitcher(
  2,
  ["Jeffrey", "Springs"],
  { starts: 24, ip: "128.2", era: "4.02", k9: 7.7, bb9: 2.9, speed: 90.8 },
  {
    era: { rank: 29, of: 46 },
    k9: { rank: 26, of: 46 },
    bb9: { rank: 20, of: 46 },
    speed: { rank: 43, of: 46 },
  },
  [
    { code: "FF", name: "Four-seam FB", share: 0.4, mph: 90.8 },
    { code: "CH", name: "Changeup", share: 0.35, mph: 79.5 },
  ],
);

const TONIGHT = "2026-09-24";
// Each club's games so far, which a starter needs as many innings as to qualify.
const CLUB_GAMES = { HOU: 157, ATH: 158 };
const AT_ATHLETICS = {
  date: TONIGHT,
  start: "2026-09-25T01:40:00Z",
  state: "pre",
  away: "HOU",
  home: "ATH",
  starters: [
    { id: 1, name: "Blubaugh" },
    { id: 2, name: "Springs" },
  ],
  today: true,
};

/**
 * The sheet's markup once each side has loaded what the Worker answers for it.
 * @param {any} game
 * @param {object[]} loaded what each side, away then home, loads
 * @param {Record<string, number>} [clubGames] each club's games so far
 */
function renderLoaded(game, loaded, clubGames = CLUB_GAMES) {
  const sides = listSides(game).map((side, index) => ({ ...side, ...loaded[index] }));
  const countClubGames = (/** @type {string} */ club) => clubGames[club] ?? null;
  return normalizeSpaces(String(renderMatchupBody(game, sides, countClubGames)));
}

/**
 * @param {any} [away]
 * @param {any} [home]
 * @param {Record<string, number>} [clubGames]
 */
const renderStarters = (away = BLUBAUGH, home = SPRINGS, clubGames = CLUB_GAMES) =>
  renderLoaded(AT_ATHLETICS, [{ pitcher: away }, { pitcher: home }], clubGames);

const readText = (markup) => convertToText(new Markup(markup)).replace(/\s+/g, " ").trim();

/**
 * The text of every element with the class, in order.
 * @param {string} markup
 * @param {string} name
 */
const readClass = (markup, name) =>
  [...markup.matchAll(new RegExp(`<(\\w+) class="${name}"[^>]*>([\\s\\S]*?)</\\1>`, "g"))].map(
    ([, , inner]) => readText(inner),
  );

/**
 * Each measure's two numbers, as the tape draws them, and where each starter's mark sits on its
 * curve, as a share of its width.
 * @param {string} markup
 */
const readTape = (markup) =>
  markup
    .split('<div class="tape-measure">')
    .slice(1)
    .map((measure) => ({
      label: readClass(measure, "tape-label")[0],
      away: readNumber(measure, "away"),
      home: readNumber(measure, "home"),
      marks: Object.fromEntries(
        [...measure.matchAll(/<b class="(away|home)" style="left: ([\d.]+)%/g)].map(
          ([, side, left]) => [side, Number(left)],
        ),
      ),
    }));

/**
 * @param {string} measure
 * @param {"away" | "home"} side
 */
function readNumber(measure, side) {
  const start = measure.indexOf(`<span class="tape-number ${side}`);
  if (start < 0) return null;
  const number = measure.slice(start).split(/class="(?:tape-label|player-curve)"/)[0];
  return {
    value: readClass(number, "tabular")[0],
    rank: readClass(number, "tape-rank")[0] ?? null,
    standing: number.match(/^<span class="tape-number \w+ (better|worse|unranked)/)?.[1] ?? null,
  };
}

const countMatches = (markup, pattern) => [...markup.matchAll(pattern)].length;

/** @param {string} isoTime @param {() => void} check */
function checkAt(isoTime, check) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(isoTime) });
  try {
    check();
  } finally {
    mock.timers.reset();
  }
}

test("each measure shows each starter's number and rank under his side, the higher-ranked one bolder and the other's dot dimmed", () => {
  const markup = renderStarters();
  const tape = readTape(markup);
  assert.deepEqual(
    tape.map((measure) => measure.label),
    ["ERA", "K/9", "BB/9", "Fastball mph"],
  );
  assert.deepEqual(
    tape.map(({ away, home }) => [away, home]),
    [
      [
        { value: "3.66", rank: "17th", standing: "better" },
        { value: "4.02", rank: "29th", standing: "worse" },
      ],
      [
        { value: "9.1", rank: "3rd", standing: "better" },
        { value: "7.7", rank: "26th", standing: "worse" },
      ],
      [
        { value: "3.4", rank: "33rd", standing: "worse" },
        { value: "2.9", rank: "20th", standing: "better" },
      ],
      [
        { value: "95.4", rank: "10th", standing: "better" },
        { value: "90.8", rank: "43rd", standing: "worse" },
      ],
    ],
  );
  assert.deepEqual(readClass(markup, "tape-note"), ["Rank among qualified starters"]);
});

test("both starters are marked on one curve of every qualified starter's number, the better one always further right", () => {
  const tape = readTape(renderStarters());
  assert.ok(tape.every(({ marks }) => marks.away !== undefined && marks.home !== undefined));
  const [era, strikeouts, walks, speed] = tape;
  assert.ok(era.marks.away > era.marks.home, "a lower ERA sits further right");
  assert.ok(strikeouts.marks.away > strikeouts.marks.home);
  assert.ok(walks.marks.home > walks.marks.away, "fewer walks sit further right");
  assert.ok(speed.marks.away > speed.marks.home);
});

test("each starter's marks take his club's color, the away club taking its other one when the two look alike", () => {
  const readColors = (away, home) =>
    renderLoaded({ ...AT_ATHLETICS, away, home }, [
      { pitcher: BLUBAUGH },
      { pitcher: SPRINGS },
    ]).match(/<div class="tape" style="([^"]*)">/)[1];
  assert.equal(readColors("HOU", "CIN"), "--away: #608eca; --home: #fb4c4c");
  assert.equal(readColors("DET", "SF"), "--away: #738eb1; --home: #fd5a1e");
});

test("two numbers that read the same mark neither starter as ahead", () => {
  const tied = { ...SPRINGS, line: { ...SPRINGS.line, k9: 9.1 } };
  const [, strikeouts] = readTape(renderStarters(BLUBAUGH, tied));
  assert.equal(strikeouts.away.standing, null);
  assert.equal(strikeouts.home.standing, null);
});

test("a finished game without its starters names both clubs and has nothing to check back for", () => {
  const final = { ...AT_ATHLETICS, state: "final", starters: [] };
  const markup = renderLoaded(final, [{}, {}]);
  assert.equal(countMatches(markup, /<div class="pitcher-id (away|home)">/g), 2);
  assert.equal(countMatches(markup, /class="club team-open"/g), 2);
  assert.doesNotMatch(markup, /check-back/);
});

test("a game with its starters named has nothing to check back for", () => {
  const markup = renderStarters();
  assert.equal(countMatches(markup, /class="pitch-mix"/g), 2);
  assert.doesNotMatch(markup, /check-back/);
});

test("a club with no starts to go by says so", () => {
  const stillTbd = { ...AT_ATHLETICS, starters: [] };
  const markup = renderLoaded(stillTbd, [
    { rotation: { club: "HOU", date: TONIGHT, starters: [] } },
    { failure: "unreachable" },
  ]);
  const astros = markup.slice(
    0,
    markup.indexOf('<section class="scout">', markup.indexOf("scout") + 1),
  );
  assert.deepEqual(readClass(astros, "scout-note"), ["No starts in the last two weeks to go by"]);
  assert.doesNotMatch(astros, /class="rotation"/);
});

test("a starter outside the qualified starters has his numbers marked unranked, with no rank or mark, and a line saying why, and neither is marked ahead", () => {
  const markup = renderStarters(BLUBAUGH, { ...SPRINGS, ranks: null });
  const tape = readTape(markup);
  assert.deepEqual(
    tape.map((measure) => measure.home),
    ["4.02", "7.7", "2.9", "90.8"].map((value) => ({ value, rank: null, standing: "unranked" })),
  );
  assert.deepEqual(tape[0].away, { value: "3.66", rank: "17th", standing: null });
  assert.ok(tape.every(({ marks }) => marks.away !== undefined && marks.home === undefined));
  assert.deepEqual(readClass(markup, "tape-note"), [
    "Rank among qualified starters",
    "Springs has pitched 128 2/3 of the 158 innings needed to qualify",
  ]);
});

test("with neither starter ranked, the sheet says why and drops the note about the curves", () => {
  const markup = renderStarters(
    { ...BLUBAUGH, ranks: null, line: { ...BLUBAUGH.line, ip: "88.0" } },
    { ...SPRINGS, ranks: null },
  );
  assert.ok(
    readTape(markup).every(
      ({ away, home }) => away.standing === "unranked" && home.standing === "unranked",
    ),
  );
  assert.deepEqual(readClass(markup, "tape-note"), [
    "Blubaugh has pitched 88 of the 157 innings needed to qualify",
    "Springs has pitched 128 2/3 of the 158 innings needed to qualify",
  ]);
});

test("an unranked starter whose innings or club's games aren't known yet still says he needs more to qualify", () => {
  const withoutInnings = { ...SPRINGS, ranks: null, line: { ...SPRINGS.line, ip: undefined } };
  for (const markup of [
    renderStarters(BLUBAUGH, withoutInnings),
    renderStarters(BLUBAUGH, { ...SPRINGS, ranks: null }, {}),
  ])
    assert.deepEqual(readClass(markup, "tape-note"), [
      "Rank among qualified starters",
      "Springs hasn't pitched the innings needed to qualify",
    ]);
});

/** @param {{ isStillPitching: boolean }} options */
function readLiveStarts({ isStillPitching }) {
  const [blubaugh, springs] = AT_ATHLETICS.starters;
  const live = {
    ...AT_ATHLETICS,
    state: "live",
    starters: [{ ...blubaugh, pitching: isStillPitching }, springs],
  };
  const tonight = { date: TONIGHT, opp: "ATH", home: false, ip: "2.0", runs: 0, k: 3 };
  const pitcher = { ...BLUBAUGH, starts: [tonight, ...BLUBAUGH.starts] };
  const markup = renderLoaded(live, [{ pitcher }, { pitcher: SPRINGS }]);
  const [starts] = [...markup.matchAll(/<ul class="recent-starts">([\s\S]*?)<\/ul>/g)];
  return [...starts[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, start]) => ({
    parts: [...start.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(([, part]) => readText(part)),
    isNow: start.includes('class="start-now"'),
  }));
}

test("a start in the game under way says Now while he's still pitching", () =>
  checkAt("2026-09-25T02:30:00Z", () => {
    const [now, last] = readLiveStarts({ isStillPitching: true });
    assert.deepEqual(now, { parts: ["Now", "@ Athletics", "2 IP, 0 R, 3 K"], isNow: true });
    assert.deepEqual(last, {
      parts: ["Sep 19", "vs Mariners", "5 2/3 IP, 2 R, 6 K"],
      isNow: false,
    });
  }));

test("a start in the game under way says Today once he's pulled", () =>
  checkAt("2026-09-25T02:30:00Z", () => {
    const [today] = readLiveStarts({ isStillPitching: false });
    assert.deepEqual(today, { parts: ["Today", "@ Athletics", "2 IP, 0 R, 3 K"], isNow: false });
  }));

test("both starters' speed lines share one scale, from the slowest pitch either throws to the fastest", () => {
  const markup = renderStarters();
  const scales = [...markup.matchAll(/<div class="speed-labels"[^>]*>([\s\S]*?)<\/div>/g)].map(
    ([, labels]) =>
      labels
        .split(/<span class="speed-label"[^>]*>/)
        .slice(1)
        .map(readText),
  );
  assert.deepEqual(scales, [
    ["70 mph", "80", "90", "100"],
    ["70 mph", "80", "90", "100"],
  ]);
});

test("a starter whose numbers didn't load says so under his club, with Try again, and the other's still show", () => {
  const markup = renderLoaded(AT_ATHLETICS, [{ pitcher: BLUBAUGH }, { failure: "unreachable" }]);
  const springs = markup.slice(markup.indexOf('<div class="pitcher-id home">'));
  assert.deepEqual(readClass(springs, "retry-side"), ["Couldn't load Try again"]);
  assert.equal(countMatches(markup, /class="retry-side"/g), 1);
  assert.equal(countMatches(markup, /data-retry/g), 1);
  assert.equal(countMatches(markup, /class="pitch-mix"/g), 1);
  assert.equal(countMatches(markup, /<section class="scout">/g), 1);
  assert.doesNotMatch(markup, /retry-block/);
});

test("a starter whose numbers didn't load still shows the first name the game keeps", () => {
  const withFirstNames = {
    ...AT_ATHLETICS,
    starters: [
      { id: 1, name: "Blubaugh", firstName: "AJ" },
      { id: 2, name: "Springs", firstName: "Jeffrey" },
    ],
  };
  const failed = renderLoaded(withFirstNames, [{ pitcher: BLUBAUGH }, { failure: "unreachable" }]);
  assert.deepEqual(readClass(failed, "pitcher-first"), ["AJ", "Jeffrey"]);
  assert.match(failed, /data-player-name="Jeffrey Springs"/);
  const loading = renderLoaded(withFirstNames, [{ pitcher: BLUBAUGH }, {}]);
  assert.deepEqual(readClass(loading, "pitcher-first"), ["AJ", "Jeffrey"]);
});

test("with neither starter's numbers loaded, the section says why once, centered over Try again", () => {
  const markup = renderLoaded(AT_ATHLETICS, [
    { failure: "unreachable" },
    { failure: "unreachable" },
  ]);
  assert.deepEqual(readClass(markup, "retry-title"), ["Couldn't connect to the server"]);
  assert.deepEqual(readClass(markup, "retry-next"), ["Try again to load starters' numbers"]);
  assert.equal(countMatches(markup, /data-retry/g), 1);
  assert.match(markup, /class="retry-button filled"/);
  assert.doesNotMatch(markup, /retry-side|<section class="scout">/);
});

test("a club whose last starters didn't load says so with Try again, beside the other's", () => {
  const stillTbd = { ...AT_ATHLETICS, starters: [] };
  const markup = renderLoaded(stillTbd, [
    { rotation: { club: "HOU", date: TONIGHT, starters: [] } },
    { failure: "unreachable" },
  ]);
  const athletics = markup.slice(markup.lastIndexOf('<section class="scout">'));
  assert.deepEqual(readClass(athletics, "retry-message scout-note"), [
    "Couldn't load who started lately",
  ]);
  assert.equal(countMatches(markup, /data-retry/g), 1);
  assert.doesNotMatch(markup, /retry-block/);
});

test("with neither club's last starters loaded, the section says so once", () => {
  const stillTbd = { ...AT_ATHLETICS, starters: [] };
  const markup = renderLoaded(stillTbd, [{ failure: "offline" }, { failure: "offline" }]);
  assert.deepEqual(readClass(markup, "retry-title"), ["Couldn't connect to the internet"]);
  assert.deepEqual(readClass(markup, "retry-next"), [
    "Will load who started lately when back online",
  ]);
  assert.equal(countMatches(markup, /data-retry/g), 1);
});

test("a lone named starter whose numbers didn't load leaves the section saying so", () => {
  const oneNamed = {
    ...AT_ATHLETICS,
    state: "final",
    starters: [{ id: 1, name: "Blubaugh" }, null],
  };
  const markup = renderLoaded(oneNamed, [{ failure: "server" }, {}]);
  assert.deepEqual(readClass(markup, "retry-title"), ["The server had a problem"]);
  assert.deepEqual(readClass(markup, "retry-next"), ["Try again to load his numbers"]);
});

test("a starter named after the sheet read its sides takes his side's place, and the other side stays as it loaded", () => {
  const unnamed = { ...AT_ATHLETICS, starters: [AT_ATHLETICS.starters[0], { id: 2 }] };
  const sides = listSides(unnamed).map((side) => ({ ...side, pitcher: BLUBAUGH }));
  const [away, home] = updateSides(sides, AT_ATHLETICS);
  assert.equal(away, sides[0]);
  assert.deepEqual(home.starter, { id: 2, name: "Springs" });
  assert.equal(home.pitcher, null);
});

test("a club's starter changed after the sheet read its sides takes his side's place", () => {
  const sides = listSides(AT_ATHLETICS);
  const changed = {
    ...AT_ATHLETICS,
    starters: [{ id: 3, name: "Brown" }, AT_ATHLETICS.starters[1]],
  };
  const [away, home] = updateSides(sides, changed);
  assert.deepEqual(away.starter, { id: 3, name: "Brown" });
  assert.equal(home, sides[1]);
});

test("a starter the store has only by his id keeps the side that names him", () => {
  const sides = listSides(AT_ATHLETICS);
  const unnamed = { ...AT_ATHLETICS, starters: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(updateSides(sides, unnamed), sides);
  assert.equal(updateSides(sides, unnamed)[0], sides[0]);
});
