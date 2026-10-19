# Reviewing a pull request

What a review of a pull request here reads, looks for, and reports.
AGENTS.md holds the rules the code keeps; this file says how to check a change against them.

## Read all of it

- Read in full every diff your review hands you:
  the whole change in a first review and in the last read of it,
  and what the pushes since the last finished review changed in a review of a later push.
  A recorded fixture (`tests/fixtures/`) or `package-lock.json` needs only its name and size,
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
   empty and missing values (a `null` or `NaN` that reaches the screen),
   a game whose teams aren't known yet, doubleheaders, the playoffs, a season's first and last day,
   a time zone on each side of UTC, a read that fails or answers late,
   two reads that finish out of order, and a listener or timer that's never removed.
2. **One fact, one rule, one place.**
   AGENTS.md: "A rule or a limit two places share lives in one place",
   and "A fact two places show ... comes from one read, kept in one document".
   Flag a new constant, helper, wording, or rule that copies one the repo already has,
   and logic one app adds that the other already has, which belongs in `shared/`.
3. **Both apps, every place.**
   AGENTS.md: "When fixing a bug, look for the same bug in all apps and in every view, sheet, and theme, and fix those in the same PR."
   Check the other app and the other views for what the change fixes or changes.
4. **Budgets and outside services.**
   Count the requests a run makes against Cloudflare's per-run cap, and check the reading stays lean ("Read ahead of the page" in AGENTS.md).
   Count the work a key press does over a whole season.
   Never trust a league's feed or Claude to answer in the shape the code expects without checking it.
   A link from a feed reaches an `href` only through `isWebAddress`.
5. **Security.**
   Text reaching the page without the `html` template, anything that weakens the `APP_KEY` check or the access gate,
   and a secret, key, account ID, page address, or access code in code, docs, logs, issues, or a Diagnostics report.
   In a workflow: untrusted text (a title, branch name, or comment) put into `run:` through `${{ }}`,
   wider `permissions` than the job needs, an action not pinned to a commit,
   and a pull request's own code run with a secret.
   A change to the review itself, its jobs in `.github/workflows/ci.yml`,
   `worker/plan-review.mjs`, `worker/judge-review.mjs`, `worker/post-review.mjs`,
   `worker/review-context.mjs`, or `worker/review-state.mjs`, or to a guard test,
   that lets less through is Important, naming what it no longer catches,
   since the pull request's own copy of them runs its review.
6. **Red changes.**
   A property that gives a part a layer of its own or changes how it takes a touch,
   like `-webkit-touch-callout`, that `worker/red-change.mjs` doesn't list yet.
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
    AGENTS.md or README.md describing what the code no longer does, a comment naming a file that's gone,
    and a comment that tells history or restates the code.
11. **Any other rule in AGENTS.md** the changed lines break.

Skip what lint, Prettier, TypeScript, knip, and the repo's guard tests already catch, and matters of taste.
Don't run the tests: CI runs them all.

## How to report

In CI, each area's reviewers each look for one kind of problem
(in the last read of the whole change, one reviewer an area looks for every kind)
and list every problem they find,
a checker confirms each against the code before anything is posted and merges repeats,
a check across areas, when there's more than one, names repeats across them and adds what spans them,
and a step posts what they confirmed or left unsure.

- Report every problem you find, not a sample, each as one finding that names every place it shows,
  in both apps too, rather than one finding for each place.
  Include one you're unsure of, with your confidence, rather than leaving it out.
- Before a finding is posted, check it by reading more of the code:
  trace the path from a real caller or input to what goes wrong, and see what the base did.
  If it would matter and still can't be settled, post it as **Unsure** with what would settle it.
- Each finding goes on the line it's about, the first place's for one that names several.
  Say what is wrong, when it goes wrong (the input or state that shows it), and how to fix it, in a few sentences.
- Start each with its weight:
  **Important** for a bug, meaning a wrong result someone can see, wrong data kept, or a failure,
  for a security hole, or for a broken AGENTS.md rule;
  **Nit** for something worth fixing that doesn't block;
  **Pre-existing** for a problem in code the change didn't make worse.
- An **Important** or **Unsure** finding is posted on its line, a thread of its own.
  A review's **Nit** and **Pre-existing** findings are posted together in one comment, a checklist on the file of the first,
  each item naming its file and line, so they're one thread to answer and resolve.
- The numbered items above are never matters of taste:
  a rule now in two places, a leftover, or a doc the change makes wrong is a finding whenever the code shows it.
- Read the pull request's threads first.
  Never raise again what a thread already raised, an item of a checklist of Nits too, whether it was fixed, answered, or left open,
  unless its answer is wrong or a fix it claims didn't hold, and then say so.
- No praise.
- The review ends with one summary comment: the commit reviewed, what it read, the findings by weight,
  how many cases the checkers turned down, how many of the changed files were read in full out of how many,
  each one that wasn't and why, and anything read but not judged.
  In CI, a step writes it from the findings posted, what each reviewer actually read, and what each said it couldn't judge.
