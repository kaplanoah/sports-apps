---
name: steward
description: How a session answers CI's review on a pull request in this repo
---

Answer every review finding, a Nit or Pre-existing one too, as below; the `ship` skill says what to do when the `review` job fails.

- A PR's first round of review is the one CI runs once the PR is ready.
  Answer all of its findings, the Nits and Pre-existing ones too, in one push:
  fix each and go back to step 2 of "Shipping a change" in AGENTS.md, or reply on its thread, only when you won't fix it, saying why,
  and linking the issue that holds it when it's left for later.
  End that push by adding the `review` label, which asks for the second round.
- From the second round on, answer each Important or Unsure finding as the first round's,
  and end a push that fixes an Important finding, or an Unsure one that turned out to be a real bug, by adding the `review` label.
  Answer each Nit or Pre-existing finding in a reply on its thread, saying it stays as is and why,
  or that it rides the push an Important fix needs anyway, and never give one a push of its own.
- The `review` label asks CI to review what the push changed, and takes the label off itself, so the next ask is a fresh label.
  Add it once the push's own CI run has started on the PR's head, since that run stops a label's run queued before it.
  A push stops a review still running or waiting, and a label change stops one still waiting,
  so when `check` says no review has passed on the PR's code, take the label off if the stopped run left it on, and add it again.
- Fix a finding in every place the PR's own change shows the same problem, not only on its line,
  and leave what's outside the PR's one thing to an issue, as the `ship` skill's step 12 says, rather than widening the PR.
- Once the push is up, resolve the thread of each finding you fixed, with no reply, since GitHub marks it outdated once its line changes,
  and of each you answered.
- Resolve each checklist of Nits once every item in it is fixed or answered in a reply on its thread.
- A finding in the PR's conversation has no thread: answer one you won't fix with a reply in the conversation.
- After three reviews in a row with an Important finding, or when a finding you declined comes back, stop and ask the user.
