---
name: ship
description: "What the Shipping a change steps in AGENTS.md leave out: major bumps, issues for later work, the beta channel, red changes and phone-ok, CI's review and its failures, the deploy's log, and one thing a PR, stacked or not"
---

# Shipping a change

This skill holds what "Shipping a change" in AGENTS.md leaves out, most of it under the step it belongs to, numbered as that list numbers them.

## PR titles

- A `!` after a type is major for every app the PR's deploy changes, through shared code too;
  when only one app breaks, name it, as in `feat(mlb)!:`, and the others take the type's own bump.
  A scope is only for that.
  A PR that mixes kinds takes the biggest bump.
  CI's `title` job checks it.
- Don't spend time curating commit history.
  Squash merges make it irrelevant.

## Issues

- An issue holds one thing a PR could do, as AGENTS.md's step 12 says, decided but left for later, written so a session can build it with no other prompt.
- Open one in the turn the work is left out: a finding step 12 leaves out of a PR, something the owner chose not to build yet, or a bug seen on beta that isn't this PR's.
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
- Flaky browser tests and each app's outage and no-code issues belong to their workflows, which find each by its title and read the flaky table back from its body: never edit or close one by hand.
- No labels, milestones, or projects.

## The beta channel

- Each app has a beta channel: a second Worker, `<app>-app-beta`,
  from the `[env.beta]` in its `wrangler.toml`, with its own store,
  key, and address, whose page says beta on the Home Screen and in settings' version line (the root's `worker/build.mjs`),
  and in a tag beside the app's name, with the commit it runs and how long ago that went live (`shared/page/channel-tag.js`).
  A push to the `beta` branch deploys it at once, with the same checks and rollback as `main`'s deploy.
  To use a PR's change on the owner's phone before it merges, reset `beta` to the PR's branch and push (`git push -f origin <branch>:beta`),
  wait for that push's Deploy run to say `worker check: ok` for each app, and tell the user to use the beta app on the Home Screen.
  Each of `deploy:api`, `rollback`, `set-app-key`, `set-access-code`, and `set-page-host` takes `--channel beta`.

## Red changes

- Take a red change to its branch and PR, deploy it to beta once its CI passes, as "The beta channel" above says,
  and stop there: tell the user what to use on the phone, and wait, keeping to steps 4 to 6 of AGENTS.md's list meanwhile.
  Its PR stays a draft while the owner tries its design on beta:
  CI tests a draft, and beta deploys it, as for any PR, but CI reviews it only once it's ready for review.
  Once the owner says the design is the one to keep, mark the PR ready for review, which starts its first full review,
  go on to step 7 and answer the review, and then deploy its reviewed head to beta for the owner's `phone-ok`.
  When you ask the owner to add `phone-ok`, link the PR in the same message.
  Never add `phone-ok`.
  Only the owner labels it, once they've used the change on beta, which runs `gate` again without a push.
  A push after the label, a merge of `main` too, holds the PR again until the owner has used that commit on beta and labeled it again,
  so deploy it to beta and ask.
  Merge `main` into the branch just before each deploy to beta, so the commit the owner labels is the one that merges, since a PR merges while behind `main` as long as it has no conflicts.
- One red change goes live per deploy.
  While a red change is on beta, or has merged and the owner hasn't confirmed it on the phone, no other red PR merges, and none replaces it on beta.

## Step 4: conflicts

- A merge to `main` that leaves an open PR in conflict comments on it (the root's `worker/flag-conflicts.mjs`), which wakes a session watching it.

## Step 7: what CI's review does

- CI reviews a PR once it's ready, when it's opened ready or marked ready, and again only when the `review` label asks, which the steward skill says when to add.
- CI's review splits the change into areas by what the files are about, each test with its code (the root's `worker/plan-review.mjs`),
  and one reviewer an area looks for every item in `REVIEW.md`'s "What to look for" and lists every problem it finds.
  Each area's reviewer reads the rule files whose `paths` match its files, as well as its diffs.
  Each area's reviewer runs on its own (`.github/workflows/review-area.yml`), so no area waits on another's.
  How the check across areas then confirms what they find, and how each finding is posted, is under "How to report" in the root's `REVIEW.md`.
  The first review reads the whole change, and each review after it reads what changed since the last review that finished.
  A review asked for on the head the last finished review read in full reads nothing,
  and so does one whose pushes since change only what a merge of its base brings in.
  The `review` job checks what each reviewer actually read and writes the summary comment "How to report" describes (the root's `worker/judge-review.mjs`).
  It fails when any changed file went unread, or when a reviewer, the check across areas, or the posting step didn't finish, naming each,
  a reviewer that left one of its area's rule files unread among them.
  If the summary names something it couldn't judge, tell the user.
- If `review` fails, read its summary and the log of the failed job, an area's `find` under `review-area`, or `review-across` or `review-post`, which shows each try's turns and tool calls.
  If one stopped before Claude started, like an install that timed out, re-run the failed jobs once yourself.
  Otherwise don't reproduce it locally or re-run it: each reviewer already tried twice, and the check across areas once.
  Tell the user what the log shows: an invalid or expired Claude credential secret, Claude unreachable,
  where a review stalled, or a re-run that failed too.
  `check` can't pass until the job does.

## Step 8: a red PR

- Merge a red PR only once `check` and `phone` passed with the `phone-ok` label on it: the label is the owner's sign-off from beta and their go-ahead to merge, so don't ask again.
  Until then, tell the user it's ready and wait.
  An OK in chat never stands in for the label.
  Merge it yourself: the owner doesn't.
- `check` holds the code that merges, the PR merged into `main` as `main` is then,
  so when `main` moved after the PR's last review, the run `phone-ok` starts fails `check` for want of a review.
  Add the `review` label then.

## Step 9: the deploy

- When the PR's CI passed on exactly the code `main` now has (the root's `worker/find-passed-ci.mjs`),
  which it did if the PR was up to date with `main` as it merged,
  that first Deploy run deploys, and CI on `main` skips the checks it already ran; otherwise the Deploy run that follows CI on `main` does.
  Either runs the root's `worker/deploy.mjs`, which deploys each app's Worker and rolls back any new version that doesn't answer,
  or whose page doesn't draw (the root's `worker/check-page.mjs`).
  Each line of the deploy log starts with its app's name, so read step 10's results for each app.

## Step 10: reading a deploy's log

Wait for the Deploy runs for the merge commit to finish, then read their logs and do what matches:

- The first says "No pull request's CI passed on exactly this code": the deploy waits for CI on `main`.
  Read the next Deploy run's log.
- It says "worker check: ok": the new version is live.
  Tell the user.
  A line before it saying "page check: skipped" names a page the deploy couldn't open, like one whose secrets are missing or out of date,
  and one saying "page check: ok, but" a page that opened without the code its environment holds:
  tell the user that too.
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
- It says "No CLOUDFLARE_API_TOKEN": the channel's environment has no Cloudflare token, so nothing was deployed.
  Tell the user.
- The run failed: read the log.
  If it says "the earlier version is live again", the Worker rolled back and is unchanged.
  Tell the user what failed and recommend a fix.

## Step 12: one thing a PR, and stacked PRs

- A review finding outside the PR's one thing that AGENTS.md's step 12 names becomes an issue, linked from its thread, not a commit on the PR.
  The same problem in the other app, or in another view, sheet, or theme, is part of the one thing, and is fixed on the PR.
- A PR built to fix review findings left for later takes findings that make one thing, like one area's or about five sharing a cause, never a whole review's.
- When a change has red and non-red parts that can each stand alone, split them:
  the non-red PR first, and the red one stacked on it, so the non-red half ships without waiting for the owner's phone.
- A PR that needs another PR's unmerged changes doesn't wait for it: stack it.
  Start its branch from that PR's branch, open it into that branch,
  so its diff and review show only its own changes, and name the PR it builds on in its description.
  Whenever the earlier PR's branch changes, merge it into the stacked branch.
  Once the earlier PR merges, change the stacked PR's base to `main` if GitHub hasn't, merge `main` into its branch, and go back to step 2 for it.
  That merge conflicts wherever the stacked PR changed lines the earlier one did,
  since `main` has the earlier PR only as its squash: keep the stacked branch's side of those, and resolve any other conflict as step 4 says.
  Never merge a PR into another PR's branch: a stack merges into `main` one PR at a time, earliest first.
