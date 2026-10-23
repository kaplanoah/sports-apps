export default {
  mutate: [
    "shared/page/search-reading.js",
    "shared/page/series-text.js",
    "shared/page/season-days.js",
  ],
  testRunner: "command",
  commandRunner: {
    command: "node worker/mutation-tests.mjs",
  },
  coverageAnalysis: "off",
  // Node's command runner needs no TypeScript config or compiler API in its sandbox.
  ignorePatterns: ["tsconfig.json"],
  concurrency: 4,
  timeoutMS: 30000,
  reporters: ["clear-text", "json", "html"],
};
