---
paths:
  - "tests/browser/**"
  - "apps/*/tests/browser/**"
  - "playwright.config.mjs"
  - "worker/browser-scope.mjs"
  - "worker/burn-in-specs.mjs"
  - "worker/judge-burn-in.mjs"
  - "worker/report-flaky-tests.mjs"
  - ".github/workflows/flaky.yml"
---

# Browser tests

- In a browser test, wait for what the page shows, with `expect(locator)` or `expect.poll`,
  never for a fixed time or for the network to go quiet; lint rejects `waitForTimeout`, `setTimeout`, and `networkidle`.
  Get past the page's timers and animation frames by moving its fake clock with `page.clock.runFor`,
  and past a scroll by waiting for its `scroll` or `scrollend` event.
- A browser test that passes only some of the time has a bug to find and fix, in the page or the test, in its own PR.
  CI retries a failed browser test once, so it can't fail a pull request it has nothing to do with,
  and stops a run once five tests have failed even on their retry (`maxFailures` in the root's `playwright.config.mjs`),
  and GitHub's reporter marks each one that passed only on its retry on the pull request's checks,
  the run keeps its failed try's trace, with each step but not the page at each step, which only burn-in and the nightly run record,
  and the next nightly run adds it to the table in the issue Flaky browser tests, from the reports CI keeps (the root's `worker/report-flaky-tests.mjs`),
  unless a test in the same run failed even on its retry, which says the change broke it, and likely the others too.
  CI runs the browser tests only of the apps a change reaches, by its own folder or by an import from a spec, a helper, or the Playwright config,
  so a change to the docs, the other workflows, the files that only configure the checks,
  or tooling or Node tests no browser test imports, runs none,
  and runs every app's for shared code, CI's own workflow, the dependencies, or a kind of file it doesn't know (the root's `worker/browser-scope.mjs`).
  CI's `burn-in` runs each browser spec a pull request adds or changes ten times with no retry,
  but for one that passed burn-in in an earlier run, on this push or one before it, and hasn't changed since,
  with every helper and config the specs reach by import, and the dependencies, the Node version, and CI's own workflow, unchanged too, on the pull request's side and its base's (the root's `worker/burn-in-specs.mjs`),
  in WebKit too for the at-rest specs, so a spec holds 30 tests at most,
  split by what its tests are about, which the root's `tests/browser-spec-size.test.js` checks,
  and fails the pull request only on a test it wrote or edited,
  where a change in a spec outside every test, like an import or a helper,
  edits them all, and the next nightly run adds any other test that failed to the table in the issue Flaky browser tests (the root's `worker/judge-burn-in.mjs`),
  and each night main's browser tests run three times over with no retry and add each test that failed to the table in the open issue Flaky browser tests (`.github/workflows/flaky.yml` and the root's `worker/report-flaky-tests.mjs`),
  which comments on each test new to it and starts the routine that fixes the table's top test,
  through its API trigger, from the `FLAKY_ROUTINE_URL` and `FLAKY_ROUTINE_TOKEN` secrets,
  drops a test once it hasn't failed for a week, and closes once none is left.
  To reproduce a flaky test, or to show a fix holds, run that workflow by hand with the tests,
  the project, the branch, and how many times to run each: it runs on the machine CI uses, WebKit included, which a cloud session doesn't have.
  After a reload whose page code a test holds, the copy the page puts back has already taken the load note away,
  so the test waits for `domcontentloaded` to know the code has run.
- Route a browser test's requests by a pattern, like the root's `matchPath` in `tests/browser/harness.mjs`,
  never a function, which makes Playwright ask the test about every request the page makes and slows each load; lint rejects one.
  To unroute one of two routes with the same pattern, name its handler too.
- Before a test changes what the page reads next, wait until the page shows its last read, or the change races the read still on its way.
- A browser test that isn't about motion asks for reduced motion,
  with `page.emulateMedia({ reducedMotion: "reduce" })` or, for a whole file,
  `test.use({ contextOptions: { reducedMotion: "reduce" } })`, so it doesn't wait out eased scrolls and springs.
  Each animation keeps a full-motion test of its own.
  A gesture, like a swipe, is tested both ways too: its full-motion test drives it with the root's `tests/browser/touch.mjs`,
  as a finger does, and checks what moves and what doesn't once the finger lifts,
  since a motion that replays or jumps then shows only in full motion.
  A drag's moves come as a flick unless its `durationMs` spreads their times out, so a test of a drag that comes to rest before the finger lifts gives one.
  Its moves still go out within a frame or two, so a test that checks a drag on each frame also passes `isFrameByFrame`,
  which spaces their times a frame apart too, so it sets the drag's speed with `durationMs`,
  as the root's `tests/browser/home-screen-help.mjs` does for the welcome's swipe down.
  A swipe is checked frame by frame: where what it moves is on each frame,
  never stepping back, and that the page changes nothing while the finger moves it but where that is,
  as the WNBA's `sheet-stack.spec.mjs` does for a sheet's swipe back.
- The browser tests run in CI on Chromium's headless shell, which behaves differently from full Chromium; for example, it denies notification permission.
  If you set `CHROMIUM_PATH`, point it at the headless shell.
  Set `BROWSER_TEST_PORT` to run a second checkout's browser tests alongside another's, on that port and the next.
