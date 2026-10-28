---
name: deploy-log
description: "How the deploy after a merge runs, and what each line of a Deploy run's log means and asks of a session"
---

# The deploy and its log

This skill holds what steps 9 and 10 of "Shipping a change" in AGENTS.md leave out, for a PR whose type deploys.

## Step 9: the deploy

- When the PR's CI passed on exactly the code `main` now has (the root's `worker/find-passed-ci.mjs`), which it did if nothing else merged into `main` after its CI ran, that first Deploy run deploys, and CI on `main` skips the checks it already ran; otherwise the Deploy run that follows CI on `main` does. Either runs the root's `worker/deploy.mjs`, which deploys each Worker, each service's before any app's. `.claude/rules/tooling.md` describes its verification and rollback conditions. Each line of the deploy log starts with its Worker's name, so read step 10's results for each Worker.

## Step 10: reading a deploy's log

Wait for the Deploy runs for the merge commit to finish, then read their logs and do what matches:

- The first says "No pull request's CI passed on exactly this code": the deploy waits for CI on `main`. Read the next Deploy run's log.
- An app says "worker check: ok": its live Worker answers at the expected release, and its page draws after signing in with the channel's access code. Tell the user it is verified. For a service, read its preceding health-check result below; this line alone does not establish verification.
- It says "The recorded live version is unverified": no upload happened in this run, and verification of the already-live version failed. Tell the user the recorded version is still live and what blocked verification.
- It says "The new version is live but unverified": the upload went live, but the run failed verification without rolling it back. The verification limits are listed in `.claude/rules/tooling.md`. Tell the user what prevented verification and recommend repairing that check before treating the release as verified. An initial new-league upload can reach this state before its key, code, and URL are configured.
- A service's lines say "health check: ok": every app that reports it says it answers at the uploaded commit, or at its own live commit when the run didn't change the service. Saying "health check: skipped" because "no app reaches" it yet, no app's live version binds it, so the service went unchecked: tell the user, since the `Watch apps` workflow is the first to read it. When "health check: ok" goes on to say what it needs, the service answers and stays live, but asks for its owner, like a Contact report waiting over an hour or paused, which may be slow rather than lost: tell the user what it says, and that `Watch apps` keeps an issue for it.
- It says "The service didn't answer as the live version": the run failed without rolling back the unchanged service. Inspect the service and the reporting apps' health, and tell the user what didn't answer.
- It says "Nothing the Worker runs changed": this run left the Worker unchanged because the merge didn't need a deploy, or an earlier run already deployed it. Tell the user which; this line alone establishes no new verification. To recover missing verification or a checked production receipt, re-run the current eligible Deploy run's jobs following `.claude/rules/tooling.md`'s rerun requirements. For superseded runs, follow its guidance instead.
- It says "has moved on" and "whose deploy covers": another merge landed first, and CI passed on it, so its Deploy run covers this one. This run is superseded; read that run's log for its verified outcome. Saying "hasn't passed on it" instead, it deploys this merge while the newer one's CI is still to pass, so read on in this run's log. Saying "couldn't be asked", it deploys this merge because GitHub couldn't say how CI went on the newer one, so read on in this run's log too.
- It says "which already has": a newer merge's deploy went live first, and supersedes this one. Read that run's log for its verified outcome.
- The run was skipped: CI failed on `main`. Read the CI log, fix the failure in a new PR, and start again at step 1.
- A run for a push to beta says "so nothing was deployed to beta": the pushed commit isn't the head of the PR that holds beta, or GitHub couldn't say which PR does, so beta keeps the build it had. The line names the PR holding beta and when it took it, or else says no PR holds beta or GitHub couldn't say. Put the PR on beta by the `beta` skill.
- It says "No CLOUDFLARE_API_TOKEN": the channel's environment has no Cloudflare token, so nothing was deployed. The run fails: tell the user which channel needs its token restored.
- The run failed: read the log. If it says "the earlier version is live again", the Worker rolled back after route setup or a Worker, page, or service check failed. The uploaded release is no longer live; tell the user what failed and recommend a fix. If it says "the new version is still live" or "no earlier version exists", restoration failed or was unavailable: report that state explicitly. If it says "no version was uploaded or rolled back", a check of the unchanged version failed: report the failed verification and the version still live.
