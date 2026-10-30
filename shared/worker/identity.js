// Atomic, vendor-scoped associations retain matching evidence and independent uncertainty counts.
import { IdentityEntry, IdentityObservation, validateSportsData } from "./sports-schema.js";
import { isSameJson } from "../page/compare.js";

const nameStatusKey = (league) => `identity:status:${encodeURIComponent(league)}`;
const nameEntityKey = (league, type, id) =>
  `identity:entity:${encodeURIComponent(league)}:${type}:${encodeURIComponent(id)}`;
const nameVendorKey = (league, type, vendor, id) =>
  `identity:vendor:${encodeURIComponent(vendor)}:${encodeURIComponent(league)}:${type}:${encodeURIComponent(id)}`;
const nameProblemKey = (key) => `identity:problem:${key}`;
const createBlankStatus = () => ({ games: 0, players: 0, unmatched: 0, disputed: 0 });

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
  return {
    /** @param {any[]} observations */
    async save(observations) {
      observations.forEach((observation) => validateSportsData(IdentityObservation, observation));
      return storage.transaction(async (transaction) => {
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
            disputed:
              result.disputed || (await transaction.get(nameProblemKey(key))) === "disputed",
          });
        }
        return results;
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
    async countMappingConflicts(key) {
      return storage.transaction(async (transaction) => {
        const value = await transaction.get(key);
        if (!value) return 0;
        let conflicts = 0;
        if (key.startsWith(`identity:entity:${league}:`)) {
          for (const [vendor, id] of Object.entries(value.vendors)) {
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
        } else if (key.startsWith("identity:vendor:") && value.league === league) {
          const entry = await transaction.get(nameEntityKey(league, value.type, value.internalId));
          if (entry?.vendors[value.vendor] !== value.vendorId) conflicts += 1;
        }
        return conflicts;
      });
    },
    readStatus: async () => (await storage.get(nameStatusKey(league))) ?? createBlankStatus(),
  };
}
