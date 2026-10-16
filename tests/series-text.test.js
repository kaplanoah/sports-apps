import test from "node:test";
import assert from "node:assert/strict";
import { convertToText } from "#shared/html.js";
import { describeAsNotification } from "../shared/worker/notifications.js";
import {
  describeSeriesAfterWin,
  describeSeriesGame,
  describeSeriesLead,
  describeSeriesWin,
} from "#shared/series-text.js";

const readGame = (own, theirs) =>
  convertToText(
    describeSeriesGame({
      result: "Fever beat the Aces 99-89",
      number: 2,
      series: "Semifinals",
      own,
      theirs,
    }),
  );

test("a series game's result and where the series stands join with a comma", () => {
  assert.equal(readGame(2, 0), "Fever beat the Aces 99-89 in Game\u00a02, lead the Semifinals 2-0");
  assert.equal(readGame(1, 1), "Fever beat the Aces 99-89 in Game\u00a02, tie the Semifinals 1-1");
  assert.equal(
    readGame(1, 2),
    "Fever beat the Aces 99-89 in Game\u00a02, trail the Semifinals 1-2",
  );
});

test("a series game's notification is one title, with no body", () => {
  const markup = describeSeriesGame({
    result: "Fever beat the Aces 99-89",
    number: 2,
    series: "Semifinals",
    own: 1,
    theirs: 1,
  });
  assert.deepEqual(describeAsNotification(markup, "game"), {
    title: "Fever beat the Aces 99-89 in Game\u00a02, tie the Semifinals 1-1",
    body: "",
    tag: "game",
  });
});

test("a game that wins its series says so, and its wins stay on one line", () => {
  const markup = String(
    describeSeriesWin({
      result: "Dodgers beat the Blue Jays 5-4",
      series: "World Series",
      own: 4,
      theirs: 3,
    }),
  );
  assert.equal(
    markup,
    'Dodgers beat the Blue Jays 5-4 to win the World Series <span class="series-score">4-3</span>',
  );
});

test("a series reads as tied, who leads, or who won it", () => {
  const readLead = (wins, losses, isOver = false) =>
    describeSeriesLead({ leader: "Guardians", wins, losses, isOver });
  assert.equal(readLead(2, 2), "Tied 2-2");
  assert.equal(readLead(0, 0), "Tied 0-0");
  assert.equal(readLead(3, 1), "Guardians lead 3-1");
  assert.equal(readLead(4, 1, true), "Guardians win 4-1");
});

test("a game's winner tells where the series stood after it: ahead, level, behind, or through", () => {
  const readAfterWin = (wins, losses) =>
    describeSeriesAfterWin({ winner: "Guardians", wins, losses, winsNeeded: 3 });
  assert.equal(readAfterWin(2, 1), "Guardians won to lead 2-1");
  assert.equal(readAfterWin(2, 2), "Guardians won to tie 2-2");
  assert.equal(readAfterWin(1, 2), "Guardians won but trail 1-2");
  assert.equal(readAfterWin(3, 2), "Guardians won the series 3-2");
});
