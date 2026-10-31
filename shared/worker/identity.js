// Atomic, vendor-scoped associations retain matching evidence and independent uncertainty counts.
import {
  IDENTITY_TYPES,
  IdentityEntry,
  IdentityObservation,
  validateSportsData,
} from "./sports-schema.js";
import { isSameJson } from "../page/compare.js";
import { nameIdentityGameGroup } from "./identity-matching.js";
import { readPlayerName } from "./player-name.js";

const VENDOR_PREFIX = "identity:vendor:";
const nameStatusKey = (league) => `identity:status:${encodeURIComponent(league)}`;
export const IDENTITY_CANDIDATE_PREFIX = "identity:candidate:";
export const IDENTITY_CANDIDATE_END = namePrefixEnd(IDENTITY_CANDIDATE_PREFIX);
export const nameIdentityCandidateGroup = (type, record) =>
  type === "game" ? nameIdentityGameGroup(record) : readPlayerName(record);
export const isIdentityNativeCandidate = (type, entry, vendor) =>
  type !== "game" || !!entry.vendors[vendor];
const nameFactsRevisionKey = (league) => `identity:facts-revision:${encodeURIComponent(league)}`;
export const nameIdentityEntityPrefix = (league, type) =>
  `identity:entity:${encodeURIComponent(league)}:${type}:`;
const nameEntityKey = (league, type, id) =>
  `${nameIdentityEntityPrefix(league, type)}${encodeURIComponent(id)}`;
export const nameIdentityCandidatePrefix = (league, type, record) =>
  `${IDENTITY_CANDIDATE_PREFIX}${encodeURIComponent(league)}:${type}:${encodeURIComponent(nameIdentityCandidateGroup(type, record))}:`;
const nameCandidateKey = (entry) =>
  `${nameIdentityCandidatePrefix(entry.league, entry.type, entry.facts ?? {})}${encodeURIComponent(entry.id)}`;

async function saveCandidateIndex(transaction, previous, entry) {
  const key = nameCandidateKey(entry);
  if (previous && nameCandidateKey(previous) !== key)
    await transaction.delete(nameCandidateKey(previous));
  await saveChanged(transaction, key, entry.id);
}
const nameVendorKey = (league, type, vendor, id) =>
  `${VENDOR_PREFIX}${encodeURIComponent(vendor)}:${encodeURIComponent(league)}:${type}:${encodeURIComponent(id)}`;
const nameProblemKey = (key) => `identity:problem:${key}`;
const PROBLEM_PREFIX = nameProblemKey(VENDOR_PREFIX);
export class IdentityFactsChanged extends Error {}
const createBlankStatus = () => ({ games: 0, players: 0, unmatched: 0, disputed: 0 });

function readProblem(key, value, league) {
  try {
    const parts = key.slice(PROBLEM_PREFIX.length).split(":").map(decodeURIComponent);
    if (parts.length !== 4 || !parts.every(Boolean)) return { reason: "invalid_problem" };
    const [vendor, storedLeague, type, id] = parts;
    if (storedLeague !== league) return null;
    return {
      vendor,
      type,
      id,
      problem: value === "unmatched" || value === "disputed" ? value : "other",
    };
  } catch {
    return { reason: "invalid_problem" };
  }
}

function namePrefixEnd(prefix) {
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

function listOtherProblemRanges(prefixes) {
  const ranges = [];
  let start = PROBLEM_PREFIX;
  for (const prefix of [...prefixes].sort()) {
    ranges.push({ start, end: prefix });
    start = namePrefixEnd(prefix);
  }
  ranges.push({ start, end: namePrefixEnd(PROBLEM_PREFIX) });
  return ranges;
}

function readUniqueProblems(entries, league, seen) {
  const problems = [];
  for (const [key, value] of entries) {
    if (seen.has(key)) continue;
    seen.add(key);
    const problem = readProblem(key, value, league);
    if (problem) problems.push(problem);
  }
  return problems;
}

function selectProblemSample(pools, limit) {
  const problems = [];
  const rows = Math.max(0, ...pools.map((pool) => pool.length));
  for (let row = 0; row < rows && problems.length < limit; row += 1) {
    for (const pool of pools) {
      if (pool[row]) problems.push(pool[row]);
      if (problems.length === limit) break;
    }
  }
  return problems;
}

/** @param {any} storage @param {string} key @param {any} value */
async function saveChanged(storage, key, value) {
  if (!isSameJson(await storage.get(key), value)) await storage.put(key, value);
}

/** @param {any} transaction @param {string} key @param {string | null} problem */
async function saveProblem(transaction, league, key, problem) {
  const path = nameProblemKey(key);
  const previous = await transaction.get(path);
  if (previous === problem || (!previous && !problem)) return;
  const status = (await transaction.get(nameStatusKey(league))) ?? createBlankStatus();
  if (previous) status[previous] -= 1;
  if (problem) status[problem] += 1;
  if (problem) await transaction.put(path, problem);
  else await transaction.delete(path);
  await transaction.put(nameStatusKey(league), status);
}

/** @param {any} transaction @param {string} league @param {any} observation */
async function ensureEntity(transaction, league, observation) {
  const { type, internalId, facts = {} } = observation;
  const key = nameEntityKey(league, type, internalId);
  const previous = await transaction.get(key);
  const entry = previous ?? { id: internalId, league, type, vendors: {}, evidence: {} };
  const updated = {
    ...entry,
    facts: {
      ...entry.facts,
      ...Object.fromEntries(
        Object.entries(facts).filter(([, value]) => value !== undefined && value !== null),
      ),
    },
  };
  validateSportsData(IdentityEntry, updated);
  await saveChanged(transaction, key, updated);
  if (!previous || nameCandidateKey(previous) !== nameCandidateKey(updated))
    await saveCandidateIndex(transaction, previous, updated);
  if (!isSameJson(previous?.facts, updated.facts))
    await transaction.put(nameFactsRevisionKey(league), crypto.randomUUID());
  if (!previous) {
    const status = (await transaction.get(nameStatusKey(league))) ?? createBlankStatus();
    status[type === "game" ? "games" : "players"] += 1;
    await transaction.put(nameStatusKey(league), status);
  }
  return {
    entry: updated,
    created: !previous,
    addedFacts: Object.keys(updated.facts).filter((field) => previous?.facts?.[field] == null),
  };
}

/** @param {any} transaction @param {string} league @param {any} observation */
async function saveAssociation(transaction, league, observation) {
  const { type, vendor, vendorId, internalId, evidence, decisive = false } = observation;
  const key = nameVendorKey(league, type, vendor, vendorId);
  const previous = await transaction.get(key);
  const { entry, created, addedFacts } = await ensureEntity(transaction, league, observation);
  const competingId = entry.vendors[vendor];
  if (
    (previous && previous.internalId !== internalId) ||
    (competingId && competingId !== vendorId)
  ) {
    if (!decisive) {
      await saveProblem(transaction, league, key, "disputed");
      return {
        internalId: previous?.internalId ?? internalId,
        disputed: true,
        created,
        addedFacts,
      };
    }
    if (previous && previous.internalId !== internalId) {
      const oldKey = nameEntityKey(league, type, previous.internalId);
      const oldEntry = await transaction.get(oldKey);
      if (oldEntry?.vendors[vendor] === vendorId) {
        delete oldEntry.vendors[vendor];
        delete oldEntry.evidence[vendor];
        await transaction.put(oldKey, oldEntry);
      }
    }
    if (competingId && competingId !== vendorId) {
      const competingKey = nameVendorKey(league, type, vendor, competingId);
      await transaction.delete(competingKey);
      await saveProblem(transaction, league, competingKey, "unmatched");
    }
  }
  entry.vendors[vendor] = vendorId;
  const matchingEvidence =
    evidence.method === "existing-id" && entry.evidence[vendor] ? entry.evidence[vendor] : evidence;
  entry.evidence[vendor] = matchingEvidence;
  validateSportsData(IdentityEntry, entry);
  await saveChanged(transaction, nameEntityKey(league, type, internalId), entry);
  await saveChanged(transaction, key, {
    internalId,
    evidence: matchingEvidence,
    type,
    league,
    vendor,
    vendorId,
  });
  if (!observation.preserveProblem) await saveProblem(transaction, league, key, null);
  return { internalId, disputed: false, created, addedFacts };
}

/**
 * The storage transaction owns lookup and creation, including collision checks and reconciliation.
 * @param {any} storage Durable Object storage
 * @param {string} league
 */
export function createIdentityLookup(storage, league) {
  /** @param {any[]} observations @param {string | null} [factsRevision] @param {boolean} [includeEntries] */
  async function saveObservations(observations, factsRevision = undefined, includeEntries = false) {
    observations.forEach((observation) => validateSportsData(IdentityObservation, observation));
    return storage.transaction(async (transaction) => {
      if (
        factsRevision !== undefined &&
        ((await transaction.get(nameFactsRevisionKey(league))) ?? null) !== factsRevision
      )
        throw new IdentityFactsChanged("Identity facts changed during reconciliation");
      const beforeRevision = includeEntries
        ? ((await transaction.get(nameFactsRevisionKey(league))) ?? null)
        : null;
      const results = [];
      for (const observation of observations) {
        const key = nameVendorKey(
          league,
          observation.type,
          observation.vendor,
          observation.vendorId,
        );
        if (observation.disputed) {
          await saveProblem(transaction, league, key, "disputed");
          results.push({
            vendorId: observation.vendorId,
            internalId: observation.internalId ?? null,
            disputed: true,
          });
          continue;
        }
        if (!observation.internalId) {
          await saveProblem(transaction, league, key, "unmatched");
          results.push({ vendorId: observation.vendorId, internalId: null, disputed: false });
          continue;
        }
        const result = await saveAssociation(transaction, league, observation);
        results.push({
          ...result,
          vendorId: observation.vendorId,
          disputed: result.disputed || (await transaction.get(nameProblemKey(key))) === "disputed",
        });
      }
      const entries = [];
      if (includeEntries)
        for (const observation of observations)
          if (observation.internalId)
            entries.push(
              await transaction.get(
                nameEntityKey(league, observation.type, observation.internalId),
              ),
            );
      return {
        results,
        entries,
        beforeRevision,
        revision: includeEntries
          ? ((await transaction.get(nameFactsRevisionKey(league))) ?? null)
          : null,
      };
    });
  }
  return {
    /** @param {any[]} observations @param {string | null} [factsRevision] */
    save: async (observations, factsRevision = undefined) =>
      (await saveObservations(observations, factsRevision)).results,
    saveWithEntries: (observations) => saveObservations(observations, undefined, true),
    async indexCandidate(type, id) {
      await storage.transaction(async (transaction) => {
        const entry = await transaction.get(nameEntityKey(league, type, id));
        if (entry) await saveCandidateIndex(transaction, null, entry);
      });
    },
    /** @param {{ type: "game" | "player", vendor: string, vendorId: string, facts?: object }} asked */
    async discover(asked) {
      return storage.transaction(async (transaction) => {
        const key = nameVendorKey(league, asked.type, asked.vendor, asked.vendorId);
        const previous = await transaction.get(key);
        if (previous) return previous.internalId;
        let internalId;
        do {
          internalId = `${asked.type === "game" ? "g" : "p"}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
        } while (await transaction.get(nameEntityKey(league, asked.type, internalId)));
        const observation = { ...asked, internalId, evidence: { method: "discovery" } };
        validateSportsData(IdentityObservation, observation);
        await saveAssociation(transaction, league, observation);
        return internalId;
      });
    },
    /** @param {"game" | "player"} type @param {string} vendor @param {string} id */
    async read(type, vendor, id) {
      return (await storage.get(nameVendorKey(league, type, vendor, id)))?.internalId ?? null;
    },
    /** @param {"game" | "player"} type @param {string} id */
    readEntry: (type, id) => storage.get(nameEntityKey(league, type, id)),
    async countMappingConflicts(key, vendors = null) {
      return storage.transaction(async (transaction) => {
        const value = await transaction.get(key);
        if (!value) return 0;
        let conflicts = 0;
        if (key.startsWith(nameIdentityEntityPrefix(league, value.type))) {
          for (const [vendor, id] of Object.entries(value.vendors)) {
            if (vendors && !vendors.includes(vendor)) continue;
            const mapping = await transaction.get(nameVendorKey(league, value.type, vendor, id));
            if (mapping?.internalId === value.id) continue;
            if (mapping) {
              const owner = await transaction.get(
                nameEntityKey(league, value.type, mapping.internalId),
              );
              // A broken forward relation is counted from its vendor key.
              if (owner?.vendors[vendor] !== id) continue;
            }
            conflicts += 1;
          }
        } else if (key.startsWith(VENDOR_PREFIX) && value.league === league) {
          const entry = await transaction.get(nameEntityKey(league, value.type, value.internalId));
          if (entry?.vendors[value.vendor] !== value.vendorId) conflicts += 1;
        }
        return conflicts;
      });
    },
    async readProblems(limit, vendors) {
      const probe = await storage.list({ prefix: PROBLEM_PREFIX, limit: 1 });
      if (!probe.size) return { problems: [], truncated: false };
      const prefixes = [...new Set(vendors)].flatMap((vendor) =>
        IDENTITY_TYPES.map((type) => nameProblemKey(nameVendorKey(league, type, vendor, ""))),
      );
      const windows = [
        ...prefixes.map((prefix) => ({ prefix })),
        ...listOtherProblemRanges(prefixes),
      ];
      const entries = await Promise.all(
        windows.map((window) =>
          storage.list({
            prefix: PROBLEM_PREFIX,
            reverse: true,
            limit: limit + 1,
            ...window,
          }),
        ),
      );
      const seen = new Set();
      const pools = entries.map((window) => readUniqueProblems(window, league, seen));
      return {
        problems: selectProblemSample(pools, limit),
        truncated:
          entries.some((window) => window.size > limit) ||
          pools.reduce((total, pool) => total + pool.length, 0) > limit,
      };
    },
    readStatus: async () => (await storage.get(nameStatusKey(league))) ?? createBlankStatus(),
    readFactsRevision: async () => (await storage.get(nameFactsRevisionKey(league))) ?? null,
  };
}
