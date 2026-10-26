import { existsSync } from "node:fs";
import { defineConfig, devices, webkit } from "@playwright/test";
import { listAppsWithBrowserTests } from "./worker/apps.mjs";
import { WEBKIT_TEST_MATCH } from "./worker/browser-projects.mjs";
import { ASSERTION_TIMEOUT_MS } from "./tests/browser/limits.mjs";

// Another checkout's browser tests can run alongside on other ports.
const FIRST_PORT = Number(process.env.BROWSER_TEST_PORT) || 4173;
const executablePath = process.env.CHROMIUM_PATH;

// Each app with browser tests gets its own project, served from its own port.
const appsWithBrowserTests = listAppsWithBrowserTests();
const findPort = (index) => FIRST_PORT + index;

// iPhones run the pages in WebKit, so the at-rest specs run there too wherever it's installed.
const hasWebKit = existsSync(webkit.executablePath());

export default defineConfig({
  timeout: 30_000,
  expect: { timeout: ASSERTION_TIMEOUT_MS },
  // CI retries a failed test once, so a test that fails only now and then doesn't fail a pull
  // request it has nothing to do with. GitHub's reporter marks each one that passed only on its
  // retry as flaky on the pull request's checks, and a nightly run finds them on main
  // (.github/workflows/flaky.yml).
  retries: process.env.CI ? 1 : 0,
  // A broken change fails many tests, each only after its timeout and its retry's, so CI stops a
  // run once five tests have failed rather than spending its whole time limit on them. A test
  // that passed on its retry doesn't count.
  maxFailures: process.env.CI ? 5 : 0,
  // Each test stands alone, so CI's shards split the tests evenly rather than file by file.
  fullyParallel: true,
  // The tests are bound by the CPU, and a browser per core keeps CI's busier than Playwright's
  // default of one per two.
  workers: process.env.CI ? "100%" : undefined,
  forbidOnly: !!process.env.CI,
  // CI's JSON report names each test that failed only some of the time in the issue Flaky browser
  // tests (worker/report-flaky-tests.mjs).
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/report.json" }],
      ]
    : "list",
  use: {
    // Tests expect Eastern times unless they pick another zone with test.use({ timezoneId }).
    timezoneId: "America/New_York",
    locale: "en-US",
    // A service worker's requests skip the routes tests answer, so only tests about it allow it.
    serviceWorkers: "block",
    // A failed try keeps its trace, whose snapshots show the page at each step. Its screenshots
    // would add a tenth to every test's time and show nothing the snapshots don't. CI's browser
    // job leaves out the snapshots too, a sixth of every test's time, while burn-in and the nightly
    // run, where flaky tests are found, keep them.
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: process.env.TRACE_SNAPSHOTS !== "off",
    },
  },
  projects: appsWithBrowserTests.flatMap((app, index) => [
    {
      name: app,
      testDir: `apps/${app}/tests/browser`,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${findPort(index)}`,
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    ...(hasWebKit
      ? [
          {
            name: `${app}-webkit`,
            testDir: `apps/${app}/tests/browser`,
            testMatch: WEBKIT_TEST_MATCH,
            use: { ...devices["Desktop Safari"], baseURL: `http://127.0.0.1:${findPort(index)}` },
          },
        ]
      : []),
  ]),
  webServer: appsWithBrowserTests.map((app, index) => ({
    command: `node tests/browser/serve.mjs ${findPort(index)} apps/${app}/page`,
    url: `http://127.0.0.1:${findPort(index)}/index.html`,
    // A server already on the port may be serving another checkout, so a busy port fails the run.
    reuseExistingServer: false,
  })),
});
