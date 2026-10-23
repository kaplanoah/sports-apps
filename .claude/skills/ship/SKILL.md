---
name: ship
description: "What the Shipping a change steps in AGENTS.md leave out: major bumps, issues for what's left out, the beta channel, red changes and phone-ok, CI's review and its failures, the deploy's log, and one thing a PR, stacked or not"
---

# Shipping a change

This skill holds what "Shipping a change" in AGENTS.md leaves out, most of it under the step it belongs to, numbered as that list numbers them.

## PR titles

- A `!` is major for every Worker the deploy changes, or only the one a scope names, as in `feat(mlb)!:` (`findScopeProblem` in the root's `worker/release.mjs`).
  A PR that mixes kinds takes the biggest bump.
- Don't spend time curating commit history.
  Squash merges make it irrelevant.

## Issues

- An issue holds one thing a PR could do, as AGENTS.md's step 12 says, a finding or bug left out of a PR, written so a session can build it with no other prompt.
- Open one in the turn the work is left out: a finding step 12 leaves out of a PR, or a bug that isn't this PR's, like one seen on beta.
  A finding declined as not worth its code gets no issue: the reply on its thread says why.
- First search the open issues, and comment on one that already covers the work rather than open a second.
- Write it under these headings:
  - Background: what's wrong or missing, where it was found, and why it was left out.
  - What to build, with the files it touches.
  - Tests: what each new test checks.
  - Type: the PR title's type, and whether the change is red, by `.claude/rules/red-change.md`.
- An issue that waits on another PR names it in its first line, as in "Waits on #671."
- Open it with `gh issue create --title '<title>' --body-file <file>`, or with GitHub's issue tool where a session has no `gh`, which `.claude/settings.json` allows without asking.
  When a session still can't, it gives the owner that command to paste, with the brief in a heredoc.
- Before building from an issue, check it still holds on `main`; if it doesn't, close it as not planned, or as a duplicate of the one that covers it, saying why.
- The PR that does the work says "Fixes #N" in its description, which closes the issue as the PR merges into `main`.
  A PR that does only part of it says "Part of #N" and comments on the issue with what's left.
- A PR's description names work outside it only by its issue.
- Flaky browser tests, each app's outage and no-code issues, and each service's outage issue belong to their workflows, which find each by its title and read the flaky table back from its body: never edit or close one by hand.
- No labels, milestones, or projects on an issue.
  Labels like `beta` and `phone-ok` are for PRs.

## The beta channel

- Each app has a beta channel: a second Worker, `<app>-app-beta`,
  from the `[env.beta]` in its `wrangler.toml`, with its own store,
  key, and address, whose page says beta on the Home Screen and in settings' version line (the root's `worker/build.mjs`).
  Its page also shows a tag beside the app's name, with the commit it runs and how long ago that went live
  (`writeRelease` in the root's `worker/page-files.mjs`, its age drawn by `shared/page/draw-channel-tag-age.js`).
  A push to the `beta` branch deploys it at once, with the same checks and rollback as `main`'s deploy,
  but only when the pushed commit is the head of the PR that holds beta (the root's `worker/beta-claim.mjs`).
  Each of `deploy:api`, `rollback`, `set-app-key`, `set-access-code`, `set-page-host`, `set-email-key`, and `set-rp-id` takes `--channel beta`.
- Beta holds one PR at a time, while the owner tests it on the phone.
  A PR claims beta with the `beta` label, and of the open PRs labeled `beta`, the one labeled first holds it.
  A PR waiting for beta has the `beta-wait` label, and the one labeled first has waited longest.
  On its watched same-repo PR events and each merge to `main`, the `Beta` workflow (`.github/workflows/beta.yml`) takes `beta` off a PR that closed, was pushed after its label, or got `phone-ok` after it,
  and off every PR but the one that holds beta, which it puts in line with `beta-wait`.
  Once beta is free, it comments on the PR that has waited longest, which wakes its session: "Beta is free, and this pull request has waited longest."
  A claim has no time limit, since the owner is the only tester.
  The deploy check reads labels live, so it sees a label change at once, even on a PR in conflict with `main`.
  GitHub starts no PR workflow for one in conflict, even after a push that leaves it in conflict.
  The workflow's label fixes and its comment wait for the next Beta run,
  which a merge to `main`, or a watched event on any same-repo PR not in conflict, this one included, starts.
- Change a PR's labels one at a time, never by setting its whole list, which would drop `phone-ok` or `review`:
  `gh pr edit <number> --add-label beta` or `--remove-label beta`, and the same for `beta-wait`.
  See who holds beta with `gh pr list --label beta --state open`, and who waits with `gh pr list --label beta-wait --state open`.
  Where a session has no `gh`, GitHub's issue tool sets a PR's whole label list, so read its labels just before and write them back with only the one change.
- To put a PR on beta:
  1. Merge `main` into its branch and push the branch, so the commit the owner tests is the one that merges,
     since a PR merges while behind `main` as long as it has no conflicts.
     A push gives beta up, so it comes before the claim.
  2. Take `beta` off the PR if it still has it from before that push, since adding a label a PR already has changes nothing.
  3. Add `beta` to the PR.
  4. Confirm the PR holds beta: it does once it's the only open PR labeled `beta`.
     While another still has it, wait a minute for the `Beta` workflow and look again.
     If the workflow took `beta` off the PR, beta is held: see the next bullet.
  5. Take `beta-wait` off the PR if it has it, only now: taking it off first would tell the next in line, who would then lose the race.
  6. Push to beta: `git push -f origin <branch>:beta`.
  7. Wait for that push's Deploy run to say `worker check: ok` for each Worker, and tell the owner to use the beta app on the Home Screen.
     Name the commit the beta tag at the top of the app should show, so a build swapped since is plain to see.
- A design round tuned on the phone opens with an app's `page/tuning-round.json`,
  which names each CSS variable on `:root` to tune,
  with a slider's `min`, `max`, `step`, and `unit`, or a list of `options`, as `readRound` in `shared/page/tuning-round.js` checks.
  It tunes only a variable that's the same in every theme and at every width, since the panel reads each start once, as the page loads.
  Beta's build writes it into the page with the tuning panel, and production's leaves both out (the root's `worker/tuning-files.mjs`).
  The owner pastes back what the panel's Copy gives, and the PR sets those values in its stylesheets and deletes the round file in the same push.
- If beta is held, add `beta-wait` to the PR if the workflow hasn't, stay subscribed to the PR, and stop.
  The last message to the owner names the PR holding beta, with its link,
  and says the owner can say "put this on beta now" to take it.
  When the workflow's comment says beta is free, put the PR on beta from step 1.
- When the owner says "put this on beta now", take `beta` off the PR that holds it and add `beta-wait` to it, which puts it at the back of the line,
  then put this PR on beta from step 1.
  This is the only time a session changes another PR's labels, and only on the owner's word.
  If the workflow told another waiter before this PR took beta, it comments on that waiter that it stays first in line,
  or, when that waiter claimed beta meanwhile, takes `beta` off it.
  Either way, the workflow tells it again once beta is free.
- A PR gives beta up as it closes or merges, as its branch is pushed, and as the owner adds `phone-ok`, and the workflow takes the label off.
  Take `beta` off yourself when going back to work without a push yet, as when the owner's test found a problem,
  and when the owner is done testing a PR that isn't red, which never gets `phone-ok`.
  Take off both `beta` and `beta-wait` before saying the work is done.

## Red changes

- Take a red change to its branch and PR, put it on beta once its CI passes, as "The beta channel" above says,
  and stop there: tell the user what to use on the phone, and wait, keeping to steps 4 to 6 of AGENTS.md's list meanwhile.
  Its PR stays a draft while the owner tries its design on beta:
  CI tests a draft, and beta deploys it, as for any PR, but CI reviews it only once it's ready for review.
  Once the owner says the design is the one to keep, take `beta` off, since answering the review is going back to work,
  mark the PR ready for review, which starts its first full review,
  go on to step 7 and answer the review, and then put its reviewed head on beta for the owner's `phone-ok`.
  When you ask the owner to add `phone-ok`, link the PR in the same message.
  Never add `phone-ok`.
  Only the owner labels it, once they've used the change on beta, which runs `gate` again without a push and gives beta up.
  A push after the label, a merge of `main` too, holds the PR again until the owner has used that commit on beta and labeled it again,
  so put it on beta again and ask.
- One red change goes live per deploy.
  From a red PR's push to beta until it has merged and its deploy has finished, or it has closed unmerged, no other red PR merges.
  This rule outlasts the claim, which ends at `phone-ok`:
  a red PR tested on beta can merge behind `main`, so had another red PR merged first, the tested commit never had it.

## Step 4: conflicts

- A merge to `main` that leaves an open PR in conflict comments on it (the root's `worker/flag-conflicts.mjs`), which wakes a session watching it.

## Step 7: what CI's review does

- CI reviews a PR once it's ready, when it's opened ready or marked ready, and again only when the `review` label asks, which the steward skill says when to add.
  Each review after the first reads only what changed since the last one that finished (the root's `worker/plan-review.mjs` and `worker/judge-review.mjs`).
  If the summary names something it couldn't judge, tell the user.
- If `review` fails, read its summary and the log of the failed job, an area's `find` under `review-area`, or `review-across` or `review-post`.
  An area's `find` and `review-across` show the action's own errors but not each try's turns and tool calls, since they'd be public,
  and `review-post` shows the errors of the root's `worker/post-review.mjs`.
  If an area's `find` or `review-across` stopped before Claude started, like an install that timed out, re-run the failed jobs once yourself.
  Otherwise don't reproduce it locally or re-run it: each reviewer already tried twice, and the check across areas once.
  If `review-post` failed, re-run the failed jobs once yourself, since it starts no Claude and posts each finding only once.
  Tell the user what the log shows: an invalid or expired Claude credential secret, Claude unreachable,
  an error from `worker/post-review.mjs`, like a GitHub API call that failed, or a re-run that failed too.
  `check` can't pass until the job does.

## Step 8: a red PR

- Merge a red PR only once `check` and `phone` passed with the `phone-ok` label on it: the label is the owner's sign-off from beta and their go-ahead to merge,
  so don't ask again, before the merge or once it's live.
  Until then, tell the user it's ready and wait.
  An OK in chat never stands in for the label.
  Merge it yourself: the owner doesn't.
- `check` holds the code that merges, the PR merged into `main` as `main` is then,
  so when `main` moved after the PR's last review, the run `phone-ok` starts fails `check` for want of a review.
  Answer it as the steward skill says for a `check` with no review on the code that merges.

## Step 9: the deploy

- When the PR's CI passed on exactly the code `main` now has (the root's `worker/find-passed-ci.mjs`),
  which it did if the PR was up to date with `main` as it merged,
  that first Deploy run deploys, and CI on `main` skips the checks it already ran; otherwise the Deploy run that follows CI on `main` does.
  Either runs the root's `worker/deploy.mjs`, which deploys each Worker, each service's before any app's, and rolls back any new version that doesn't answer,
  or whose page doesn't draw (the root's `worker/check-page.mjs`).
  Each line of the deploy log starts with its Worker's name, so read step 10's results for each Worker.

## Step 10: reading a deploy's log

Wait for the Deploy runs for the merge commit to finish, then read their logs and do what matches:

- The first says "No pull request's CI passed on exactly this code": the deploy waits for CI on `main`.
  Read the next Deploy run's log.
- It says "worker check: ok": the new version is live.
  Tell the user.
  A line before it saying "page check: skipped" names a page the deploy couldn't open, like one whose secrets are missing or out of date,
  and one saying "page check: ok, but" a page that opened without the code its environment holds:
  tell the user that too.
- A service's lines say "health check: ok": every app that reports it says it answers at the uploaded commit,
  or at its own live commit when the run didn't change the service.
  Saying "health check: skipped" because "no app reaches" it yet, no app's live version binds it, so the service went unchecked:
  tell the user, since the `Watch apps` workflow is the first to read it.
- It says "The service didn't answer as the live version": the run failed without rolling back the unchanged service.
  Inspect the service and the reporting apps' health, and tell the user what didn't answer.
- It says "Nothing the Worker runs changed": the merge didn't need a deploy, or the first Deploy run already deployed it.
  Tell the user which.
- It says "has moved on" and "whose deploy covers": another merge landed first, and CI passed on it, so its Deploy run covers this one.
  Read that run's log instead.
  Saying "hasn't passed on it" instead, it deploys this merge while the newer one's CI is still to pass, so read on in this run's log.
  Saying "couldn't be asked", it deploys this merge because GitHub couldn't say how CI went on the newer one, so read on in this run's log too.
- It says "which already has": a newer merge's deploy went live first, and covers this one.
  Read that run's log instead.
- The run was skipped:
  CI failed on `main`.
  Read the CI log, fix the failure in a new PR, and start again at step 1.
- A run for a push to beta says "so nothing was deployed to beta": the pushed commit isn't the head of the PR that holds beta,
  or GitHub couldn't say which PR does, so beta keeps the build it had.
  The line names the PR holding beta and when it took it, or else says no PR holds beta or GitHub couldn't say.
  Put the PR on beta by the steps under The beta channel above.
- It says "No CLOUDFLARE_API_TOKEN": the channel's environment has no Cloudflare token, so nothing was deployed.
  Tell the user.
- The run failed: read the log.
  If it says "the earlier version is live again", the Worker rolled back and is unchanged.
  Tell the user what failed and recommend a fix.

## Step 12: one thing a PR, and stacked PRs

- A review finding outside the PR's one thing that AGENTS.md's step 12 names becomes an issue, linked from its thread, not a commit on the PR.
  The same problem in the other app, or in another view, sheet, or theme, is part of the one thing, and is fixed on the PR.
- A PR built to fix review findings left for later takes findings that make one thing, like one area's or about five sharing a cause, never a whole review's.
- When a change has red and non-red parts and the non-red ones work without the red, split them, so the non-red work never waits for the owner's phone.
  A red PR that needs the non-red one's changes stacks on it, and one that stands alone goes into `main` on its own.
- A PR that needs another PR's unmerged changes doesn't wait for it: stack it.
  Start its branch from that PR's branch, open it into that branch,
  so its diff and review show only its own changes, and name the PR it builds on in its description.
  Whenever the earlier PR's branch changes, merge it into the stacked branch.
  Once the earlier PR merges, change the stacked PR's base to `main` if GitHub hasn't, merge `main` into its branch, and go back to step 2 for it.
  That merge conflicts wherever the stacked PR changed lines the earlier one did,
  since `main` has the earlier PR only as its squash: keep the stacked branch's side of those, and resolve any other conflict as step 4 says.
  Never merge a PR into another PR's branch: a stack merges into `main` one PR at a time, earliest first.
