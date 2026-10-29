import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createGitHub, readAllPages, readPages } from "./github-api.mjs";
import { readReviewArtifact } from "./review-artifact.mjs";
import { readReviewRun } from "./review-run.mjs";
import { isGitObjectId } from "./git-object.mjs";
import {
  readNativeRatePolicyHash,
  readNativeRatePolicy,
  requireNativeQuotaIdentity,
  createNativeAdmissionStepName,
  isNativeAdmissionStepName,
} from "./codex-rate-policy.mjs";

import { readNativeRateEntries } from "./codex-rate-source.mjs";

const workflows = readNativeRateEntries().map(({ entry }) => entry);
const baseline = "3f81595241c7fc53c994ca4534398cec14357c89";
const nativeSteps = new Set(readNativeRateEntries().map(({ step }) => step));

function requireTime(value) {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0) throw new Error("Unavailable quota producer time.");
  return time;
}

function isQuotaRecoveryDue(producer, now) {
  const policy = readNativeRatePolicy();
  return now - requireTime(producer.job.completed_at) >= policy.windowMs + policy.maxWaitMs;
}

function isCompletedQuotaRunAged(run, now) {
  return (
    run.status === "completed" &&
    typeof run.updated_at === "string" &&
    Number.isSafeInteger(Date.parse(run.updated_at)) &&
    isQuotaRecoveryDue({ job: { completed_at: run.updated_at } }, now)
  );
}

/** @param {any} run @param {any} expected */
export function readNativeQuotaSource(run, expected) {
  if (
    !Number.isSafeInteger(run?.id) ||
    run.repository?.id !== expected.repositoryId ||
    run.repository?.full_name !== expected.repository ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    !workflows.some((name) => run.path === `.github/workflows/${name}`)
  )
    throw new Error("Untrusted native quota workflow.");
  if (run.path === ".github/workflows/review.yml") {
    const review = readReviewRun(run);
    if (!review || review.intent !== "review")
      throw new Error("Untrusted native review quota source.");
    return review.source;
  }
  if (
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.actor?.login !== expected.owner ||
    run.triggering_actor?.login !== expected.owner ||
    !isGitObjectId(run.head_sha)
  )
    throw new Error("Untrusted dispatched native quota source.");
  return run.head_sha;
}

/** @param {any[]} jobs @param {number} run @param {string} portion */
export function selectCurrentQuotaJob(jobs, run, portion) {
  const name = createNativeAdmissionStepName(portion);
  const matches = jobs.filter((job) =>
    job.steps?.some((step) => step.name === name && step.status === "in_progress"),
  );
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0].id) ||
    matches[0].run_id !== run ||
    matches[0].run_attempt !== 1 ||
    matches[0].status !== "in_progress"
  )
    throw new Error("Missing or ambiguous active native quota producer.");
  requireTime(matches[0].started_at);
  return matches[0];
}

/** @param {any[]} candidates @param {any} current */
export function selectPreviousQuotaJob(candidates, current) {
  const started = requireTime(current.started_at);
  const previous = [];
  for (const candidate of candidates) {
    const { job } = candidate;
    if (job.id === current.id) continue;
    const native = job.steps?.find((step) => nativeSteps.has(step.name));
    if (!native || native.conclusion === "skipped") continue;
    if (native.status === "queued") {
      if (
        job.status === "in_progress" &&
        job.steps?.some(
          (step) => step.status === "in_progress" && isNativeAdmissionStepName(step.name),
        )
      )
        throw new Error("Another native quota admission is active.");
      continue;
    }
    if (
      job.status !== "completed" ||
      job.run_attempt !== 1 ||
      !["success", "failure", "cancelled", "timed_out"].includes(job.conclusion)
    )
      throw new Error("Another native quota consumer is active or unverifiable.");
    const completed = requireTime(job.completed_at);
    if (completed > started || requireTime(job.started_at) >= started)
      throw new Error("Native quota consumers overlap.");
    previous.push({ ...candidate, completed });
  }
  previous.sort((left, right) => right.completed - left.completed);
  if (previous.length > 1 && previous[0].completed === previous[1].completed)
    throw new Error("Ambiguous previous native quota consumer.");
  return previous[0] ?? null;
}

/** @param {any} record @param {any} producer @param {any} expected @param {number} now */
export function validateQuotaHandoff(record, producer, expected, now, { pastPolicy = false } = {}) {
  if (pastPolicy && !isQuotaRecoveryDue(producer, now))
    throw new Error("Recent native quota policy cannot be replaced.");
  requireNativeQuotaIdentity(record, pastPolicy ? record.policy : readNativeRatePolicyHash());
  const { job, run, source } = producer;
  const completed = requireTime(job.completed_at);
  if (
    record?.version !== 1 ||
    record.repository !== expected.repository ||
    record.run !== run.id ||
    record.job !== job.id ||
    record.source !== source ||
    (!pastPolicy && record.policy !== readNativeRatePolicyHash()) ||
    record.finalized !== true ||
    record.feedbackFailed !== false ||
    record.namespacesRestored !== true ||
    record.runtimeRemoved !== true ||
    !["parent-exited", "deadline", "not-started"].includes(record.termination) ||
    (record.termination === "not-started" &&
      (record.requests !== 0 || record.reservedTokens !== 0 || record.observedTokens !== null)) ||
    !Number.isSafeInteger(record.completedAt) ||
    record.completedAt < requireTime(job.started_at) ||
    record.completedAt > completed ||
    !Number.isSafeInteger(record.notBefore) ||
    record.notBefore < record.completedAt + (pastPolicy ? 0 : readNativeRatePolicy().windowMs) ||
    !Number.isSafeInteger(record.scanSince) ||
    record.scanSince > requireTime(run.created_at) ||
    record.scanSince < 0 ||
    !Number.isSafeInteger(record.reservedTokens) ||
    record.reservedTokens < 0 ||
    (record.observedTokens !== null &&
      (!Number.isSafeInteger(record.observedTokens) || record.observedTokens < 0)) ||
    completed > now
  )
    throw new Error("Incomplete or mismatched native quota handoff.");
  return {
    notBefore: Math.max(record.notBefore, completed + readNativeRatePolicy().windowMs),
    scanSince: record.scanSince,
    activeRuns: record.activeRuns,
  };
}

/** @param {any} expected @param {any} [dependencies] */
export async function readNativeQuotaAdmission(
  expected,
  { fetchImpl = fetch, now = Date.now } = {},
) {
  const api = createGitHub({
    repository: expected.repository,
    fetchImpl,
    env: { GH_TOKEN: expected.token },
  });
  const sourceTrust = new Map();
  const main = await api("/git/ref/heads/main");
  if (!isGitObjectId(main.object?.sha)) throw new Error("Native quota main source is unavailable.");
  async function verifySource(source) {
    if (sourceTrust.has(source)) return;
    for (const [base, head] of [
      [baseline, source],
      [source, main.object.sha],
    ]) {
      const comparison = await api(`/compare/${base}...${head}`);
      if (
        !["ahead", "identical"].includes(comparison.status) ||
        comparison.behind_by !== 0 ||
        comparison.merge_base_commit?.sha !== base
      )
        throw new Error("Native quota source ancestry is unverified.");
    }
    sourceTrust.set(source, true);
  }
  const currentRun = await api(`/actions/runs/${expected.run}`);
  if (currentRun.run_attempt !== 1) throw new Error("Untrusted current native quota attempt.");
  const currentSource = readNativeQuotaSource(currentRun, expected);
  if (currentSource !== expected.source) throw new Error("Native quota source mismatch.");
  await verifySource(currentSource);
  const currentJobs = await readAllPages(
    api,
    `/actions/runs/${expected.run}/jobs?filter=all`,
    (answer) => answer.jobs,
  );
  const current = selectCurrentQuotaJob(currentJobs, expected.run, expected.portion);
  const initial = await api(`/commits/${baseline}`);
  let scanSince = requireTime(initial.commit?.committer?.date);
  let activeRuns = [];
  let seedNotBefore = 0;

  function readTrustedSource(run) {
    try {
      return readNativeQuotaSource(run, expected);
    } catch {
      return null;
    }
  }

  function isRecoveryDue(producer) {
    return isQuotaRecoveryDue(producer, now());
  }

  async function readProducer(artifact) {
    const run = await api(`/actions/runs/${artifact.workflow_run.id}`);
    const source = readNativeQuotaSource(run, expected);
    await verifySource(source);
    const jobs = await readAllPages(api, `/actions/runs/${run.id}/jobs?filter=all`, (a) => a.jobs);
    const matches = jobs.filter((job) => artifact.name === `codex-rate-handoff-${job.id}`);
    if (matches.length !== 1) throw new Error("Missing native quota artifact producer.");
    const job = matches[0];
    if (
      job.status !== "completed" ||
      job.run_id !== run.id ||
      job.run_attempt !== 1 ||
      !["success", "failure", "cancelled", "timed_out"].includes(job.conclusion) ||
      !job.steps?.some(
        (step) =>
          nativeSteps.has(step.name) &&
          step.status === "completed" &&
          step.conclusion !== "skipped",
      )
    )
      throw new Error("Native quota handoff is not a terminal model producer.");
    return { run, source, job };
  }
  async function readRecord(artifact, producer) {
    const created = requireTime(artifact.created_at);
    if (
      created < requireTime(producer.job.started_at) ||
      created > requireTime(producer.job.completed_at)
    )
      throw new Error("Native quota artifact lies outside its producer lifetime.");
    const folder = await readReviewArtifact(artifact, {
      repository: expected.repository,
      repositoryId: expected.repositoryId,
      run: producer.run.id,
      token: expected.token,
      names: ["cooldown.json"],
      fetchImpl,
    });
    try {
      return JSON.parse(readFileSync(join(folder, "cooldown.json"), "utf8"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  async function readHandoff(artifact, producer) {
    if (artifact.expired) {
      if (!isRecoveryDue(producer)) throw new Error("Recent native quota evidence expired.");
      return null;
    }
    const record = await readRecord(artifact, producer);
    const pastPolicy = record.policy !== readNativeRatePolicyHash() && isRecoveryDue(producer);
    const state = validateQuotaHandoff(record, producer, expected, now(), { pastPolicy });
    if (pastPolicy)
      state.notBefore = Math.max(state.notBefore, now() + readNativeRatePolicy().windowMs);
    return state;
  }
  let seedSearchFinished = false;
  let skipExpiredSeeds = false;
  for await (const artifacts of readPages(
    api,
    "/actions/artifacts",
    (answer) => answer.artifacts,
  )) {
    for (const artifact of artifacts) {
      if (!/^codex-rate-handoff-[1-9]\d*$/.test(artifact.name)) continue;
      if (skipExpiredSeeds && artifact.expired) continue;
      const run = await api(`/actions/runs/${artifact.workflow_run.id}`);
      if (readTrustedSource(run) === null) continue;
      const producer = await readProducer(artifact);
      const seed = await readHandoff(artifact, producer);
      if (!seed) {
        skipExpiredSeeds = true;
        continue;
      }
      scanSince = seed.scanSince;
      activeRuns = seed.activeRuns;
      seedNotBefore = seed.notBefore;
      seedSearchFinished = true;
      break;
    }
    if (seedSearchFinished) break;
  }
  const runs = new Map([[currentRun.id, currentRun]]);
  for (const id of activeRuns) runs.set(id, await api(`/actions/runs/${id}`));
  for (const workflow of workflows) {
    const recent = await readAllPages(
      api,
      `/actions/workflows/${workflow}/runs?created=%3E%3D${encodeURIComponent(new Date(scanSince).toISOString())}`,
      (answer) => answer.workflow_runs,
    );
    for (const run of recent) runs.set(run.id, run);
    for (const status of ["queued", "in_progress", "pending", "waiting"]) {
      const active = await readAllPages(
        api,
        `/actions/workflows/${workflow}/runs?status=${status}`,
        (answer) => answer.workflow_runs,
      );
      for (const run of active) runs.set(run.id, run);
    }
  }
  const candidates = [];
  for (const run of runs.values()) {
    const source = readTrustedSource(run);
    if (source === null || isCompletedQuotaRunAged(run, now())) continue;
    const jobs = await readAllPages(api, `/actions/runs/${run.id}/jobs?filter=all`, (a) => a.jobs);
    const native = jobs.filter((job) =>
      job.steps?.some((step) => nativeSteps.has(step.name) && step.conclusion !== "skipped"),
    );
    if (!native.length) continue;
    await verifySource(source);
    for (const job of native) candidates.push({ run, source, job });
  }
  const previous = selectPreviousQuotaJob(candidates, current);
  let notBefore = Math.max(seedNotBefore, now() + readNativeRatePolicy().windowMs);
  if (previous) {
    const artifacts = await readAllPages(
      api,
      `/actions/runs/${previous.run.id}/artifacts`,
      (answer) => answer.artifacts,
    );
    const matches = artifacts.filter(
      (artifact) => artifact.name === `codex-rate-handoff-${previous.job.id}`,
    );
    if (matches.length > 1 || (!matches.length && !isRecoveryDue(previous)))
      throw new Error("Missing or duplicate preceding native quota state.");
    if (matches.length) {
      const handoff = await readHandoff(matches[0], previous);
      if (handoff) notBefore = Math.max(seedNotBefore, handoff.notBefore);
      const refreshed = await readProducer(matches[0]);
      if (
        refreshed.job.completed_at !== previous.job.completed_at ||
        refreshed.job.conclusion !== previous.job.conclusion ||
        refreshed.source !== previous.source
      )
        throw new Error("Native quota producer changed during verification.");
    }
  }
  const unfinished = [...runs.values()].filter(
    (run) => run.status !== "completed" && readTrustedSource(run) !== null,
  );
  if (unfinished.length > 256 || !unfinished.some((run) => run.id === currentRun.id))
    throw new Error("Unverifiable active native quota workflows.");
  const refreshedRun = await api(`/actions/runs/${expected.run}`);
  if (
    refreshedRun.run_attempt !== 1 ||
    readNativeQuotaSource(refreshedRun, expected) !== currentSource
  )
    throw new Error("Native quota invocation changed during admission.");
  const refreshedJob = selectCurrentQuotaJob(
    await readAllPages(api, `/actions/runs/${expected.run}/jobs?filter=all`, (a) => a.jobs),
    expected.run,
    expected.portion,
  );
  if (refreshedJob.id !== current.id || refreshedJob.started_at !== current.started_at)
    throw new Error("Native quota job changed during admission.");
  return {
    version: 1,
    repository: expected.repository,
    run: currentRun.id,
    job: current.id,
    source: currentSource,
    policy: readNativeRatePolicyHash(),
    notBefore,
    scanSince: Math.min(...unfinished.map((run) => requireTime(run.created_at))),
    activeRuns: unfinished.map((run) => run.id),
    predecessor: previous?.job.id ?? null,
  };
}
