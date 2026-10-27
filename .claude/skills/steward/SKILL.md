---
name: steward
description: How a session answers Trusted review on a pull request in this repo
---

Answer every review finding, a Nit or Pre-existing one too, as below. The `ship` skill says what to do when Trusted review's `review` or CI's `review-join` job fails.

- In every round, fix each Important finding and each Unsure finding confirmed as a bug, or reply on its thread explaining why it will not be fixed, linking the issue that holds it when it is left for later. Fix a genuine nonblocking Nit or Pre-existing finding only in a push already needed for the PR, or decline it with a reason. Replies and deferrals of nonblocking Nits or Pre-existing findings require no push or re-review of their own. A finding that demonstrates a broken rule is Important under REVIEW.md; answer it as Important even if it was labeled Nit. After a fix, go back to step 2 of "Shipping a change" in AGENTS.md.
- After any push to a ready PR, add the `review` label. It asks Trusted review to review what the push changed, and that workflow takes the label off itself, so the next ask is a fresh label. Add it once the push's own CI run has started on the PR's head, since that run stops a label's run queued before it. A push stops a review still running or waiting, and a label change stops one still waiting. Whenever `check` says no review has passed on the code that merges, as after a stopped run or once `main` moved after the last review, take the label off if a stopped run left it on, and add it again.
- A finished review doesn't always wake the session, so after marking a PR ready or adding the `review` label, stay subscribed to the PR and schedule a check-in about 30 minutes out where the session can. When it fires, carry on from step 4 of "Shipping a change", scheduling another while the review still runs.
- Fix a finding in every place the PR's own change shows the same problem, not only on its line, and leave what's outside the PR's one thing to an issue, as the `ship` skill's step 12 says, rather than widening the PR.
- Once a fix is pushed, resolve its thread with no reply, since GitHub marks it outdated once its line changes.
- Resolve a finding answered without a code change once its reply is posted.
- Resolve each checklist of Nits once every item in it is fixed or answered in a reply on its thread.
- A finding in the PR's conversation has no thread: answer one you won't fix with a reply in the conversation.
- After three reviews in a row with Important findings, identify what the earlier preparation and review missed. Record, in the PR's description, one concrete, evidence-based improvement that would have caught those problems sooner. Continue fixing and shipping under the existing checks and approval rules; reaching three rounds alone is not a reason to ask the user. If a declined finding returns, reassess it against the code and explain the decision. Ask the user when a decision is reserved for the user or progress is blocked, rather than because of the round count or a repeated finding.
