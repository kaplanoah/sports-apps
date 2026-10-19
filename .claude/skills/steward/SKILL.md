---
name: steward
description: How a session answers CI's review on a pull request in this repo
---

Answer every review finding as step 7 of "Shipping a change" in AGENTS.md says, a Nit or Pre-existing one too.

- Read every finding `npm run wait-for-review -- <PR number>` lists before you answer any.
- Fix a finding and resolve its thread, with no reply.
- Reply only on a finding you won't fix, saying why, and then resolve its thread.
- Resolve the thread that holds a review's checklist of Nits once every item in it is fixed or answered in a reply on it.
