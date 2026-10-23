export default {
  mutate: [
    "shared/page/search-reading.js",
    "shared/page/series-text.js",
    "shared/page/season-days.js",
  ],
  testRunner: "command",
  commandRunner: {
    command:
      "node --import ./tests/no-network.js --test tests/game-search.test.js tests/series-text.test.js tests/season-days.test.js apps/mlb/tests/page.test.js apps/wnba/tests/page.test.js apps/wnba/tests/game-sheet.test.js",
  },
  coverageAnalysis: "off",
  // Node's command runner needs no TypeScript config or compiler API in its sandbox.
  ignorePatterns: ["tsconfig.json"],
  concurrency: 4,
  timeoutMS: 30000,
  reporters: ["clear-text", "json", "html"],
  thresholds: { break: 0 },
};
