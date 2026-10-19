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

## Repo

- Apps: one per league, each in `apps/<app>/` with its own `page/`,
  `worker/`, and `tests/`, and deployed as its own Worker, named in `apps/<app>/worker/wrangler.toml`.
  Paths here, in the rule files, and in the skills are inside an app's folder, except `shared/` and the ones named as the root's.
- Page:
  `page/`.
  `page/js/app.js` is the entry module; shared page data lives in `page/js/session.js`.
- More rules load from `.claude/rules/` once a session reads or edits a file they cover:
  `page-look.md` and `page-code.md` for the pages, `worker.md` for the Workers,
  `shared-modules.md` for what each shared module does, `mlb.md` and `wnba.md` for what each app holds,
  `tests.md` and `browser-tests.md` for tests, and `tooling.md` for the root's `worker/` and `.github/`.
  Adding a league follows the `add-league` skill.
- Shared code:
  `shared/page/` and `shared/worker/` hold what every app uses, which `.claude/rules/shared-modules.md` lists.
  A change there reaches every app, so shared code never imports an app's modules: an app hands it what it needs, as `watchReturns({ isBusy, catchUp })` does.
  Logic or a view that more than one app needs lives there once,
  and each league hands it only what differs, as each app's `readGameDay`,
  `renderGameRow`, and `listSeasonDays` calls do; never copy it into a second app.
- Tests: each app's `tests/`, with its browser tests in `tests/browser/`, and the root's `tests/` for `shared/` and the tooling.
  How to write them is under "Tests" above and in `.claude/rules/tests.md` and `browser-tests.md`.
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
    Its PR opens as a draft and stays one while the owner tries its design on beta:
    CI tests a draft, and beta deploys it, as for any PR, but CI reviews it only once it's ready for review.
    Once the owner says the design is the one to keep, mark the PR ready for review, which starts its first full review,
    answer the review, and then deploy its reviewed head to beta for the owner's `phone-ok`.
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
   - Before each push, have a helper agent review what you changed since the last push, or the whole change before the first,
     by the root's `REVIEW.md`, and fix what it finds.
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
     open its PR as a draft, and deploy it to beta once its CI passes (`git push -f origin <branch>:beta`,
     as "Workflow" says), unless another red change is still on beta or unconfirmed.
     Then tell the user it's on beta and what to use on the phone, and keep to steps 4 to 6 while the owner tries its design.
     Once the owner says it's the one to keep, mark the PR ready for review, and go on to step 7.
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
   and in each area four reviewers each look for one kind of problem, bugs twice, then rules and tests, and list every problem they find, each once with every place it shows.
   Each area's reviewers read the rule files whose `paths` match its files, as well as its diffs.
   A checker for each area confirms each problem against the code, merges repeats, and weighs it,
   a check across areas, when there's more than one, names repeats across them and adds what spans them,
   and a step posts what they confirmed or left unsure: each Important or Unsure finding on the line it concerns, or its file,
   and the review's Nits and Pre-existing findings together in a checklist, in one comment, or in more only past GitHub's limit on a comment's length,
   each on the first of its items' files GitHub takes and each a thread of its own,
   and any finding GitHub takes on no file in a comment in the PR's conversation.
   Each area's reviewers and then its checker run on their own (`.github/workflows/review-area.yml`), so no area waits on another's.
   The first review reads the whole change, and each review after it reads what changed since the last review that finished.
   A review of a push with anything to read reads the whole change once more alongside, one reviewer an area,
   and posts what that read found only when the push's review finishes and posts nothing new, and the summary names it then.
   A push that changes only what a merge of its base brings in isn't reviewed again.
   The `review` job checks what each reviewer actually read and updates one summary comment that says which commit it reviewed,
   how many findings it posted by weight, which files it left unread and why, like recorded data or a drawing,
   and anything it read but couldn't judge (`worker/judge-review.mjs`).
   It fails when any changed file went unread, or when a reviewer, checker, check across areas, or posting step didn't finish, naming each,
   a reviewer that left one of its area's rule files unread among them.
   If the summary names something it couldn't judge, tell the user.
   Answer all of a review's findings in one push: fix each and go back to step 2, or reply on its thread, only when you won't fix it, saying why.
   Fix a finding in every place the PR's own change shows the same problem, not only on its line,
   and name a place outside the change that shows it in a line of the PR's description, rather than widening the PR.
   Once the push is up, resolve the thread of each finding you fixed, with no reply, since GitHub marks it outdated once its line changes,
   and of each you answered.
   Resolve each checklist of Nits once every item in it is fixed or answered in a reply on its thread.
   A finding in the PR's conversation has no thread: answer one you won't fix with a reply in the conversation.
   `main` merges a PR only once every thread on it is resolved.
   A Nit you fix rides a push the PR needs anyway,
   or, when none is left, one last push just before the merge,
   which on a red change comes before its last deploy to beta,
   and never waits for a later PR or the next change to its file.
   After three reviews in a row with an Important finding, or when a finding you declined comes back, stop and ask the user.
   - If `review` fails, read its summary and the log of the failed job, an area's `find` or `check` under `review-area`, or `review-across` or `review-post`, or its `review-final-` twin, which shows each try's turns and tool calls.
     If one stopped before Claude started, like an install that timed out, re-run the failed jobs once yourself.
     Otherwise don't reproduce it locally or re-run it: each reviewer already tried twice, and each checker and the check across areas once.
     Tell the user what the log shows: an invalid or expired Claude credential secret, Claude unreachable,
     where a review stalled, or a re-run that failed too.
     `check` can't pass until the job does.
8. Squash-merge the PR once all of these are true:
   `check` passed on the latest commit, the PR has no merge conflicts, every review thread is resolved, and its base is `main`.
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
    Never deploy any other way, but for a new league's sandbox Worker (the `add-league` skill).
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

In this file, the rule files in `.claude/rules/`, the skills, and `REVIEW.md`,
start each sentence on a line of its own, and break a long one after its commas,
so two changes to one bullet touch different lines and rarely conflict.
The root's `tests/agents-lines.test.js` checks it.
Each rule file lists the `paths` it loads for, each matching a file in the repo, which the root's `tests/rule-files.test.js` checks.

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
