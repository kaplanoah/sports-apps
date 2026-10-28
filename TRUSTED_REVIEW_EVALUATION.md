# Trusted review provider evaluation

Codex activation requires separate provider quality, token and speed measurements. Claude subscription usage must not substitute for a separate OpenAI API credential.

## Reproduced historical defects

The offline replay script imports each fix's regression test into the chosen buggy snapshot, runs just that test, and restores the original test afterward. It verifies that the snapshot exists and precedes the fix. Component snapshots must be the fix's immediate parent. It repeats against the fixed snapshot and requires failure before and success after. The frozen cases have these expected outcomes:

| Case | Buggy snapshot | Fixed snapshot | Buggy test | Fixed test |
| --- | --- | --- | --- | --- |
| case-1: unknown store socket frame throws | `950a11002a35bab3d2671c2d858615ff86587fd7` | `1b90fd34f64459f960ff0e735c1eb1f1266fcc11` | exit 1 | exit 0 |
| case-2: a removed playoff month remains stored | `8e61ec83806cf5cd0f21a2791b456039aec5e7be` | `f2f919e6ae856d9e7b2a953ffceb9e55ffe66714` | exit 1 | exit 0 |
| range-694: complete historical PR #694, both apps and shared code | `54e0ca728ecd43d12a670b8a35aebb97b63335c2` | `1b90fd34f64459f960ff0e735c1eb1f1266fcc11` | exit 1 | exit 0 |
| range-734: complete historical PR #734 | `a6105d72d8706dc280d162b890a6cd82b21888dc` | `1b90fd34f64459f960ff0e735c1eb1f1266fcc11` | exit 1 | exit 0 |

The two complete ranges reproduce case-1's socket defect; they are not two additional independent bugs. Range #734 changes only comments in the defect's files, so that defect is pre-existing there. It is a completion-only case with no changed-code detection target: detection is null, and confirmed-target adjudications are rejected. A valid Pre-existing report is not a false finding. Their reviewed ranges are each frozen head's first parent through that head. PR #694 changes 51 files across both apps, shared page and Worker code, tests and rules. Component audits supply their target files completely; full-range trials supply the complete production review plan, including its disclosed generated/binary exclusions.

Component audits intentionally deliver complete files in addition-formatted envelopes, even when the selected commit did not change them. They audit the frozen components, not that commit's Git diff. Both providers receive this distinction in the same bound context. Historical-range trials retain the actual first-parent diff and Pre-existing classification.

Reproduce with `node worker/review-evaluation.mjs reproduce /tmp/review-cases`. The destination must not exist. The script writes the snapshots, reproduction logs, review context and a hidden adjudication rubric outside git. It runs no provider and posts nothing to GitHub.

## Separate provider trials

Copy only a case's `buggy` checkout and `review-context.json` to a disposable runner. Never expose the sibling fixed checkout, regression replay or rubric to either model. Give each provider the same trusted rules, context and required snapshot content, with its native tools and the complete repository available. Record all supplied content and commands, including investigation beyond targets.

Run Claude and Codex as independent trials, never together on a live PR. Use each provider's recorded comparison profile, as described under Hosted blind trials; these profiles do not represent full production-run measurements. Capture final structured answers, all portion and integration outcomes, native usage telemetry, elapsed wall time including setup and integration, model and tool versions, and the exact snapshot identity. Record failures and interruptions as trials too.

These first two cases audit historical components; they do not establish full PR quality or large-change completion. Before enabling Codex, also replay the original complete historical PR ranges and large changes with multiple areas. Include both apps, interactions, empty candidates, malformed results and a deliberate interruption. Do not omit difficult cases or failed runs.

## Hosted blind trials

`provider-review-trial.yml` accepts one explicit provider and one frozen case per owner dispatch on main, while Codex remains gated. Each paid model job independently refuses reruns. The preparation job supplies identical trusted rules, observed-test context and complete required content independently of the provider. Common-content hashes distinguish actual supplied input from a model's claim of reading it.

Only the historical head and its ancestors reach the model host, in a Git bundle. Current source, fixes and the hidden rubric arrive only after execution. Claude uses the trusted production first-attempt prompts directly, including search forms, stale-name searches and test checks. Its action, model, tools, turn limits and 15-minute investigation/30-minute integration step limits match production. The recorded production-prompt-single-attempt profile intentionally omits production's remaining-read retry. It also requires full integration Read coverage beyond production's across-area policy. These are explicitly different completion policies, not full production-run measurements; do not label their quality, tokens or time as production results. Codex uses its production action/CLI/model, native tools, structured schema and semantic portions. Its offline configuration additionally [disables web search](https://developers.openai.com/codex/config-reference/#web_search), preventing cached or live lookup of later answers. Integration is unconditional after complete portions when the production provider policy requires it, including empty candidate lists.

The native validator checks exact case/head/base/source/run/provider, immutable input/plan/bundle hashes, actual coverage and candidate dispositions. Codex unfinished or unjudged work blocks completion. Claude retains unjudged limitations in its structured records without blocking an otherwise complete review, matching REVIEW.md. Claude coverage is normalized from real SDK Read records through the same helper as live artifact export. Integration requires Read-tool evidence for the candidate list, every required diff and every required rule; shell output does not satisfy that check. No synthetic Claude events stand in for Codex's supplied-content evidence. These trials have no publishing permission and cannot satisfy a live PR's checks.

Native investigation portions generate candidates without a prior candidate file. Only integration receives candidates.json. A contained native session creates and verifies its own candidates. These phase instructions do not relax completion, coverage or required integration checks.

GitHub artifacts and job outputs are public. The one-day review-trial-input and trial-session-input artifacts contain historical bundles, trusted rules/context, prompts, schemas and configuration in plaintext before execution. Claude's prompt and schema also pass through job outputs. Supply no private values in these inputs. Only post-execution raw evidence uses the encrypted 14-day transport.

A session creates an RSA evidence key outside git and keeps its private key in private session storage. The evidence-certificate input requires a PEM X.509 certificate with an RSA key of at least 3072 bits; a bare public key or any PRIVATE KEY block is rejected. Only that public certificate enters GitHub. For example, prepare the files outside the repository before a separately authorized dispatch:

```sh
umask 077
mkdir -p /tmp/trusted-review-evidence
openssl req -x509 -newkey rsa:4096 -sha256 -days 30 -nodes -keyout /tmp/trusted-review-evidence/key.pem -out /tmp/trusted-review-evidence/certificate.pem -subj /CN=example-evidence
```

Keep key.pem private and supply only certificate.pem as the workflow input. Preparation checks its strength and tests OpenSSL CMS encryption before any model runs. After execution, complete supplied context, answers and raw command/tool transcripts are encrypted with AES-256-GCM and RSA-OAEP/SHA-256 before upload. The private key never enters GitHub or a model host.

The one-day public session artifact contains validated answer/coverage records and numeric usage; a separate 14-day artifact contains only encrypted raw evidence. A session downloads and decrypts that evidence privately for command inspection and adjudication. Never print or publish its plaintext. Preserve the private key until every trial is adjudicated; losing it makes those raw records unavailable, not public. Encryption adds no permission to publish sensitive material.

Record each configured action/model and observed CLI/SDK version separately. An unavailable observed version remains null until verified from actual run evidence. `sessionElapsedSeconds` measures from that model job's input download through the start of collection. Measure complete trial wall time from Actions job timestamps, including preparation, setup, queues, validation, evidence capture and integration. Sum usage from every portion and integration session. Keep failed, interrupted and unmeasured trials in the report; absent usage is never zero. All outputs remain evidence to adjudicate, not automatic quality scores.

Judge each reported finding against the code and reproducer, separately for each provider and recorded comparison profile. Range #734 has no detection target; evaluate its completion and adjudicate any Pre-existing finding separately. Record its id, verdict and evidence as `confirmed-target`, `confirmed-other`, `false` or `unsure`. A real additional defect is not a false finding. Report unresolved adjudications separately. Do not use a model's own accuracy or completion assertion as the score.

## Measurements

`node worker/review-evaluation.mjs measure <trial.json> <telemetry-file>` emits detection, false findings, unresolved findings, completion, token counters and elapsed time for one provider and case. Retain its telemetry hash and any raw offline-trial artifacts privately; public GitHub artifacts are not private storage. Claude telemetry is its SDK execution-message JSON array; Codex telemetry is `usage.jsonl`, containing only validated numeric usage from native `turn.completed` events in the one-day answer artifact. Raw turns and tool output never enter that artifact. Include every session, including integration. The collector sums final usage events rather than intermediate Claude messages.

The trial JSON requires `case`, `head`, `fix`, `provider`, `comparisonProfile`, `model`, `toolVersion`, `status`, `elapsedSeconds` and `adjudications`. The profile must be production-prompt-single-attempt for Claude or native-offline for Codex; measurements retain it. Status is `completed`, `failed` or `interrupted`. The snapshot and fix must match a frozen case. Each adjudication has a unique nonempty `id`, `verdict` and an evidence-based `reason`. Missing usage cannot be reported as zero. The live review may validate an answer without telemetry, but its evaluation remains unmeasured until usage is observed.

Input counts exclude cache reads for both providers. Claude reports cache creation separately from its uncached input; Codex's reported cache-write count is already a subset of its noncached input. Native reasoning output is likewise included in output, so do not add either subset twice. Missing optional counters are unavailable, never zero. The collector rejects negative or inconsistent reported counters.

| Provider | Detection    | False findings | Completion   | Tokens       | Elapsed      |
| -------- | ------------ | -------------- | ------------ | ------------ | ------------ |
| Claude   | not measured | not measured   | not measured | not measured | not measured |
| Codex    | not measured | not measured   | not measured | not measured | not measured |

Keep `TRUSTED_CODEX_REVIEW_ENABLED` unset until real results and disposable-runner proofs are reviewed and recorded in the enabling PR or its setup evidence. Neither unit tests nor reproduced bug fixtures establish equivalent quality or better efficiency.
