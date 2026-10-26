import { readReviewRun, REVIEW_CHECK_NAME } from "./review-run.mjs";
import { createHash } from "node:crypto";
import { needsCodexIntegration } from "./review-supplied.mjs";

/** @param {any} evidence */
export const createPublicationStamp = (evidence) =>
  JSON.stringify({
    version: 1,
    digest: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
  });

/** @param {any} check @param {any} evidence @param {number} appId */
export function validatePublicationAttestation(check, evidence, appId) {
  if (
    check?.app?.id !== appId ||
    check.name !== REVIEW_CHECK_NAME ||
    check.head_sha !== evidence.head ||
    check.id !== evidence.check ||
    check.output?.text !== createPublicationStamp(evidence)
  )
    throw new Error("Terminal evidence has no matching App-owned attestation.");
}

export const REVIEW_PUBLICATION_STAGES = [
  "review-select",
  "review-begin",
  "review-plan",
  "review-label",
  "review-area",
  "review-across",
  "review-codex",
  "review-codex-across",
  "review-post",
  "review",
];

/** @param {any[]} pulls @param {string} head @param {string} repository */
export function selectPublicationPull(pulls, head, repository) {
  const matching = pulls.filter((pull) => pull.head?.sha === head);
  if (matching.length !== 1) return null;
  const pull = matching[0];
  return pull.state === "open" &&
    !pull.draft &&
    pull.base?.ref === "main" &&
    pull.base.repo?.full_name === repository
    ? pull
    : null;
}

/** @param {any[]} runs @param {any} pull @param {{name:string,id:number}} repository */
export function selectPublicationRun(runs, pull, repository) {
  return (
    runs
      .filter((run) => {
        const identity = readReviewRun(run);
        return (
          identity?.intent === "review" &&
          identity.target === "main" &&
          identity.pull === pull.number &&
          identity.head === pull.head.sha &&
          identity.base === pull.base.sha &&
          run.repository.full_name === repository.name &&
          run.repository.id === repository.id &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(run.created_at ?? "")
        );
      })
      .sort(
        (first, second) =>
          second.created_at.localeCompare(first.created_at) || second.id - first.id,
      )[0] ?? null
  );
}

/** @param {any} pull */
export const isPublicationExempt = (pull) =>
  pull.user?.login === "dependabot[bot]" && pull.user?.type === "Bot";

/** @param {any[]} jobs @param {string} name @param {number} attempt */
function selectProducerJob(jobs, name, attempt) {
  const matching = jobs.filter(
    (job) =>
      (job.name === name ||
        job.name.startsWith(`${name} / `) ||
        (["review-area", "review-codex"].includes(name) && job.name.startsWith(`${name} (`))) &&
      Number.isSafeInteger(job.id) &&
      Number.isSafeInteger(job.run_attempt) &&
      job.run_attempt <= attempt,
  );
  const byName = new Map();
  for (const job of matching) {
    const previous = byName.get(job.name);
    if (!previous || job.run_attempt > previous.run_attempt) byName.set(job.name, job);
    else if (job.run_attempt === previous.run_attempt && job.id !== previous.id)
      throw new Error("Ambiguous producer jobs.");
  }
  return [...byName.values()].sort((first, second) => first.name.localeCompare(second.name));
}

/** @param {any[]} jobs @param {number} attempt @param {any} needs */
export function validatePublicationJobs(jobs, attempt, needs) {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error("Invalid publication attempt.");
  const count = Number(needs["review-plan"]?.outputs?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Missing trusted area count.");
  const labeled = needs["review-plan"]?.outputs?.labeled === "true";
  const provider = needs["review-plan"]?.outputs?.provider;
  const codex = provider === "codex";
  if (provider !== undefined && !["claude", "codex"].includes(provider))
    throw new Error("Invalid producer provider.");
  if (
    provider !== undefined &&
    (needs["review-select"]?.outputs?.provider !== provider ||
      needs["review-select"]?.outputs?.selection !== needs["review-plan"]?.outputs?.selection)
  )
    throw new Error("Producer provider selection changed.");
  const required = {
    "review-select": provider !== undefined,
    "review-label": labeled,
    "review-area": count > 0 && !codex,
    "review-across": count > 0 && !codex,
    "review-codex": count > 0 && codex,
    "review-codex-across": needsCodexIntegration(provider, count),
    "review-post": count > 0,
  };
  const selected = [];
  for (const name of REVIEW_PUBLICATION_STAGES) {
    const optional = required[name] === false;
    if (
      optional &&
      needs[name] === undefined &&
      ["review-select", "review-codex", "review-codex-across"].includes(name)
    )
      continue;
    const expected = optional ? "skipped" : "success";
    if (needs[name]?.result !== expected)
      throw new Error(`Required producer did not pass: ${name}.`);
    const producers = selectProducerJob(jobs, name, attempt);
    if (!producers.length && !optional) throw new Error(`Missing producer job: ${name}.`);
    if (name === "review-area" && !optional && count > 0 && producers.length !== count)
      throw new Error("Review area jobs do not match the trusted plan.");
    if (["review-codex", "review-codex-across"].includes(name) && !optional) {
      const prefixes = new Map();
      for (const job of producers) {
        const match = /^(.*) \/ (request|model|validate)$/.exec(job.name);
        if (!match) throw new Error("Invalid Codex producer stage.");
        if (!prefixes.has(match[1])) prefixes.set(match[1], []);
        prefixes.get(match[1]).push(match[2]);
      }
      if (
        prefixes.size !== (name === "review-codex" ? count : 1) ||
        [...prefixes.values()].some(
          (stages) => stages.sort().join(",") !== "model,request,validate",
        )
      )
        throw new Error("Missing Codex producer stage.");
    }
    for (const job of producers) {
      if (job.status !== "completed" || job.conclusion !== expected)
        throw new Error(`Producer attempt did not pass: ${name}.`);
      selected.push({
        id: job.id,
        name: job.name,
        attempt: job.run_attempt,
        conclusion: job.conclusion,
      });
    }
  }
  return selected;
}

/** @param {any} pull @param {any} run @param {any} evidence @param {any[]} jobs */
export function validatePublicationEvidence(pull, run, evidence, jobs) {
  const identity = readReviewRun(run);
  if (
    !identity ||
    evidence.version !== 1 ||
    evidence.repository !== run.repository.full_name ||
    evidence.repositoryId !== run.repository.id ||
    evidence.pull !== pull.number ||
    evidence.head !== pull.head.sha ||
    evidence.base !== pull.base.sha ||
    evidence.target !== pull.base.ref ||
    evidence.source !== identity.source ||
    evidence.run !== run.id ||
    evidence.attempt !== run.run_attempt
  )
    throw new Error("Stale or foreign publication evidence.");
  const producers = validatePublicationJobs(jobs, run.run_attempt, evidence.needs);
  if (JSON.stringify(evidence.producers) !== JSON.stringify(producers))
    throw new Error("Publication producer attempts changed.");
  return evidence;
}
