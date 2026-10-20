---
name: steward
description: How a session answers CI's review on a pull request in this repo
---

Answer every review finding, a Nit or Pre-existing one too, as below; the `ship` skill says what to do when the `review` job fails.

- Answer all of a review's findings in one push: fix each and go back to step 2 of "Shipping a change" in AGENTS.md, or reply on its thread, only when you won't fix it, saying why.
- End that push by adding the `review` label to the PR, which asks CI to review what it changed, and takes the label off itself, so the next ask is a fresh label.
  A push alone starts no review, and a push while a review is running or waiting stops it, so ask again after it,
  taking the label off first if the stopped run left it on.
- Fix a finding in every place the PR's own change shows the same problem, not only on its line,
  and name a place outside the change that shows it in a line of the PR's description, rather than widening the PR.
- Once the push is up, resolve the thread of each finding you fixed, with no reply, since GitHub marks it outdated once its line changes,
  and of each you answered.
- Resolve each checklist of Nits once every item in it is fixed or answered in a reply on its thread.
- A finding in the PR's conversation has no thread: answer one you won't fix with a reply in the conversation.
- A Nit you fix rides a push the PR needs anyway,
  or, when none is left, one last push just before the merge,
  which on a red change comes before its last deploy to beta,
  and never waits for a later PR or the next change to its file.
- After three reviews in a row with an Important finding, or when a finding you declined comes back, stop and ask the user.
