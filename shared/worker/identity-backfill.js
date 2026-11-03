// Resumable identity work with independent writer versions and a conservative storage-work allowance.
import { isSameJson } from "../page/compare.js";
import { hashTextInFull } from "./hash-text.js";
import { reconcileIdentities } from "./identity-matching.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import {
  IdentityFactsChanged,
  nameIdentityEntityPrefix,
  nameIdentityCandidatePrefix,
  IDENTITY_CANDIDATE_PREFIX,
  IDENTITY_CANDIDATE_END,
  isIdentityNativeCandidate,
  isIdentityEntityKey,
  IDENTITY_PREFIX,
  IDENTITY_PREFIX_END,
  IDENTITY_COVERAGE_KEY,
  IDENTITY_BACKFILL_KEY,
  saveIdentitySourceProblems,
  saveIdentityError,
  saveIdentitySourceRejections,
  readIdentitySourceRejections,
} from "./identity.js";

export const IDENTITY_AUDIT_VERSION = 2;
export const IDENTITY_WORK_PER_RUN = 20;
export const IDENTITY_WORK_PER_DAY = 10_000;
export const IDENTITY_WORK_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORK_KEY = `${IDENTITY_PREFIX}work`;
const MAX_CANDIDATE_BYTES = 512 * 1024;
const RETRY_DELAY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60 * 1000;

const createProgress = (coverageRevision = null) => ({
  version: IDENTITY_AUDIT_VERSION,
  cursor: "",
  checkedDocuments: 0,
  complete: false,
  phase: "documents",
  missingEntries: 0,
  nativeMissingEntries: 0,
  missingFacts: 0,
  conflicts: 0,
  coverageRevision,
  indexes: {},
  pending: null,
});

const describeSignature = (value) => hashTextInFull(JSON.stringify(value));

function chooseSourceStage(source) {
  if (source.kind !== "vendor") return "native";
  return source.records.length ? "candidates" : "done";
}

function countSourceRejections(source, pending) {
  return (source.rejected ?? 0) + (pending.nativeMissingEntries ?? 0);
}

/**
 * @param {any} storage
 * @param {{ lookup: any, policy: any, describeSource: (key: string, value: any, phase: string, docs: any) => Promise<any>, saveErrors: (key: string, count: number, kind?: string, processedRetry?: any) => Promise<void>, hasFailedSources: () => Promise<boolean>, forgetSource: (key: string) => Promise<void>, saveGameMatches: (results: any[], docs: any) => Promise<void>, registerObservations: (observations: any[], source: import("./identity.js").IdentitySource) => Promise<any[]> }} options
 * @param {() => number} now
 */
export function createIdentityBackfill(storage, options, now) {
  const {
    lookup,
    policy,
    describeSource,
    saveErrors,
    hasFailedSources,
    forgetSource,
    saveGameMatches,
    registerObservations,
  } = options;

  async function readCurrentProgress() {
    const previous = await storage.get(IDENTITY_BACKFILL_KEY);
    const coverageRevision = (await storage.get(IDENTITY_COVERAGE_KEY)) ?? null;
    const progress =
      previous?.version === IDENTITY_AUDIT_VERSION &&
      (previous.coverageRevision ?? null) === coverageRevision
        ? { ...createProgress(coverageRevision), ...structuredClone(previous) }
        : createProgress(coverageRevision);
    return { previous, progress };
  }

  async function saveProgress(previous, progress, isActive) {
    if (!isActive()) return;
    await storage.transaction(async (transaction) => {
      const latest = await transaction.get(IDENTITY_BACKFILL_KEY);
      if (!isActive() || !isSameJson(latest, previous)) return;
      await transaction.put(IDENTITY_BACKFILL_KEY, progress);
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

  async function buildCandidateIndex(type, progress, work) {
    const index = (progress.indexes[type] ??= { cursor: "", complete: false });
    if (index.complete) return true;
    const limit = work.remaining;
    work.remaining = 0;
    const entries = await storage.list({
      prefix: nameIdentityEntityPrefix(policy.league, type),
      startAfter: index.cursor,
      limit,
    });
    for (const [key, entry] of entries) {
      await lookup.indexCandidate(type, entry.id);
      index.cursor = key;
    }
    work.remaining = limit - Math.max(1, entries.size);
    index.complete = entries.size < limit;
    return index.complete;
  }

  async function collectCandidates(source, pending, progress, work) {
    if (!(await buildCandidateIndex(source.type, progress, work)) || !work.remaining) return;
    const revision = await lookup.readFactsRevision();
    if (pending.nativeRevision !== revision) {
      pending.nativeRevision = revision;
      pending.candidateCursor = "";
      pending.groupOffset = 0;
      pending.candidates = [];
      pending.offset = 0;
    }
    const prefixes = [
      ...new Set(
        source.records.map((record) =>
          nameIdentityCandidatePrefix(policy.league, source.type, record),
        ),
      ),
    ];
    while (work.remaining && pending.groupOffset < prefixes.length) {
      const limit = work.remaining;
      work.remaining = 0;
      const entries = await storage.list({
        prefix: prefixes[pending.groupOffset],
        startAfter: pending.candidateCursor,
        limit,
      });
      for (const [key, id] of entries) {
        const entry = await lookup.readEntry(source.type, id);
        if (entry && isIdentityNativeCandidate(source.type, entry, policy.vendor))
          pending.candidates.push({ id: entry.id, ...entry.facts });
        pending.candidateCursor = key;
      }
      work.remaining = limit - Math.max(1, entries.size);
      if (new TextEncoder().encode(JSON.stringify(pending.candidates)).length > MAX_CANDIDATE_BYTES)
        throw new Error("Identity candidate evidence exceeds the checkpoint limit");
      if (entries.size < limit) {
        pending.groupOffset += 1;
        pending.candidateCursor = "";
      }
    }
    if (pending.groupOffset === prefixes.length) pending.stage = "vendor";
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
      const results = await registerObservations(batch, {
        key: pending.key,
        rejected: countSourceRejections(source, pending),
        unregistered: pending.nativeMissingEntries ?? 0,
        partial: true,
      });
      pending.nativeMissingEntries =
        (pending.nativeMissingEntries ?? 0) + results.filter((result) => result.missing).length;
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
      const entry =
        observation.type === "game"
          ? await lookup.readEntry(observation.type, observation.internalId)
          : null;
      const missing =
        observation.vendorId === undefined
          ? !(await lookup.recordRegistrationCheck(
              observation.type,
              observation.vendor,
              observation.internalId,
              {
                key: pending.key,
                rejected: countSourceRejections(source, pending),
                unregistered: pending.nativeMissingEntries ?? 0,
                partial: true,
              },
            ))
          : (await lookup.read(observation.type, observation.vendor, observation.vendorId)) !==
            observation.internalId;
      if (missing) {
        pending.missingEntries += 1;
        if (observation.vendorId === undefined)
          pending.nativeMissingEntries = (pending.nativeMissingEntries ?? 0) + 1;
      }
      if (observation.type === "game" && !Number.isInteger(entry?.facts?.season))
        pending.missingFacts += 1;
    }
    pending.offset += batch.length;
    if (pending.offset >= source.observations.length) {
      pending.offset = 0;
      pending.stage = source.records.length ? "candidates" : "done";
    }
  }

  async function checkMappingBatch(key, value, pending, work) {
    const vendors = isIdentityEntityKey(key) ? Object.keys(value.vendors).sort() : null;
    const batch = vendors?.slice(pending.offset, pending.offset + work.remaining) ?? null;
    const consumed = Math.max(1, batch?.length ?? 1);
    work.remaining -= consumed;
    pending.conflicts += await lookup.countMappingConflicts(key, batch);
    pending.offset += consumed;
    if (!vendors || pending.offset >= vendors.length) pending.stage = "done";
  }

  async function advanceSource(docs, key, value, source, progress, work, isActive) {
    const signature = await describeSignature(source.records ?? []);
    if (progress.pending?.key !== key) {
      progress.pending = {
        key,
        signature,
        offset: 0,
        stage: chooseSourceStage(source),
        candidates: [],
        candidateCursor: "",
        groupOffset: 0,
        nativeRevision: null,
        missingEntries: 0,
        nativeMissingEntries: 0,
        missingFacts: 0,
        conflicts: 0,
      };
    }
    const pending = progress.pending;
    if (pending.signature !== signature) {
      pending.signature = signature;
      if (pending.stage === "candidates" || pending.stage === "vendor") {
        pending.stage = "candidates";
        delete pending.nativeRevision;
      }
    }
    while (work.remaining && pending.stage !== "done" && isActive()) {
      if (source.kind === "mappings") await checkMappingBatch(key, value, pending, work);
      else if (pending.stage === "candidates")
        await collectCandidates(source, pending, progress, work);
      else if (pending.stage === "vendor") await saveVendorBatch(source, pending, work, docs);
      else if (progress.phase === "facts") await checkNativeBatch(source, pending, work);
      else await registerNativeBatch(source, pending, work);
    }
    if (!isActive() || pending.stage !== "done") return false;
    const latest = await storage.get(key);
    let published = isSameJson(latest, value);
    if (published && source.kind === "document" && !isSameJson(source.document, value)) {
      const matched = source.cached
        ? await storage.transaction(async (transaction) => {
            const current = await transaction.get(key);
            if (!isActive() || !isSameJson(current, value)) return false;
            await transaction.put(key, source.document);
            return true;
          })
        : await docs.replaceIfUnchanged(key, value, source.document);
      published = matched;
    }
    if (!isActive()) return false;
    const expected = source.kind === "document" ? source.document : value;
    const finalized =
      published &&
      (await storage.transaction(async (transaction) => {
        if (!isActive() || !isSameJson(await transaction.get(key), expected)) return false;
        if (
          source.kind === "document" &&
          (await readIdentitySourceRejections(transaction, key)) !== source.retainedRejections
        )
          return false;
        if (source.kind !== "mappings") {
          if (policy.nativeIdMode === "internal")
            await saveIdentitySourceProblems(
              transaction,
              key,
              countSourceRejections(source, pending),
              pending.nativeMissingEntries ?? 0,
            );
          else await saveIdentityError(transaction, key, countSourceRejections(source, pending));
          if (source.kind === "document")
            await saveIdentitySourceRejections(transaction, key, source.rejected ?? 0);
        }
        return true;
      }));
    if (!finalized) {
      await forgetSource(key);
      progress.pending = null;
      return false;
    }
    if (progress.phase !== "facts" && published)
      await saveErrors(key, 0, "failed", source.retryEvidence ?? null);
    progress.missingEntries += pending.missingEntries;
    if (progress.phase === "facts")
      progress.nativeMissingEntries += pending.nativeMissingEntries ?? 0;
    progress.missingFacts += pending.missingFacts;
    progress.conflicts += pending.conflicts;
    return true;
  }

  async function finishPhase(progress) {
    progress.cursor = "";
    progress.pending = null;
    if (progress.phase === "documents") {
      progress.phase = "facts";
    } else if (progress.phase === "facts") progress.phase = "vendors";
    else {
      progress.complete = true;
      if (progress.recoveryAttempt && (await hasFailedSources()))
        progress.retryAfter =
          now() +
          Math.min(MAX_RETRY_MS, RETRY_DELAY_MS * 2 ** Math.min(progress.recoveryAttempt - 1, 6));
    }
  }

  async function readDueProgress() {
    const current = await readCurrentProgress();
    const progress = current.progress;
    if (!progress.complete) return current;
    if (progress.retryAfter > now() || !(await hasFailedSources())) return null;
    return {
      ...current,
      progress: {
        ...createProgress(progress.coverageRevision),
        recoveryAttempt: (progress.recoveryAttempt ?? 0) + 1,
      },
    };
  }

  async function backfill(docs, isActive = () => true, currentProgress = null) {
    if (!isActive()) return;
    const current = currentProgress ?? (await readDueProgress());
    if (!current) return;
    const { previous, progress } = current;
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
      if (key.startsWith(IDENTITY_CANDIDATE_PREFIX)) {
        progress.cursor = IDENTITY_CANDIDATE_END;
        progress.pending = null;
        continue;
      }
      if (progress.phase !== "vendors" && key.startsWith(IDENTITY_PREFIX)) {
        progress.cursor = IDENTITY_PREFIX_END;
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
    const progress = await storage.get(IDENTITY_BACKFILL_KEY);
    const coverageRevision = (await storage.get(IDENTITY_COVERAGE_KEY)) ?? null;
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
      if (!isActive()) return;
      const current = await readDueProgress();
      if (!current) return;
      if (isActive() && (await reserveWork(isActive))) await backfill(docs, isActive, current);
    },
    readStatus,
  };
}
