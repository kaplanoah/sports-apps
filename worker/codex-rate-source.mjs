const entries = Object.freeze(
  [
    {
      workflow: "trusted-codex-review.yml",
      entry: "review.yml",
      step: "Investigate with native Codex",
    },
    {
      workflow: "provider-review-session.yml",
      entry: "provider-review-trial.yml",
      step: "Native Codex investigation",
    },
    {
      workflow: "codex-runner-proof.yml",
      entry: "codex-runner-proof.yml",
      step: "Run one native Codex proof",
    },
  ].map((entry) => Object.freeze(entry)),
);
const controls = Object.freeze(
  [
    "codex-rate-runtime",
    "codex-rate-source",
    "codex-rate-policy",
    "codex-rate-lifecycle",
    "codex-rate-handoff",
    "codex-rate-budget",
    "codex-rate-controller",
    "codex-rate-estimate",
    "codex-rate-gateway",
    "codex-rate-namespaces",
    "github-api",
    "review-artifact",
    "review-run",
    "git-object",
  ].map((name) => `worker/${name}.mjs`),
);

export function readNativeRateEntries() {
  return entries;
}
export function listNativeRateControls() {
  return controls;
}
