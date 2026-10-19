# AGENTS.md

## Code

- Keep code clean, consistent, reliable, readable, secure, and maintainable.
- Follow best practices.
  Don't be unique or clever.
- Leave code better than you found it.
  Don't leave something sub-optimal just because that's how you found it.
- Write every change as it would have been written had its final design been known from the start,
  however many rounds of mockups, sliders, comparisons, or fixes it took to get there.
  Build from the values picked, never from a playground's code,
  and leave nothing those rounds left behind: values or options no longer chosen,
  a setting or branch kept only to compare, a case that can no longer happen,
  a name for an earlier version, or a rule that overrides another where one rule would do.
  Before each push, read the whole diff against `main` for it, and the review flags any of it.
- Start function names with a verb naming the action (boolean predicates excepted).
  No generic names like `call`, `run`, `execute`, or `handle`,
  which lint rejects for a function.
- Make every function do one thing well.
  Make orchestration a sequence of named steps.
  Extract and name any non-trivial logic inside blocks or chained conditions.
- Keep a view's decisions out of the code that draws it.
  What to show, which item is chosen, the order, and any time limit live in a module the view calls with its state and what it measured,
  so a Node test reaches them, as `shared/page/search-reading.js` does for what search shows as words are typed.
- A rule or a limit two places share lives in one place,
  like the two minutes away that closes a sheet or the search, so the places can't drift apart.
- A fact two places show, like a game's inning or a club's record, comes from one read, kept in one document,
  so the places can't trail each other, as a game's row and its field did while one read MLB's schedule and the other its live feed.
  Where one read would cost more than the store's request budget allows, the later place waits for the earlier, or hides, rather than reading on its own.
  A fix of two places that trailed adds a test that they agree.
- Name variables with full words that are reasonable for their types.
  No opaque abbreviations.
- Default to no comments.
  Only use a comment for a non-obvious why.
  Every comment must be evergreen: no history narrative, no call-site lists, no fixture values, nothing that restates the code.
- Use plain ASCII in code, comments, docs, and commit messages: no em dashes, no curly quotes.

## Tests

- Every change to behavior comes with tests that fail without it, in the same PR.
  Before pushing, break the code each new test guards and watch it fail; a test that still passes guards nothing.
- Test text, numbers, and logic in Node, where a test takes milliseconds: render the view's markup or call the function,
  as `apps/mlb/tests/page.test.js` does for the Games list's series labels.
  Write a browser test only for what takes a browser: layout, color, motion, focus, and the page working with its Worker and store.
- Test what people type the way they type it, never only the words a test's author thought of:
  in lowercase, a key at a time, every name and the ways fans write it, alone and inside the searches they make,
  as each app's `tests/search-typing.test.js` types every team and place with the root's `tests/search-sweep.js`.
- Test what searches, matches, or ranks across a league against all of it, recorded, never a few rows picked by hand,
  which hide the collisions a whole league has, like a first name that starts a city's,
  as the sweep reads every player on a roster from `apps/mlb/tests/fixtures/2026-10-13-player-index.json`.
- In a browser test, wait for what the page shows, with `expect(locator)` or `expect.poll`,
  never for a fixed time or for the network to go quiet; lint rejects `waitForTimeout`, `setTimeout`, and `networkidle`.
  Get past the page's timers and animation frames by moving its fake clock with `page.clock.runFor`,
  and past a scroll by waiting for its `scroll` or `scrollend` event.
- A browser test that passes only some of the time has a bug to find and fix, in the page or the test, in its own PR.
  CI retries a failed browser test once, so it can't fail a pull request it has nothing to do with,
  and stops a run once five tests have failed even on their retry (`maxFailures` in the root's `playwright.config.mjs`),
  and GitHub's reporter marks each one that passed only on its retry on the pull request's checks,
  the run keeps its failed try's trace, with each step but not the page at each step, which only burn-in and the nightly run record,
  and the next nightly run adds it to the table in the issue Flaky browser tests, from the reports CI keeps (`worker/report-flaky-tests.mjs`),
  unless a test in the same run failed even on its retry, which says the change broke it, and likely the others too.
  CI runs the browser tests only of the apps a change reaches, by its own folder or by an import from a spec, a helper, or the Playwright config,
  so a change to the docs, the other workflows, the files that only configure the checks,
  or tooling or Node tests no browser test imports, runs none,
  and runs every app's for shared code, CI's own workflow, the dependencies, or a kind of file it doesn't know (`worker/browser-scope.mjs`).
  CI's `burn-in` runs each browser spec a pull request adds or changes ten times with no retry,
  but for one that passed burn-in in an earlier run, on this push or one before it, and hasn't changed since,
  with every helper and config the specs reach by import, and the dependencies, the Node version, and CI's own workflow, unchanged too, on the pull request's side and its base's (`worker/burn-in-specs.mjs`),
  in WebKit too for the at-rest specs, so a spec holds 30 tests at most,
  split by what its tests are about, which the root's `tests/browser-spec-size.test.js` checks,
  and fails the pull request only on a test it wrote or edited,
  where a change in a spec outside every test, like an import or a helper,
  edits them all, and the next nightly run adds any other test that failed to the table in the issue Flaky browser tests (`worker/judge-burn-in.mjs`),
  and each night main's browser tests run three times over with no retry and add each test that failed to the table in the open issue Flaky browser tests (`.github/workflows/flaky.yml` and `worker/report-flaky-tests.mjs`),
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
- A theme changes only colors, so each view lays out the same in each of an app's themes.
  A theme may also change a weight where its font keeps its width at every weight,
  as MLB's Ball sets a final's losing score a step lighter in Chivo Mono,
  to stand apart from the winner as much as its dim ink does in Night Game,
  and may lift a part a pixel or two where its colors look off center otherwise,
  as MLB's bracket chips and their digits sit as each theme's set them by eye, which the root's `tests/browser/theme-layout.mjs` leaves out.
  The WNBA's `tests/browser/themes.spec.mjs` checks every view in Walnut against Maple,
  on a phone and a wide screen, with the root's `tests/browser/theme-layout.mjs`; a new view joins its list.
- Sheets look alike.
  Every sheet's top is a band, from `.sheet-page .sheet-top` in `shared/page/sheet.css`,
  never a list of sheets, as tall as what it holds: the WNBA's is the floor's color over the card's,
  ending in a line, with each title at the same height on every sheet and what goes with it, like a game's teams and score, in the band under it.
  A title holds its name and one line under it, and anything more, like a player's facts or hometown, goes in the band under the title,
  so the title and its close or back button, which holds the top of the title's row (`shared/page/chrome.css`), sit in one spot on every sheet and the band grows below them.
  Sheets, and a sheet's sections, slide side by side with the app's `--sheet-gap` of the sheet's color between them,
  each band's sides edged in its line while they move, so two bands never have to meet.
  Each app's `tests/browser/sheet-stack.spec.mjs` opens every sheet on the page and checks each top; a new sheet joins its list, or the test fails.
- A reload draws each open sheet as it was.
  A sheet that reads from the Worker keeps what it read in its `keeper` (`wireSheet` in `shared/page/sheet.js`),
  beside what it shows, and draws again from that while it reads again,
  never its placeholders, as the game sheet does with its box score and a team's sheet with its roster (`sectionsKeeper` in `shared/page/team-sheet.js`).
  Each app's `tests/browser/sheet-reload.spec.mjs` reloads each sheet with its reads held and checks it shows the same; a new sheet joins its list, or the test fails.
- A browser test that isn't about motion asks for reduced motion,
  with `page.emulateMedia({ reducedMotion: "reduce" })` or, for a whole file,
  `test.use({ contextOptions: { reducedMotion: "reduce" } })`, so it doesn't wait out eased scrolls and springs.
  Each animation keeps a full-motion test of its own.
  A gesture, like a swipe, is tested both ways too: its full-motion test drives it with the root's `tests/browser/touch.mjs`,
  as a finger does, and checks what moves and what doesn't once the finger lifts,
  since a motion that replays or jumps then shows only in full motion.
  A drag's moves come as a flick unless its `durationMs` spreads them out, so a test of a drag that comes to rest before the finger lifts gives one.
  A swipe is checked frame by frame: where what it moves is on each frame,
  never stepping back, and that the page changes nothing while the finger moves it but where that is,
  as the WNBA's `sheet-stack.spec.mjs` does for a sheet's swipe back.

## Repo

- Apps: one per league, each in `apps/<app>/` with its own `page/`,
  `worker/`, and `tests/`, and deployed as its own Worker, named in `apps/<app>/worker/wrangler.toml`.
  `apps/mlb/` is baseball, Worker `mlb-app`, whose page reads each season's one record from the store,
  which the Worker saves as it reads MLB, as the WNBA's does,
  reading each game being played from MLB's live feed with each update, since the schedule's copy of it runs half a minute or more behind,
  so every part shows the same inning, outs, and score (`page/js/snapshot.js`), and opens each club's sheet from its name or dot,
  with cards of its nearest games from the slate, its season's runs,
  runs allowed, and records at home and on the road ranked among every club's on curves,
  and its postseason's as dots against the playoff field's (`page/js/team-view.js` and the shared `team-numbers.js`),
  and its leaders in MLB's headline numbers, from its roster, AVG,
  OPS, and ERA among qualified players only (`page/js/leaders-view.js`) and,
  under its Roster pill, its active players and injured list, each with his regular season,
  which the store keeps for each club for the current season, reading a club's roster again only after a transaction names it,
  and once a day (`page/js/roster-section.js`, `roster-view.js`,
  `worker/src/rosters.js`, and `roster-updater.js`), and each player's sheet,
  which a tap anywhere on his row in a roster, a box score, or a lineup,
  or on a starter's name in a matchup, opens over the sheet it's in,
  with his facts, then, while he's on the injured list, a box with his stay and why,
  from ESPN's injury report, read for the whole league once an hour (`worker/src/injuries.js`,
  with the shared `injury-report.js` the WNBA's reads too),
  but not when the box score that opened him shows him playing in a game under way or ended today,
  which the report hasn't caught up with (the shared `playing-now.js`), his postseason,
  and his regular season, a hitter's ranked among MLB's ranked hitters and a starter's among its qualified starters,
  with what he throws, and his last few games, from the last few weeks of his game log,
  read only as his games add up, which the same job keeps for each player on a roster,
  holding his season's totals, on his sheet and his club's Roster,
  as they were while his game log is still to read the game they count,
  so the two never show different games, unless that read failed (`page/js/player-sheet.js`,
  `player-view.js`, and `worker/src/players.js`), and each game's sheet from its row,
  whose Game section shows the game, its starters on a line that slides to its Matchup,
  before first pitch its clubs' season series (`page/js/season-series.js`),
  and its box score, or each club's lineup before first pitch (`page/js/game-sheet.js`,
  `matchup.js`, and `box-score-view.js`), over which a game under way has its Runs so far and a final its Runs,
  each half inning that scored under its heading, and a line for each change of the score with the score after it,
  with the runners who got on since the last one on a lighter line above the play that scored,
  and a pinch runner who scored named with whom he ran for,
  from each play in MLB's live feed, and, while a half inning is under way,
  who's pinch running for whom over a drawing of the field with each runner's name by his base and how he got on,
  and who's up against whom (`page/js/runs-view.js`), and, once it's final,
  its Highlights section, MLB's recap video, MLB.com's story, and the clip of each play,
  with its inning and the score after a play that scored, from MLB's content and the plays its live feed ties each clip to,
  which the store keeps for each of the current season's finals,
  read as it ends and again over the hours after, and reads on a tap for a season before (`worker/src/highlights.js` and `highlights-updater.js`),
  each still showing the moment, never a headline: the recap's a frame from its video,
  and a play's MLB's own unless Claude Haiku finds a headline laid over it,
  as the store asks once for each still, a few a run,
  since Cloudflare caps a run's requests,
  and asks again a few times about one Claude doesn't answer, which shows as MLB's own meanwhile and then counts as clean,
  then a frame from the play's video or,
  for a clip without frames, MLB.com's photo of the game (`worker/src/headline-stills.js`),
  which the store keeps for every finished game of each season it keeps,
  the slate's first, then the rest of the current season's and each past season's,
  newest first, and reads with each update for a game a page has open (`worker/src/box-score.js`,
  `game-details-updater.js`, and `watched-games.js`), whose Games tab lists every game of the season,
  the All-Star Game too, under a strip of its days, each day's heading held under the strip while its games pass,
  and only the days near the screen drawn whole, each game away from today showing its starter with his arm,
  and each club's record: as of the game once it's been played, from the schedule,
  and its record now for a game still to come, from the standings, as today's rows show it,
  each postseason game its series as it stood at the game, or its game until both clubs are known,
  and If necessary under one MLB may not need, and each final its inning when it didn't end in the ninth (`page/js/series-games.js`),
  from the season's whole schedule, which the store keeps a month to a document in `schedules-<year>`,
  reading MLB's whole schedule once a day and the days around today with each update,
  and saving only the months that changed, with each game's ballpark,
  a game away from its home club's own one saying where in its label (`page/js/games-view.js` and `worker/src/season-updater.js`),
  and whose Search, a round button beside the tab bar, finds the season's games as the WNBA's does,
  from MLB's names for its clubs, ballparks, leagues and divisions,
  each league's own rounds, and its starters, by the games each is named to start (`page/js/search-terms.js`),
  and the app's own pages as the WNBA's does: each club's sheet and its Roster,
  each player on a club's roster this season, by the names MLB uses for him,
  from the list of players the store keeps beside its rosters (`worker/src/player-index.js`),
  the latest final's Highlights and the next game's Matchup, the bracket and the News tab,
  the standings' playoff fields and each league's divisions, and settings and each setting (`page/js/search-pages.js`),
  apart from the slate the header, the Updates box, and the store follow (`page/js/slate.js`),
  whose ranking each device keeps for itself, in name order until its first drag,
  with when its Updates box counts from, its first look or last dismissal (`page/js/kept-on-device.js`),
  which only phones and tablets show (`page/js/updates.js`), and which also serves each starting pitcher's matchup numbers,
  ranked among MLB's qualified starters (`worker/src/pitchers.js`),
  and, for a club yet to name one, its last starters and their rest (`worker/src/rotations.js`),
  both of which the store keeps for the current season, with the qualified starters of each season it keeps from before,
  reading MLB as a game ends and only the pitchers who pitched in it,
  so a sheet reads only the store (`worker/src/pitcher-updater.js`),
  and which fills in each past season's record once, with its standings,
  from MLB (`worker/src/past-seasons.js`),
  and whose News tab shows the news as the WNBA's does, from MLB's outlets and the Mets' own,
  which the same shared news job keeps by MLB's prompt: anything about the Mets,
  and another club's news only when it matters across baseball,
  with a settings switch for each of its paid outlets (`worker/src/news-feeds.js`,
  `news-prompts.js`, and `news-updater.js`, and `page/js/news-league.js`);
  `apps/wnba/` is the WNBA, Worker `wnba-app`, which reads the league's own feeds (`page/js/snapshot.js` says which) with the browser headers they require (`worker/src/wnba.js`),
  ESPN's scoreboard for where each game is on, and ESPN's scores and clocks only while the league's scoreboard isn't answering,
  or for a game the league's schedule still holds as under way once its scoreboard no longer lists it,
  reading the schedule again every five minutes until it catches up,
  and also serves each game's box score and preview for the game sheet (`worker/src/box-score.js` and `preview.js`),
  whose store reads a live game's box score and lead with each update while a page has its sheet open,
  and pushes them to that page (`worker/src/watched-games.js`),
  keeps each finished game's for good, read as it ends and once more after the league and ESPN catch up,
  and a few at a time back through each season it keeps (`worker/src/game-details-updater.js`),
  and keeps each upcoming game's meetings from the schedule each update reads,
  so the sheet's routes read the league only for what the store doesn't keep (the shared `store-reads.js`),
  and, from ESPN's game summary, the score through each game for the sheet's lead chart (`worker/src/lead.js` and `page/js/lead-chart.js`) and when each game it saw live ended (`worker/src/game-ends.js`),
  and each team's roster for any season, from the league's roster of that season and its list of every player it has had,
  with ESPN's injury report, read once for the whole league, saying who is out and why (`worker/src/injuries.js`),
  which shows only while the team still plays, which the team's sheet shows under its Roster pill,
  beside its stats under its Team pill, with each player's averages,
  which the store keeps apart from the season, worked out once for the Roster, the leaders, and her sheet (`worker/src/roster.js`, `season-averages.js`,
  `page/js/roster-section.js`, and `roster-view.js`), and each player's sheet,
  which a tap on her name in a roster, a box score, or a list of leaders opens over the sheet it's in,
  with her facts from that roster, then, while she is out, a box saying why,
  with RotoWire's sentence on it,
  but not when the box score that opened her shows her playing in a game under way or ended today,
  which the injury report hasn't caught up with (the shared `playing-now.js`),
  her last game and her points in each playoff game from every player's game logs,
  and her regular season's averages ranked among the players who meet the WNBA's rule for its leaders,
  from every player's totals (`worker/src/player.js`, `page/js/player-sheet.js`,
  and `player-view.js`), both of which the store keeps for the current season and each one it keeps from before,
  reading the league as a game ends, so a sheet reads only the store,
  and saving how each run went, with how often a sheet still had to read the league,
  in `players/status` (`worker/src/player-updater.js`), and which,
  beside the season's updates, reads the news from the outlets' feeds (`worker/src/news-feeds.js`),
  drops what the shared rules can tell isn't news (`shared/worker/news-rules.js`),
  and has Claude judge the rest against the cards it has so far,
  a story with news of its own leading a card, one that tells a card's news better or brings a new development in its story taking it over,
  and one that adds to it going under its lead, at a higher bar for each story the card has,
  and judge every story again when its prompt changes (`news-prompts.js`,
  built with the shared `composeLabelPrompt`), saving the cards in `news/cards` (the shared `news-updater.js`,
  which `worker/src/news-updater.js` hands its outlets, prompt,
  and teams), with each card's photo's size and, for one taller than 3:2, where Claude says its subject is,
  each read once (`shared/worker/news-photos.js`),
  which its News tab shows newest lead first, each photo in its own shape from 16:9 to 3:2 (`shared/page/news-photo.js`),
  with the stories under each lead in a quiet More on this list,
  from the outlets the settings' News switches include, kept per device (`shared/page/news.js`,
  `news-picks.js`, `news-view.js`, and `news-choices.js`, which `page/js/news-league.js` hands its teams and the switches for its outlets),
  and whose game sheet, once a game is over, has pills that slide between its box score and its Highlights,
  ESPN's recap video, its story, and its clips, from ESPN's game summary,
  each leaving once ESPN takes it down, which the store keeps for each of the current season's finals,
  read as it ends and again over the hours after (`worker/src/highlights.js` and `highlights-updater.js`),
  and whose sheet for each team opens on cards of its last game,
  the one it's playing, and its next, from the whole season, regular season and all,
  each opening the game's sheet, all of which the store keeps with the season and reads ahead like the playoffs' (`page/js/nearest-games.js`),
  and whose bracket joins each pair of series to the one they feed with square lines (`page/js/bracket-tree.js`),
  whose scores show in scoreboard digits (`page/js/scoreboard.js`),
  whose Games tab lists every game of the season, the All-Star Game too,
  from its first day to its last, under a strip of its days, opening on today,
  or on a past season's last day, from the season's whole schedule,
  which the store keeps apart from its record in `schedules/<year>` and saves again only as a game ends or the schedule changes,
  with each game's arena (`page/js/games-view.js` and `worker/src/season-updater.js`),
  and whose Search, a round button beside the tab bar, finds the season's games from the words a fan types,
  like teams, a city or arena, a day or time, a round, or a team's next game,
  with suggestions as they type, from the league's names for its teams,
  places, and rounds (`page/js/search-terms.js`), and the app's own pages: each team's sheet and its Roster,
  each player on a roster of the season shown, from the list of its players the store keeps beside its rosters (`worker/src/player-index.js`),
  the latest final's Highlights, the bracket and the News tab, the standings' lists,
  and settings and each setting (`page/js/search-pages.js`), whose settings pick any season the store keeps once it keeps more than one,
  whose page saves nothing to the store, lists each playoff final in an Updates box only on phones and tablets,
  and only for the current season, each keeping when its box counts from, its first look or last dismissal,
  by when the Worker first found each final (`page/js/updates.js`),
  and follows the phone's dark (Walnut) or light (Maple) setting unless the viewer picks one in settings or the Home Screen welcome (the shared `appearance.js`, kept per device,
  and `pick-theme.js`, which the browser's address names it in for the Home Screen app), in its own self-hosted fonts.
  Paths below are inside an app's folder, except `shared/` and the ones named as the root's.
- Page:
  `page/`.
  `page/js/app.js` is the entry module; shared page data lives in `page/js/session.js`.
- Build page markup with the `html` template from `shared/page/html.js` and write it with `setHtml`.
  Both escape stored and fetched text, and lint rejects any other `innerHTML` write.
  `setHtml` changes only the nodes that differ from what the element shows, so a redraw keeps the rest as it is.
- Set every text in a type role from `shared/page/type.css`, whose top comment lists each role and what it sets,
  like `title` for the app's name, `body` for sentences, `detail` for short facts, and `label` for capitals.
  Each app's `:root` sets each role's size and weight for its own fonts, as `--type-<role>-size` and `--type-<role>-weight`,
  matched by eye so a role looks as big and as heavy in every app, and a new league sets its own.
  A rule that sets a role's size sets its weight from the same role,
  or a step from it where its text leads or recedes within the role, as `calc(var(--type-label-weight) - 100)`,
  and a heading's or label's letter spacing from `--type-heading-tracking` or `--type-label-tracking`,
  and every line height set by its text's size is a share of the app's `--leading`,
  which MLB's Libre Franklin sets a little apart, while one in pixels keeps its pixels.
  The root's `tests/type-roles.test.js` checks the stylesheets for each.
  The WNBA sets its words in Barlow and its teams, numbers, and the app's name in Barlow Condensed,
  which draws 8% larger to look as big as Barlow,
  and MLB sets its words in Libre Franklin and its numbers in Chivo Mono,
  which draws at 97.48% to look as big as Libre Franklin's words.
  A field's text is at `--type-field-size` (16px), since an iPhone zooms in on a smaller field when it's tapped,
  in a copy of its font whose `size-adjust` draws it at its role's size,
  as both apps' searches and Season pickers do, never a viewport that stops a pinch.
  The root's `tests/browser/type-roles.mjs` lists every shown text off its app's role sizes,
  or in a weight its font has no face for, and each app's browser tests check every view with it.
  Each role draws in one font and one case,
  and in a second only where the app's `tests/browser/role-looks.spec.mjs` names the text and why,
  like MLB's numbers in Chivo Mono and the WNBA Games list's dates in Barlow, as a wall calendar's;
  it walks the theme specs' views from the app's `tests/browser/views.mjs`,
  the gate, the Updates box, and the bracket before the playoff field is set,
  and fails on any look its tables don't name, and on any they name that nothing draws.
- Shape every corner with the shape tokens the shared stylesheets read from each app's `:root`:
  `--radius-card`, `--radius-chip`, `--radius-control` for buttons and fields,
  like each name in a pill, and `--radius-sheet` for a sheet on a wide screen,
  with `--held-bar-line` under a bar held at the top once something scrolls under it.
  A dot is round, a switch is round like the phone's own, an app icon keeps its own shape,
  and the floating tab bar, tinted in the app's own color, stays a capsule like the phone's own;
  any other corner typed as a number fails the root's `tests/shape-tokens.test.js`.
  In every app, a sheet and settings fill a phone's screen, square and without a shadow,
  and leave the page behind them as it is, closing with a caret at their top left,
  or, on a sheet opened from another, going back with an arrow in its place,
  each just the icon in the app's `--accent`, from `shared/page/sheet.css` and `chrome.css`.
  The WNBA's look is Hardwood, which the top comment of its `page/styles.css` states in full: square corners,
  cards and outlined buttons `--raised` inside an `--edge`, a held bar that ends in a line and never fades,
  buttons in sentence case, the one that's on filled orange, like the list a pill shows,
  whose other names are plain words, and orange and teal each with two jobs, named only in `:root` as the roles every rule uses:
  `--now` (what's happening now) and `--action` (where to tap) in orange,
  and `--structure` (what organizes the page) and `--result` (how something ended) in teal,
  and everything else in ink, which its `tests/hardwood.test.js` checks.
- Channel logos in `shared/page/networks/` come only from Wikimedia Commons files marked public domain or CC0, or from the repo's owner, since the repo is public.
  A logo that works on only one background gets a version for the other,
  made by turning its black parts the cream of team names on a dark page or its white parts dark, and named with `-dark` for the dark one.
- Icons come only from [Phosphor](https://phosphoricons.com), the apps' one icon set: copy the icon's path from it at the weight its neighbors use,
  Light for the page's controls, like the tab bar and close buttons,
  and Regular in a line of text, and name the icon and weight in a comment where the code holds it, as `team-view.js` does for its caret-right.
  Never draw an icon by hand or take one from another set, but for the four drawn for their place: the Home Screen steps' Share and menu glyphs,
  which copy the browser's own buttons so people find them (`shared/page/draw-home-screen-asks.js`),
  MLB's seed lock (`games-view.js`), and the catching-up ring,
  Phosphor's circle-notch at its Light weight with a 55-degree gap, set in a line of text (`shared/page/catch-up-note.js`).
  The root's `tests/icons.test.js` fails on any other icon on the pages whose shapes aren't Phosphor's, and names those four,
  and on a Phosphor icon the last comment before it doesn't name with its weight.
  An All-Star team's star isn't an icon but stands in for its dot,
  so it's drawn for its place too, filled with soft tips and set in as the app's dot is (`shared/page/all-star.js`).
- Make every tap land on a button or a link.
  An iPhone hands the page a tap only where one is, whatever listens for it,
  so a page's listener never finds what was tapped from the row or card around a button,
  and a row that opens wherever it's tapped has its button reach over it,
  as a game's row does (`shared/page/game-row.css`), the WNBA bracket's team lines do,
  and, in a table, where Safari never lets a row hold what reaches over it,
  the standings do, with the cell around the button and a clip around the table (`shared/page/row-button.css`).
  The root's `tests/browser/tap-states.mjs` lists each spot that shows a pointer where a tap lands on no button (`listTapsOffButtons`),
  and each app's browser tests check every view with it; a new view or sheet joins that list,
  and a test of a row's tap checks where a finger lands, with `document.elementFromPoint`, as well as what opens.
- Separate items in a line of facts with `joinWithSeparator` from `shared/page/html.js`; lint rejects a bullet or middle dot typed by hand.
  Design mockups are one plain HTML artifact page that works on a phone,
  never a design canvas, and copy the app's existing styles, separators,
  and colors from its `page/styles.css` instead of inventing new ones.
- Worker:
  `worker/src/`.
  It serves the page, its store, and its sheets' reads, only under `/<APP_KEY>/`; everything but `robots.txt` and `health` is a 404 without the key,
  but at the address its `PAGE_HOST` secret names, where it serves them without the key, behind the access code alone,
  and so only while it has one (`findAppPrefix` in `shared/worker/app-worker.js`).
  `health` says whether the Worker and its store answer, 200 or 503 with the release's commit,
  so an uptime monitor can watch it without holding a secret, and asks the store once a minute at most however often it's hit (`shared/worker/health.js`).
  An alarm in its Durable Object (`worker/src/season-updater.js`) keeps the current season's saved data up to date from the league,
  less often while no page has its socket open, and a page that opens brings the next update forward; the page only reads it.
  When the Worker has an `ACCESS_CODE` secret, the page's address shows the app's `page/gate.html`,
  built from the shared `gate.js` and `gate.css`, and the season's data answers 401 until the phone sends that code,
  which the Worker keeps in a cookie signed over the code with the `ACCESS_SIGNING_KEY` secret,
  never the page's key, which every link shows (`shared/worker/access-gate.js`); a 401 reloads the page (`shared/page/access.js`).
  The Home Screen app's link to add the site again, whose browser keeps its cookies apart from the app's,
  signs the browser in with a handoff the Worker makes for a phone signed in,
  good for ten minutes under the code it was made under,
  which the app asks for again halfway through while settings stays open,
  or as it comes back once that's past, since a phone freezes its timers while it's away (`shared/page/appearance.js`),
  and opens the page at its own address without it (`serveHandoff` in `shared/worker/access-gate.js`).
  Each update's news goes out as Web Push notifications (`worker/src/notifications.js`,
  `shared/worker/push.js` and `web-push.js`, and `page/sw.js`);
  the Durable Object makes and keeps the signing key itself, under a key the store's paths can't name.
  The same service worker, which every load registers (`shared/page/service-worker.js`),
  keeps a copy of the page and every file it loads, and the pictures from other sites,
  like the News photos, that the page last showed (`shared/page/offline-worker.js`),
  so the page opens from the phone at once, even offline, while a newer page downloads behind it and replaces the copy only once all its files have arrived,
  and a page a deploy replaced reloads only once it has (`refreshPageCopy`);
  a copy the phone can't read leaves each request to the Worker, as if there were none,
  so a phone whose storage fails still opens the page whenever the Worker can answer;
  the worker keeps its last steps, each start, install, activation, and push,
  and each page it opened and how, in a cache of its own,
  for Diagnostics to show (`shared/page/service-worker-steps.js`, read by `service-worker.js`);
  a phone the Worker signs out drops the copy (`shared/page/access.js`).
  Browser tests block service workers, whose requests skip the tests' routes, unless a test is about one.
  Deploys bundle it with all of the app's `page/`; `npm run build` writes each app's bundle to its `worker/dist/`, which git ignores.
  The build points the page's stylesheets, scripts, and import map into a folder named for its commit (`pinPageFiles` in the root's `worker/page-files.mjs`),
  which only that release's Worker serves, and browsers keep for good,
  so a page loaded mid-deploy never runs two releases' files together;
  when one is missing, `shared/page/release-guard.js`, written into the page's head, reloads it.
- Read ahead of the page.
  What a view or sheet shows from a league, the store reads in the background and keeps,
  so a tap reads only the store and never waits on the league,
  as the WNBA's players and rosters do (`worker/src/player-updater.js`).
  Keep that reading lean: read only what may have changed, with the shared `createFeedKeeper`,
  a feed that changes with games as a game ends and any other once it's old;
  read a whole league in one request rather than one per player or team;
  keep each answer trimmed to the columns the page reads; save only the documents that changed;
  read a finished season once and never again; and fill past seasons a little at a time, newest first.
  A test counts the requests each run makes, as the WNBA's `tests/player-updater.test.js` does, so a change that reads more than it needs fails.
  The Worker reads the league on a tap only for what the store doesn't keep.
- Shared code:
  `shared/page/` holds the page modules every app uses (the `html` template,
  tabs and the tab bar, switching the page's tabs in `page-tabs.js` and reopening the last one before the first paint in `open-last-tab.js`,
  putting back what each part the page draws whole last showed,
  and the sheets it had open, before the first paint, hiding again a part marked `data-start-hidden`,
  like the search, after two minutes away, in `show-last-drawn.js`,
  closing, before the page draws as it comes back or loads again,
  settings left two minutes and any other sheet six hours, but a game's sheet on top showing a game on its day or under way,
  which stays until an hour after its end shows on the screen,
  in `sheet-memory.js`, saying the page is slow or offline while its views are still empty in `slow-load.js`,
  until the page's first drawing ends it with `endLoadNote` from `load-note.js`,
  saying, as the header's first line, when the scores shown are from while the store hasn't yet confirmed them since the page opened or came back,
  and that the phone is offline or the server isn't answering,
  in `catch-up-note.js`, showing that the page has caught up with a sweep through the header's lines,
  faded where they changed and a faded band passing through where they didn't,
  in `caught-up-sweep.js`, pulling a page on the Home Screen down to catch up in `pull-to-refresh.js`,
  the settings sheet in `settings-sheet.js`, the Diagnostics past its end,
  which, once switched on, record what the store sends and what each part the page draws whole shows in each open's first seconds,
  and, with a tap on Share report, what the page shows then, with the sheets open,
  and share it at once under a header naming the release, the device,
  the page's state, and how each of the store's background jobs last ran,
  from the status each saves (`shared/worker/job-status.js`),
  and the steps the service worker kept, in `diagnostics.js`,
  and log each change to the screen's viewports, and how they stand as the page opens,
  leaves the screen, and comes back, but not a bounce past the page's top or bottom,
  flagging the visual one out of line with the layout one that the tab bar and sheets are held to and keeping the latest line where it went off,
  in `viewport-log.js`, and what each dialog's row of sheets does,
  each touch and click on it, each slide, and each sheet it settles on or lets go of,
  in `sheet-log.js`, and what a season's list of days does, each touch and click on it,
  where each tap on a day or on Today takes the list and when it arrives,
  what each fill draws and where it leaves the list, each new day at its top and whether the strip's dates slide to it,
  any day that changes height as it's drawn whole or as a stand-in,
  and a strip that doesn't scroll where it's told, in `day-strip-log.js`,
  and each touch on a season's standings and bracket, how far it moved,
  whether the page's code took it from the browser, and how far the part under it scrolled,
  and each click on them, in `bracket-standings-log.js`,
  and each error the page's code doesn't catch, in `error-log.js`,
  each a log made with `step-log.js`, the welcome over the whole screen that a phone's or tablet's browser opens on,
  whose numbered steps pick the theme the Home Screen icon takes and say how to add the page there,
  until the page is added or the viewer goes on in the browser, which keeps it closed on that device,
  and the box at the bottom of settings that keeps the steps, both drawn before the first paint in `draw-home-screen-asks.js`,
  so the welcome never arrives over the page and its pick and close work at once, with Chrome's Install in `home-screen.js`,
  the theme picked, shown before the first paint and named in the browser's address,
  where Safari reloads the page after a pick, since it takes the Home Screen app's address and its own bars' color from the page as it loaded,
  and which the Home Screen app keeps on its first open,
  and an iPhone's app, which keeps the icon it was added with, hands Safari with a link to add the site again,
  opening Safari's page on that theme and the welcome, in `pick-theme.js`,
  telling a phone or tablet from a computer, and the Home Screen from the browser,
  in `device.js`, one tab for a season's standings and its bracket,
  named Standings and opening on them until the playoff field is set, and Bracket from then on,
  with the one it opens on first in the pill over them, side by side, which a tap on a name or a swipe slides between,
  a swipe on the bracket scrolling it to its end first, as a team's Roster does, in `bracket-standings.js`,
  each scrolling on its own with the header riding up over the one shown until the pill holds at the top,
  as a profile's tabs do in a phone's apps, in `season-header.js`,
  with a stand-in under each of the Updates box's buttons in each part's empty top,
  so a tap on one opens what it does and a finger that drags from it scrolls the part, as a button inside a list does,
  in `rider-taps.js`,
  the accent block under a pill's shown name, which never travels between names but hands off from one to the next once a tap or a finger's lift sets what's under it off,
  in `pill-thumb.js`, a season's games as one list of its game days under a strip of every day,
  whose chosen day is the one at the list's top, its box holding still while the list's scroll slides the dates behind it on a spring (`strip-slide.js`),
  today's named Today, which a tap on a day or on Today brings to the top,
  a day's gap under the bar, a tap on a date without games bringing in its No games row until it's out of sight,
  and a tap on Today with the list already there bringing the date back to the strip's middle after a finger moved the strip,
  or, with the strip there too, pulsing the date, whose month follows the strip as a finger moves it,
  going back to today after two minutes away (`long-away.js`),
  and, for a league of many games a day, drawing whole only the days within a few screens of what shows and the rest as stand-ins as tall as their games,
  which days those are in `near-days.js`, as the search's list of games draws them too,
  as each app's Games view shows them, in `day-strip.js`,
  with what it decides apart from drawing and scrolling, like each date's label and when a trip to a day jumps rather than flies,
  in `day-strip-rules.js`, a search over a season's games and a league's pages,
  in a view of its own, reading what's typed with fixed rules into teams,
  a word two teams share finding either's, places and venues, groups of teams like a conference or a division,
  days, times, day and night games by the clock where they're played,
  rounds, a conference's own rounds, kinds of game, doubleheaders,
  and starters, finding the games, and saying in a line under the field what it read,
  with suggestions and examples, in `game-search-view.js`, from `search-words.js`,
  `search-dates.js`, `game-search.js`, which reads what's typed in `game-search-read.js` with the words in `game-search-dictionary.js`,
  finds the games in `game-search-match.js`, and says what it read in `game-search-describe.js`, and `search-suggestions.js`,
  what it shows for words as they're typed, a name half typed read as the name the first suggestion finishes once three letters of it are,
  or five with one wrong, in `search-reading.js`,
  which each app's `tests/search-typing.test.js` types a key at a time, as fans do, and with a letter wrong each way a thumb gets one wrong,
  with the root's `tests/search-sweep.js`,
  and reading the same words into the pages they name, a team's,
  its section's, a player's, even with a letter wrong, or by a team's name and the number a player wears,
  or while it's typed each number it starts, over the suggestions, a place's, or a game's part's, like a final's Highlights or the next game's Matchup,
  from the list of a season's players the store keeps for it, in `page-search.js`,
  each game day under a label, the WNBA's date beside its games as a wall calendar shows it and MLB's heading over them,
  with a No games row for today between game days, in `season-days.js`,
  a scroll that eases into place on a spring, as UIKit's scroll to top does,
  in `spring-scroll.js`, each game's row and its button that opens the game wherever the row is tapped in `game-row.js`,
  a row that opens something tinting while a finger or the mouse presses it,
  a moment after a finger lands so a scroll never tints one, and a tapped search row's search waiting for its tint to show,
  and a finger that drifts or that the browser takes for a scroll never tapping a button or link, even when iOS still sends its click,
  as an iPhone's lists do, in `press.js`,
  a player a box score shows in a game under way or ended today marked on his button for the sheet it opens,
  which then leaves out the injury report's box, in `playing-now.js`, an All-Star team's star,
  in its uniform's color and set in as a dot is, in `all-star.js`,
  the line of channels a game's sheet says it's on, with their logos,
  in `network-logos.js` and `networks/`, opening a sheet at its top,
  over the whole screen on a phone, a dialog's sheets one over another,
  only the one on top drawn at rest, a sheet opened from another sliding in beside it from the right with a back arrow in place of its close caret,
  even a sheet the stack already holds, which leaves in its place a copy of what it showed that it takes back once the stack returns there,
  and a tap on what the sheet under it shows going back to that,
  the arrow or a swipe right that the finger drags sliding it away and out of the stack (each sideways swipe the page's code follows,
  which leaves a swipe to anything that scrolls sideways on its own until it's at its edge,
  in `side-swipe.js`), its ways to close the dialog, the caret,
  the backdrop, Escape, and a swipe down (`sheet-swipe.js`), in `sheet.js`,
  whose top comment states the stack and the three rules every motion keeps: nothing asks for a layer ahead of time,
  nothing animates at rest, and nothing filters what is behind it,
  the sheets open listed as the page leaves the screen, and each sheet's code taking back what it showed when a reload put it back open,
  in `sheet-reopen.js`, panels side by side, one shown, that a finger drags and that slide to rest with no animation left once they settle,
  as the stack and a sheet's sections move, in `slide-panels.js`,
  a sheet's sections under pills in its still top, one shown at a time,
  which a tap on a pill or a swipe slides between, each scrolling on its own,
  like the WNBA team's Team and Roster, in `sheet-sections.js`,
  its titled parts in `sheet-part.js`, a player's number in a stat beside its rank,
  on a curve of every ranked player's, or a number beside another's,
  each a dot on a line solid across a range and dashed past it as far as a number reaches,
  as a team's playoffs face the playoff field's on the regular season's range,
  with a legend for the dashes once a line has them (`team-numbers.js`),
  in `rank-curve.js`, a final's Highlights section, its recap video,
  story, and plays, each a clip a tap plays full screen in the device's own player,
  in `highlights-view.js`, `highlights-section.js`, and `clip-player.js`,
  a team's sheet, which a tap on the team's name or dot opens wherever it shows,
  with its numbers and facts, and any sections a league fills after them,
  in `team-sheet.js`, the cards of a team's nearest games across its sheet's top,
  each as wide as the row's widest line, in `game-cards.js`, and which games those are in `nearest-games.js`,
  reading what a sheet shows from the app's own Worker, sharing a recent read of it,
  in `worker-fetch.js`, reading the Worker's error answers in `worker-error.js`, the face-off rows of a sheet a tap opens in `tape.js`,
  the placeholders that hold a sheet's shape while it loads in `placeholder.js`,
  what a sheet shows where a read of its Worker failed, a centered block for a whole sheet or section and a note for one part,
  each with a Try again button, which, like the phone coming back online or the page coming back,
  reads again while the part shows its placeholders, in `retry.js`,
  easing the page's parts to their new heights, fading in what's new,
  when new data redraws them, in `eased-redraw.js`, opening a sideways bracket on its earliest round still playing in `opening-round.js` and its round dots in `round-dots.js`,
  how long a league's next update waits, from where its games stand,
  in `poll-schedule.js`, days and times in `days.js` (a day near now named in words with `nameDay`,
  the league's Eastern day with `readEasternDay`, and adding days to a date with `addDays`),
  a read worked out again only once what it reads from changes, like each app's season for its search, in `kept-read.js`,
  the header's lines on the latest score and the next game, in words like "last night",
  in `stamp.js`, the release check and catching up on return in `resume.js`,
  the access code's gate in `gate.js`, what the page last showed,
  drawn first on its next load, in `last-seen.js`, the box under the tabs that lists what's new since the device first opened the app or last dismissed it,
  with each app's release notes under New in the app, in `updates.js`,
  the settings' Season picker in `season-picker.js`, the year in the title,
  lighter, whenever the season shown isn't being played, an earlier one or the current one once its last game is final,
  in `title-year.js`, keeping what a viewer chooses on their own device,
  listing every such choice, and telling the page when another tab changes one,
  in `device-storage.js`, reading the season the store says is current,
  its record, which a page reads only in the version it knows,
  reloading once a newer release is out, and the store's status,
  and moving on to the next season when the store does, in `season-reader.js`,
  the News tab, its cards and the outlets each device reads, and its switches,
  from the cards a league's news job keeps,
  in `news.js`, `news-view.js`, `news-picks.js`, and `news-choices.js`, the store client, notifications), which pages import as `#shared/<module>.js` through their import map and Node through `package.json`'s imports.
  Its `type.css` lists the type roles, `chrome.css` styles the tab bar,
  settings sheet and its Diagnostics, round dots, Home Screen welcome and box,
  the catching-up line and the sweep once caught up, and pull to refresh's spokes,
  `pager.css` a pill's names and the standings and bracket under one, `day-strip.css` a season's list of days and its strip,
  `game-search.css` the search's view, `game-row.css` lays out a game row and colors an All-Star team's star,
  `sheet.css` a sheet a tap opens, like MLB's pitching matchup,
  with its face-off rows and line of channels, titled parts, and status chips,
  `team-sheet.css` a team's sheet and the buttons that open it,
  `row-button.css` a table's row that opens wherever it's tapped,
  `game-cards.css` the cards of its nearest games, `updates.css` the Updates box,
  `news.css` the News view's layout, `retry.css` what a sheet shows where a read failed,
  `highlights.css` a final's Highlights, `rank-curve.css` a rank curve and each player's mark on it,
  `no-field-note.css` the bracket before the playoff field is set,
  `channel-tag.css` the tag beside the app's name on beta,
  and `gate.css` the access code's gate, whose title and button the welcome takes too;
  pages link them before their own `styles.css` and theme them with the tokens their top comments list.
  The Worker serves all of it under `shared/`.
  `shared/worker/` holds the Worker's routing under the key (`app-worker.js`),
  the store's Durable Object (`season-store.js`, which each app's `worker/src/store.js` hands its league: how it loads and saves a snapshot,
  how long to wait, what to notify, and any details of the games pages have open that it reads with each update,
  and any work of its own it runs beside the season's updates,
  on its own schedule, like the WNBA's news; the store saves the update status and backs off its retries itself),
  reading a league's feeds and reusing a recent load in `upstream.js`,
  reading a league's slower feeds again only when they may have changed in `feed-keeper.js`,
  keeping each final's highlights, read over the hours after it ends,
  in `highlights-job.js`, keeping each finished game's details, a few at a time, in `game-details-job.js`,
  reading the documents the store keeps for a sheet in `store-reads.js`, a story's first lines as plain text in `story-lead.js`,
  keeping a league's news from its outlets' feeds, judged by Claude with the prompt the league hands it,
  in `news-updater.js`, `news-feeds.js`, `news-parse.js`, `news-rules.js`,
  `news-prompts.js`, and `news-claude.js`, the season a request names in `seasons.js`,
  capping a night's notifications in `notifications.js`, push, and responses.
  A change there reaches every app, so shared code never imports an app's modules: an app hands it what it needs, as `watchReturns({ isBusy, catchUp })` does.
  Logic or a view that more than one app needs lives there once,
  and each league hands it only what differs, as each app's `readGameDay`,
  `renderGameRow`, and `listSeasonDays` calls do; never copy it into a second app.
- Tooling: the root `worker/` builds, versions, deploys, and rolls back every app,
  and tells a red change for CI's gate, and comments on each open pull request a merge to main leaves in conflict,
  from its own `Conflicts` workflow (`apps.mjs`, `build.mjs`, `deploy.mjs`,
  `deploy-scope.mjs`, `flag-conflicts.mjs`, `red-change.mjs`, `release.mjs`,
  `rollback.mjs`, `set-app-key.mjs`, `set-access-code.mjs`, `set-page-host.mjs`, the secrets calls they share in `worker-secrets.mjs`,
  and the channels each command's `--channel` names in `channels.mjs`); its tests are in the root `tests/`.
  It opens each app's live page as a phone does, signed in with its code, and says whether it drew what its store sent (`check-page.mjs`),
  which each deploy does for its new version, putting the one before back when it doesn't,
  and which the `Watch apps` workflow does every 15 minutes,
  keeping one open issue for each app that isn't opening, which closes once it opens again,
  and one for each that opens without asking for its code, which closes once it asks again (`watch-apps.mjs`),
  both from each page's address and code in the `production` environment's secrets, as `<APP>_PAGE_URL` and `<APP>_ACCESS_CODE`,
  and a beta deploy from the `beta` environment's, with `_BETA` after the app's name.
- Tests: each app's `tests/`, with its browser tests in `tests/browser/`, and the root's `tests/` for `shared/` and the tooling.
  How to write them is under "Tests" below.
- Commands:
  `npm ci` once.
  `npm run check` runs everything CI does, but locally run only what step 2 of "Shipping a change" names.
  `npm run format` fixes formatting.
  Types are checked from JSDoc by `npm run typecheck`; the code stays plain JavaScript.
  `npm run deadcode` runs knip, which fails on unused files, exports, and dependencies: delete them rather than ignoring them.
- Which season is current, the store says in `live/current`, as the Worker decides it from the league's own data; a page never picks it by its own clock.
  A new season becomes current on the day of its first game, preseason included, as MLB's spring training and the WNBA's preseason start it,
  so through the offseason a page shows the season just played, opening on its bracket.
  Times show in the viewer's own time zone; only a league's own day is Eastern (read with the shared `readEasternDay` in `shared/page/days.js`: all of MLB's, and the WNBA's for a game without a set time).
  Pages count, read, and format days and times with `shared/page/days.js`, the one module lint lets read the machine's own calendar and clock, and its tests check each of its readings in zones on both sides of UTC;
  an app's own `readGameDay` only says which of its fields hold a game's start and its league's day.
  Tests pass in any `TZ`: a test that asserts a time picks its zone with the root's `tests/time-zone.js` or `test.use({ timezoneId })`.
- The store returns documents frozen, with sorted keys.
  The page writes nothing to the store; everything in it is written by the Worker.
  What a viewer chooses, like MLB's ranking, a dismissal of the Updates box,
  or the WNBA's theme, stays on their own device, since nobody signs in and people share a page's address.
  The theme also rides in the browser's address, as `?theme=`, since a Home Screen app keeps its storage apart from the browser's and opens at the address it was added from,
  and a shared link's theme is swapped for the viewer's own (`shared/page/pick-theme.js`).
  Each is a choice made with `createViewerChoice` in `shared/page/device-storage.js`,
  which keeps it as JSON under its key, lists it, and tells the page when another tab changes it, so each tab redraws what it shows.
  A new choice that a viewer would want on their other devices is made the same way;
  what belongs to one device or browser, like the last tab, the Home Screen welcome's dismissal,
  or the Diagnostics, isn't a viewer choice and stays out of that list.

## Adding a league

A new league is a new app.
Copy the WNBA's: it was built on the shared code from its start,
while MLB still carries pieces from before it, and every file below has a working example in `apps/wnba/`.

A league ships in parts.
Its first PR holds what a fan opens the app for, by the steps below:
the Worker and its store, the Games tab, the standings and bracket,
each game's sheet with its box score, each team's sheet with its numbers,
search, settings, the gate, the page's copy on the phone, both themes, and the beta channel.
Each later PR adds one more of the WNBA's parts, copying it,
like rosters and players' sheets, a final's Highlights, a game's preview and lead chart,
the News tab and its notifications, or the Updates box,
with its tests and its places in search.

While a league is being built, a sandbox Worker may try its feeds from Cloudflare,
since a league can answer Cloudflare differently than it answers a cloud session.
Name it `<app>-sandbox`, upload it from a scratch folder outside git with Cloudflare's API, as `worker/deploy.mjs` does,
and give it no page, store, key, or secret.
Delete it once the app's first PR merges.

1. **Worker config.** `apps/<app>/worker/wrangler.toml` names the Worker `<app>-app`,
   binds the store and the gate's rate limit, and names the beta channel's Worker `<app>-app-beta` under `[env.beta]`,
   as the WNBA's does, which the root's `tests/deploy.test.js` checks for every app.
   The tooling finds apps by this file, and `package.json`'s `#page-files/*` import,
   the lint, type, and dead code globs, and Playwright's projects all pick the new folder up from `apps/*`.
   Add `worker/page-files.mjs`, a one-line call to the root's `readPageFiles`.
2. **The league's data.** `page/js/snapshot.js` names the league's feeds and turns their answers into one snapshot:
   `buildSnapshot(responses, { season, now })`, with the season's games,
   series, and standings and a `missing` list of feeds that didn't answer,
   and `choosePollDelay(snapshot, now)`, which hands the shared one in `shared/page/poll-schedule.js` whether a game is live, the starts still to come, and the league's live pace.
   It runs in both the page and the Worker, so it uses no DOM and no globals.
3. **Reading the feeds.** `worker/src/snapshot.js` fetches them with `createSnapshotLoader()`,
   reading each slow feed again only as a game ends or once it's old,
   and keeping its last good answer for when a read fails, with the shared `createFeedKeeper` in `shared/worker/feed-keeper.js`.
4. **Keeping the season.** `worker/src/season-updater.js` saves each snapshot into the store,
   leaving a field as it was when a feed it needs didn't answer, and lists the notifications for what's new.
   `worker/src/store.js` hands those functions to the shared store with `createSeasonStore(league)`.
   `worker/src/index.js` builds the Worker with `createAppWorker` and exports the store's class.
5. **The page.** `index.html` keeps the shared tab bar and settings markup, its element IDs, and the import map for `#shared/`.
   Its Games view is one empty `#seasonGames`, which `startDayStrip()` wires and `fillDayStrip()` fills with the league's game days.
   It loads the same shared stylesheets and scripts as the WNBA's, in the same order,
   around its own `styles.css`, which sets every token their top comments list,
   and calls `openLastTab()`, `showLastDrawn()`, `followSeasonPart()`, `watchSlowLoad()`, and `drawHomeScreenAsks()` right after its views and sheets,
   in that order, so a part on the shown tab can take back its sideways scroll, the header rides as far as the season's part put back,
   and the welcome opens over any sheet put back.
   Its `gate.html`, which asks for the access code, and its `sw.js`, which sets `self.pageName`,
   load the same shared files as the WNBA's too, which the root's `tests/apps.test.js` checks.
   It marks each element its code draws whole, like `#bracketWrap` and `#stamp`,
   with `data-last-drawn`, and keeps the empty `#loadNote` above its views.
   Give it a manifest, icons, and an `apple-mobile-web-app-title` of the league's short name,
   which its manifest's `name` and `short_name` match.
   Agree on the league's look with the owner from a mockup first: its fonts,
   self-hosted in `page/fonts/`, with each type role's size and weight set in its `:root`, as "Repo" says,
   and its light and dark themes, each a set of colors, the dark one under `:root[data-theme="dark"]`,
   with an icon and a bar color of its own, which `page/js/looks.js` hands the shared `appearance.js`
   for the page and, through `page/js/gate-theme.js`, for the gate.
   Choose the league's All-Star colors with the owner too: each All-Star team's star takes its uniform's color,
   as the WNBA's orange West and white East do, its visitors orange and its home team white in a year of captains' teams,
   and MLB's American and National League colors do, through `renderAllStarMark` in `shared/page/all-star.js`,
   and `styles.css` sets the star's tokens that `game-row.css` lists from the league's own dot.
   `page/js/league-words.js` names what the league's fans call things and the words its pages never show,
   as "Writing" below says, and its search terms hand it to the shared search as `words`.
6. **Tests.** Record a real afternoon of the league's feeds as a fixture in `tests/fixtures/`,
   and test the snapshot, the Worker, the season updater, and the page's views against it.
   Copy each of the WNBA's tests of what the PR builds, since they run the shared checks:
   its browser harness, which runs the page against the real store,
   `page.spec.mjs`, `themes.spec.mjs`, and `role-looks.spec.mjs`,
   which check every view for type roles, contrast, periods, words, taps, and theme layout,
   the last two walking the views listed in `tests/browser/views.mjs`,
   `at-rest.spec.mjs`, which runs in WebKit too,
   and `release-check.spec.mjs`, `access.spec.mjs`, and `offline.spec.mjs`.
   Its `tests/search.test.js` names each place in `COVERAGE`, as "Search finds every place" says,
   and its `tests/search-typing.test.js` types every team, place, and player with the root's `tests/search-sweep.js`,
   from a recorded list of the league's players.
   Each sheet joins `sheet-stack.spec.mjs` and `sheet-reload.spec.mjs` in the PR that adds it.
   Hand the deploy each channel's page secrets in `.github/workflows/deploy.yml`,
   and the `Watch apps` workflow production's in `watch.yml`, which the root's `tests/deploy.test.js` checks.
7. **Docs.** Add the app to the README's table and its setup section's list of apps, and to the "Apps" bullet above.
8. **Ship it.** Open it as a `feat:` PR, which starts the app at version 1.0.0.
   Its page adds lines that give parts layers of their own, so it's a red change,
   tried on the owner's phone from beta before it merges, as "Workflow" says.
   Each channel's token can edit only the Workers it names, so before the first deploy of each channel,
   the owner creates its Worker in Cloudflare's dashboard and adds it to that environment's token:
   `<app>-app-beta` to the `beta` token before the first push to `beta`, and `<app>-app` to the `production` token before the merge.
   Once its CI passes, push it to `beta`, whose deploy replaces `<app>-app-beta`,
   which answers nothing but `robots.txt` and `health` until `npm run set-app-key -- <app> --channel beta` gives it a key and prints its address.
   Give the owner that address, and ask them to set its code with `npm run set-access-code -- <app> <code> --channel beta`,
   add both as `<APP>_BETA_PAGE_URL` and `<APP>_BETA_ACCESS_CODE` in the `beta` environment's secrets,
   add the page to the Home Screen, and label the PR `phone-ok` once they've used it.
   The merge's deploy then replaces `<app>-app`, which `npm run set-app-key -- <app>` gives its key in the same way,
   and the owner adds its address and code as `<APP>_PAGE_URL` and `<APP>_ACCESS_CODE`,
   so each deploy and the `Watch apps` workflow open its page.

## Workflow

- `main` is the source of truth.
  Every change reaches it through a PR, by the steps in "Shipping a change" below.
- Never push to another session's branch.
- Run each command so it needs no approval: one command per call, from the repo's root, where every session starts.
  Never start with `cd`, never join `cd` to a `git` command, and never pipe or chain after a command `.claude/settings.json` allows, like the beta force-push.
  A hook in `.claude/settings.json` blocks a call that starts with `cd`, a subshell's `(cd` too,
  or joins commands with `&&`, `||`, `;`, a lone `&` that runs one in the background, or a line break,
  in the call itself or in a script it hands a shell as a string, as `bash -c "a; b"` does (`.claude/hooks/one-command.mjs`).
  When a command still asks, add it to that allow list in the same PR if it's safe for any session to run, or say why it asks.
- Don't spend time curating commit history.
  Squash merges make it irrelevant.
- Refer to PRs by number, not branch.
- Start every PR title with a type.
  The squash merge carries it to `main`, where it sets the next version of each app it changes (`worker/release.mjs`);
  a PR that changes nothing an app's deploy counts (`worker/deploy-scope.mjs`),
  such as only its tests or other apps' folders, leaves that app's version alone:
  `feat:` for something new to see or do (minor), `fix:` for fixes and polish (patch),
  `refactor:` for code the Worker runs with no visible change (patch),
  `build:` for dependencies, the build, and the deploy (patch),
  and `docs:`, `test:`, `ci:`, or `chore:` for changes the deploy skips (no version).
  Add `!` after a type that releases, as in `feat!:`, for a major change: a new address, lost data, or something that's gone.
  It's major for every app the PR's deploy changes, through shared code too;
  when only one app breaks, name it, as in `feat(mlb)!:`, and the others take the type's own bump.
  A scope is only for that.
  A PR that mixes kinds takes the biggest bump.
  CI's `title` job checks it.
- Release notes: each app's `page/js/release-notes.js` lists what's new in the app,
  which its Updates box shows under New in the app, the newest three and how many more,
  until it's dismissed or two weeks after the device first showed it,
  so a viewer back from time away still sees what they missed,
  but a device's first look counts every note already out as shown,
  and starts its games' updates after every one already out,
  so a new phone opens with no box (`listNotesToShow` and `readOrStartSeenAt` in `shared/page/updates.js`).
  Add a note only when the user asks for one, whatever the PR's type, in the words they approve, with an `at` just before the PR merges.
  A word that should stand out, like a button's name, goes in `<b>`,
  in a note built with the `html` template, which the Updates box sets at 500, heavier than the note's text, as it does a final's team names.
- Each app has a beta channel: a second Worker, `<app>-app-beta`,
  from the `[env.beta]` in its `wrangler.toml`, with its own store,
  key, and address, whose page says beta on the Home Screen and in settings' version line (`worker/build.mjs`),
  and in a tag beside the app's name, with the commit it runs and how long ago that went live (`shared/page/channel-tag.js`).
  A push to the `beta` branch deploys it at once, with the same checks and rollback as `main`'s deploy.
  To use a PR's change on the owner's phone before it merges, reset `beta` to the PR's branch and push (`git push -f origin <branch>:beta`),
  wait for that push's Deploy run to say `worker check: ok` for each app, and tell the user to use the beta app on the Home Screen.
  `beta` is a scratch branch: never commit to it or open a PR from it.
  Each of `deploy:api`, `rollback`, `set-app-key`, `set-access-code`, and `set-page-host` takes `--channel beta`.
- A red change is one whose bugs no CI browser would show, since none touches,
  scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong before: parts left undrawn by how layers and sheets stack.
  `worker/red-change.mjs` finds it: any change to the shared JavaScript that moves and draws the page (`sheet.js`,
  `sheet-reopen.js`, `slide-panels.js`, `sheet-swipe.js`, `sheet-sections.js`,
  `side-swipe.js`, `bracket-standings.js`, `pill-thumb.js`, `tab-bar.js`, `eased-redraw.js`,
  `show-last-drawn.js`, `season-header.js`, `rider-taps.js`, `held-bar.js`,
  `day-strip.js`, `strip-slide.js`, `pull-to-refresh.js`, and `spring-scroll.js` in `shared/page/`),
  but not to its comments, blank lines, or formatting, which draw nothing;
  a change to the sequence of its shared stylesheets' (`sheet.css`, `pager.css`,
  `chrome.css`, `team-sheet.css`, `game-cards.css`, and `day-strip.css`) top-level statements,
  like `@layer` and `@import`, and declarations, under each selector and its at-rules,
  of a property that decides how parts layer, stack, scroll,
  take a touch, or show, whatever its value (any below, any `position`, `overflow` but `overflow-wrap`,
  `overscroll-behavior`, `scroll-snap`, `scroll-behavior`, `scroll-padding`, `scroll-margin`,
  `touch-action`, `-webkit-touch-callout`, `user-select`, `pointer-events`, `z-index`,
  `opacity`, `visibility`, `display`, `isolation`, `mix-blend-mode`, `container`, `offset`,
  `view-transition-name`, `-webkit-box-reflect`, or `zoom`),
  but not in their fonts, colors, spacing, or sizes, which CI checks,
  so a rule renamed, split, or merged that sets none of those isn't red;
  what any other stylesheet of a page adds that gives a part a layer of its own (`transform`,
  `translate`, `rotate`, `scale`, `perspective`, `backface-visibility`,
  `filter`, `backdrop-filter`, `mask`, `clip-path`, `will-change`,
  `animation`, `transition`, `contain`, `content-visibility`, or a fixed or sticky `position`),
  or lifts it over others, or decides how it scrolls or takes a touch (any of those but `opacity`, `visibility`, and `display`,
  with a `position` only `absolute`, `fixed`, or sticky, and an `overflow` only when it isn't `visible`),
  and any top-level statement it adds or takes out;
  a custom property any stylesheet of a page changes, adds, or takes out that one of those declarations reads, itself or through another,
  and the `@property` rule that registers one;
  a line a page's other JavaScript adds that writes one of those layer properties or a fixed or sticky `position` as CSS, or starts an animation,
  that sets or clears what those other stylesheets would be red to add, by a property's name on a part's style or on one a script holds as `style`, as `style.zIndex = 5` does,
  with `setProperty` or `removeProperty`, in a style's object,
  or in a style's whole text, through its `cssText`, the `style` itself, or `setAttribute("style", ...)` and `removeAttribute("style")`,
  or a custom property those declarations read, or a style property whose name a template, a variable in `setProperty` or `removeProperty`, or an index into `style` holds,
  that creates a `dialog`, `style`, or `script` element, or that holds the markup below;
  a line an app's `page/*.html` adds or takes out that holds `<script`, `<style`, `<dialog`, or `popover`,
  or a `style=` that sets what one of those other stylesheets would be red to add, or a custom property those declarations read,
  or whose value the gate can't read, as where a template fills it in whole,
  or any change to the stylesheets it links, whose order sets the cascade, but not its other links, like a preload or an icon,
  to its `viewport`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, and `apple-mobile-web-app-status-bar-style` metas,
  which fit it to the screen, open it from the Home Screen without the browser's bars, and color the phone's own,
  or to its inline scripts and styles, which take effect in the order the page holds them;
  a change to the `display`, `display_override`, `orientation`, or `scope` an app's `page/*.webmanifest` gives,
  which open its Home Screen app without the browser's bars, turn it, and say which pages keep it so,
  or to a manifest the gate can't read;
  and a diff the gate can't read.
  In a stylesheet, a `style=`, or a script, a declaration that reads a custom property, or a value a template or the script fills in, counts as if it held any value,
  and a `transition`, or a `transition-property`, counts unless every property it names only repaints a part (`color`, `background`, `background-color`,
  `border-color` and each side's, `outline-color`, `box-shadow`, `text-decoration-color`, `fill`, `stroke`, or `caret-color`),
  so `none`, `all`, one that names none, or a keyword like `inherit` counts,
  but for one in a script's CSS text, as in its template or a string, or keyed in a style's object or keyframes,
  however its key is written, which counts whatever it eases,
  since the script can add to it past where the gate reads it.
  A script, stylesheet, or page the gate can't read is red, and so is one whose diff hides its content, as a binary one's does, from a diff that shows every file's text whatever `.gitattributes` says.
  By design it can't see what a page's other stylesheets take out, or their `display` and `opacity` overriding a shared rule,
  nor a class that markup or a script adds that a shared stacking rule then reaches.
  The base's copy of the gate's code, on the Node and modules the base names, judges a pull request's files,
  so a change to the gate's code can't let the pull request's own red change through,
  and a change to the workflow's `gate`, `phone`, or `check` job is the review's to weigh, as a guard `REVIEW.md` names.
  Tests are never red.
  The owner's phone is a red change's test, and CI's `gate` holds one on its head's `phone` status, pending until its PR has the `phone-ok` label,
  added by the owner after the PR's last push,
  which main's rules require for a merge, so `check` passes on the PR's tests and review alone,
  and holds the change itself whenever main's rules don't require that status, which its own step reads from GitHub,
  or the pull request comes from a fork, whose token can't post it,
  so a fork's pull request has no `phone` status and merges only past main's rules while they require it (`.github/workflows/ci.yml`).
  - Take a red change to its branch and PR, deploy it to beta as the bullet above says,
    and stop there: tell the user what to use on the phone, and wait, doing only what CI and the review ask of the PR meanwhile.
    When you ask the owner to add `phone-ok`, link the PR in the same message.
    Never add `phone-ok`.
    Only the owner labels it, once they've used the change on beta, which runs `gate` again without a push.
    A push after the label, a merge of `main` too, holds the PR again until the owner has used that commit on beta and labeled it again,
    so deploy it to beta and ask.
    Merge `main` into the branch just before each deploy to beta, so the commit the owner labels is the one that merges, since a PR merges while behind `main` as long as it has no conflicts.
    Merge a red PR once `check` and `phone` pass with `phone-ok` on it: the label is the owner's sign-off from beta and their go-ahead to merge, so don't ask again.
    An OK in chat never stands in for the label.
    Merge it yourself: the owner doesn't.
  - One red change goes live per deploy.
    While a red change is on beta, or has merged and the owner hasn't confirmed it on the phone, no other red PR merges, and none replaces it on beta.
  - If parts of a page ever stop drawing on the phone again, the first step is a phone restart and a Diagnostics report from settings, not a code change.
- `npm run rollback -- <app>` puts the app's previous version back at all of its traffic and prints which commit was live and which is now.
  Run it only when the user asks.
- `npm run set-app-key -- <app>` gives that app's Worker its `APP_KEY` and prints the page's address.
  `--rotate` replaces the key, which changes the address; do that only when the user asks.
- `npm run set-access-code -- <app> <code>` sets the code an app's page asks for, with a new random `ACCESS_SIGNING_KEY`; the user picks the code.
  A new code signs every phone out, and `--remove` stops asking.
  Never commit, log, or post the code.
- `npm run set-page-host -- <app> <host>` points a host on a domain in the Cloudflare account at that app's Worker and names it in the Worker's `PAGE_HOST` secret,
  so the page also opens there without its key, behind its access code, which it needs first; the user picks the host.
  The address with the key keeps working as it was, and phones stay signed in there.
  Keep the host out of the repo, as the Worker's own address is.
- The repo is public.
  Never commit secrets, keys, account IDs, real Worker addresses or subdomains, or personal data; use placeholders in tests and docs:
  `example` or `example-subdomain` for a Worker's subdomain and `k3y` or `<key>` for a page's key,
  which the root's `tests/no-secrets.test.js` tells from a real one, failing on any real one in a tracked file.
  Nothing a change logs or posts where the public can read it, like a workflow's log or an issue,
  carries a page's address, its key, an access code, or the account's id either,
  masked as `hideAddress` in `worker/check-page.mjs` masks a check's reason.
  Nor does a Diagnostics report, which a viewer shares wherever they like:
  each of its logs names a file by its own name and the page as page (`nameFile` in `shared/page/step-log.js`).
  Reviewing a change, check what it commits, logs, and posts for any of these.
- The Cloudflare tokens live only in the cloud environment's API credentials and the repo's `production` and `beta` GitHub environments,
  each environment's limited to its channel's Workers and usable only from its channel's branch, so a branch on beta can't change the live apps.
  Never ask for one in chat or put one in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never point tests at the real page.
- When unsure, do what best serves the intent of the work, and confirm with the user.
  If you genuinely need a decision from the user, give all the context concisely, list the pros and cons of each option, and make a recommendation.

### Shipping a change

Follow these steps in order.
When a step says to go back to an earlier step, continue in order from there.

1. Fetch `main` and start your branch from it, or, for a stacked PR (step 12), from the branch of the PR it builds on.
   If the branch's last PR has merged, reset the branch to `origin/main` first.
2. Run `npm run lint`, `npm run format:check`, `npm run typecheck`,
   and `npm run deadcode`, and the tests that cover what you changed: a test file with `node --test <file>`, or a browser spec with `npx playwright test <file>`.
   Even for a change to shared code, run the specs that exercise it by name,
   found by searching the tests for the module or the elements it draws; never pass a folder.
   Don't run the full test suite locally (`npm test`, `npm run test:browser`, or `npm run check`):
   CI runs the Node tests, and the browser tests a change reaches, on every push.
   If anything fails, fix it and run it again.
   Repeat until it passes.
   Never push while it fails.
   - Before pushing a change to how a page looks, screenshot every view it touches,
     in each of the app's themes, on a phone and a wide screen, and look at each one: a test checks only what it names.
     Look at a view built from a mockup beside the mockup, with the same data,
     and a new view beside its siblings, like a new sheet beside the others, rather than on its own.
     Fix anything off, and name the views and themes you looked at in the PR's description.
   - The browser tests run in CI on Chromium's headless shell, which behaves differently from full Chromium; for example, it denies notification permission.
     If you set `CHROMIUM_PATH`, point it at the headless shell.
     Set `BROWSER_TEST_PORT` to run a second checkout's browser tests alongside another's, on that port and the next.
3. Fetch `main` and merge it into your branch, or, for a stacked PR, the branch of the PR it builds on.
   If that brought in anything new, go back to step 2.
   Then commit, push, and open a PR into `main`, or a stacked PR into the branch it builds on.
   If the PR is already open, the push updates it.
   - If the change is red (`node worker/red-change.mjs`,
     with `git diff --text --no-textconv --no-ext-diff --no-renames origin/main` on stdin, as CI runs it, says why),
     also deploy it to beta once its CI passes (`git push -f origin <branch>:beta`,
     as "Workflow" says), unless another red change is still on beta or unconfirmed.
     Then tell the user it's on beta and what to use on the phone, and keep to steps 4 to 7 while the owner tries it.
4. Check whether the PR has merge conflicts with its base branch.
   GitHub runs no CI on a PR with conflicts, so waiting on one would never end.
   A merge to `main` that leaves an open PR in conflict comments on it (`worker/flag-conflicts.mjs`), which wakes a session watching it.
   If it has them, merge the base branch into your branch, resolve the conflicts, and go back to step 2.
   If resolving a conflict would drop behavior from either side, resolve it in the way that best serves the spirit of both changes, and confirm with the user.
   If you genuinely need a decision from the user, give all the context concisely, list the pros and cons of each option, and make a recommendation.
5. Wait until every CI job on the PR's latest commit has finished.
   The `check` job is the one that must pass; it fails whenever any other CI job fails.
   Each time you look while waiting, and whenever no CI run has started on the latest commit a few minutes after the push,
   go back to step 4 first: another PR may have merged into `main` and left this one in conflict.
6. If a CI job failed, read its log and reproduce the failure locally.
   Fix it and go back to step 2.
   If you can't reproduce or fix it, tell the user which job failed, what its log says, what you tried, and what you recommend.
7. CI's review reads the PR by the root's `REVIEW.md` as `main` has it.
   It splits the change into areas by what the files are about, each test with its code (`worker/plan-review.mjs`),
   and in each area four reviewers each look for one kind of problem, bugs twice, then rules and tests, and list every case they find.
   A checker for each area confirms each case against the code, merges repeats, and weighs it,
   a check across areas, when there's more than one, names repeats across them and adds what spans them,
   and a step posts what they confirmed or left unsure, each on the line it concerns.
   The first review reads the whole change, and each review after it reads what changed since the last review that finished.
   A review of a push that finishes and posts nothing new reads the whole change once more, one reviewer an area, and the summary names what that pass found.
   A push that changes only what a merge of its base brings in isn't reviewed again.
   The `review` job checks what each reviewer actually read and updates one summary comment that says which commit it reviewed,
   how many findings it posted by weight, which files it left unread and why, like recorded data or a drawing,
   and anything it read but couldn't judge (`worker/judge-review.mjs`).
   It fails when any changed file went unread, or when a reviewer, checker, check across areas, or posting step didn't finish, naming each.
   If the summary names something it couldn't judge, tell the user.
   Answer all of a review's findings in one push: fix each and go back to step 2, or reply on its comment saying why not.
   A Nit you fix rides a push the PR needs anyway,
   or, when none is left, one last push just before the merge,
   which on a red change comes before its last deploy to beta,
   and never waits for a later PR or the next change to its file.
   After three reviews in a row with an Important finding, or when a finding you declined comes back, stop and ask the user.
   - If `review` fails, read its summary and the log of the failed `review-find`, `review-check`, `review-across`, or `review-post` job, or its `review-final-` twin, which shows each try's turns and tool calls.
     If one stopped before Claude started, like an install that timed out, re-run the failed jobs once yourself.
     Otherwise don't reproduce it locally or re-run it: each reviewer already tried twice, and each checker and the check across areas once.
     Tell the user what the log shows: an invalid or expired Claude credential secret, Claude unreachable,
     where a review stalled, or a re-run that failed too.
     `check` can't pass until the job does.
8. Squash-merge the PR once all of these are true:
   `check` passed on the latest commit, the PR has no merge conflicts, every review finding is answered, and its base is `main`.
   If GitHub refuses the merge, go back to step 4.
   - Merge a red PR only once `check` and `phone` passed with the `phone-ok` label on it, which is the owner's go-ahead to merge: until then, tell the user it's ready and wait.
     An OK in chat never stands in for the label.
     One red change goes live per deploy.
9. Don't deploy.
   Merging starts the Deploy workflow at once, and CI on `main`.
   When the PR's CI passed on exactly the code `main` now has (`worker/find-passed-ci.mjs`),
   which it did if the PR was up to date with `main` as it merged,
   that first Deploy run deploys, and CI on `main` skips the checks it already ran; otherwise the Deploy run that follows CI on `main` does.
   Either runs `worker/deploy.mjs`, which deploys each app's Worker and rolls back any new version that doesn't answer,
   or whose page doesn't draw (`worker/check-page.mjs`).
   An app's deploy is skipped when nothing but docs, tests, tooling,
   and other apps' folders changed since its live version's commit; `worker/deploy-scope.mjs` lists those files.
   Each line of the deploy log starts with its app's name, so read step 10's results for each app.
   When you add a file that can't change the Worker, add it to that list.
10. Wait for the Deploy runs for the merge commit to finish, then read their logs and do what matches:
    - The first says "No pull request's CI passed on exactly this code": the deploy waits for CI on `main`.
      Read the next Deploy run's log.
    - It says `worker check: ok`: the new version is live.
      Tell the user.
      A line before it saying `page check: skipped` names a page the deploy couldn't open, like one whose secrets are missing or out of date,
      and one saying `page check: ok, but` a page that opened without the code its environment holds:
      tell the user that too.
    - It says "Nothing the Worker runs changed": the merge didn't need a deploy, or the first Deploy run already deployed it.
      Tell the user which.
    - It says "has moved on" and "whose deploy covers": another merge landed first, and CI passed on it, so its Deploy run covers this one.
      Read that run's log instead.
      Saying "hasn't passed on it" instead, it deploys this merge while the newer one's CI is still to pass, so read on in this run's log.
      Saying "couldn't be asked", it deploys this merge because GitHub couldn't say how CI went on the newer one, so read on in this run's log too.
    - It says "already has": a newer merge's deploy went live first, and covers this one.
      Read that run's log instead.
    - The run was skipped:
      CI failed on `main`.
      Read the CI log, fix the failure in a new PR, and start again at step 1.
    - It says "nothing was deployed": the channel's environment has no Cloudflare token.
      Tell the user.
    - The run failed: read the log.
      If it says "the earlier version is live again", the Worker rolled back and is unchanged.
      Tell the user what failed and recommend a fix.
11. Run `npm run deploy:api` yourself only when step 10 found no successful deploy and the user agrees.
    Say why the automatic deploy didn't happen and recommend whether to deploy by hand.
    Never deploy any other way, but for a new league's sandbox Worker ("Adding a league").
12. Related changes can ship together in one PR.
    Split work into several PRs only when its parts can be reviewed or rolled back on their own.
    A PR that needs another PR's unmerged changes doesn't wait for it: stack it.
    Start its branch from that PR's branch, open it into that branch,
    so its diff and review show only its own changes, and name the PR it builds on in its description.
    Whenever the earlier PR's branch changes, merge it into the stacked branch.
    Once the earlier PR merges, change the stacked PR's base to `main` if GitHub hasn't, merge `main` into its branch, and go back to step 2 for it.
    That merge conflicts wherever the stacked PR changed lines the earlier one did,
    since `main` has the earlier PR only as its squash: keep the stacked branch's side of those, and resolve any other conflict as step 4 says.
    Never merge a PR into another PR's branch: a stack merges into `main` one PR at a time, earliest first.

## Building and fixing

### Both apps, every place

- A fix or design change applies to both apps, and to every view, sheet, and theme where the same thing shows, unless the owner names one app.
- When only one app can have it now, build it in `shared/` so the other can add it later.
- When adding to one app something the other already has, reuse the other app's values, like logo sizes and spacing, and leave the other app untouched.
- A phone and a wide screen look the same, except where the width forces a difference.

### When something is wrong

- When fixing a bug, look for the same bug in all apps and in every view, sheet, and theme, and fix those in the same PR.
  Say what else you checked.
- When a bug reaches production or beta, the PR also says how it got there and why no test caught it, and adds the test or lint rule that would have.
  Prefer a test or lint rule over a written rule, which agents can forget.
- Say a bug is fixed only once you've reproduced it and seen the fix work.
- Ask for a Diagnostics report rather than guessing.
- While chasing a bug, test one idea at a time and say what each one showed.
  Never stack guesses in production.
- Once a bug is fixed, take out any attempted fixes that didn't help, and put back anything removed that turned out not to be the cause.
- When something replaces an old system, delete the old code in the same PR.

### Search finds every place

- Search finds every place the app has, as the phone's own search does: each tab,
  sheet, sheet section, and setting, and each kind of thing with a page of its own,
  like a team or a player, and a coach once coaches have pages.
  Anything a change adds that a fan could look for is searchable, in words a fan would type, unless there's a reason to leave it out.
- When you add a place, make it searchable in the app's `page/js/search-pages.js`,
  with its row, its words, and what it opens, and add it to `COVERAGE` in the app's `tests/search.test.js`,
  with the search that finds it, or with why search leaves it out.
  That test reads the page's markup and fails on any tab, sheet,
  sheet section, or setting `COVERAGE` doesn't name, on any setting's row without the `data-setting` its search opens, and on any search that no longer finds its place.
  A kind of thing whose pages share one sheet, like a player's, is named once, by a search that finds one of them.
- Reviewing a change, check that each place it adds is searchable,
  or is left out for a reason a fan would agree with, and that a place it removes leaves search too.

### What the apps should feel like

- Smooth above all.
  Nothing flickers, jumps, or flashes on open, return, reload, or redraw, and a new release arrives without anyone swiping the app closed.
- Follow general best practices for web development code and app UI.
- Desktop hover is a subtle change of text color only, to the app's `--ink-hover`: never an underline, border, or highlight,
  which the root's `tests/hover-color.test.js` checks.
- Simple beats configurable.
  Pick good defaults rather than adding settings.
- Readable before elegant.
  Text that's too small, light, or dim is a bug: check it against its type role,
  and against WCAG's AA contrast, 4.5 to 1, which the root's `tests/browser/contrast.mjs` checks wherever the browser tests check the type roles,
  once nothing is pressed or mid-transition, so a test of a pressed or hovered row's colors measures that on purpose,
  and the WNBA's `tests/browser/themes.spec.mjs` in both its themes.
- Things shown side by side for comparison share one scale, like two pitchers' speed lines.
- Build with mature web features that work in every browser, Safari first.

## Writing

README and anything user-facing: be clear, direct, and concise.

In this file, start each sentence on a line of its own, and break a long one after its commas,
so two changes to one bullet touch different lines and rarely conflict.
The root's `tests/agents-lines.test.js` checks it.

On the pages, text of one sentence or less, like a label, an empty view's note,
or a setting's note, ends without a period; text of two or more sentences,
like a release note or a message that says what to do, ends with one,
but for text that ends in a link, which ends without one, as the Home Screen app's note does.
An outlet's own words keep their punctuation, in an element marked `data-quoted`.
The root's `tests/browser/stray-periods.mjs` lists any shown text that breaks this,
and each app's browser tests check every view with it, wherever they check the type roles.

On the pages, write how fans talk, not a league's official or press words:
the playoffs in every app, never the postseason or a berth,
and a league's own word only where its fans say it too, like the World Series, Opening Day, and extra innings.
Each app's `page/js/league-words.js` holds what its fans call the things that differ by league,
which shared code reads instead of typing its own (`shared/page/league-words.js`),
and the words its pages never show, like another sport's.
The root's `tests/browser/never-shown-words.mjs` lists any shown text that holds one,
and each app's `page.spec.mjs` checks every view with it, wherever it checks the type roles.
