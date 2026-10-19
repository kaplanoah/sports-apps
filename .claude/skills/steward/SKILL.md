---
name: steward
description: How a session answers CI's review on a pull request in this repo
---

Answer every review finding as step 7 of "Shipping a change" in AGENTS.md says, a Nit or Pre-existing one too.

- Read every finding `npm run wait-for-review -- <PR number>` lists before you answer any.
- Fix a finding and resolve its thread, with no reply.
- Fix it in every place the PR's own change shows the same problem, not only on its line.
  A place outside the change that shows it goes in a line of the PR's description, not a wider PR.
- Reply only on a finding you won't fix, saying why, and then resolve its thread.
- Resolve the thread that holds a review's checklist of Nits once every item in it is fixed or answered in a reply on it.
