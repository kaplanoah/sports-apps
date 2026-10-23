# Reviewing a pull request

What a review of a pull request here reads, looks for, and reports.
AGENTS.md and the rule files in `.claude/rules/` hold the rules the code keeps; this file says how to check a change against them.

## Read all of it

- Read in full every diff your review hands you:
  the whole change in a first review,
  and what the pushes since the last finished review changed in files the pull request still changes, in a review asked for after them.
  A file restored to the base's copy has no pull request change left to review and is intentionally left out, including when resolving a merge conflict accepts that copy.
  A recorded fixture (`tests/fixtures/`), `package-lock.json`, a binary file,
  or a drawing or minified library a tool wrote needs only its name and size,
  and whether a test reads it.
- Read past the diff: each caller of a function the change touches,
  and each place that holds a copy of what it changes.
  Search for the name, the constant, or the words before taking a new one as the only one.
- A finding can be in a line the change didn't touch, when the change makes that line wrong.
  Put it on the nearest changed line and name the line it's about.
- Review against the pull request's own base, which for a stacked pull request isn't `main`.
- Say what you didn't read.
  Never say a change has no issues when you read only part of it.

## What to look for

In order of what has mattered here.

1. **Bugs.** State and edge cases above all:
   - empty and missing values (a `null` or `NaN` that reaches the screen)
   - a game whose teams aren't known yet
   - doubleheaders
   - the playoffs
   - a season's first and last day
   - a time zone on each side of UTC
   - a read that fails or answers late
   - two reads that finish out of order
   - a listener or timer that's never removed
2. **One fact, one rule, one place.**
   AGENTS.md: "A rule or a limit two places share lives in one place",
   and "A fact two places show ... comes from one read, kept in one document".
   Flag a new constant, helper, wording, or rule that copies one the repo already has,
   and logic one app adds that the other already has, which belongs in `shared/`.
3. **Both apps, every place.**
   AGENTS.md: "When fixing a bug, look for the same bug in all apps and in every view, sheet, and theme, and fix those in the same PR."
   Check the other app and the other views for what the change fixes or changes.
4. **Budgets and outside services.**
   Count the requests a run makes against Cloudflare's per-run cap, and check the reading stays lean ("Read ahead of the page" in `.claude/rules/worker.md`).
   Count the work a key press does over a whole season.
   Never trust a league's feed or Claude to answer in the shape the code expects without checking it.
   A link from a feed reaches an `href` only through `isWebAddress`.
5. **Security.**
   Text reaching the page without the `html` template, anything that weakens the `APP_KEY` check or the access gate,
   and anything AGENTS.md's public-repo bullet keeps out of the repo, wherever it shows: code, docs, logs, issues, or a Diagnostics report.
   In a workflow: untrusted text (a title, branch name, or comment) put into `run:` through `${{ }}`,
   wider `permissions` than the job needs, an action not pinned to a commit,
   and a pull request's own code run with a secret.
   A change that lets the review catch less is Important, naming what it no longer catches,
   whether the review runs from main's copy or the pull request's own.
   Its controls include:

   - the jobs in `.github/workflows/ci.yml` and `.github/workflows/review-area.yml`
   - the jobs in `.github/workflows/review.yml` and `.github/workflows/trusted-review-area.yml`
   - `worker/plan-review.mjs`
   - `worker/judge-review.mjs`
   - `worker/post-review.mjs`
   - `worker/review-context.mjs`
   - `worker/review-state.mjs`
   - `worker/rule-files.mjs`
   - `worker/trusted-review.mjs`
   - `worker/review-data.mjs`
   - `worker/review-repository.mjs`
   - their imports, like `shared/page/escape-pattern.js`
   - guard tests

   A change to `worker/review-git.mjs`, the reviewer's only command, that lets it run more is Important,
   naming what the reviewer could newly read or write.
   So is a change to the red-change gate that lets less through,
   its `gate`, `phone`, or `check` job in `.github/workflows/ci.yml`,
   `worker/red-change.mjs`, or `worker/red-change-styles.mjs`,
   naming what it no longer holds for the owner's phone,
   since the pull request's own copy of those jobs runs.
   So is a change to which tests a pull request runs, or which of their failures fail it,
   that runs or fails fewer: its `scope` and `burn-in` jobs in `.github/workflows/ci.yml`,
   `worker/browser-scope.mjs`, `worker/burn-in-specs.mjs`, and the modules they import to decide,
   like `worker/deploy-scope.mjs` and `worker/package-imports.mjs`, and `worker/judge-burn-in.mjs`.
   The finding names which browser tests or burn-in specs no longer run or fail,
   since the pull request's own copy of those jobs and modules picks its own tests.

6. **Red changes.**
   A property that gives a part a layer of its own or changes how it takes a touch,
   that `worker/red-change-styles.mjs` doesn't list yet.
7. **Tests.**
   AGENTS.md: "Every change to behavior comes with tests that fail without it, in the same PR."
   Flag a change to behavior whose tests would still pass with it reverted.
   Flag a browser test that would pass only some of the time:
   one that reads the page right after an action without waiting, with `expect` or `expect.poll`, for what the action shows;
   one that depends on how fast the machine is; or one that measures while a press, hover, transition, or scroll may still be going.
8. **Leftovers.**
   AGENTS.md says the review flags what earlier rounds of a change left behind:
   values no longer chosen, a setting kept only to compare, a case that can no longer happen,
   a name for an earlier version, a branch kept for data the store no longer holds,
   and old code next to what replaced it.
9. **Search.**
   Each place a change adds is searchable from the app's `page/js/search-pages.js` and named in `COVERAGE`,
   or is left out for a reason a fan would agree with, and a place it removes leaves search too.
10. **Docs and comments the change makes wrong.**
    AGENTS.md, a rule file, a skill, or README.md describing what the code no longer does, a comment naming a file that's gone,
    and a comment that tells history or restates the code.
11. **Any other rule in AGENTS.md or a rule file** the changed lines break.

Skip what lint, Prettier, TypeScript, knip, and the repo's guard tests already catch, and matters of taste.
Don't run the tests: CI runs them all.

## How to report

In CI, one reviewer an area looks for every item above and lists every problem it finds.
One check across every area, one area too, confirms each against the code before anything is posted,
merges repeats, weighs each, and adds what spans areas,
and a step posts what it confirmed or left unsure.

- Report every problem you find, not a sample, each as one finding that names every place it shows,
  in both apps too, rather than one finding for each place.
  Include one you're unsure of, with your confidence, rather than leaving it out.
- Before a finding is posted, check it by reading more of the code:
  trace the path from a real caller or input to what goes wrong, and see what the base did.
  If it would matter and still can't be settled, post it as **Unsure** with what would settle it.
- Each finding goes on the line it's about, the first place's for one that names several.
  Say what is wrong, when it goes wrong (the input or state that shows it), and how to fix it, in a few sentences.
  For a finding that a rule from AGENTS.md or a rule file is broken, quote the rule, name its file, and show how the changed code violates it.
- Start each with its weight:
  **Important** for a bug, meaning a wrong result someone can see, wrong data kept, or a failure,
  for a security hole, or for a broken rule from AGENTS.md or a rule file;
  **Nit** for something worth fixing that doesn't block;
  **Pre-existing** for a problem in code the change didn't make worse.
- Each **Important** or **Unsure** finding gets a thread of its own, and the **Nit** and **Pre-existing** ones a checklist, as the root's `worker/post-review.mjs` posts them.
- The numbered items above are never matters of taste:
  a rule now in two places, a leftover, or a doc the change makes wrong is a finding whenever the code shows it.
- Read the pull request's threads first.
  Never raise again what a thread already raised, an item of a checklist of Nits too, whether it was fixed, answered, or left open,
  unless its answer is wrong or a fix it claims didn't hold, and then say so.
- No praise.
- The review ends with one summary comment: the commit reviewed, what it read, the findings by weight,
  how many of the problems the reviewers listed the check across areas turned down, how many of the changed files were read in full out of how many,
  each one that wasn't and why, and anything read but not judged.
  In CI, a step writes it from the findings posted, what each reviewer actually read, and what each said it couldn't judge.
  Each later review updates that one comment in place.
