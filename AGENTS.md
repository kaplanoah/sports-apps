# AGENTS.md

## Code

- Keep code clean, consistent, reliable, readable, secure, and maintainable.
- Follow best practices. Don't be unique or clever.
- Leave code better than you found it. Don't leave something sub-optimal just because that's how you found it.
- Weigh options by how each result works: the work or code an option takes is never a pro or a con.
- Write every change as it would have been written had its final design been known from the start, however many rounds of mockups, sliders, comparisons, or fixes it took to get there. Build from the values picked, never from a playground's code, and leave nothing those rounds left behind: values or options no longer chosen, a setting or branch kept only to compare, a case that can no longer happen, a name for an earlier version, or a rule that overrides another where one rule would do. Before each push, read the whole diff against `main` for it, and CI's review flags any of it.
- Start function names with a verb naming the action (boolean predicates excepted). No generic names like `call`, `run`, `execute`, or `handle`, which lint rejects for a function.
- Make every function do one thing well. Make orchestration a sequence of named steps. Extract and name any non-trivial logic inside blocks or chained conditions.
- Keep a view's decisions out of the code that draws it. What to show, which item is chosen, the order, and any time limit live in a module the view calls with its state and what it measured, so a Node test reaches them, as `shared/page/search-reading.js` does for what search shows as words are typed.
- A rule or a limit two places share lives in one place, like the two minutes away that closes a sheet or the search, so the places can't drift apart.
- A fact two places show, like a game's inning or a club's record, comes from one read, kept in one document, so the places can't trail each other, as a game's row and its field did while one read MLB's schedule and the other its live feed. Where one read would cost more than the store's request budget allows, the later place waits for the earlier, or hides, rather than reading on its own. A fix of two places that trailed adds a test that they agree.
- Name variables with full words that are reasonable for their types. No opaque abbreviations.
- Default to no comments. Only use a comment for a non-obvious why. Every comment must be evergreen: no history narrative, no call-site lists, no fixture values, nothing that restates the code.
- Use plain ASCII in code, comments, docs, and commit messages: no em dashes, no curly quotes.

## Tests

- Every change to behavior comes with tests that fail without it, in the same PR. Before pushing, break the code each new test guards and watch it fail; a test that still passes guards nothing.
- Test text, numbers, and logic in Node, where a test takes milliseconds: render the view's markup or call the function, as `apps/mlb/tests/page.test.js` does for the Games list's series labels. Write a browser test only for what takes a browser: layout, color, motion, focus, and the page working with its Worker and store.

## Repo

- Apps: one per league, each in `apps/<app>/` with its own `page/`, `worker/`, and `tests/`, and deployed as its own Worker, named in `apps/<app>/worker/wrangler.toml`. Paths here, in the rule files, and in the skills are inside an app's or a service's folder, except `shared/`, `.github/`, `.agents/`, `.claude/`, `.githooks/`, and the ones named as the root's.
- Services: a Worker with no page, which the apps reach by a binding and the public never does, each in `services/<name>/` with its own `worker/` and `tests/`, and built, deployed, and rolled back as an app is (`.claude/rules/tooling.md`).
- Before reading or changing files, read every rule file whose `paths` frontmatter matches them, even when the client does not load rules automatically. The labels below describe topics, not scope:
  - `.claude/rules/page-look.md` for page appearance.
  - `.claude/rules/page-code.md` for page code.
  - `.claude/rules/worker.md` for app and service Workers.
  - `.claude/rules/season-and-store.md` for seasons and stored data.
  - `.claude/rules/red-change.md` for changes that need a phone test.
  - `.claude/rules/shared-modules.md` for shared modules.
  - `.claude/rules/mlb.md` for the MLB app.
  - `.claude/rules/wnba.md` for the WNBA app.
  - `.claude/rules/tests.md` for tests.
  - `.claude/rules/browser-tests.md` for browser tests.
  - `.claude/rules/tooling.md` for root tooling, workflows, and hooks.
- Read these skills:
  - `.agents/skills/ship/SKILL.md` before shipping any change.
  - `.agents/skills/steward/SKILL.md` before answering CI's review.
  - `.agents/skills/review-failures/SKILL.md` for a failed `review` or `review-join` job.
  - `.agents/skills/beta/SKILL.md` for beta and red changes.
  - `.agents/skills/deploy-log/SKILL.md` for a deploy's log.
  - `.agents/skills/add-league/SKILL.md` before adding a league.
- `.agents/skills/` holds the skills; `.claude/skills` links to it. Codex has no enforcement equivalent for Claude's one-command or context-limit hooks. Follow the command rules here; when a context-limit stop requires handoff, follow the handoff steps in `.claude/hooks/context-limit.mjs`.
- Shared code: `shared/page/` and `shared/worker/` hold what every app uses, which `.claude/rules/shared-modules.md` lists. A change there reaches every app, so shared code never imports an app's modules: an app hands it what it needs, as `watchReturns({ isBusy, catchUp })` does. Logic or a view that more than one app needs lives there once, and each league hands it only what differs, as each app's `readGameDay`, `renderGameRow`, and `listSeasonDays` calls do; never copy it into a second app.
- Tests: each app's `tests/`, with its browser tests in `tests/browser/`, and the root's `tests/` for `shared/` and the tooling. How to write them is under "Tests" above and in `.claude/rules/tests.md` and `.claude/rules/browser-tests.md`.
- Commands: `npm run check` runs everything CI does, but locally run only what step 2 of "Shipping a change" names. `npm run format` fixes formatting. Types are checked from JSDoc by `npm run typecheck`; the code stays plain JavaScript. `npm run deadcode` runs knip, which fails on unused files, exports, and dependencies: delete them rather than ignoring them.

## Workflow

- `main` is the source of truth. Every change reaches it through a PR, by the steps in "Shipping a change" below.
- Never push to another session's branch, but for one the owner's handoff prompt names once the session that had it has stopped.
- Run each command so it needs no approval: one command per call, from the repo's root, where every session starts. Never start with `cd`, never join `cd` to a `git` command, and never pipe or chain after a command `.claude/settings.json` allows, like the beta force-push. When a command still asks, add it to the allow list in `.claude/settings.json` in the same PR if it's safe for any session to run, or say why it asks.
- Refer to PRs by number, not branch.
- A finding left out of a PR, or a bug that isn't the PR's, goes in an issue, as the `ship` skill says; planned work doesn't.
- Start every PR title with a type. The squash merge carries it to `main`, where it sets the next version of each Worker it changes, and CI's `title` job checks it (`findTitleProblem` in the root's `worker/release.mjs`). Use `feat:` for something new to see or do (minor), `fix:` for fixes and polish (patch), `refactor:` for code the Worker runs with no visible change (patch), `build:` for dependencies, the build, and the deploy (patch), and `docs:`, `test:`, `ci:`, or `chore:` for changes the deploy skips (no version). Add `!` after a type that releases, as in `feat!:`, for a major change: a new address, lost data, or something that's gone; the `ship` skill says how it reaches each Worker.
- Each app has a beta channel, a second Worker the `beta` branch deploys, which the `beta` skill says how to use. `beta` is a scratch branch: never commit to it or open a PR from it.
- A red change is one only the owner's phone can test: `.claude/rules/red-change.md` says what makes one, and the `beta` skill how it ships.
- `npm run rollback`, `set-app-key`, `set-access-code`, `set-page-host`, `set-email-key`, and `set-rp-id` change the live Workers: run each only as `.claude/rules/tooling.md` says.
- The repo is public. Never commit secrets, keys, access codes, account IDs, real Worker addresses, subdomains, page hosts, or personal data; use placeholders in tests and docs: `example` or `example-subdomain` for a Worker's subdomain and `k3y` or `<key>` for a page's key, which the root's `tests/no-secrets.test.js` tells from a real one, failing on any real one in a tracked file. Nothing a change logs or posts where the public can read it, like a workflow's log or an issue, carries any of these either.
- The Cloudflare tokens live only in the cloud environment's API credentials and the repo's `production` and `beta` GitHub environments, each environment's limited to its channel's Workers and usable only from its channel's branch, so a branch on beta can't change the live apps. Never ask for one in chat or put one in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never point tests at the real page.
- When unsure, do what best serves the intent of the work, and confirm with the user.

### Shipping a change

Follow these steps in order, with the `ship` skill loaded, which adds to most of them. When a step says to go back to an earlier step, continue in order from there.

1. Fetch `main` and start your branch from it, or, for a stacked PR (step 12), from the branch of the PR it builds on. If the branch's last PR has merged, reset the branch to `origin/main` first.
2. The Git pre-push hook checks unpublished commits with `npm run lint`, `format:check`, `typecheck`, `deadcode`, and `test`. Bypass checks only for your own branch's handoff push after the context-limit stop, following its message. Run the browser specs that cover what you changed, each with `npx playwright test <file>`. Name each spec that exercises the change, a change to shared code too, found by searching the tests for the module or what it draws; never pass a folder. Don't run `npm test`, `npm run test:browser`, or `npm run check` yourself: the hook runs the Node tests, and CI runs them and the browser tests a change reaches on every push. If anything fails, fix it and run it again. Repeat until it passes. Never push failing work except for that handoff.
3. Commit, push, and open a draft PR into `main`, or a stacked draft PR into the branch it builds on. If the PR is already open, the push updates it. Merge `main` into your branch only for step 4's conflicts, or as the `ship` skill says for a red or stacked PR, since CI and Trusted review read the PR merged into `main`. Mark it ready for review once step 2 passes and you've read its whole diff against `main`, which is when Trusted review reviews it. If `git diff --text --no-textconv --no-ext-diff --no-renames origin/main... | node worker/red-change.mjs` says the change is red, ship it by the `beta` skill's steps for one.
4. Check whether the PR has merge conflicts with its base branch. GitHub runs no CI on a PR with conflicts, so waiting on one would never end. If it has them, merge the base branch into your branch, resolve the conflicts, and go back to step 2. If resolving a conflict would drop behavior from either side, resolve it in the way that best serves the spirit of both changes, and confirm with the user.
5. Wait until every CI job on the PR's latest commit has finished. The `check` job is the one that must pass; it fails whenever any other CI job fails. Each time you look while waiting, and whenever no CI run has started on the latest commit a few minutes after the push, go back to step 4 first, since another PR may have merged into `main` and left this one in conflict.
6. If a CI job failed, read its log and reproduce the failure locally. Fix it and go back to step 2. If you can't reproduce or fix it, tell the user which job failed, what its log says, what you tried, and what you recommend.
7. Trusted review reads the PR by the root's `REVIEW.md` as `main` has it. After the first review, it reads only what changed since the last full read in files the PR still changes. Answer its findings as the `steward` skill says. Add the `review` label to the PR, which asks Trusted review to review it again, only when the `steward` skill says to. A push alone starts no review, and `check` fails on a ready PR until a review passes on the code that merges, the PR merged into `main`. `main` merges a PR only once every thread on it is resolved.
8. Squash-merge the PR once all of these are true: `check` passed on the latest commit, the PR has no merge conflicts, every review thread is resolved, and its base is `main`. If GitHub refuses the merge, go back to step 4.
9. Don't deploy. Merging starts the Deploy workflow at once, and CI on `main`.
10. Read the Deploy runs for the merge commit as the `ship` skill says, and tell the user what went live.
11. Run `npm run deploy:api` yourself only when step 10 found no successful deploy and the user agrees, following `.claude/rules/tooling.md`'s session verification requirements. Say why the automatic deploy didn't happen and recommend whether to deploy by hand. Never deploy any other way, but for a new league's sandbox Worker (the `add-league` skill).
12. A PR does one thing the owner could name in a sentence, and the `ship` skill says how to keep it to that and when to stack.

## Building and fixing

### Both apps, every place

- A fix or design change applies to both apps, and to every view, sheet, and theme where the same thing shows, unless the owner names one app.
- When only one app can have it now, build it in `shared/` so the other can add it later.
- When adding to one app something the other already has, reuse the other app's values, like logo sizes and spacing, and leave the other app untouched.

### When something is wrong

- When fixing a bug, look for the same bug in all apps and in every view, sheet, and theme, and fix those in the same PR. Say what else you checked.
- When a bug reaches production or beta, the PR also says how it got there and why no test caught it, and adds the test or lint rule that would have. Prefer a test or lint rule over a written rule, which agents can forget.
- Say a bug is fixed only once you've reproduced it and seen the fix work.
- Ask for a Diagnostics report rather than guessing.
- While chasing a bug, test one idea at a time and say what each one showed. Never stack guesses in production.
- Once a bug is fixed, take out any attempted fixes that didn't help, and put back anything removed that turned out not to be the cause.
- When something replaces an old system, delete the old code in the same PR.

### What the apps should feel like

- Smooth above all. Nothing flickers, jumps, or flashes on open, return, reload, or redraw, and a new release arrives without anyone swiping the app closed.
- Follow general best practices for web development code and app UI.
- Simple beats configurable. Pick good defaults rather than adding settings.
- Build with mature web features that work in every browser, Safari first.

## Writing

README and anything user-facing: be clear, direct, and concise.

In this file, the rule files, the skills, and `REVIEW.md`, keep each sentence to 60 words or fewer, and write a long catalog as a list. Keep guidance paragraphs short enough for an agent to read them whole. Keep this file to at most 16,000 characters, so a rule only some work needs goes in its rule file or skill (the root's `tests/agents-lines.test.js`). Each rule file's `paths` match files in the repo (the root's `tests/rule-files.test.js`).
