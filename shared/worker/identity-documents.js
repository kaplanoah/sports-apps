// Additive facts and identity registration for stored sports documents.
import { isStoreDocumentPath } from "../page/store-path.js";
import { isSameJson } from "../page/compare.js";
import {
  createIdentityLookup,
  IdentityFactsChanged,
  nameIdentityEntityPrefix,
} from "./identity.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import { readIdentityDiagnosis } from "./identity-diagnostics.js";
import { readPlayerName } from "./player-name.js";
import { reconcileIdentities, nameIdentityGameGroup } from "./identity-matching.js";
import { createIdentityBackfill, IDENTITY_COVERAGE_KEY } from "./identity-backfill.js";

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
 * @property {string[]} gameFactFields
 * @property {(record: any, season: number | null) => object} readGameFacts
 * @property {(id: string) => object} readSeriesFacts
 * @property {string} [vendorGameSourcePrefix]
 * @property {(key: string, value: any, limit?: number) => { records: any[], rejected: number, truncated?: boolean } | null} [readSavedVendorGames]
 * @property {(id: string) => string} [nameMatchKey]
 */

/** @param {any} storage @param {IdentityPolicy} policy @param {() => number} [now] */
export function createIdentityDocuments(storage, policy, now = Date.now) {
  const lookup = createIdentityLookup(storage, policy.league);

  const nameRetryKey = (key) => `identity:retry:${encodeURIComponent(key)}`;
  const nameErrorKey = (key, kind) => `identity:error:${kind}:${encodeURIComponent(key)}`;
  async function saveErrors(key, count, kind = "rejected", processedRetry = null) {
    const path = nameErrorKey(key, kind);
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
    const previous = await storage.get(path);
    if (previous === count || (!previous && !count)) return;
    if (count) await storage.put(path, count);
    else await storage.delete(path);
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
      const groups = new Set(records.map(type === "game" ? nameIdentityGameGroup : readPlayerName));
      const natives = (await listNatives(type))
        .filter(
          (entry) =>
            (type !== "game" || entry.vendors[policy.vendor]) &&
            groups.has(
              type === "game"
                ? nameIdentityGameGroup(entry.facts ?? {})
                : readPlayerName(entry.facts ?? {}),
            ),
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
        vendorId: internalId,
        internalId,
        facts: { ...previous?.facts, ...facts },
        evidence: { method: "existing-id" },
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

  async function registerDocument(key, sourceKey, prepared) {
    const { document, observations, rejected, espnPlayers } = prepared;
    let results = [];
    if (observations.length) {
      const saved = await lookup.saveWithEntries(observations);
      results = saved.results;
      rememberNatives(saved);
    }
    await saveErrors(sourceKey, rejected);
    if (
      observations.some(
        (observation, index) =>
          observation.type === "game" &&
          ((results[index].created && !Number.isInteger(observation.facts?.season)) ||
            (!results[index].created && results[index].addedFacts.includes("season"))),
      )
    )
      await storage.put(IDENTITY_COVERAGE_KEY, crypto.randomUUID());
    if (espnPlayers.length) await reconcileLiveRecords("player", espnPlayers);
    const matches = listGameMatchObservations(key, document);
    if (matches.length) await lookup.save(matches);
    return prepared.document;
  }
  async function expandWithKnownFacts(key, document, known = null) {
    let prepared = expandDocument(key, document, known);
    if (prepared.rootId && !prepared.document.season) {
      const entry = await lookup.readEntry("game", String(prepared.rootId));
      if (entry?.facts) prepared = expandDocument(key, document, entry.facts);
    }
    return prepared;
  }

  function describeDetailAnswer(key, value) {
    const url = new URL(key.slice("job:details:detail-answer:".length), "https://store");
    const season = Number(url.searchParams.get("season")) || value.body?.season;
    return { key: `details/${season ?? "answer"}`, document: value.body };
  }

  function mergePlayerEvidence(retained, current) {
    return [
      ...new Map(
        [...(retained?.records ?? []), ...current].map((record) => [String(record.id), record]),
      ).values(),
    ];
  }

  async function saveRetryEvidence(key, records) {
    await storage.transaction(async (transaction) => {
      const retained = await transaction.get(nameRetryKey(key));
      await transaction.put(nameRetryKey(key), {
        revision: crypto.randomUUID(),
        records: mergePlayerEvidence(retained, records),
      });
      await transaction.put(nameErrorKey(key, "failed"), 1);
    });
  }

  async function prepareDocument(key, document, known = null, sourceKey = key) {
    let prepared = expandDocument(key, document, known);
    let retryEvidence = null;
    return attemptIdentity(
      sourceKey,
      async () => {
        prepared = await expandWithKnownFacts(key, document, known);
        retryEvidence = (await storage.get(nameRetryKey(sourceKey))) ?? null;
        return registerDocument(key, sourceKey, {
          ...prepared,
          espnPlayers: mergePlayerEvidence(retryEvidence, prepared.espnPlayers),
        });
      },
      async () => {
        if (prepared.espnPlayers.length)
          await saveRetryEvidence(sourceKey, prepared.espnPlayers).catch(() => {});
        return prepared.document;
      },
      () => retryEvidence,
    );
  }

  async function prepareDetailAnswer(key, value) {
    const source = describeDetailAnswer(key, value);
    const body = await prepareDocument(source.key, source.document, null, key);
    return { ...value, body };
  }

  async function forgetSource(key) {
    await storage.delete(nameRetryKey(key));
    await saveErrors(key, 0, "failed");
    await saveErrors(key, 0, "rejected");
  }

  async function describeBackfillSource(key, value, phase, docs) {
    if (phase === "vendors") {
      const saved = policy.readSavedVendorGames?.(key, value);
      if (saved) return { kind: "vendor", type: "game", ...saved };
      return key.startsWith("identity:entity:") || key.startsWith("identity:vendor:")
        ? { kind: "mappings" }
        : null;
    }
    const cached = key.startsWith("job:details:detail-answer:");
    if (!cached && !isStoreDocumentPath(key)) return null;
    if (!cached && !isSameJson(await docs.read(key), value)) return { kind: "changed" };
    const source = cached ? describeDetailAnswer(key, value) : { key, document: value };
    const prepared = await expandWithKnownFacts(source.key, source.document, cached ? null : value);
    const retryEvidence = (await storage.get(nameRetryKey(key))) ?? null;
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
      rejected: prepared.rejected,
    };
  }

  async function noteFeedAnswer(key, value) {
    try {
      const saved = policy.readSavedVendorGames?.(key, value);
      if (saved) await saveErrors(key, saved.rejected);
    } catch {
      await saveErrors(key, 1, "failed").catch(() => {});
    }
  }

  async function hasFailedSources() {
    const errors = await storage.list({
      prefix: "identity:error:failed:",
      limit: ERROR_SCAN_LIMIT,
    });
    let retry = false;
    for (const [path] of errors) {
      const key = decodeURIComponent(path.slice("identity:error:failed:".length));
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
      saveGameMatches,
    },
    now,
  );

  async function readStatus() {
    const errors = [...(await storage.list({ prefix: "identity:error:" })).values()].reduce(
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
    prepareDocument,
    prepareDetailAnswer,
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
