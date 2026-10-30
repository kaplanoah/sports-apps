import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  BasketballGame,
  BaseballGame,
  validateSportsData,
} from "../shared/worker/sports-schema.js";

test("sports validation works when the runtime forbids code generation", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "-e",
      `import { z } from 'zod';
     import { BaseballGame } from './shared/worker/sports-schema.js';
     if (z.config().jitless !== true) process.exit(2);
     BaseballGame.parse({ id: 'game', state: 'pre', start: null, away: null, home: null });`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("schemas reject malformed game state and scores without logging the payload", () => {
  const baseball = {
    id: "game",
    state: "live",
    start: null,
    away: "NYM",
    home: "ATL",
    score: [1, 2],
  };
  assert.equal(validateSportsData(BaseballGame, baseball), baseball);
  for (const invalid of [
    { ...baseball, score: [1, "private-payload"] },
    { ...baseball, state: "unexpected" },
  ]) {
    assert.throws(
      () => validateSportsData(BaseballGame, invalid),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid sports data at (score.1|state):/);
        assert.doesNotMatch(error.message, /private-payload|unexpected/);
        return true;
      },
    );
  }
  const basketball = {
    id: "game",
    round: null,
    series: null,
    number: null,
    start: null,
    state: "live",
    status: "",
    isTimeSet: true,
    period: 1,
    clock: "1:00",
    isIfNeeded: false,
    away: { team: "ATL", seed: null, score: 1, isInBonus: false },
    home: { team: "NYL", seed: null, score: 2, isInBonus: false },
  };
  assert.equal(validateSportsData(BasketballGame, basketball), basketball);
  assert.throws(
    () =>
      validateSportsData(BasketballGame, {
        ...basketball,
        away: { ...basketball.away, score: "1" },
      }),
    /Invalid sports data at away.score/,
  );
});
