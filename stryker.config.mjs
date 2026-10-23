import { readMutationTarget } from "./worker/mutation-targets.mjs";

const target = process.env.MUTATION_TARGET;
const module = readMutationTarget(target);
const report = `reports/mutation/${target}`;

export default {
  mutate: [module],
  testRunner: "command",
  commandRunner: {
    command: "node worker/mutation-tests.mjs",
  },
  coverageAnalysis: "off",
  // Node's command runner needs no TypeScript config or compiler API in its sandbox.
  ignorePatterns: ["tsconfig.json"],
  concurrency: 1,
  timeoutMS: 30000,
  reporters: ["clear-text", "json", "html", "event-recorder"],
  eventReporter: { baseDir: `${report}/events` },
  jsonReporter: { fileName: `${report}/mutation.json` },
  htmlReporter: { fileName: `${report}/mutation.html` },
  tempDirName: `.stryker-tmp/${target}`,
};
