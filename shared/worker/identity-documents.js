// Additive identity registration, fact expansion and bounded storage-only coverage checks.
import { isStoreDocumentPath } from "../page/store-path.js";
import { isSameJson } from "../page/compare.js";
import { createIdentityLookup } from "./identity.js";
import { ESPN_VENDOR } from "./espn-adapter.js";
import { readIdentityDiagnosis } from "./identity-diagnostics.js";
import { readPlayerName } from "./player-name.js";
import { reconcileIdentities, nameIdentityGameGroup } from "./identity-matching.js";
import { createIdentityBackfill } from "./identity-backfill.js";

const COVERAGE_KEY = "identity:coverage-revision";
const ERROR_SCAN_LIMIT = 20;
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

  const nameErrorKey = (key, kind) => `identity:error:${kind}:${encodeURIComponent(key)}`;
  async function saveErrors(key, count, kind = "rejected") {
    const path = nameErrorKey(key, kind);
    const previous = await storage.get(path);
    if (previous === count || (!previous && !count)) return;
    if (count) await storage.put(path, count);
    else await storage.delete(path);
  }

  async function attemptIdentity(key, action, fallback = () => null) {
    try {
      const result = await action();
      await saveErrors(key, 0, "failed");
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
      const entries = await storage.list({ prefix: `identity:entity:${policy.league}:${type}:` });
      nativeEntries.set(type, new Map([...entries.values()].map((entry) => [entry.id, entry])));
    }
    return [...nativeEntries.get(type).values()];
  }
  async function saveVendorGames(records, key = "snapshot", rejected = 0, docs = null) {
    await saveErrors(key, rejected);
    if (!records?.length) return;
    const factsRevision = await refreshNativeRevision();
    const groups = new Set(records.map(nameIdentityGameGroup));
    const signature = JSON.stringify(records);
    if (vendorBatches.get(key) === signature) return;
    const natives = (await listNatives("game"))
      .filter(
        (entry) =>
          entry.vendors[policy.vendor] && groups.has(nameIdentityGameGroup(entry.facts ?? {})),
      )
      .map((entry) => ({ id: entry.id, ...entry.facts }));
    const results = await reconcileIdentities(lookup, {
      type: "game",
      vendor: ESPN_VENDOR,
      natives,
      records,
      factsRevision,
    });
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
    const results = observations.length ? await lookup.save(observations) : [];
    await saveErrors(sourceKey, rejected);
    if (
      observations.some(
        (observation, index) =>
          observation.type === "game" &&
          ((results[index].created && !Number.isInteger(observation.facts?.season)) ||
            (!results[index].created && results[index].addedFacts.includes("season"))),
      )
    )
      await storage.put(COVERAGE_KEY, crypto.randomUUID());
    if (espnPlayers.length) {
      const factsRevision = await refreshNativeRevision();
      const names = new Set(espnPlayers.map(readPlayerName));
      const natives = (await listNatives("player"))
        .filter((entry) => names.has(readPlayerName(entry.facts ?? {})))
        .map((entry) => ({ id: entry.id, ...entry.facts }));
      await reconcileIdentities(lookup, {
        type: "player",
        vendor: ESPN_VENDOR,
        natives,
        records: espnPlayers,
        factsRevision,
      });
    }
    const matches = listGameMatchObservations(key, document);
    if (matches.length) await lookup.save(matches);
    return prepared.document;
  }
  async function prepareDocument(key, document, known = null, sourceKey = key) {
    let prepared = expandDocument(key, document, known);
    return attemptIdentity(
      sourceKey,
      async () => {
        if (prepared.rootId && !prepared.document.season) {
          const entry = await lookup.readEntry("game", String(prepared.rootId));
          if (entry?.facts) prepared = expandDocument(key, document, entry.facts);
        }
        return registerDocument(key, sourceKey, prepared);
      },
      () => prepared.document,
    );
  }

  async function prepareDetailAnswer(key, value) {
    const url = new URL(key.slice("job:details:detail-answer:".length), "https://store");
    const season = Number(url.searchParams.get("season")) || value.body?.season;
    const body = await prepareDocument(`details/${season ?? "answer"}`, value.body, null, key);
    return { ...value, body };
  }

  async function forgetSource(key) {
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
    const url = cached
      ? new URL(key.slice("job:details:detail-answer:".length), "https://store")
      : null;
    const season = cached ? Number(url.searchParams.get("season")) || value.body?.season : null;
    const documentKey = cached ? `details/${season ?? "answer"}` : key;
    const document = cached ? value.body : value;
    let prepared = expandDocument(documentKey, document, cached ? null : document);
    if (prepared.rootId && !prepared.document.season) {
      const entry = await lookup.readEntry("game", String(prepared.rootId));
      if (entry?.facts) prepared = expandDocument(documentKey, document, entry.facts);
    }
    return {
      kind: "document",
      cached,
      type: "player",
      document: cached ? { ...value, body: prepared.document } : prepared.document,
      observations: [
        ...prepared.observations,
        ...listGameMatchObservations(key, prepared.document),
      ],
      records: prepared.espnPlayers,
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
