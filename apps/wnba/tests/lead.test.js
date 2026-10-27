import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBoxScore, renderPendingBoxScore } from "../page/js/box-score-view.js";
import { renderLeadChart, renderPendingLeadChart } from "../page/js/lead-chart.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import {
  createLeadServer,
  describeLead,
  findEventId,
  nameScoreboardRequest,
  nameSummaryRequest,
  readEndTime,
} from "../worker/src/lead.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";

// Valkyries at Wings, Game 2, which the Wings won 108-100 in overtime.
const LEAD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-lead.json`, "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const TEAMS = { away: "GSV", home: "DAL" };
const GAME = { id: "1042600112", ...TEAMS, start: LEAD.game.start };

/** @param {Record<string, any>} answers */
const createFetch = (answers) => async (url) =>
  url in answers
    ? new Response(JSON.stringify(answers[url]))
    : new Response("Not found", { status: 404 });

const ESPN_ANSWERS = {
  [nameScoreboardRequest(LEAD.game.start)]: LEAD.scoreboard,
  [nameSummaryRequest(LEAD.eventId)]: LEAD.summary,
};

/**
 * @param {(url: string) => Promise<Response>} fetchImpl
 * @param {Record<string, string>} params
 * @param {(key: string) => Promise<any>} [readDoc]
 */
const askForLead = (fetchImpl, params, readDoc) =>
  createLeadServer({ fetchImpl }).serveLead(
    new URL(`https://wnba.test/lead?${new URLSearchParams(params)}`),
    readDoc,
  );

test("ESPN's game is the day's one between the same away and home teams, on the league's Eastern day", () => {
  assert.equal(
    nameScoreboardRequest("2026-10-01T01:00:00Z"),
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20260930",
  );
  assert.equal(findEventId(LEAD.scoreboard, TEAMS), "401918020");
  assert.equal(findEventId(LEAD.scoreboard, { away: "DAL", home: "GSV" }), null);
});

test("the lead is each basket's seconds from tip-off with the score after it, overtime included", () => {
  const lead = describeLead(LEAD.summary);

  assert.equal(lead.periods, 5);
  assert.equal(lead.isOver, true);
  assert.deepEqual(lead.scores.slice(0, 3), [
    [0, 0, 0],
    [35, 2, 0],
    [65, 4, 0],
  ]);
  assert.deepEqual(lead.scores.at(-1), [2691, 100, 108]);
  assert.ok(lead.scores.every(([at], index) => !index || at >= lead.scores[index - 1][0]));
});

test("a basket in a period's last minute counts its tenths of a second", () => {
  const summary = {
    plays: [
      {
        scoringPlay: true,
        period: { number: 2 },
        clock: { displayValue: "45.2" },
        awayScore: 30,
        homeScore: 28,
      },
    ],
  };

  assert.deepEqual(describeLead(summary).scores.at(-1), [1155, 30, 28]);
  assert.equal(describeLead(summary).isOver, false);
});

test("the Worker answers a game's lead, says when ESPN has no such game, and turns away a bad ask", async () => {
  const answer = await askForLead(createFetch(ESPN_ANSWERS), GAME);
  const body = await answer.json();
  assert.equal(answer.status, 200);
  assert.deepEqual(
    [body.away, body.home, body.start, body.periods],
    ["GSV", "DAL", LEAD.game.start, 5],
  );

  const missing = await askForLead(createFetch(ESPN_ANSWERS), {
    ...GAME,
    away: "IND",
    home: "LVA",
  });
  await assertErrorAnswer(missing, 404, "not_found");

  const refused = await askForLead(createFetch({}), GAME);
  assert.match(await assertErrorAnswer(refused, 502, "upstream_error"), /^Couldn't read ESPN: /);

  for (const params of [
    { ...TEAMS, id: GAME.id },
    { ...TEAMS, start: LEAD.game.start },
    { ...GAME, id: "../x" },
    { ...GAME, home: "GSV" },
  ]) {
    await assertErrorAnswer(
      await askForLead(createFetch(ESPN_ANSWERS), params),
      400,
      "invalid_argument",
    );
  }
});

test("a lead ESPN can't send says what ESPN answered, and for which of its feeds", async () => {
  const fetchImpl = async (/** @type {string} */ url) =>
    url === nameSummaryRequest(LEAD.eventId)
      ? new Response("")
      : new Response(JSON.stringify(ESPN_ANSWERS[url] ?? {}), {
          status: url in ESPN_ANSWERS ? 200 : 503,
        });

  assert.equal(
    await assertErrorAnswer(await askForLead(fetchImpl, GAME), 502, "upstream_error"),
    "Couldn't read ESPN: ESPN answered /apis/site/v2/sports/basketball/wnba/summary with nothing rather than data",
  );
  const otherDay = { ...GAME, start: "2026-09-20T23:00:00Z" };
  assert.equal(
    await assertErrorAnswer(await askForLead(fetchImpl, otherDay), 502, "upstream_error"),
    "Couldn't read ESPN: ESPN answered 503 for /apis/site/v2/sports/basketball/wnba/scoreboard",
  );
});

/**
 * Answers ESPN's feeds from the fixture, counting each read.
 * @param {Record<string, any>} answers
 */
function createCountedFetch(answers) {
  const counted = { reads: 0 };
  const answer = createFetch(answers);
  return Object.assign(counted, {
    fetchImpl: async (/** @type {string} */ url) => {
      counted.reads += 1;
      return answer(url);
    },
  });
}

test("a finished game's lead comes from the store, and from ESPN while the store keeps none or the game isn't over", async () => {
  const espn = createCountedFetch(ESPN_ANSWERS);
  const server = createLeadServer({ fetchImpl: espn.fetchImpl });
  const fromEspn = await (await askForLead(createFetch(ESPN_ANSWERS), GAME)).json();
  /** @param {any} lead */
  const askWithKept = async (lead) => {
    const url = new URL(`https://wnba.test/lead?${new URLSearchParams(GAME)}`);
    const answer = await server.serveLead(url, async (key) =>
      key === `games/${GAME.id}` ? { boxScore: null, lead } : null,
    );
    return answer.json();
  };

  assert.deepEqual(await askWithKept(fromEspn), fromEspn);
  assert.equal(espn.reads, 0);

  assert.deepEqual(await askWithKept({ ...fromEspn, isOver: false }), fromEspn);
  assert.equal(espn.reads, 2);
  assert.deepEqual(await askWithKept(null), fromEspn);
  assert.equal(espn.reads, 3, "ESPN's game is found on its day's scoreboard once");
});

test("a store that can't be read leaves the lead to ESPN", async () => {
  const answer = await askForLead(createFetch(ESPN_ANSWERS), GAME, async () => {
    throw new Error("The store answered 500");
  });
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).periods, 5);
});

test("a game ended when ESPN logged its last play, and its end is unknown until then", () => {
  const plays = [
    { type: { text: "Jump Ball" }, wallclock: "2026-10-01T01:12:59Z" },
    { type: { text: "End Game" }, wallclock: "2026-10-01T04:01:34Z" },
  ];
  assert.equal(readEndTime({ plays }), "2026-10-01T04:01:34Z");
  assert.equal(readEndTime({ plays: plays.slice(0, 1) }), null);
  assert.equal(readEndTime(null), null);
});

/**
 * The text of each of the chart's labels with the class named.
 * @param {string} markup
 * @param {string} name
 */
const readLabels = (markup, name) =>
  [...markup.matchAll(new RegExp(`class="${name}( home| away)?"[^>]*>([^<]+)<`, "g"))].map(
    (match) => match[2],
  );

/**
 * A game the home side leads from its first basket by up to `biggest`, and wins.
 * @param {number} biggest
 * @returns {import("../page/js/lead-chart.js").Lead}
 */
const leadBy = (biggest) => ({
  periods: 4,
  isOver: true,
  scores: [
    [0, 0, 0],
    [600, 0, biggest],
    [2400, 0, 2],
  ],
});

test("the chart names each side on its own half, marks each side's biggest lead, and names each period, overtime too", () => {
  const markup = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;

  assert.match(
    markup,
    /aria-label="The Valkyries led by as many as 8, the Wings led by as many as 8"/,
  );
  assert.deepEqual(readLabels(markup, "lead-side"), [
    "&#9650; Valkyries ahead",
    "&#9660; Wings ahead",
  ]);
  assert.deepEqual(readLabels(markup, "lead-peak-label"), ["Valkyries +8", "Wings +8"]);
  assert.deepEqual(readLabels(markup, "lead-period"), ["Q1", "Q2", "Q3", "Q4", "OT"]);
});

test("each side's half, name, and biggest lead say whose they are, for the sheet to color", () => {
  const markup = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;

  assert.deepEqual(
    [
      ...markup.matchAll(/class="(lead-area|lead-side|lead-peak|lead-peak-label) (home|away)"/g),
    ].map(([, name, place]) => `${name} ${place}`),
    [
      "lead-side away",
      "lead-area away",
      "lead-area home",
      "lead-peak away",
      "lead-peak home",
      "lead-peak-label away",
      "lead-peak-label home",
      "lead-side home",
    ],
  );
});

test("the visitors' lead shows above the middle line and the home team's below, as the box score lists them", () => {
  const markup = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;
  const middle = Number(markup.match(/class="lead-middle"[^>]* y1="([^"]+)"/)[1]);
  const readPeak = (/** @type {string} */ place) =>
    Number(markup.match(new RegExp(`class="lead-peak ${place}"[^>]* cy="([^"]+)"`))[1]);

  assert.ok(readPeak("away") < middle);
  assert.ok(readPeak("home") > middle);
});

test("the scale reaches past the biggest lead far enough to keep its label on the tile", () => {
  for (const { biggest, reach } of [
    { biggest: 7, reach: "+10" },
    { biggest: 8, reach: "+15" },
    { biggest: 10, reach: "+15" },
    { biggest: 11, reach: "+20" },
  ]) {
    assert.deepEqual(readLabels(renderLeadChart(leadBy(biggest), TEAMS).text, "lead-reach"), [
      reach,
      reach,
    ]);
  }
});

test("the chart's shape while it loads is the loaded chart's: the same drawing's size, the teams' names, and a regulation game's periods", () => {
  const pending = renderPendingLeadChart(TEAMS).text;
  const loaded = renderLeadChart(leadBy(8), TEAMS).text;
  const readViewBox = (/** @type {string} */ markup) => markup.match(/viewBox="([^"]+)"/)[1];

  assert.equal(readViewBox(pending), readViewBox(loaded));
  assert.deepEqual(readLabels(pending, "lead-side"), readLabels(loaded, "lead-side"));
  assert.deepEqual(readLabels(pending, "lead-period"), readLabels(loaded, "lead-period"));
  assert.match(pending, /class="lead-tile pending"/);
  assert.doesNotMatch(pending, /lead-line|lead-peak/);
});

test("a live game's line stops at its latest basket, and a side that never led has no mark", () => {
  /** @type {import("../page/js/lead-chart.js").Lead} */
  const lead = {
    periods: 4,
    isOver: false,
    scores: [
      [0, 0, 0],
      [60, 0, 2],
      [600, 10, 20],
    ],
  };
  const markup = renderLeadChart(lead, TEAMS).text;
  const line = markup.match(/class="lead-line" d="([^"]+)"/)[1];

  assert.match(markup, /aria-label="The Valkyries never led, the Wings led by as many as 10"/);
  assert.deepEqual(markup.match(/class="lead-peak [a-z]+"/g), ['class="lead-peak home"']);
  assert.equal(line.split("L").at(-1).split(",")[0], String(30 + (600 / 2400) * 284));
});

test("the box score shows the lead under the quarters once it has a basket", () => {
  const box = describeBoxScore(GAMES.boxScores["1042600112"]);
  const lead = describeLead(LEAD.summary);

  assert.match(
    renderBoxScore(box, { lead }).text,
    /By quarter[\s\S]*Lead through the game[\s\S]*Team stats/,
  );
  assert.doesNotMatch(renderBoxScore(box).text, /Lead through the game/);
  assert.doesNotMatch(
    renderBoxScore(box, { lead: { periods: 4, isOver: false, scores: [[0, 0, 0]] } }).text,
    /Lead through the game/,
  );
});

test("while the lead loads, the box score and its placeholders hold the chart's place, and show it once it's in", () => {
  const box = describeBoxScore(GAMES.boxScores["1042600112"]);
  const lead = describeLead(LEAD.summary);
  const isPendingChart = (/** @type {{ text: string }} */ markup) =>
    /Lead through the game[\s\S]*class="lead-tile pending"[\s\S]*Team stats/.test(markup.text);
  const isLoadedChart = (/** @type {{ text: string }} */ markup) =>
    /Lead through the game[\s\S]*class="lead-line"[\s\S]*Team stats/.test(markup.text);

  assert.ok(isPendingChart(renderPendingBoxScore(TEAMS, { isLeadLoading: true })));
  assert.ok(isPendingChart(renderBoxScore(box, { isLeadLoading: true })));
  assert.ok(isLoadedChart(renderPendingBoxScore(TEAMS, { lead })));
  assert.ok(isLoadedChart(renderBoxScore(box, { lead })));
  assert.doesNotMatch(renderPendingBoxScore(TEAMS).text, /Lead through the game/);
});
