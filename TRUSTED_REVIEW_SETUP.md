# Independent trusted review enforcement

The separate GitHub App publishes `trusted-review` on the PR head. Main's expected-App rule distinguishes this check from ordinary Actions jobs with the same name. The code is installed separately from App setup and rule enforcement. Leave `TRUSTED_REVIEW_PUBLISHER_ENABLED` unset until the protected setup is verified.

## Protected setup

1. Create a private GitHub App with no webhook receiver or OAuth flow. Install it on this repository only. Start with Checks read/write and automatic Metadata read; runtime installation tokens request only `checks:write` for this repository. The Actions metadata token remains read-only. Verify expected-source eligibility before granting any extra installation permission.
2. Create `trusted-review-publisher` under repository Settings > Environments. Select only the exact `main` branch. Allow no tags, PR refs, beta, or other branches. Disable administrator bypass where supported. Inspect effective protections before adding a key: Actions otherwise creates missing environments without these restrictions.
3. Add environment variable `TRUSTED_REVIEW_APP_ID` with the App ID, not its installation ID. Add `TRUSTED_REVIEW_APP_PRIVATE_KEY` as an environment secret. Enter the key directly in GitHub; never put it in repository secrets, a checkout, an issue, or chat. Required owner review can additionally make each publication manual.
4. Once trusted code is on main and the environment is verified, set repository variable `TRUSTED_REVIEW_PUBLISHER_ENABLED` to `true`. Missing credentials or publication permissions then stop new authorized model work instead of silently skipping the publisher. This flag alone does not enforce a required check.

The SHA-pinned token action requests one repository explicitly and revokes its token after the job. The protected publisher runs on fresh GitHub-hosted runners with trusted main source, no PR checkout, dependency installation, restored cache, PR actions, or Claude credentials. Main-authorized workflows are part of this trust boundary; an environment does not pin access to a particular workflow file.

## Publication and evidence

The initial job replaces prior success with a documented completed/failure conclusion while review is pending. This deliberate non-success avoids assuming that setting an old completed check to in-progress clears its successful conclusion. Titles explain whether review is pending, invalid, or conflicting. Final success requires exact authenticated evidence; review stages and test suites are unchanged.

The App requirement applies to main. A successful non-success publication does not prevent the existing trusted reviewer from reviewing a stacked PR against another base; that PR gets no authoritative passing App check until its context qualifies for main. Publication API failures still stop newly requested model work.

The final job directly depends on all review producers, including label consumption. It validates their outcomes, actual job IDs/attempts, the authenticated result upload ID/digest, sealed data, and GitHub's merge parents/tree. Successful stages reused by rerun-failed are allowed; newer failed producers and stale terminal decisions are rejected. It never waits for its own workflow's final conclusion.

The publisher binds its native main source to the review run, then places a digest of the terminal decision in the App-owned check output. The saved terminal artifact contains the exact decision, including check ID, repository/PR, head/base/source, run/attempt, producer records, and result identity. Observer restoration requires that App-owned attestation; matching job names and self-sealed artifacts alone cannot prove publisher execution.

The lifecycle workflow handles requested, in-progress, and completed review events plus PR lifecycle events without invoking Claude. Requested events do not occur on reruns; the in-progress observer handles reused successful start jobs. Observation-only label events do not supersede authorized requests. Requests order by original creation, with attempts ordered within their run; rerunning an older request cannot reclaim a newer check.

## Commit scope and asynchronous limits

GitHub requires checks by commit, not by PR or `external_id`. The publisher enumerates every open PR, including forks and drafts, and permits exactly one PR for that head. It then checks ready/open state, main base branch, exact base SHA, authorization, and reviewed evidence. Synchronization reconciles both the previous and current head. Conflicts hold the shared check until a unique valid context remains.

An outsider can cause a hold by opening a conflicting PR at an existing head. GitHub events, publication, and invalidation are asynchronous. Changes between the final metadata read and check write remain possible. A missed event, unavailable credential, or denied invalidation write can leave old success visible. Workflow failure alone does not clear it. This is not an atomic PR/base lock.

Strict up-to-date checks stay off. Main advancing after publication remains outside the guarantee; retain existing tree and shipping checks. Dependabot's authenticated existing exemption is published explicitly as review not required, not as reviewed evidence. Other fork authors still require the existing maintainer review request.

## Live acceptance before enforcement

Use an owner-approved isolated target/ruleset, not a weakened Main rule. Synthetic fixtures can test publication mechanics; a real positive uses existing authenticated review evidence without an extra Claude probe. A throwaway repository cannot prove this repository's environment protection: inspect the actual configuration and use an approved harmless canary for access denial.

| Proof | Required observation |
| --- | --- |
| Approved read-only fork replaces CI/join and creates matching successful Actions checks | The distinct App requirement remains unsatisfied. Record head/merge SHA and check-run/commit-status behavior. |
| Fork workflow requests the protected environment | Access denied; never print or attempt to retrieve the real key. |
| Valid trusted result | Exact head, App ID, evidence, and successful required result. Verify the expected-source picker accepts the actual App. |
| Foreign workflow fabricates matching jobs, seals, and terminal artifact | No success without the App-owned terminal attestation. |
| Failed review, missing evidence, permission denial, or cancelled first attempt | No successful authoritative result created. |
| Failed rerun reuses a successful start or earlier stages | Previous success invalidates after observation; old artifacts cannot rescue the failed current attempt. Record invalidation delay and failed-write behavior. |
| Shared head, retarget, or draft conversion | Commit-wide check held after reconciliation, without extra Claude work. |
| Conflicting PR moves to another head | Both SHAs reconciled; surviving old-head context restored only from valid attested evidence. |
| Duplicate App checks or reordered events | No convenient old success selected; all conflicting owned checks become non-success, and superseded runs do not reclaim ownership. |

The local controller tests do not establish these platform behaviors. Record the live evidence and residual windows before approving the final rule.

## Main rule and operation

After live proof and explicit owner approval, add one required check: context `trusted-review`, expected integration equal to the actual App ID. Preserve `check`, `phone`, CodeQL, thread resolution, strict-off, and every other rule. Read back the effective rule and verify a legitimate PR. Never infer issuer enforcement from the displayed check name alone.

Current agent credentials cannot administer Actions protections. App creation, secure key entry, environment setup, and the final approved rule need the owner's authenticated browser or an appropriately authorized administration integration.

If publication fails, repair credentials or publishing and rerun the appropriate failed publisher jobs. Duplicate owned checks deliberately hold and need reviewed repair; do not remove the required rule, invent an alias, or mark a failure successful. Removing a required rule or broadening environment access requires a separate owner decision. Rotation replaces the environment key and verifies publication before revoking the prior key.
