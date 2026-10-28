# Independent trusted review enforcement

The separate GitHub App publishes `trusted-review` on the PR head. Main's expected-App rule distinguishes this check from ordinary Actions jobs with the same name. The code is installed separately from App setup and rule enforcement. Leave `TRUSTED_REVIEW_PUBLISHER_ENABLED` unset until the protected setup is verified.

## Protected setup

1. Create a private GitHub App with no webhook receiver or OAuth flow. Install it on this repository only. Start with Checks read/write and automatic Metadata read; runtime installation tokens request only `checks:write` for this repository. The Actions metadata token remains read-only. Verify expected-source eligibility before granting any extra installation permission.
2. Create `trusted-review-publisher` under repository Settings > Environments. Select only the exact `main` branch. Allow no tags, PR refs, beta, or other branches. Disable administrator bypass where supported. Inspect effective protections before adding a key: Actions otherwise creates missing environments without these restrictions.
3. Add environment variable `TRUSTED_REVIEW_APP_ID` with the App ID, not its installation ID. Add `TRUSTED_REVIEW_APP_PRIVATE_KEY` as an environment secret. Enter the key directly in GitHub; never put it in repository secrets, a checkout, an issue, or chat. Required owner review can additionally make each publication manual.
4. Once trusted code is on main and the environment is verified, set repository variable `TRUSTED_REVIEW_PUBLISHER_ENABLED` to `true`. Missing credentials or publication permissions then stop new authorized model work instead of silently skipping the publisher. This flag alone does not enforce a required check.

The SHA-pinned token action requests one repository explicitly and revokes its token after the job. The protected publisher runs on fresh GitHub-hosted runners with trusted main source, no PR checkout, dependency installation, restored cache, PR actions, or model credentials. Main-authorized workflows are part of this trust boundary; an environment does not pin access to a particular workflow file.

Each caller explicitly passes the publisher's named key secret into the reusable workflow, which declares it required. The job's protected environment supplies its value; keep the key there. GitHub requires this [caller handoff even for environment-only secrets](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow). An omitted handoff resolves to an empty input. If token creation reports an empty private key, check that handoff before asking the owner to replace credentials. The required declaration checks the handoff, not whether its value is non-empty.

## Publication and evidence

The initial job replaces prior success with a documented completed/failure conclusion while review is pending. This deliberate non-success avoids assuming that setting an old completed check to in-progress clears its successful conclusion. Titles explain whether review is pending, invalid, or conflicting. Final success requires exact authenticated evidence; the selected provider must finish every required stage.

The App requirement applies to main. A PR targeting another branch keeps its normal trusted review and gets no passing App check until its context qualifies for main. Publication API failures still stop newly requested model work.

The final job directly depends on all review producers, including label consumption. It validates their outcomes, actual job IDs/attempts, the authenticated result upload ID/digest, sealed data, and GitHub's merge parents/tree. Successful stages reused by rerun-failed are allowed; newer failed producers and stale terminal decisions are rejected. It never waits for its own workflow's final conclusion.

The publisher binds its native main source to the review run, then places a digest of the terminal decision in the App-owned check output. The saved terminal artifact contains the exact decision, including check ID, repository/PR, head/base/source, run/attempt, producer records, and result identity. Observer restoration requires that App-owned attestation; matching job names and self-sealed artifacts alone cannot prove publisher execution.

The lifecycle workflow handles requested, in-progress, and completed review events plus PR lifecycle events without invoking a model. GitHub.com runs `pull_request_target` from the default branch, including for stacked PRs and retargeting away from main. The publisher still rejects non-main native authority. Verify these native refs during live setup; older GitHub Enterprise Server versions have different semantics. Requested events do not occur on reruns; the in-progress observer handles reused successful start jobs. Observation-only label events do not supersede authorized requests. Requests order by original creation, with attempts ordered within their run; rerunning an older request cannot reclaim a newer check.

Every publisher phase shares one concurrency group per repository/head with `queue: max` and cancellation disabled. GitHub queues up to 100 waiting jobs instead of replacing the pending begin or finish with an observer. Queue overflow cancels additional jobs; a failed or missed publication remains visible and requires recovery. GitHub's [job-concurrency schema](https://github.com/actions/languageservices/blob/4043eda158e16579cc5fb1b0b07a4bce2a76f0b5/workflow-parser/src/workflow-v1.0.json#L2044-L2083) and [positive parser fixture](https://github.com/actions/languageservices/blob/4043eda158e16579cc5fb1b0b07a4bce2a76f0b5/workflow-parser/testdata/reader/concurrency.yml#L28-L32) accept this syntax. Live setup must verify a burst covering all phases.

The review run title uses a bounded main/other target and one native intent expression shared with the planner. Long branch names cannot enlarge the title, and the planner does not independently decide which requests are authorized.

## Commit scope and asynchronous limits

GitHub requires checks by commit, not by PR or `external_id`. The publisher enumerates every open PR, including forks and drafts, and permits exactly one PR for that head. It then checks ready/open state, main base branch, exact base SHA, authorization, and reviewed evidence. Synchronization reconciles both the previous and current head. Conflicts hold the shared check until a unique valid context remains.

An outsider can cause a hold by opening a conflicting PR at an existing head. GitHub events, publication, and invalidation are asynchronous. Changes between the final metadata read and check write remain possible. A missed event, unavailable credential, or denied invalidation write can leave old success visible. Workflow failure alone does not clear it. This is not an atomic PR/base lock.

Strict up-to-date checks stay off. Main advancing after publication remains outside the guarantee; retain existing tree and shipping checks. Dependabot's authenticated existing exemption is published explicitly as review not required, not as reviewed evidence. Other fork authors still require the existing maintainer review request.

## Live acceptance before enforcement

The [isolated issuer protocol](TRUSTED_REVIEW_ISSUER_TEST.md) tests expected-source association and same-name Actions rejection.

Use an owner-approved isolated target/ruleset, not a weakened Main rule. Synthetic fixtures can test publication mechanics; a real positive uses existing authenticated review evidence without an extra Claude probe. A throwaway repository cannot prove this repository's environment protection: inspect the actual configuration and use an approved harmless canary for access denial.

| Proof | Required observation |
| --- | --- |
| Approved read-only fork replaces CI/join and creates matching successful Actions checks | The distinct App requirement remains unsatisfied. Record head/merge SHA and check-run/commit-status behavior. |
| Fork workflow requests the protected environment | Access denied; never print or attempt to retrieve the real key. |
| Valid trusted result | Exact head, App ID, evidence, and successful required result. Verify the expected-source picker accepts the actual App. |
| Foreign workflow fabricates matching jobs, seals, and terminal artifact | No success without the App-owned terminal attestation. |
| Failed review, missing evidence, permission denial, or cancelled first attempt | No successful authoritative result created. |
| Failed rerun reuses a successful start or earlier stages | Previous success invalidates after observation; old artifacts cannot rescue the failed current attempt. Record invalidation delay and failed-write behavior. |
| Shared head, retarget, or draft conversion | Commit-wide check held after reconciliation, without extra Claude work. For a stacked or retargeted PR, record native `github.ref`, `github.sha`, and `github.workflow_ref`; the publisher must execute from main, including when the target is an older branch. |
| Conflicting PR moves to another head | Both SHAs reconciled; surviving old-head context restored only from valid attested evidence. |
| Burst of begin, finish, and observe jobs for one head | Shared queue retains every job within its 100-job bound, with no concurrent writes or pending-job replacement. |
| Duplicate App checks or reordered events | No convenient old success selected; all conflicting owned checks become non-success, and superseded runs do not reclaim ownership. |

The local controller tests do not establish these platform behaviors. Record the live evidence and residual windows before approving the final rule.

## Main rule and operation

After live proof and explicit owner approval, add one required check: context `trusted-review`, expected integration equal to the actual App ID. Preserve `check`, `phone`, CodeQL, thread resolution, strict-off, and every other rule. Read back the effective rule and verify a legitimate PR. Never infer issuer enforcement from the displayed check name alone.

App creation, secure key entry, environment setup, and the final approved rule require the owner's authenticated browser or an appropriately authorized administration integration.

If publication fails, repair credentials or publishing and rerun the appropriate failed publisher jobs. Duplicate owned checks deliberately hold and need reviewed repair; do not remove the required rule, invent an alias, or mark a failure successful. Removing a required rule or broadening environment access requires a separate owner decision. Rotation replaces the environment key and verifies publication before revoking the prior key.

# Selecting Claude or Codex

`TRUSTED_REVIEW_DEFAULT_PROVIDER` may name `claude` or `codex`, and defaults to `claude` when unset. The first trusted selection pins that default per PR. Changing the repository default does not change existing PR choices. Set a Codex default only after satisfying its activation gate below. PRs pinned to gated Codex require an owner `review-provider:claude` selection to use Claude.

The owner selects a provider by adding `review-provider:claude` or `review-provider:codex`. Only the repository owner's label events count. Removing a label does not change the choice. Remove and re-add an existing provider label to select it again. The latest owner selection wins, even when both labels remain. Each selection event starts a complete review with a new selection identity. The ordinary `review` label requests another round with the current provider.

The trusted bot comment records the PR's current choice, which only an owner's provider label changes. Timeline events retain explicit choices through failed or interrupted runs. Artifacts bind the provider and selection alongside the repository, run, head, base, merge and trusted source. Publishing and CI's join recheck the live choice. A switch away and back cannot reuse an older result. Unfinished work is never shared between providers.

## Codex activation gate

Codex stays disabled until both of these exist:

- A repository Actions secret named `TRUSTED_REVIEW_OPENAI_API_KEY`, containing an OpenAI API project credential with its own spending limit.
- Repository variable `TRUSTED_CODEX_REVIEW_ENABLED=true`, set only after the historical evaluation and disposable-runner proofs below have been recorded.

The API credential is separate from Claude credentials and subscription usage. Never paste its value into a chat, issue, PR, command argument or log. The owner can enter it directly in GitHub's Actions secrets settings or use the secure prompt from `gh secret set TRUSTED_REVIEW_OPENAI_API_KEY` in a local clone. Do not enable the variable merely because the secret exists. A gated Codex selection fails visibly without starting Claude or silently switching providers.

Before activation, record the separate provider measurements described in `TRUSTED_REVIEW_EVALUATION.md`. Include large historical changes, cross-app interactions, an empty-candidate integration pass, and interruption recovery. Demonstrate that malformed answers, missing coverage, stale head/base/provider identities and missing integration evidence cannot publish success. Keep the protected publisher and unresolved-thread and phone requirements.

### Hosted runner proof

After the owner saves the API secret, dispatch `codex-runner-proof.yml` once on main with the public `evidence-certificate` prepared by `TRUSTED_REVIEW_EVALUATION.md`. Only the owner can dispatch it, with live Codex still disabled. The disposable model host receives a hostile fixture and trusted configuration; current source, historical fixes and evaluation rubrics arrive only after the model exits.

The native tool must execute the trusted probe successfully. It checks non-root execution, unavailable sudo, absent credential and canary variables in its shell, and refused checkout writes. It checks variable presence without reading or printing their values. A model's completion claim or a command that merely prints the markers cannot pass. The public proof artifact retains only fixed facts, a transcript hash and observed numeric usage.

The one-day codex-proof-input artifact holds the synthetic project, prompt, schema and trusted configuration in public plaintext before execution. It must contain no private values. Collection also runs when the action fails and keeps that failure red; abrupt runner termination can still prevent collection. Post-execution copies of complete input, answer and execution evidence are encrypted to the session-held evidence key before upload, as for historical trials. Inspect it privately instead of guessing a failure's cause. Missing usage is unavailable, never zero. A failed proof cannot become activation evidence merely because its diagnostic artifact exists.

Read the completed job log separately: neither `TRUSTED_CODEX_TOOL_PROOF_OK` nor `TRUSTED_CODEX_CAPTURE_PROOF` may appear there. Record the source SHA, run, proof artifact, observed CLI, configured action and model, observed usage and log inspection. Apply the activation gate above; this proof establishes only the tested runner behavior. A model-started failure needs fresh owner authorization before another attempt.

### Hosted validator controls

Only the owner's first dispatch attempt of `codex-validation-proof.yml` on main with the gate off executes its jobs. It uses no model, API key or publisher credential. One runner seals synthetic empty-candidate portions and integration through the production validators; a second downloads those artifacts and revalidates them before testing negative controls. Neither runner posts a review or writes a commit check.

The `codex-validation-proof` artifact binds the source and run and lists each passing control. A valid baseline must pass before rejection can count. Stale head/base/source/run, changed provider/selection, malformed or incomplete answers, unjudged work, missing supplied-content coverage and changed integration evidence must fail. Producer checks separately reject missing integration, cancelled model and missing validation stages.

Record the source SHA, run, artifact ID and digest, and the artifact's `checks` list. A green run with skipped jobs and no proof artifact establishes nothing. A failed control prints its name and a fixed reason; unexpected diagnostic contents stay out of public logs.

| This proof establishes | Evidence still required separately |
| --- | --- |
| Actual artifact transfer and production validator rejection on fresh hosted runners | Native model investigation and empty-candidate integration |
| Rejection of a synthetic cancelled producer | Actual interruption, retained evidence and recovery behavior |
| Production publisher's producer-selection validation with synthetic records | Protected App publishing and live head/base/provider reconciliation |

Synthetic records use an example repository identity and cannot authorize a real PR. Keep this distinction in every activation report. A passing fixture workflow does not satisfy the native interruption, empty-integration or live publishing requirements above.

## Verified official Codex configuration

The official [action README](https://github.com/openai/codex-action/blob/c05cfd74ad95c626cdf05c6685e62becc3bf7813/README.md), [action inputs](https://github.com/openai/codex-action/blob/c05cfd74ad95c626cdf05c6685e62becc3bf7813/action.yml), and [security guidance](https://github.com/openai/codex-action/blob/c05cfd74ad95c626cdf05c6685e62becc3bf7813/docs/security.md) define the pinned action's behavior. The CLI and API proxy are pinned to `0.164.0`. Permission profiles require CLI `0.138.0` or later. The pinned CLI's official model catalog includes `gpt-6.1-sol`; this path uses that model with high reasoning effort.

`trusted-codex-review.yml` uses disposable GitHub-hosted Linux runners, `openai-api-key`, `prompt-file`, `output-schema-file`, `output-file`, `permission-profile: ":read-only"` and `safety-strategy: drop-sudo`. The official action invokes native `codex exec`. Native search, shell and history remain available within its sandbox.

The trusted `BASH_ENV` capture redirects the action's execution step stdout and stderr to a temporary runner file. The pinned action removes `BASH_ENV` before starting the Linux model process. A trusted reducer retains only validated numeric usage counters. Unavailable telemetry emits a fixed warning and never discards a valid answer; structured-answer validation remains required. The one-day answer artifact contains only `answer.json` and `usage.jsonl`; raw transcripts stay on the disposable runner and out of public job logs. Public repository artifacts can be downloaded by signed-in GitHub users. Hosted proof of capture and reduction is required before activation.

Trusted Codex configuration lives outside the reviewed checkout. Project instructions are disabled and that checkout is explicitly untrusted, preventing its Codex configuration from becoming trusted settings. Shell commands inherit no credentials. The action protects its API credential through its own proxy and privilege removal. Model jobs receive no Claude or publisher credentials. After model execution, trusted steps reduce telemetry to usage counters and transport the answer artifact. Validation and privileged publishing run on fresh hosts from trusted source.

## Coverage and review portions

Preparation supplies the same exact-code plan, complete required diffs, trusted rules and previous findings independently of the provider. Both providers receive observed CI check context and a test-source inventory, and investigate the relevant tests themselves. Existing diff parts are transport files; every assigned part is included whole in the native prompt, without using their sizes to limit Codex investigation.

Codex groups code and tests by semantic repository area. One contained area uses one native session to investigate and verify findings. Multiple areas use coherent portions and a separate integration session supplied the whole change and every candidate. Integration runs even when every portion found nothing. There is no line-count or agent-count routing threshold. Cross-app changes get an integration pass regardless of size.

Coverage records hash the actual complete content supplied by trusted preparation, not a model assertion that it read everything. The summary says "Supplied in full" for Codex and retains Claude's Read-based accounting. Native tools inspect callers, shared state, related code, both apps, failure paths and tests beyond the diff. Supplied coverage establishes delivery, not the depth of reasoning. Incomplete investigation, unjudged work, context exhaustion, malformed output or interruption fails closed. No automatic retry starts another provider.

Both providers produce the common candidate, disposition and posting contract, with different coverage evidence. Structured answers and sealed artifacts are revalidated before privileged posting or approval.
