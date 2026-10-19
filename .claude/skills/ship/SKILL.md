---
name: ship
description: "What the Shipping a change steps in AGENTS.md leave out: PR titles' major bumps, the beta channel, red changes and the owner's phone-ok, CI's review and a failed review job, the deploy and its log, and stacked PRs"
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

- Take a red change to its branch and PR, open it as a draft, deploy it to beta once its CI passes, as "The beta channel" above says,
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
  Step 5 goes back to step 4 each time it looks, since another PR may have merged into `main` and left this one in conflict.

## Step 7: what CI's review does

- CI's review splits the change into areas by what the files are about, each test with its code (the root's `worker/plan-review.mjs`),
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
  and anything it read but couldn't judge (the root's `worker/judge-review.mjs`).
  It fails when any changed file went unread, or when a reviewer, checker, check across areas, or posting step didn't finish, naming each,
  a reviewer that left one of its area's rule files unread among them.
  If the summary names something it couldn't judge, tell the user.
- If `review` fails, read its summary and the log of the failed job, an area's `find` or `check` under `review-area`, or `review-across` or `review-post`, or its `review-final-` twin, which shows each try's turns and tool calls.
  If one stopped before Claude started, like an install that timed out, re-run the failed jobs once yourself.
  Otherwise don't reproduce it locally or re-run it: each reviewer already tried twice, and each checker and the check across areas once.
  Tell the user what the log shows: an invalid or expired Claude credential secret, Claude unreachable,
  where a review stalled, or a re-run that failed too.
  `check` can't pass until the job does.

## Step 8: a red PR

- Merge a red PR only once `check` and `phone` passed with the `phone-ok` label on it: the label is the owner's sign-off from beta and their go-ahead to merge, so don't ask again.
  Until then, tell the user it's ready and wait.
  An OK in chat never stands in for the label.
  Merge it yourself: the owner doesn't.

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

## Step 12: stacked PRs

- Split work into several PRs only when its parts can be reviewed or rolled back on their own.
  A PR that needs another PR's unmerged changes doesn't wait for it: stack it.
  Start its branch from that PR's branch, open it into that branch,
  so its diff and review show only its own changes, and name the PR it builds on in its description.
  Whenever the earlier PR's branch changes, merge it into the stacked branch.
  Once the earlier PR merges, change the stacked PR's base to `main` if GitHub hasn't, merge `main` into its branch, and go back to step 2 for it.
  That merge conflicts wherever the stacked PR changed lines the earlier one did,
  since `main` has the earlier PR only as its squash: keep the stacked branch's side of those, and resolve any other conflict as step 4 says.
  Never merge a PR into another PR's branch: a stack merges into `main` one PR at a time, earliest first.
