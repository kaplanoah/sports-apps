# Temporary App identity test

Part of #809. Preparing and merging this fixture does not approve running it. Keep both publisher and Codex activation flags unset. The normal CI, phone, CodeQL and resolved-thread gates remain in force, with strict up-to-date checks off.

## One later approval

After fixture shipping, construct the marker-only commit locally without pushing a ref. Record its exact head SHA and main parent SHA in #809, then obtain approval for these bounded actions. If main advances before dispatch, that record is void: stop and obtain a refreshed exact-source/head approval rather than substituting a new target or rerunning.

1. Publish the pre-recorded commit and create only branch `issue-809-app-identity-proof` at it. Its parent must be the approved current main source, adding only `.github/issue-809-app-identity-proof.md` containing `Issue #809 App identity proof only.` followed by a newline. Do not open a PR from it.
2. Dispatch `trusted-review-app-test.yml` once from main, as the repository owner. Use the recorded commit as `proof-head` and `APPROVE_ONE_APP_IDENTITY_TEST` as `approval`. No rerun or replacement invocation is included.
3. Read the single run's metadata, safe result summary and token-action post-job revocation result. Do not print or retrieve credentials. If any prerequisite changes or the run fails, record it and stop for a reviewed recovery decision.
4. Delete the disposable branch with its exact expected-SHA lease. Remove this workflow, its controller, its tests and this document in a normal cleanup PR. Remove the fixture's deployment-skip entries and restore its supporting API-client changes when unused, preserving any later consumers. Verify the cleanup merge's main CI and every Deploy outcome. The intentionally failing historical check remains; no successful synthetic check is created.

No execution approval has been given yet. No App grants, Main rules, environments, additional refs, model calls or activation changes are included. The user enters keys/settings directly in GitHub; no private key belongs in a checkout or chat.

## Safeguards and acceptance

The workflow has only a manual trigger and requires an owner-started first attempt from main. Its controller rechecks native workflow identity, current main, both unset activation flags and the configured App ID before using the key. It checks out only trusted main, installs no dependencies and restores no cache. Only the SHA-pinned token action receives the private key.

The target must be the exact named ref, one marker-only commit above that main source, with no open PR at its head or merge SHA. Every page of open PRs and existing checks is inspected. An existing `trusted-review` check blocks the test rather than being replaced. Target checks repeat immediately before the sole write. Main/ref/PR changes are asynchronous; a race can create only the deliberately failing proof result.

The token action requests only this repository and Checks write, with its default post-job revocation enabled. The controller reads the token's accessible repositories and requires exactly this repository. It creates one completed/failure `trusted-review` check, then reads it back and requires the expected numeric App ID, head, external identity and failure conclusion. The workflow's `APP_PROOF_EXPECTED_ID` pins the expected App identity.

| Evidence | What it establishes |
| --- | --- |
| Check create/readback matches `APP_PROOF_EXPECTED_ID` and the recorded head | The configured key can issue a Checks API token and create an App-owned check |
| Token repository listing contains only sports-apps | Observed repository isolation for this token |
| Pinned action requests only Checks write | Requested permission narrowing; no negative permission-probe matrix is claimed |
| Token action post-job revocation succeeds | The action reports successful revocation; token expiry alone is insufficient |
| Check remains completed/failure | No synthetic review approval or terminal publisher attestation was created |

This first test does not prove expected-source picker eligibility, a required-rule association, wrong-issuer rejection, real-fork isolation, authenticated review completion, lifecycle/rerun handling or queue operation. Those remain separately reviewed proofs. Successful recent checks or additional installation permissions may be needed for later picker eligibility; never add Commit statuses write speculatively. Activation and the final App-pinned Main rule each remain separate approvals.
