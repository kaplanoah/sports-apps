# Isolated issuer acceptance

Part of #809. This package prepares a test; shipping it does not approve execution. Never rerun or replace an earlier identity test as part of this protocol. Main and both activation flags stay unchanged throughout this isolated issuer protocol. No additional App grant is included.

## Approval after shipping

After normal review, merge, main CI and every Deploy are resolved, prepare the exact public source/head record before requesting execution approval. Record current main source, one unpublished marker-only child commit, its tree/blob, both proposed refs, the isolated ruleset JSON, run budget and recovery. If source changes before any phase, stop for reviewed recovery and refreshed approval; do not silently substitute a source or target.

Only these new refs are proposed: `refs/heads/issue-809-issuer-base` at the recorded main source, and `refs/heads/issue-809-issuer-head` at the recorded child. Require remote absence before creating either. The child adds only `.github/issue-809-issuer-proof.md` containing `Issue #809 isolated issuer proof only.` and a newline. Do not recreate any earlier canary or identity-proof ref.

The isolated ruleset is named `Issue 809 issuer proof`, targets Branch, and is active with no bypass actors. Its only included ref is `refs/heads/issue-809-issuer-base`, with no excluded refs. Its sole rule requires `trusted-review` from integration **5481243**, strict up-to-date false and do-not-enforce-on-create false. Verify all effective rules before using the key; never modify Main to perform this test.

Record the unchanged owner-credential REST answer from `GET /repos/{owner}/{repo}/rulesets/{id}` as the approved snapshot. It must include the ID, exact configuration, empty `bypass_actors` and exact `updated_at` version. Use an existing credential that can read bypass actors; do not use a Settings export, manufacture missing fields or add administration to the Actions token. Supply that identical JSON as `ruleset-snapshot` in each phase. The controller binds its digest across phases and compares the live version, visible configuration and effective rules. When either answer includes `current_user_can_bypass`, it must be `"never"`. An omitted caller-bypass field or live bypass list is accepted only against the owner-verified empty actor list and unchanged native version; omission itself proves no bypass property. Any configuration change voids the snapshot. Validate this exact recorded input locally against recorded metadata before dispatch so malformed input cannot spend a live phase.

Create one same-repository draft PR from issuer-head into issuer-base, never Main. Record its number, exact head/base/merge/tree and ruleset ID before dispatch. Administration writes use the owner's settings access; available connector access does not establish administration capability. No private key enters a checkout or chat.

## Finite live budget

The proposed budget is three first-attempt owner dispatches of `trusted-review-issuer-test.yml` from the approved unchanged main, in order `fail`, `pass`, `reset`; one first-attempt dispatch of `trusted-review-lookalike-test.yml` at the exact issuer-head; and one isolated proof PR. Each issuer job lasts at most five minutes and mints one repository-only Checks-write token with the pinned action's default post-job revocation. The lookalike has no token permissions, environment, checkout, dependencies or credentials.

Making the isolated PR ready starts its ordinary CI and one normal trusted Claude review request under existing repository policy. Include that model work, its area matrix and existing automatic-attempt limits explicitly in the eventual execution approval; it is not a Codex trial. No agent-requested model retry, additional review request, workflow rerun or replacement invocation is included. The operator enforces the dispatch budget; first-attempt guards alone do not prevent a new replacement run ID.

| Order | Action | Required observation |
| --- | --- | --- |
| 1 | Dispatch issuer `fail`, check/actions-check both `0` | One completed/failure check from App 5481243 at the exact isolated head. Record its ID and actual post-job revocation. |
| 2 | Make the isolated PR ready and let ordinary CI/review finish | No conflicts, no unrelated effective rule, exact base/head and resolved ordinary findings. Do not merge it. |
| 3 | Dispatch the lookalike once at issuer-head | Same-name completed/success check from Actions 15368 at that exact head; record its native run/job/check IDs. It has no App key or privileged publisher environment. |
| 4 | Read native PR/rule state | Confirm settled `mergeable: true` and `mergeable_state: "blocked"` after the lookalike finishes and immediately before the pass dispatch. Matching Actions success does not satisfy the pin. Capture check/status snapshots at head and test-merge SHA. A null mergeability value means computation is pending; resolve that preflight before dispatch. |
| 5 | Dispatch issuer `pass` with exact App and Actions check IDs | Same App check changes to synthetic success, with exact issuer/source/head readback and token revocation. Then independently observe native merge eligibility become clean. Do not merge. |
| 6 | Dispatch issuer `reset` with those same IDs | Same App check returns to failure; independently observe native hold again and successful token revocation. |
| 7 | Close the proof PR unmerged, remove only the approved isolated rule, delete both refs with exact SHA leases | No live synthetic passing result or disposable rule/ref remains. Preserve the historical failing check and evidence. Remove this fixture and unused support through a normal reviewed cleanup PR and verify main CI/every Deploy. |

Use `APPROVE_ISOLATED_ISSUER_PROTOCOL` only after the exact source/head/ruleset/budget protocol is approved. The source input equals current main and the native workflow SHA. The controller checks the source, refs, marker-only ancestry, exact isolated PR, exact effective App rule, all open-PR/check pages and monotonic phase record before the key and again before its one write. It rejects another open PR whose head equals the proof head, duplicate owned checks, stale phases and a wrong successful lookalike ID.

Synthetic success is limited to the isolated marker commit. It is never authenticated review evidence or a terminal publisher attestation. The App token is never supplied to the lookalike or any PR-controlled code. Main/ref/PR state can still change between metadata reads and the write; record that asynchronous window, and never turn the proof commit into a Main PR.

## Failure and remaining work

On a failed phase, ambiguous write/readback, changed source/target/rule or missing prerequisite, record the result and stop for reviewed recovery. A failed reset can leave isolated synthetic success visible. Do not delete a real rule, choose an old duplicate, rerun automatically, or broaden credentials to recover. Approve any recovery explicitly before new key use. Keep the isolated PR unmerged; normal closure happens only after failure readback.

Passing this protocol establishes saved issuer association, same-name Actions rejection, genuine-App acceptance and success-to-failure hold on an isolated native PR. It does not establish actual-fork secret isolation, foreign terminal-attestation rejection, stale/malformed producer rejection, production begin/finish/observer behavior, cancellation/rerun ordering, collisions, queue behavior or an atomic base lock. Unit tests are not those live proofs.

After issuer acceptance, prepare the separately approved limited publisher-activation/native-acceptance protocol in `TRUSTED_REVIEW_SETUP.md`, inventory eligible genuine review evidence and all active review runs, and record exact event/model budgets and recovery. Do not silently enable the publisher or rerun model jobs. Codex activation/evaluation remains separate and unnecessary for App enforcement.

The final approval, Main change and operation follow [Main rule and operation](TRUSTED_REVIEW_SETUP.md#main-rule-and-operation). #809 remains open until enforcement is verified within its documented asynchronous limits and approved exemptions.
