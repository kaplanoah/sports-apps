// Additive facts and identity registration for stored sports documents.
import { isStoreDocumentPath } from "../page/store-path.js";
import { isSameJson } from "../page/compare.js";
import {
  createIdentityLookup,
  IdentityFactsChanged,
  nameIdentityEntityPrefix,
  nameIdentityCandidateGroup,
  isIdentityNativeCandidate,
  isIdentityEntityKey,
  isIdentityVendorKey,
  IDENTITY_PREFIX,
  IDENTITY_COVERAGE_KEY,
  IDENTITY_ERROR_PREFIX,
  nameIdentityErrorKey,
  saveIdentityError,
  saveIdentitySourceProblems,
  readIdentitySourceRejections,
  saveIdentitySourceRejections,
} from "./identity.js";
import { DETAIL_ANSWER_PREFIX } from "./detail-reads.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import { readIdentityDiagnosis } from "./identity-diagnostics.js";
import { reconcileIdentities } from "./identity-matching.js";
import { createIdentityBackfill, AUDIT_PHASES } from "./identity-backfill.js";

const CACHED_ANSWER_PREFIX = `job:details:${DETAIL_ANSWER_PREFIX}`;
const isCachedAnswerKey = (key) => key.startsWith(CACHED_ANSWER_PREFIX);
const FAILED_PREFIX = `${IDENTITY_ERROR_PREFIX}failed:`;
const ERROR_SCAN_LIMIT = 20;
const LIVE_RECONCILIATION_ATTEMPTS = 3;
const PLAYER_FIELDS = new Set(["players", "batters", "pitchers", "starters", "leaders"]);
const GAME_FIELDS = new Set([
  "games",
  "nearestGames",
  "previous",
  "next",
  "lastFinal",
  "allStar",
  "nextGame",
  "lastGame",
  "lastGames",
  "boxScore",
]);

/** @param {any} side */
const readTeam = (side) => (typeof side === "string" ? side : (side?.team ?? side?.id ?? null));
const hasIdentifier = (value) =>
  (typeof value === "string" && value.length > 0) || (Number.isInteger(value) && value > 0);

/**
 * @typedef {object} IdentityPolicy
 * @property {string} league
 * @property {string} vendor
 * @property {"vendor" | "internal"} [nativeIdMode]
 * @property {string[]} gameFactFields
 * @property {(record: any, season: number | null) => object} readGameFacts
 * @property {(id: string) => object} readSeriesFacts
 * @property {string} [vendorGameSourcePrefix]
 * @property {(key: string, value: any, limit?: number) => { records: any[], rejected: number, truncated?: boolean } | null} [readSavedVendorGames]
 * @property {(id: string) => string} [nameMatchKey]
 */

/** @param {any} storage @param {IdentityPolicy} policy @param {() => number} [now] */
export function createIdentityDocuments(storage, policy, now = Date.now) {
  const lookup = createIdentityLookup(storage, policy.league, {
    nativeVendor: policy.nativeIdMode === "internal" ? policy.vendor : null,
  });

  const nameRetryKey = (key) => `${IDENTITY_PREFIX}retry:${encodeURIComponent(key)}`;
  async function saveErrors(key, count, kind = "rejected", processedRetry = null) {
    const path = nameIdentityErrorKey(key, kind);
    if (kind === "failed" && !count) {
      if (!(await storage.get(path))) return;
      await storage.transaction(async (transaction) => {
        const latestRetry = (await transaction.get(nameRetryKey(key))) ?? null;
        if (!isSameJson(latestRetry, processedRetry)) return;
        if (latestRetry) await transaction.delete(nameRetryKey(key));
        if (await transaction.get(path)) await transaction.delete(path);
      });
      return;
    }
    await saveIdentityError(storage, key, count, kind);
  }

  async function attemptIdentity(
    key,
    action,
    fallback = () => null,
    readProcessedRetry = () => null,
  ) {
    try {
      const result = await action();
      await saveErrors(key, 0, "failed", readProcessedRetry());
      return result;
    } catch {
      await saveErrors(key, 1, "failed").catch(() => {});
      return fallback();
    }
  }

  const vendorBatches = new Map();
  const nativeEntries = new Map();
  let nativeRevision;
  async function refreshNativeRevision() {
    const revision = await lookup.readFactsRevision();
    if (nativeRevision !== revision) {
      nativeEntries.clear();
      vendorBatches.clear();
      nativeRevision = revision;
    }
    return revision;
  }
  async function listNatives(type) {
    await refreshNativeRevision();
    if (!nativeEntries.has(type)) {
      const entries = await storage.list({ prefix: nameIdentityEntityPrefix(policy.league, type) });
      nativeEntries.set(type, new Map([...entries.values()].map((entry) => [entry.id, entry])));
    }
    return [...nativeEntries.get(type).values()];
  }
  function rememberNatives(saved) {
    if (nativeRevision !== saved.beforeRevision) {
      nativeEntries.clear();
      vendorBatches.clear();
    }
    if (saved.revision !== saved.beforeRevision) vendorBatches.clear();
    for (const entry of saved.entries) nativeEntries.get(entry.type)?.set(entry.id, entry);
    nativeRevision = saved.revision;
  }

  async function reconcileLiveRecords(type, records) {
    for (let attempt = 0; attempt < LIVE_RECONCILIATION_ATTEMPTS; attempt += 1) {
      const factsRevision = await refreshNativeRevision();
      const groups = new Set(records.map((record) => nameIdentityCandidateGroup(type, record)));
      const natives = (await listNatives(type))
        .filter(
          (entry) =>
            isIdentityNativeCandidate(type, entry, policy.vendor) &&
            groups.has(nameIdentityCandidateGroup(type, entry.facts ?? {})),
        )
        .map((entry) => ({ id: entry.id, ...entry.facts }));
      try {
        return await reconcileIdentities(lookup, {
          type,
          vendor: ESPN_VENDOR,
          natives,
          records,
          factsRevision,
        });
      } catch (error) {
        if (
          !(error instanceof IdentityFactsChanged) ||
          attempt === LIVE_RECONCILIATION_ATTEMPTS - 1
        )
          throw error;
      }
    }
  }

  async function saveVendorGames(records, key = "snapshot", rejected = 0, docs = null) {
    await saveErrors(key, rejected);
    if (!records?.length) return;
    await refreshNativeRevision();
    const signature = JSON.stringify(records);
    if (vendorBatches.get(key) === signature) return;
    const results = await reconcileLiveRecords("game", records);
    await saveGameMatches(results, docs);
    vendorBatches.set(key, signature);
  }

  async function saveGameMatches(results, docs) {
    if (docs && policy.nameMatchKey) {
      for (const result of results) {
        if (!result.internalId || result.disputed) continue;
        const entry = await lookup.readEntry("game", result.internalId);
        const facts = entry?.facts;
        if (!facts?.away || !facts?.home || !facts?.start) continue;
        await docs.write(policy.nameMatchKey(result.internalId), {
          id: result.internalId,
          eventId: result.vendorId,
          away: facts.away,
          home: facts.home,
          start: facts.start,
        });
      }
    }
  }

  /** @param {string} key @param {any} document */
  function expandDocument(key, document, known = null) {
    const observations = new Map();
    const espnPlayers = [];
    let rejected = 0;
    const matched = /^(?:players|pitchers)\/(\d{4})-(.+)$/.exec(key);
    const isGameDocument = /^(?:games|highlights|espnMatches)\/(?!status$)/.test(key);
    const rootId = isGameDocument
      ? (document?.id ?? document?.boxScore?.id ?? key.split("/")[1])
      : null;
    const season =
      document?.season ??
      document?.year ??
      document?.boxScore?.season ??
      known?.season ??
      (Number(/(?:^|[/:-])(\d{4})(?:$|[-/])/.exec(key)?.[1]) || null);
    const addNative = (type, id, facts) => {
      if (!hasIdentifier(id)) return;
      const internalId = String(id);
      const entryKey = `${type}:${internalId}`;
      const previous = observations.get(entryKey);
      observations.set(entryKey, {
        type,
        vendor: policy.vendor,
        internalId,
        facts: { ...previous?.facts, ...facts },
        ...(policy.nativeIdMode !== "internal" && {
          vendorId: internalId,
          evidence: { method: "existing-id" },
        }),
      });
    };
    if (isGameDocument && rootId) {
      const facts = policy.readGameFacts({ ...document, id: String(rootId) }, season);
      const savedFacts = Object.fromEntries(
        policy.gameFactFields
          .filter((field) => known?.[field] !== undefined)
          .map((field) => [field, known[field]]),
      );
      document = { ...savedFacts, ...facts, ...document };
      addNative("game", rootId, facts);
    }
    if (matched) addNative("player", matched[2], { season: Number(matched[1]) });

    function expandRecord(value, kind, inheritedSeason, team = null) {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value))
        return value.map((record) => expandRecord(record, kind, inheritedSeason, team));
      const currentSeason = value.season ?? value.year ?? inheritedSeason;
      const currentTeam = value.team ?? value.club ?? team;
      const isGame =
        hasIdentifier(value.id) &&
        (kind === "game" ||
          (value.state &&
            (value.start !== undefined || value.innings || value.period !== undefined)));
      const isPlayer =
        hasIdentifier(value.id) &&
        !isGame &&
        (kind === "player" || value.firstName !== undefined || value.lastName !== undefined);
      let record =
        typeof value.series === "string"
          ? { ...policy.readSeriesFacts(value.series), ...value }
          : value;
      if (hasIdentifier(value.gameId)) {
        const facts = policy.readGameFacts({ ...value, id: String(value.gameId) }, currentSeason);
        record = { ...facts, ...record };
        addNative("game", value.gameId, facts);
      }
      if (isGame) {
        const facts = policy.readGameFacts(value, currentSeason);
        record = { ...facts, ...record };
        addNative("game", value.id, {
          ...facts,
          season: record.season ?? currentSeason,
          ...(readTeam(value.away) && { away: readTeam(value.away) }),
          ...(readTeam(value.home) && { home: readTeam(value.home) }),
          ...(value.start && { start: value.start }),
          ...(value.date && { date: value.date }),
          ...((value.doubleheader ?? record.gameNumber) && {
            gameNumber: value.doubleheader ?? record.gameNumber,
          }),
        });
      }
      if (value.espnIdentity && !hasIdentifier(value.espnIdentity.id)) rejected += 1;
      if (value.espnIdentity && hasIdentifier(value.espnIdentity.id))
        espnPlayers.push({
          id: value.espnIdentity.id,
          ...value.espnIdentity.facts,
          team: currentTeam,
        });
      if (isPlayer) {
        const facts = {
          firstName: value.firstName ?? value.facts?.firstName,
          lastName: value.lastName ?? value.facts?.lastName,
          name: typeof value.name === "string" ? value.name : undefined,
          team: currentTeam,
          season: currentSeason,
          number: value.number,
          birthdate: value.birthdate ?? value.facts?.birthdate,
        };
        addNative("player", value.id, facts);
      }
      if (value.playoffPoints)
        for (const id of Object.keys(value.playoffPoints))
          addNative("game", id, policy.readGameFacts({ id }, currentSeason));
      const expanded = {};
      for (const [field, part] of Object.entries(record)) {
        if (field === "espnIdentity") continue;
        if (field === "series" && part && typeof part === "object" && !Array.isArray(part)) {
          expanded[field] = Object.fromEntries(
            Object.entries(part).map(([id, series]) => [
              id,
              { ...policy.readSeriesFacts(id), ...series },
            ]),
          );
        } else {
          const childKind = PLAYER_FIELDS.has(field)
            ? "player"
            : GAME_FIELDS.has(field)
              ? "game"
              : null;
          expanded[field] = expandRecord(
            part,
            childKind,
            record.season ?? currentSeason,
            currentTeam,
          );
        }
      }
      return expanded;
    }
    const rootKind = isGameDocument ? "game" : matched ? "player" : null;
    const expanded = expandRecord(document, rootKind, season);
    return {
      document: expanded,
      observations: [...observations.values()],
      espnPlayers,
      rejected,
      rootId,
    };
  }

  function listGameMatchObservations(key, document) {
    if (!key.startsWith("espnMatches/") || !document?.eventId) return [];
    return [
      {
        type: "game",
        vendor: ESPN_VENDOR,
        vendorId: String(document.eventId),
        internalId: String(document.id),
        evidence: {
          method: "existing-id",
          away: document.away,
          home: document.home,
          start: document.start,
        },
      },
    ];
  }

  async function invalidateFactCoverage(storage, observations, results) {
    if (
      observations.some(
        (observation, index) =>
          observation.type === "game" &&
          ((results[index].created && !Number.isInteger(observation.facts?.season)) ||
            (!results[index].created && results[index].addedFacts.includes("season"))),
      )
    )
      await storage.put(IDENTITY_COVERAGE_KEY, crypto.randomUUID());
  }

  async function registerDocument(key, sourceKey, prepared) {
    const { document, observations, rejected, espnPlayers } = prepared;
    let results = [];
    if (observations.length || policy.nativeIdMode === "internal") {
      const saved =
        policy.nativeIdMode === "internal"
          ? await lookup.updateRegisteredFacts(observations, {
              key: sourceKey,
              rejected,
              partial: true,
            })
          : await lookup.saveWithEntries(observations);
      results = saved.results;
      rememberNatives(saved);
    }
    await invalidateFactCoverage(storage, observations, results);
    if (espnPlayers.length) await reconcileLiveRecords("player", espnPlayers);
    const matches = listGameMatchObservations(key, document);
    if (matches.length) await lookup.save(matches);
    return prepared.document;
  }
  async function expandWithKnownFacts(key, document, prepared) {
    if (prepared.rootId && !prepared.document.season) {
      const entry = await lookup.readEntry("game", String(prepared.rootId));
      if (entry?.facts) prepared = expandDocument(key, document, entry.facts);
    }
    return prepared;
  }

  function describeDetailAnswer(key, value) {
    const url = new URL(key.slice(CACHED_ANSWER_PREFIX.length), "https://store");
    const season = Number(url.searchParams.get("season")) || value.body?.season;
    return { key: `details/${season ?? "answer"}`, document: value.body };
  }

  function describeSourceDocument(key, document) {
    return isCachedAnswerKey(key) ? describeDetailAnswer(key, document) : { key, document };
  }

  function mergePlayerEvidence(retained, current) {
    return [
      ...new Map(
        [...(retained?.records ?? []), ...current].map((record) => [String(record.id), record]),
      ).values(),
    ];
  }

  async function recordRetryEvidence(transaction, key, records) {
    if (records.length) {
      const retained = await transaction.get(nameRetryKey(key));
      await transaction.put(nameRetryKey(key), {
        revision: crypto.randomUUID(),
        records: mergePlayerEvidence(retained, records),
      });
    }
    await saveIdentityError(transaction, key, 1, "failed");
  }

  async function saveRetryEvidence(key, records) {
    await storage.transaction((transaction) => recordRetryEvidence(transaction, key, records));
  }

  /** @returns {Promise<{ document: any, failure: { records: any[] } | null }>} */
  async function prepareDocumentWrite(key, document, known = null, sourceKey = key) {
    let prepared = expandDocument(key, document, known);
    let retryEvidence = null;
    let failure = null;
    const data = await attemptIdentity(
      sourceKey,
      async () => {
        prepared = await expandWithKnownFacts(key, document, prepared);
        retryEvidence = (await storage.get(nameRetryKey(sourceKey))) ?? null;
        return registerDocument(key, sourceKey, {
          ...prepared,
          espnPlayers: mergePlayerEvidence(retryEvidence, prepared.espnPlayers),
        });
      },
      async () => {
        retryEvidence ??= (await storage.get(nameRetryKey(sourceKey)).catch(() => null)) ?? null;
        const records = mergePlayerEvidence(retryEvidence, prepared.espnPlayers);
        failure = { records };
        if (records.length) await saveRetryEvidence(sourceKey, records).catch(() => {});
        return prepared.document;
      },
      () => retryEvidence,
    );
    return { document: data, failure };
  }

  async function prepareDetailWrite(key, value) {
    const source = describeDetailAnswer(key, value);
    const prepared = await prepareDocumentWrite(source.key, source.document, null, key);
    return { document: { ...value, body: prepared.document }, failure: prepared.failure };
  }

  async function describeSourceRejections(storage, key, observedRejections) {
    const retainedRejections = await readIdentitySourceRejections(storage, key);
    return { retainedRejections, rejected: Math.max(observedRejections, retainedRejections) };
  }

  async function recordDocumentFailure(transaction, key, original, superseded) {
    await saveIdentityError(transaction, key, 1, "failed");
    if (superseded) return;
    const source = describeSourceDocument(key, original);
    const observedRejections = expandDocument(source.key, source.document).rejected;
    const { rejected } = await describeSourceRejections(transaction, key, observedRejections);
    await saveIdentitySourceRejections(transaction, key, rejected);
  }

  async function updateDocumentCoverage(transaction, key, document, original = null) {
    if (document === undefined) {
      await saveIdentitySourceProblems(transaction, key, 0, 0);
      await saveIdentitySourceRejections(transaction, key, 0);
      return;
    }
    const source = describeSourceDocument(key, original ?? document);
    const observedRejections = expandDocument(source.key, source.document).rejected;
    const { rejected } =
      original === null
        ? await describeSourceRejections(transaction, key, observedRejections)
        : { rejected: observedRejections };
    if (policy.nativeIdMode === "internal") {
      const prepared = describeSourceDocument(key, document).document;
      const { observations } = expandDocument(source.key, prepared);
      const saved = await lookup.updateRegisteredFacts(
        observations,
        { key, rejected },
        transaction,
      );
      await invalidateFactCoverage(transaction, observations, saved.results);
    } else await saveIdentityError(transaction, key, rejected);
    await saveIdentitySourceRejections(transaction, key, rejected);
  }

  async function publishDocument(key, document, original, previous = undefined, failure = null) {
    const isSuperseded = (current) =>
      isSameJson(previous, document) && !isSameJson(current, document);
    const commitDocument = (recordFailure = false) =>
      storage.transaction(async (transaction) => {
        const current = await transaction.get(key);
        const superseded = isSuperseded(current);
        const changed = !isSameJson(current, document);
        if (recordFailure) await recordDocumentFailure(transaction, key, original, superseded);
        else
          await updateDocumentCoverage(
            transaction,
            key,
            superseded ? current : document,
            superseded ? null : original,
          );
        if (superseded) return false;
        if (failure) await recordRetryEvidence(transaction, key, failure.records);
        if (changed) await transaction.put(key, document);
        return changed;
      });
    try {
      return await commitDocument();
    } catch {
      return commitDocument(true);
    }
  }

  async function forgetSource(key) {
    await storage.transaction(async (transaction) => {
      if ((await transaction.get(key)) !== undefined) return;
      await transaction.delete(nameRetryKey(key));
      await saveIdentityError(transaction, key, 0, "failed");
      await saveIdentitySourceProblems(transaction, key, 0, 0);
      await saveIdentitySourceRejections(transaction, key, 0);
    });
  }

  async function describeBackfillSource(key, value, phase, docs) {
    if (phase === AUDIT_PHASES.vendors) {
      const saved = policy.readSavedVendorGames?.(key, value);
      if (saved) return { kind: "vendor", type: "game", ...saved };
      return isIdentityEntityKey(key) || isIdentityVendorKey(key) ? { kind: "mappings" } : null;
    }
    const cached = isCachedAnswerKey(key);
    if (!cached && !isStoreDocumentPath(key)) return null;
    if (!cached && !isSameJson(await docs.read(key), value)) return { kind: "changed" };
    const source = describeSourceDocument(key, value);
    const prepared = await expandWithKnownFacts(
      source.key,
      source.document,
      expandDocument(source.key, source.document, cached ? null : value),
    );
    const retryEvidence = (await storage.get(nameRetryKey(key))) ?? null;
    const rejections = await describeSourceRejections(storage, key, prepared.rejected);
    return {
      kind: "document",
      cached,
      type: "player",
      document: cached ? { ...value, body: prepared.document } : prepared.document,
      observations: [
        ...prepared.observations,
        ...listGameMatchObservations(key, prepared.document),
      ],
      records: mergePlayerEvidence(retryEvidence, prepared.espnPlayers),
      retryEvidence,
      ...rejections,
    };
  }

  async function noteFeedAnswer(key, value) {
    try {
      const saved = policy.readSavedVendorGames?.(key, value);
      if (saved)
        await storage.transaction(async (transaction) => {
          if (isSameJson(await transaction.get(key), value))
            await saveIdentityError(transaction, key, saved.rejected);
        });
    } catch {
      await saveErrors(key, 1, "failed").catch(() => {});
    }
  }

  async function hasFailedSources() {
    const errors = await storage.list({
      prefix: FAILED_PREFIX,
      limit: ERROR_SCAN_LIMIT,
    });
    let retry = false;
    for (const [path] of errors) {
      const key = decodeURIComponent(path.slice(FAILED_PREFIX.length));
      if (key === "snapshot") continue;
      if ((await storage.get(key)) === undefined) await forgetSource(key);
      else retry = true;
    }
    return retry;
  }

  const backfill = createIdentityBackfill(
    storage,
    {
      lookup,
      policy,
      describeSource: describeBackfillSource,
      saveErrors,
      hasFailedSources,
      forgetSource,
      saveGameMatches,
      registerObservations: async (observations, source) => {
        const facts = observations.filter((observation) => observation.vendorId === undefined);
        const associations = observations.filter(
          (observation) => observation.vendorId !== undefined,
        );
        const updated = facts.length
          ? (await lookup.updateRegisteredFacts(facts, source)).results
          : [];
        const saved = associations.length ? await lookup.save(associations) : [];
        return [...updated, ...saved];
      },
    },
    now,
  );

  async function readStatus() {
    const errors = [...(await storage.list({ prefix: IDENTITY_ERROR_PREFIX })).values()].reduce(
      (total, count) => total + count,
      0,
    );
    return {
      ...(await lookup.readStatus()),
      errors,
      diagnosis: await readIdentityDiagnosis(storage, policy),
      ...(await backfill.readStatus(errors)),
    };
  }

  return {
    prepareDocumentWrite,
    prepareDetailWrite,
    publishDocument,
    saveVendorGames: (records, rejected = 0, docs = null) =>
      attemptIdentity("snapshot", () => saveVendorGames(records, "snapshot", rejected, docs)),
    forgetSource,
    noteFeedAnswer,
    backfill: backfill.backfill,
    backfillWhenDue: backfill.backfillWhenDue,
    lookup,
    readStatus,
  };
}
