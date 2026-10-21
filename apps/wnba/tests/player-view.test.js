import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describePlayerNote,
  describePosition,
  describeRankNote,
  renderPlayerBody,
  renderPlayerFacts,
  renderPlayerHeading,
} from "../page/js/player-view.js";
import { renderPlayerButton } from "../page/js/player-button.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { stripTags } from "../../../tests/text.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });

/** @param {any} markup */
const readText = (markup) =>
  stripTags(String(markup.text ?? markup).replace(/</g, " <"))
    .replace(/&bull;/g, " | ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const SUBJECT = { id: "1627668", team: "NYL", name: "Breanna Stewart" };

/** @param {Partial<Record<string, any>>} [stat] */
const describeStat = (stat) => ({
  key: "points",
  value: 20.8,
  rank: 7,
  count: 125,
  values: [2, 8, 20.8, 25],
  ...stat,
});

/** @returns {any} */
function createPlayer(changes = {}) {
  return {
    id: SUBJECT.id,
    team: "NYL",
    season: 2026,
    firstName: "Breanna",
    lastName: "Stewart",
    facts: {
      id: SUBJECT.id,
      number: "30",
      firstName: "Breanna",
      lastName: "Stewart",
      position: "F",
      height: `6'4"`,
      age: 32,
      college: "Connecticut",
      country: "USA",
      out: null,
      debut: 2016,
    },
    lastGame: {
      gameId: "1042600102",
      day: "2026-09-29",
      isPlayoffs: true,
      isWin: true,
      teamScore: 90,
      opponentScore: 81,
      points: 21,
      rebounds: 9,
      assists: 4,
      minutes: 36.95,
      steals: 2,
      blocks: 1,
      fieldGoalsMade: 8,
      fieldGoalsAttempted: 15,
      threesMade: 1,
      threesAttempted: 4,
      freeThrowsMade: 4,
      freeThrowsAttempted: 5,
    },
    playoffPoints: { 1042600101: 34 },
    regularSeason: {
      games: 42,
      gamesNeeded: 31,
      averages: { points: 20.83, rebounds: 8.29, assists: 3.26, minutes: 32.95 },
      stats: [
        describeStat(),
        describeStat({ key: "threeShare", value: 0.254, rank: 76, count: 76 }),
      ],
    },
    ...changes,
  };
}

/** @param {any} player */
const renderBody = (
  player,
  { isLoading = false, failure = null, isPastSeason = false, showsOut = true } = {},
) =>
  readText(
    renderPlayerBody({
      player,
      isLoading,
      failure,
      season: SEASON,
      isPastSeason,
      showsOut,
      now: NOW,
    }),
  );

/** @param {any} [out] */
function createOutPlayer(out = {}) {
  const player = createPlayer();
  player.facts.out = {
    reason: "Not injury related",
    isForSeason: false,
    sentence: "Stewart (not with team) is out for Wednesday's game against the Dream.",
    updated: "2026-09-22T21:05:00.000Z",
    ...out,
  };
  return player;
}

test("her heading is her team's dot and her name, and never her Out chip, which leads the box under it", () => {
  assert.equal(readText(renderPlayerHeading(SUBJECT, createOutPlayer())), "Breanna Stewart");
  assert.equal(readText(renderPlayerHeading(SUBJECT, null)), "Breanna Stewart");
  assert.doesNotMatch(String(renderPlayerHeading(SUBJECT, createOutPlayer()).text), /foul-chip/);
});

test("a player who is out has a box first saying why, with RotoWire's sentence and the day ESPN changed it, only while her team still plays", () => {
  const text = checkInTimeZone(EASTERN, () => renderBody(createOutPlayer()));
  assert.match(
    text,
    /^Out Not injury related Stewart \(not with team\) is out for Wednesday's game against the Dream\. RotoWire \| Sep 22 Last game /,
  );
  const markup = String(
    renderPlayerBody({
      player: createOutPlayer(),
      isLoading: false,
      season: SEASON,
      isPastSeason: false,
      showsOut: true,
      now: NOW,
    }).text,
  );
  assert.match(
    markup,
    /^<section class="out-box">\s*<p class="out-line"><span class="foul-chip"><span class="foul-chip-words">Out<\/span><\/span><span class="out-words">Not injury related<\/span><\/p>/,
  );
  assert.match(markup, /<p class="out-sentence" data-quoted>Stewart/);
  assert.doesNotMatch(renderBody(createOutPlayer(), { showsOut: false }), /^Out|RotoWire/);
  assert.doesNotMatch(renderBody(createPlayer()), /^Out|RotoWire/);
});

test("a player out for the season has rest of season after her reason, past an en dash, a capital only when it stands alone, and a box without RotoWire's sentence has no source", () => {
  const player = createOutPlayer({ reason: "Concussion", isForSeason: true, sentence: null });
  const markup = String(
    renderPlayerBody({
      player,
      isLoading: false,
      season: SEASON,
      isPastSeason: false,
      showsOut: true,
      now: NOW,
    }).text,
  );
  assert.match(
    markup,
    /<span class="out-words">Concussion<span class="out-dash">\u2013<\/span>rest of season<\/span>/,
  );
  assert.match(renderBody(player), /^Out Concussion \u2013 ?rest of season Last game /);
  assert.match(
    renderBody(createOutPlayer({ reason: null, isForSeason: true, sentence: null })),
    /^Out Rest of season Last game /,
  );
});

test("under her name, her team, number, and college, or her country for a player who skipped college", () => {
  assert.equal(
    readText(describePlayerNote(SUBJECT, createPlayer())),
    "Liberty | #30 | Connecticut",
  );
  const player = createPlayer();
  player.facts.college = null;
  assert.equal(readText(describePlayerNote(SUBJECT, player)), "Liberty | #30 | USA");
});

test("her facts name her position in words, and leave out any the league doesn't have", () => {
  assert.equal(
    readText(renderPlayerFacts(createPlayer(), false)),
    `Position Forward Height 6'4" Age 32 Debut 2016`,
  );
  const player = createPlayer();
  player.facts.age = null;
  assert.doesNotMatch(readText(renderPlayerFacts(player, false)), /Age/);
  assert.deepEqual(["G", "F", "C", "G-F", "F-C"].map(describePosition), [
    "Guard",
    "Forward",
    "Center",
    "Guard-Forward",
    "Forward-Center",
  ]);
});

test("her last game has its day and score, her numbers over her season's averages, and her shooting and defense", () => {
  const text = checkInTimeZone(EASTERN, () => renderBody(createPlayer()));
  assert.match(
    text,
    /^Last game Yesterday \| W 90-81 Pts Reb Ast Min 21 9 4 37\.0 Avg 20\.8 8\.3 3\.3 33\.0 /,
  );
  assert.match(text, /Shooting 8-15 FG \| 1-4 3PT \| 4-5 FT Defense 2 STL \| 1 BLK/);
});

test("her turnovers follow her defense on a line of their own, and rank from the fewest, once the store keeps them", () => {
  const player = createPlayer();
  player.lastGame.turnovers = 3;
  player.regularSeason.stats.push(
    describeStat({ key: "turnovers", value: 2.6, rank: 9, values: [0.5, 1.2, 2.6, 4] }),
  );
  const text = renderBody(player);
  assert.match(text, /Pts Reb Ast Min 21 9 4 37\.0 Avg 20\.8 8\.3 3\.3 33\.0 /);
  assert.match(text, /Defense 2 STL \| 1 BLK Turnovers 3 Playoffs/);
  assert.match(
    text,
    /Regular season 42 games Pts 20\.8 7th of 125 TO 2\.6 9th of 125 3P% 25\.4 76th of 76 Turnovers ranked by fewest The number of ranked/,
  );
  const plain = renderBody(createPlayer());
  assert.doesNotMatch(plain, /TO/);
  assert.doesNotMatch(plain, /Turnovers/);
});

test("an unranked player's turnovers show her number alone, without the note on how they rank", () => {
  const player = createPlayer();
  player.regularSeason.games = 9;
  player.regularSeason.stats.push(describeStat({ key: "turnovers", value: 1, rank: null }));
  const text = renderBody(player);
  assert.match(text, /TO 1\.0 /);
  assert.doesNotMatch(text, /ranked by fewest/);
});

test("her playoffs list her team's games with her points in each, DNP for one she missed, and its next game", () => {
  const text = renderBody(createPlayer());
  assert.match(
    text,
    /Playoffs Semis G1 W at Lynx 1st Rd 34 Pts G2 W vs Lynx 1st Rd DNP G1 at TBD Semis Sun, Oct 4 /,
  );
});

test("her regular season ranks each average among the players the WNBA ranks, on a curve, and says why the count varies", () => {
  const text = renderBody(createPlayer());
  assert.match(text, /Regular season 42 games Pts 20\.8 7th of 125 3P% 25\.4 76th of 76/);
  assert.match(
    text,
    /varies by stat because the WNBA only ranks players who've played 31 games or reached a certain total in a stat, and shooting percentages only for those who've made a certain number of shots(?!\.)/,
  );
  assert.match(
    String(
      renderPlayerBody({
        player: createPlayer(),
        isLoading: false,
        season: SEASON,
        isPastSeason: false,
        showsOut: true,
        now: NOW,
      }).text,
    ),
    /class="player-ranks" style="--mark-light: #4f9c7e; --mark-dark: #87d5b5;"/,
  );
});

test("a stat she isn't ranked in shows her number alone, and the note says why", () => {
  const player = createPlayer();
  player.regularSeason.games = 21;
  player.regularSeason.stats[0] = describeStat({ rank: null });
  const body = renderPlayerBody({
    player,
    isLoading: false,
    season: SEASON,
    isPastSeason: false,
    showsOut: true,
    now: NOW,
  });
  assert.match(readText(body), /Pts 20\.8 3P% 25\.4 76th of 76/);
  assert.equal(String(body.text).match(/player-curve-area/g)?.length, 1);
  assert.equal(
    describeRankNote(player.regularSeason, false),
    "The WNBA only ranks players who've played 31 games or reached a certain total in a stat, and shooting percentages only for those who've made a certain number of shots. She's played 21 games.",
  );
  player.regularSeason.games = 1;
  assert.match(describeRankNote(player.regularSeason, false), /She's played 1 game\.$/);
});

test("a stat she isn't ranked in, once she's a quarter of the way to the rule for it, shows where she would rank, as a line on its curve with no dot", () => {
  const player = createPlayer();
  player.regularSeason.games = 21;
  player.regularSeason.stats[0] = describeStat({ rank: null, value: 21, progress: 0.25 });
  const render = () =>
    renderPlayerBody({
      player,
      isLoading: false,
      season: SEASON,
      isPastSeason: false,
      showsOut: true,
      now: NOW,
    });
  const body = render();
  assert.match(readText(body), /Pts 21\.0 would be 2nd /);
  assert.match(
    String(body.text),
    /<i class="provisional" style="left: [\d.]+%; top: [\d.]+%"><\/i>/,
  );
  assert.equal(String(body.text).match(/player-curve-area/g)?.length, 2);

  player.regularSeason.stats[0] = describeStat({ rank: null, value: 21, progress: 0.24 });
  assert.match(readText(render()), /Pts 21\.0 3P%/);
  assert.doesNotMatch(String(render().text), /provisional/);
});

test("a player who played enough games but made too few shots for a percentage is told which, by name", () => {
  const { regularSeason } = createPlayer();
  regularSeason.stats[1] = describeStat({ key: "threeShare", value: 0.125, rank: null });
  assert.equal(
    describeRankNote(regularSeason, false),
    "She hasn't made enough 3-pointers to be ranked in 3P%. The WNBA only ranks shooting percentages for players who've made a certain number of shots.",
  );
  assert.equal(
    describeRankNote(regularSeason, true),
    "She didn't make enough 3-pointers to be ranked in 3P%. The WNBA only ranks shooting percentages for players who've made a certain number of shots.",
  );
  regularSeason.stats.push(describeStat({ key: "freeThrowShare", value: 0.575, rank: null }));
  assert.match(
    describeRankNote(regularSeason, false),
    /^She hasn't made enough 3-pointers or free throws to be ranked in 3P% or FT%\./,
  );
  regularSeason.stats.push(describeStat({ key: "fieldGoalShare", value: 0.638, rank: null }));
  assert.match(
    describeRankNote(regularSeason, false),
    /^She hasn't made enough field goals, 3-pointers, or free throws to be ranked in FG%, 3P%, or FT%\./,
  );
});

test("a player who hasn't played says so above her team's playoff games", () => {
  const player = createPlayer({ lastGame: null, regularSeason: null, playoffPoints: {} });
  assert.match(renderBody(player), /^No games yet this season Playoffs .*DNP.*DNP/);
  assert.match(renderBody(player, { isPastSeason: true }), /^No games this season/);
});

test("while her numbers load the sheet holds their shape, and says so when they don't", () => {
  assert.match(
    String(
      renderPlayerBody({
        player: null,
        isLoading: true,
        season: SEASON,
        isPastSeason: false,
        showsOut: true,
        now: NOW,
      }).text,
    ),
    /placeholder/,
  );
  assert.equal(
    renderBody(null, { failure: "offline" }),
    "Couldn't connect to the internet Will load her numbers when back online Try again",
  );
  assert.match(
    renderPlayerBody({
      player: null,
      isLoading: false,
      season: SEASON,
      isPastSeason: false,
      showsOut: true,
      now: NOW,
    }).text,
    /class="retry-block"[\s\S]*class="retry-button filled" data-retry/,
  );
  assert.match(String(renderPlayerFacts(null, true)), /placeholder/);
  assert.equal(renderPlayerFacts(null, false), false);
  assert.equal(readText(describePlayerNote(SUBJECT, null)), "Liberty");
});

test("a player's name is a button that opens her sheet", () => {
  const button = renderPlayerButton(
    { id: 1627668, team: "NYL", firstName: "Breanna", lastName: "Stewart" },
    "Stewart",
  );
  assert.match(
    String(button.text),
    /<button type="button" class="player-open" data-player="1627668" data-player-team="NYL" data-player-name="Breanna Stewart">Stewart<\/button>/,
  );
});
