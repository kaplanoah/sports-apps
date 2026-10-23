---
name: steward
description: How a session answers CI's review on a pull request in this repo
---

Answer every review finding, a Nit or Pre-existing one too, as below; the `ship` skill says what to do when the `review` job fails.

- Answer every finding from the first review, including Nits and Pre-existing findings.
  Fix each Important finding and each Unsure finding confirmed as a bug, or reply on its thread explaining why it will not be fixed,
  linking the issue that holds it when it is left for later.
  Fix a genuine nonblocking Nit in a push already needed for the PR, defer substantive unrelated work to a focused issue, or decline it with a reason.
  Replies and deferrals of nonblocking Nits or Pre-existing findings require no push or re-review of their own.
  A finding that demonstrates a broken rule is Important under REVIEW.md; answer it as Important even if it was labeled Nit.
  After a fix, go back to step 2 of "Shipping a change" in AGENTS.md.
- From the second round on, answer Important and Unsure findings the same way.
  Answer Nits and Pre-existing findings on their threads; fix them only in a push already needed for the PR.
- After any push to a ready PR, add the `review` label.
  It asks CI to review what the push changed, and takes the label off itself, so the next ask is a fresh label.
  Add it once the push's own CI run has started on the PR's head, since that run stops a label's run queued before it.
  A push stops a review still running or waiting, and a label change stops one still waiting.
  Whenever `check` says no review has passed on the code that merges, as after a stopped run or once `main` moved after the last review,
  take the label off if a stopped run left it on, and add it again.
- Fix a finding in every place the PR's own change shows the same problem, not only on its line,
  and leave what's outside the PR's one thing to an issue, as the `ship` skill's step 12 says, rather than widening the PR.
- Once a fix is pushed, resolve its thread with no reply, since GitHub marks it outdated once its line changes.
- Resolve a finding answered without a code change once its reply is posted.
- Resolve each checklist of Nits once every item in it is fixed or answered in a reply on its thread.
- A finding in the PR's conversation has no thread: answer one you won't fix with a reply in the conversation.
- After three reviews in a row with an Important finding, or when a finding you declined comes back, stop and ask the user.
