// Resumable identity work with independent writer versions and a conservative storage-work allowance.
import { isSameJson } from "../page/compare.js";
import { hashTextInFull } from "./hash-text.js";
import { reconcileIdentities, nameIdentityGameGroup } from "./identity-matching.js";
import { readPlayerName } from "./player-name.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import { IdentityFactsChanged } from "./identity.js";

export const IDENTITY_AUDIT_VERSION = 2;
export const IDENTITY_WORK_PER_RUN = 20;
export const IDENTITY_WORK_PER_DAY = 10_000;
export const IDENTITY_WORK_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_KEY = "identity:backfill";
const WORK_KEY = "identity:work";
const COVERAGE_KEY = "identity:coverage-revision";
const MAX_CANDIDATE_BYTES = 512 * 1024;
const MAX_RETRY_MS = 60 * IDENTITY_WORK_INTERVAL_MS;

const createProgress = (coverageRevision = null) => ({
  version: IDENTITY_AUDIT_VERSION,
  cursor: "",
  checkedDocuments: 0,
  complete: false,
  phase: "documents",
  missingEntries: 0,
  missingFacts: 0,
  conflicts: 0,
  coverageRevision,
  factsRevision: null,
  pending: null,
});

const describeSignature = (value) => hashTextInFull(JSON.stringify(value));

function chooseSourceStage(source) {
  if (source.kind !== "vendor") return "native";
  return source.records.length ? "candidates" : "done";
}

/**
 * @param {any} storage
 * @param {{ lookup: any, policy: any, describeSource: (key: string, value: any, phase: string, docs: any) => Promise<any>, saveErrors: (key: string, count: number, kind?: string) => Promise<void>, hasFailedSources: () => Promise<boolean>, saveGameMatches: (results: any[], docs: any) => Promise<void> }} options
 * @param {() => number} now
 */
export function createIdentityBackfill(storage, options, now) {
  const { lookup, policy, describeSource, saveErrors, hasFailedSources, saveGameMatches } = options;

  async function readCurrentProgress() {
    const previous = await storage.get(BACKFILL_KEY);
    const coverageRevision = (await storage.get(COVERAGE_KEY)) ?? null;
    const factsRevision = await lookup.readFactsRevision();
    let progress =
      previous?.version === IDENTITY_AUDIT_VERSION &&
      (previous.coverageRevision ?? null) === coverageRevision
        ? { ...createProgress(coverageRevision), ...structuredClone(previous) }
        : createProgress(coverageRevision);
    if (
      !progress.complete &&
      progress.phase !== "documents" &&
      progress.factsRevision !== factsRevision
    ) {
      progress = {
        ...progress,
        phase: "facts",
        cursor: "",
        pending: null,
        complete: false,
        missingEntries: 0,
        missingFacts: 0,
        conflicts: 0,
        factsRevision,
      };
    }
    return { previous, progress };
  }

  async function saveProgress(previous, progress, isActive) {
    if (!isActive()) return;
    await storage.transaction(async (transaction) => {
      const latest = await transaction.get(BACKFILL_KEY);
      if (!isActive() || !isSameJson(latest, previous)) return;
      await transaction.put(BACKFILL_KEY, progress);
    });
  }

  async function reserveWork(isActive) {
    const at = now();
    const day = Math.floor(at / DAY_MS);
    return storage.transaction(async (transaction) => {
      if (!isActive()) return false;
      const previous = await transaction.get(WORK_KEY);
      const budget = previous?.day >= day ? previous : { day, used: 0, nextAt: 0 };
      if (budget.nextAt > at || budget.used + IDENTITY_WORK_PER_RUN > IDENTITY_WORK_PER_DAY)
        return false;
      await transaction.put(WORK_KEY, {
        day: budget.day,
        used: budget.used + IDENTITY_WORK_PER_RUN,
        nextAt: at + IDENTITY_WORK_INTERVAL_MS,
      });
      return true;
    });
  }

  async function collectCandidates(source, pending, work) {
    const revision = await lookup.readFactsRevision();
    if (pending.nativeRevision !== revision) {
      pending.nativeRevision = revision;
      pending.candidateCursor = "";
      pending.candidates = [];
      pending.offset = 0;
    }
    const prefix = `identity:entity:${encodeURIComponent(policy.league)}:${source.type}:`;
    const limit = work.remaining;
    work.remaining = 0;
    const entries = await storage.list({ prefix, startAfter: pending.candidateCursor, limit });
    work.remaining = limit - Math.max(1, entries.size);
    const groups = new Set(
      source.records.map(source.type === "game" ? nameIdentityGameGroup : readPlayerName),
    );
    for (const [key, entry] of entries) {
      const matches =
        source.type === "game"
          ? entry.vendors[policy.vendor] && groups.has(nameIdentityGameGroup(entry.facts ?? {}))
          : groups.has(readPlayerName(entry.facts ?? {}));
      if (matches) pending.candidates.push({ id: entry.id, ...entry.facts });
      pending.candidateCursor = key;
    }
    if (new TextEncoder().encode(JSON.stringify(pending.candidates)).length > MAX_CANDIDATE_BYTES)
      throw new Error("Identity candidate evidence exceeds the checkpoint limit");
    if (entries.size < limit) pending.stage = "vendor";
  }

  async function saveVendorBatch(source, pending, work, docs) {
    if (pending.nativeRevision !== (await lookup.readFactsRevision())) {
      pending.stage = "candidates";
      return;
    }
    const count = new Set(source.records.map((record) => String(record.id))).size;
    const limit = work.remaining;
    work.remaining -= Math.max(1, Math.min(count - pending.offset, limit));
    let results;
    try {
      results = await reconcileIdentities(lookup, {
        type: source.type,
        vendor: ESPN_VENDOR,
        natives: pending.candidates,
        records: source.records,
        offset: pending.offset,
        limit,
        factsRevision: pending.nativeRevision,
      });
    } catch (error) {
      if (!(error instanceof IdentityFactsChanged)) throw error;
      pending.stage = "candidates";
      return;
    }
    pending.offset += results.length;
    if (source.type === "game") await saveGameMatches(results, docs);
    if (pending.offset >= count) pending.stage = "done";
  }

  async function registerNativeBatch(source, pending, work) {
    const batch = source.observations.slice(pending.offset, pending.offset + work.remaining);
    work.remaining -= Math.max(1, batch.length);
    if (batch.length) {
      await lookup.save(batch);
    }
    pending.offset += batch.length;
    if (pending.offset >= source.observations.length) {
      pending.offset = 0;
      pending.stage = source.records.length ? "candidates" : "done";
    }
  }

  async function checkNativeBatch(source, pending, work) {
    const batch = source.observations.slice(pending.offset, pending.offset + work.remaining);
    work.remaining -= Math.max(1, batch.length);
    for (const observation of batch) {
      if (
        (await lookup.read(observation.type, observation.vendor, observation.vendorId)) !==
        observation.internalId
      )
        pending.missingEntries += 1;
      if (
        observation.type === "game" &&
        !Number.isInteger((await lookup.readEntry("game", observation.internalId))?.facts?.season)
      )
        pending.missingFacts += 1;
    }
    pending.offset += batch.length;
    if (pending.offset >= source.observations.length) {
      pending.offset = 0;
      pending.stage = source.records.length ? "candidates" : "done";
    }
  }

  async function checkMappingBatch(key, value, pending, work) {
    const vendors = key.startsWith("identity:entity:") ? Object.keys(value.vendors).sort() : null;
    const batch = vendors?.slice(pending.offset, pending.offset + work.remaining) ?? null;
    const consumed = Math.max(1, batch?.length ?? 1);
    work.remaining -= consumed;
    pending.conflicts += await lookup.countMappingConflicts(key, batch);
    pending.offset += consumed;
    if (!vendors || pending.offset >= vendors.length) pending.stage = "done";
  }

  async function advanceSource(docs, key, value, source, progress, work, isActive) {
    const signature = await describeSignature(value);
    if (progress.pending?.key !== key || progress.pending.signature !== signature) {
      progress.pending = {
        key,
        signature,
        offset: 0,
        stage: chooseSourceStage(source),
        candidates: [],
        candidateCursor: "",
        nativeRevision: null,
        missingEntries: 0,
        missingFacts: 0,
        conflicts: 0,
      };
    }
    const pending = progress.pending;
    while (work.remaining && pending.stage !== "done" && isActive()) {
      if (source.kind === "mappings") await checkMappingBatch(key, value, pending, work);
      else if (pending.stage === "candidates") await collectCandidates(source, pending, work);
      else if (pending.stage === "vendor") await saveVendorBatch(source, pending, work, docs);
      else if (progress.phase === "facts") await checkNativeBatch(source, pending, work);
      else await registerNativeBatch(source, pending, work);
    }
    if (!isActive() || pending.stage !== "done") return false;
    const latest = await storage.get(key);
    if (!isSameJson(latest, value)) {
      progress.pending = null;
      return false;
    }
    if (source.kind === "document" && !isSameJson(source.document, value)) {
      const matched = source.cached
        ? await storage.transaction(async (transaction) => {
            const current = await transaction.get(key);
            if (!isActive() || !isSameJson(current, value)) return false;
            await transaction.put(key, source.document);
            return true;
          })
        : await docs.replaceIfUnchanged(key, value, source.document);
      if (!matched) {
        progress.pending = null;
        return false;
      }
    }
    if (!isActive()) return false;
    await saveErrors(key, source.rejected ?? 0);
    if (progress.phase !== "facts") await saveErrors(key, 0, "failed");
    progress.missingEntries += pending.missingEntries;
    progress.missingFacts += pending.missingFacts;
    progress.conflicts += pending.conflicts;
    return true;
  }

  async function finishPhase(progress) {
    progress.cursor = "";
    progress.pending = null;
    if (progress.phase === "documents") {
      progress.phase = "facts";
      progress.factsRevision = await lookup.readFactsRevision();
    } else if (progress.phase === "facts") progress.phase = "vendors";
    else {
      progress.complete = true;
      if (progress.recoveryAttempt && (await hasFailedSources()))
        progress.retryAfter =
          now() +
          Math.min(
            MAX_RETRY_MS,
            IDENTITY_WORK_INTERVAL_MS * 2 ** Math.min(progress.recoveryAttempt - 1, 6),
          );
    }
  }

  async function backfill(docs, isActive = () => true) {
    if (!isActive()) return;
    const { previous, progress: current } = await readCurrentProgress();
    let progress = current;
    if (progress.complete) {
      if (progress.retryAfter > now() || !(await hasFailedSources())) return;
      progress = {
        ...createProgress(progress.coverageRevision),
        recoveryAttempt: (progress.recoveryAttempt ?? 0) + 1,
      };
    }
    const work = { remaining: IDENTITY_WORK_PER_RUN };
    while (work.remaining && isActive()) {
      const pendingKey = progress.pending?.key;
      const entries = pendingKey
        ? new Map([[pendingKey, await storage.get(pendingKey)]])
        : await storage.list({ prefix: "", startAfter: progress.cursor, limit: 1 });
      work.remaining -= 1;
      if (!isActive()) return;
      if (!entries.size) {
        await finishPhase(progress);
        break;
      }
      const [key, value] = [...entries][0];
      if (progress.phase !== "vendors" && key.startsWith("identity:")) {
        progress.cursor = "identity;";
        progress.pending = null;
        continue;
      }
      if (!work.remaining) break;
      let done = true;
      try {
        const source =
          value === undefined ? null : await describeSource(key, value, progress.phase, docs);
        if (source?.kind === "changed") {
          progress.pending = null;
          done = false;
        } else if (source)
          done = await advanceSource(docs, key, value, source, progress, work, isActive);
      } catch {
        if (!isActive()) return;
        await saveErrors(key, 1, "failed").catch(() => {});
      }
      if (!isActive()) return;
      if (!done) break;
      progress.pending = null;
      progress.cursor = key;
      progress.checkedDocuments += 1;
    }
    await saveProgress(previous, progress, isActive);
  }

  async function readStatus(errors) {
    const progress = await storage.get(BACKFILL_KEY);
    const coverageRevision = (await storage.get(COVERAGE_KEY)) ?? null;
    const complete =
      !!progress?.complete &&
      progress.version === IDENTITY_AUDIT_VERSION &&
      (progress.coverageRevision ?? null) === coverageRevision;
    return {
      checks: {
        verified:
          complete &&
          !progress.missingEntries &&
          !progress.missingFacts &&
          !progress.conflicts &&
          !errors,
        missingEntries: progress?.missingEntries ?? 0,
        missingFacts: progress?.missingFacts ?? 0,
        competingMappings: progress?.conflicts ?? 0,
      },
      backfill: { complete, checkedDocuments: progress?.checkedDocuments ?? 0 },
    };
  }

  return {
    backfill,
    backfillWhenDue: async (docs, isActive = () => true) => {
      if (isActive() && (await reserveWork(isActive))) await backfill(docs, isActive);
    },
    readStatus,
  };
}
