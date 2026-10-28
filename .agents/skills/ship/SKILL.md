---
name: ship
description: "What the Shipping a change steps in AGENTS.md leave out: major bumps, issues for what's left out, a review of your own before Trusted review's, CI's review, which PRs end at the merge, and one thing a PR, stacked or not"
---

# Shipping a change

This skill holds what "Shipping a change" in AGENTS.md leaves out, most of it under the step it belongs to, numbered as that list numbers them.

## PR titles

- A `!` is major for every Worker the deploy changes, or only the one a scope names, as in `feat(mlb)!:` (`findScopeProblem` in the root's `worker/release.mjs`). A PR that mixes kinds takes the biggest bump.
- Don't spend time curating commit history. Squash merges make it irrelevant.

## Status

- After each push, and whenever the owner asks how a PR is going, list the steps left before the phone and before the merge, each with what it waits on, like CI, Trusted review, beta, a conflict, or the owner's `phone-ok`.
- Say a change is ready to try only once step 7 of the `beta` skill's "To put a PR on beta" says so.

## Issues

- An issue holds one thing a PR could do, as AGENTS.md's step 12 says, a finding or bug left out of a PR, written so a session can build it with no other prompt.
- Open one in the turn the work is left out: a finding step 12 leaves out of a PR, or a bug that isn't this PR's, like one seen on beta. A finding declined as not worth its code gets no issue: the reply on its thread says why.
- First search the open issues, and comment on one that already covers the work rather than open a second.
- Write it under these headings:
  - Background: what's wrong or missing, where it was found, and why it was left out.
  - What to build, with the files it touches.
  - Tests: what each new test checks.
  - Type: the PR title's type, and whether the change is red, by `.claude/rules/red-change.md`.
- An issue that waits on another PR names it in its first line, as in "Waits on #671."
- Open it with `gh issue create --title '<title>' --body-file <file>`, or with GitHub's issue tool where a session has no `gh`, which `.claude/settings.json` allows without asking. When a session still can't, it gives the owner that command to paste, with the brief in a heredoc.
- Before building any change, check nothing already does it: that an issue still holds on `main`, and whether an open PR, or one merged since the work was planned, touches the same files or does the same thing.
  - When an issue no longer holds on `main`, close it as not planned, or as a duplicate of the one that covers it, saying why.
  - When a PR already covers the work, don't build it: comment on that PR, or close the issue as a duplicate, saying which PR covers it.
  - When a PR covers only part of it, build on that PR or stack on it, as step 12 says.
- The PR that does the work says "Fixes #N" in its description, which closes the issue as the PR merges into `main`. A PR that does only part of it says "Part of #N" and comments on the issue with what's left.
- A PR's description names work outside it only by its issue.
- Flaky browser tests, each app's outage and no-code issues, each service's outage issue, and the production deploy's failure issue belong to their workflows, which find each by its title and read the flaky table back from its body: never edit or close one by hand.
- No labels, milestones, or projects on an issue. Labels like `beta` and `phone-ok` are for PRs.

## The beta channel

- Load the `beta` skill to put a PR on beta, to wait for it, or to tune a design on the phone.

## Red changes

- Load the `beta` skill for how a red change ships.

## Step 3: a review of your own first

- Before marking a PR ready, have a fresh subagent review the PR's diff against its base by the root's `REVIEW.md` as `main` has it (`git show origin/main:REVIEW.md`). Hand it the diff and that `REVIEW.md`, not your own reading of the change, so it reads the change as Trusted review will.
- Before a push that answers Trusted review's Important or Unsure findings, hand one the same, plus the PR's review threads and the commit Trusted review last read. Have it raise only what the PR changed since that commit, in files the PR still changes, and nothing a thread already settled.
- Fix each finding that holds up. Open an issue for one outside the PR's one thing, as step 12 says, and tell the user why you dropped any other. A finding caught here costs no round of CI and Trusted review.
- Each of these reviews runs once a round: its fixes go to Trusted review, not to another review of your own. Where a session can't start a subagent, say so to the user and go on.

## Step 4: conflicts

- A merge to `main` that leaves an open PR in conflict comments on it (the root's `worker/flag-conflicts.mjs`), which wakes a session watching it.

## Step 7: Trusted review and CI's join

- The Trusted review workflow reviews a PR once it's ready, when it's opened ready or marked ready, and again only when the `review` label asks, which the steward skill says when to add. Each review after the first reads only what changed since the last one that finished (the root's `worker/plan-review.mjs` and `worker/judge-review.mjs`). If the summary names something it couldn't judge, tell the user.
- A finished review doesn't always wake the session, so after marking a PR ready or adding the `review` label, stay subscribed to the PR and schedule a check-in about 30 minutes out where the session can. When it fires, carry on from step 4 of "Shipping a change", scheduling another while the review or `check` still runs.
- When a Trusted review job or CI's `review-join` fails, load the `review-failures` skill.

## Step 8: a red PR

- Load the `beta` skill before merging a red PR.

## Steps 9 and 10: the deploy and its log

- A PR typed `docs:`, `test:`, `ci:`, or `chore:` deploys nothing, since CI's `title` job holds those types to files the deploy skips (`findTypeProblem` in the root's `worker/release.mjs`). Its work ends at the merge: tell the user it merged and that nothing deploys, and skip steps 9 to 11.
- For any other PR, load the `deploy-log` skill, which says how the deploy runs and what each line of its log asks of you.

## Step 12: one thing a PR, and stacked PRs

- What a session is asked to do in one request is one thing for its PR, however many parts it has. Split off only a part that would wait on something the rest doesn't, as the bullet on red and non-red parts below does, and review findings left for later, as the bullet on them says.
- A review finding outside the PR's one thing that AGENTS.md's step 12 names becomes an issue, linked from its thread, not a commit on the PR. The same problem in the other app, or in another view, sheet, or theme, is part of the one thing, and is fixed on the PR.
- A PR built to fix review findings left for later takes findings that make one thing, like one area's or about five sharing a cause, never a whole review's.
- When a change has red and non-red parts and the non-red ones work without the red, split them, so the non-red work never waits for the owner's phone. A red PR that needs the non-red one's changes stacks on it, and one that stands alone goes into `main` on its own.
- A PR that needs another PR's unmerged changes doesn't wait for it: stack it. Start its branch from that PR's branch, open it into that branch, so its diff and review show only its own changes, and name the PR it builds on in its description. Whenever the earlier PR's branch changes, merge it into the stacked branch. Once the earlier PR merges, change the stacked PR's base to `main` if GitHub hasn't, merge `main` into its branch, and go back to step 2 for it. That merge conflicts wherever the stacked PR changed lines the earlier one did, since `main` has the earlier PR only as its squash: keep the stacked branch's side of those, and resolve any other conflict as step 4 says. Never merge a PR into another PR's branch: a stack merges into `main` one PR at a time, earliest first.
