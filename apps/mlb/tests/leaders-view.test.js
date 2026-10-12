import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderLeaders } from "../page/js/leaders-view.js";
import {
  describeRoster,
  indexSeasonStats,
  listRosterRequest,
  listSeasonStatsRequest,
} from "../worker/src/rosters.js";

// What MLB answered early on Oct 8: the Dodgers' 40-man roster and every player's regular season,
// once the Dodgers had played all 162 games.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-08-rosters.json`, "utf8"),
);
const { season, answers } = FIXTURE;
const ROSTER = describeRoster({
  club: "LAD",
  season,
  roster: answers[listRosterRequest(119, season)],
  hitting: indexSeasonStats(answers[listSeasonStatsRequest(season, "hitting")]),
  pitching: indexSeasonStats(answers[listSeasonStatsRequest(season, "pitching")]),
});
const SEASON_GAMES = 162;

/**
 * Each leader's row as it reads: the stat, his name, and his number.
 * @param {unknown} markup
 */
const listRows = (markup) =>
  [...String(markup).matchAll(/<tr>(.*?)<\/tr>/gs)]
    .map(([, row]) =>
      row
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((row) => row && row !== "Hitting" && row !== "Pitching");

/** @param {Partial<Parameters<typeof renderLeaders>[0]>} [shown] */
const render = (shown) =>
  renderLeaders({
    roster: ROSTER,
    clubGames: SEASON_GAMES,
    isLoading: false,
    failure: null,
    ...shown,
  });

test("a club's leaders are who leads it in each of MLB's headline numbers, at the plate and on the mound", () => {
  const markup = render();
  assert.match(String(markup), /<h3>Leaders<\/h3>\s*<span>Regular season<\/span>/);
  assert.deepEqual(listRows(markup), [
    "AVG Freddie Freeman .288",
    "OPS Shohei Ohtani .889",
    "HR Shohei Ohtani 30",
    "RBI Andy Pages 85",
    "SB Andy Pages 13",
    "ERA Yoshinobu Yamamoto 2.53",
    "K Tarik Skubal 186",
    "IP Yoshinobu Yamamoto 185",
    "SV Tanner Scott 25",
  ]);
});

test("AVG, OPS, and ERA count only qualified players, as MLB's leaders do, so Ohtani's 1.79 in 85 2/3 innings doesn't lead", () => {
  const ohtani = ROSTER.players.find((player) => player.name === "Shohei Ohtani");
  assert.equal(ohtani?.pitching.era, "1.79");
  assert.match(listRows(render()).join("|"), /ERA Yoshinobu Yamamoto/);

  // Early in a season, the same numbers over fewer games qualify more players.
  const early = listRows(render({ clubGames: 80 }));
  assert.ok(early.includes("ERA Shohei Ohtani 1.79"));
});

test("a number no one on the club qualifies in, or has any of yet, shows no row", () => {
  const rows = listRows(render({ clubGames: 400 }));
  assert.ok(!rows.some((row) => /^(AVG|OPS|ERA) /.test(row)));
  assert.ok(rows.includes("HR Shohei Ohtani 30"));

  const noSaves = {
    ...ROSTER,
    players: ROSTER.players.map((player) =>
      player.pitching ? { ...player, pitching: { ...player.pitching, saves: 0 } } : player,
    ),
  };
  assert.ok(!listRows(render({ roster: noSaves })).some((row) => row.startsWith("SV ")));
});

test("each leader's row opens his sheet wherever it's tapped", () => {
  const markup = String(render());
  assert.match(markup, /class="row-button-clip"/);
  assert.match(
    markup,
    /<td class="team row-button-cell"><span class="leader-stat">AVG<\/span><button type="button" class="player-open box-name" data-player="518692" data-player-club="LAD"/,
  );
});

test("leaders hold their shape while the roster loads, say so when it didn't, and don't show for a club whose games aren't known", () => {
  assert.match(String(render({ roster: null, isLoading: true })), /class="placeholder/);
  assert.match(
    String(render({ roster: null, failure: "unreachable" })),
    /Couldn&#39;t load the leaders[\s\S]*data-retry/,
  );
  assert.equal(render({ roster: null }), false);
  assert.equal(render({ clubGames: null }), false);
});
