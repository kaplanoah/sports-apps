# Trusted review provider evaluation

Codex is gated. No provider quality, token or speed comparison has been measured. The implementation environment has no configured OpenAI API credential, and its GitHub integration cannot inspect Actions secret names (HTTP 403). Claude subscription usage must not substitute for a separate OpenAI API credential.

## Reproduced historical defects

The offline replay script imports each fix's regression test into its historical parent snapshot, runs just that test, and restores the original test afterward. It repeats against the fixed snapshot and requires failure before and success after. These replays ran on October 25, 2026, in Eastern time:

| Case | Buggy snapshot | Fixed snapshot | Buggy test | Fixed test |
| --- | --- | --- | --- | --- |
| case-1: unknown store socket frame throws | `950a11002a35bab3d2671c2d858615ff86587fd7` | `1b90fd34f64459f960ff0e735c1eb1f1266fcc11` | exit 1 | exit 0 |
| case-2: a removed playoff month remains stored | `8e61ec83806cf5cd0f21a2791b456039aec5e7be` | `f2f919e6ae856d9e7b2a953ffceb9e55ffe66714` | exit 1 | exit 0 |

Reproduce with `node worker/review-evaluation.mjs reproduce /tmp/review-cases`. The destination must not exist. The script writes the snapshots, reproduction logs, review context and a hidden adjudication rubric outside git. It runs no provider and posts nothing to GitHub.

## Separate provider trials

Copy only a case's `buggy` checkout and `review-context.json` to a disposable runner. Never expose the sibling fixed checkout, regression replay or rubric to either model. Give each provider the same trusted rules, context and required snapshot content, with its native tools and the complete repository available. Record all supplied content and commands, including investigation beyond targets.

Run Claude and Codex as independent trials, never together on a live PR. Use the pinned production provider configuration. Capture final structured answers, all portion and integration outcomes, native usage telemetry, elapsed wall time including setup and integration, model and tool versions, and the exact snapshot identity. Record failures and interruptions as trials too.

These first two cases audit historical components; they do not establish full PR quality or large-change completion. Before enabling Codex, also replay the original complete historical PR ranges and large changes with multiple areas. Include both apps, interactions, empty candidates, malformed results and a deliberate interruption. Do not omit difficult cases or failed runs.

Judge each reported finding against the code and reproducer, separately for each provider. Record its id, verdict and evidence as `confirmed-target`, `confirmed-other`, `false` or `unsure`. A real additional defect is not a false finding. Report unresolved adjudications separately. Do not use a model's own accuracy or completion assertion as the score.

## Measurements

`node worker/review-evaluation.mjs measure <trial.json> <telemetry-file>` emits detection, false findings, unresolved findings, completion, token counters and elapsed time for one provider and case. Retain its telemetry hash and the raw artifacts privately. Claude telemetry is its SDK execution-message JSON array; Codex telemetry is native `codex exec --json` JSONL from the action logs. Include every session, including integration. The collector sums final usage events rather than intermediate Claude messages.

The trial JSON requires `case`, `head`, `fix`, `provider`, `model`, `toolVersion`, `status`, `elapsedSeconds` and `adjudications`. Status is `completed`, `failed` or `interrupted`. The snapshot and fix must match a frozen case. Each adjudication has `id`, `verdict` and an evidence-based `reason`. Missing usage cannot be reported as zero. Input/cache counters retain each provider's native semantics; report them separately before comparing totals.

| Provider | Detection    | False findings | Completion   | Tokens       | Elapsed      |
| -------- | ------------ | -------------- | ------------ | ------------ | ------------ |
| Claude   | not measured | not measured   | not measured | not measured | not measured |
| Codex    | not measured | not measured   | not measured | not measured | not measured |

Keep `TRUSTED_CODEX_REVIEW_ENABLED` unset until real results and disposable-runner proofs are reviewed and recorded in the enabling PR or its setup evidence. Neither unit tests nor reproduced bug fixtures establish equivalent quality or better efficiency. This PR makes no such claim.
