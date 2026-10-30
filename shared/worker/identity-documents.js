// Additive identity registration, fact expansion and bounded storage-only coverage checks.
import { isStoreDocumentPath } from "../page/store-path.js";
import { isSameJson } from "../page/compare.js";
import { createIdentityLookup } from "./identity.js";
import { readPlayerName } from "./player-name.js";
import { reconcileIdentities, readIdentityDay } from "./identity-matching.js";

const BACKFILL_KEY = "identity:backfill";
const BATCH_SIZE = 20;
const createBackfillProgress = () => ({
  cursor: "",
  checkedDocuments: 0,
  complete: false,
  phase: "documents",
  missingEntries: 0,
  missingFacts: 0,
  conflicts: 0,
});
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

function stripIdentityMetadata(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripIdentityMetadata);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "espnIdentity")
      .map(([key, part]) => [key, stripIdentityMetadata(part)]),
  );
}

/**
 * @typedef {object} IdentityPolicy
 * @property {string} league
 * @property {string} vendor
 * @property {(record: any, season: number | null) => object} readGameFacts
 * @property {(id: string) => object} readSeriesFacts
 * @property {(key: string, value: any) => { records: any[], rejected: number } | null} [readSavedVendorGames]
 */

/** @param {any} storage @param {IdentityPolicy} policy */
export function createIdentityDocuments(storage, policy) {
  const lookup = createIdentityLookup(storage, policy.league);

  const nameErrorKey = (key, kind) => `identity:error:${kind}:${encodeURIComponent(key)}`;
  async function saveErrors(key, count, kind = "rejected") {
    if (count) await storage.put(nameErrorKey(key, kind), count);
    else await storage.delete(nameErrorKey(key, kind));
  }

  async function attemptIdentity(key, action, fallback) {
    try {
      const result = await action();
      if (result !== false) await saveErrors(key, 0, "failed");
      return result;
    } catch {
      await saveErrors(key, 1, "failed").catch(() => {});
      return fallback;
    }
  }

  const vendorBatches = new Map();
  const nativeEntries = new Map();
  async function listNatives(type) {
    if (!nativeEntries.has(type)) {
      const entries = await storage.list({ prefix: `identity:entity:${policy.league}:${type}:` });
      nativeEntries.set(type, new Map([...entries.values()].map((entry) => [entry.id, entry])));
    }
    return [...nativeEntries.get(type).values()];
  }
  function rememberNatives(observations) {
    for (const observation of observations) {
      const entries = nativeEntries.get(observation.type);
      if (!entries) continue;
      const previous = entries.get(observation.internalId);
      const facts = {
        ...previous?.facts,
        ...Object.fromEntries(
          Object.entries(observation.facts).filter(([, value]) => value != null),
        ),
      };
      if (isSameJson(previous?.facts, facts)) continue;
      entries.set(observation.internalId, {
        id: observation.internalId,
        facts,
        vendors: { ...previous?.vendors, [policy.vendor]: observation.internalId },
      });
      vendorBatches.clear();
    }
  }
  async function saveVendorGames(records, key = "snapshot", rejected = 0) {
    await saveErrors(key, rejected);
    if (!records?.length) return;
    const nameGameGroup = (record) =>
      JSON.stringify([record.away, record.home, readIdentityDay(record)]);
    const groups = new Set(records.map(nameGameGroup));
    const signature = JSON.stringify(records);
    if (vendorBatches.get(key) === signature) return;
    const natives = (await listNatives("game"))
      .filter(
        (entry) => entry.vendors[policy.vendor] && groups.has(nameGameGroup(entry.facts ?? {})),
      )
      .map((entry) => ({ id: entry.id, ...entry.facts }));
    await reconcileIdentities(lookup, { type: "game", vendor: "espn", natives, records });
    vendorBatches.set(key, signature);
  }

  /** @param {string} key @param {any} document */
  async function prepareDocument(key, document, audit = null) {
    const observations = new Map();
    const espnPlayers = [];
    let rejected = 0;
    const matched = /^(?:players|pitchers)\/(\d{4})-(.+)$/.exec(key);
    const isGameDocument = /^(?:games|highlights|espnMatches)\/(?!status$)/.test(key);
    const rootId = isGameDocument
      ? (document?.id ?? document?.boxScore?.id ?? key.split("/")[1])
      : null;
    const established = rootId ? await lookup.readEntry("game", String(rootId)) : null;
    const season =
      document?.season ??
      document?.year ??
      document?.boxScore?.season ??
      established?.facts?.season ??
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
      document = { ...facts, ...document };
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
          ...(record.gameNumber && { gameNumber: record.gameNumber }),
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
    await lookup.save([...observations.values()]);
    await saveErrors(key, rejected);
    rememberNatives([...observations.values()]);
    if (audit)
      for (const observation of observations.values()) {
        if (
          (await lookup.read(observation.type, policy.vendor, observation.internalId)) !==
          observation.internalId
        )
          audit.missingEntries += 1;
        if (
          observation.type === "game" &&
          !Number.isInteger((await lookup.readEntry("game", observation.internalId))?.facts?.season)
        )
          audit.missingFacts += 1;
      }
    if (espnPlayers.length) {
      const names = new Set(espnPlayers.map(readPlayerName));
      const natives = (await listNatives("player"))
        .filter((entry) => names.has(readPlayerName(entry.facts ?? {})))
        .map((entry) => ({ id: entry.id, ...entry.facts }));
      await reconcileIdentities(lookup, {
        type: "player",
        vendor: "espn",
        natives,
        records: espnPlayers,
      });
    }
    if (key.startsWith("espnMatches/") && document?.eventId) {
      await lookup.save([
        {
          type: "game",
          vendor: "espn",
          vendorId: String(document.eventId),
          internalId: String(document.id),
          evidence: {
            method: "teams-day",
            away: document.away,
            home: document.home,
            start: document.start,
          },
        },
      ]);
    }
    return expanded;
  }

  async function prepareDetailAnswer(key, value, audit = null) {
    const url = new URL(key.slice("detail-answer:".length), "https://store");
    const season = Number(url.searchParams.get("season")) || value.body?.season;
    const body = await prepareDocument(`details/${season ?? "answer"}`, value.body, audit);
    return { ...value, body };
  }

  /** @param {import("./season-store.js").SeasonDocuments} docs */
  async function backfill(docs, isActive = () => true) {
    if (!isActive()) return;
    let progress = (await storage.get(BACKFILL_KEY)) ?? createBackfillProgress();
    if (progress.complete) {
      if (!(await storage.list({ prefix: "identity:error:", limit: 1 })).size) return;
      progress = createBackfillProgress();
    }
    const entries = await storage.list({
      prefix: "",
      startAfter: progress.cursor,
      limit: BATCH_SIZE,
    });
    for (const [key, value] of entries) {
      if (!isActive()) return;
      if (progress.phase !== "vendors" && key.startsWith("identity:")) {
        progress.cursor = "identity;";
        await storage.put(BACKFILL_KEY, progress);
        return;
      }
      await attemptIdentity(
        key,
        async () => {
          let processed = false;
          if (
            (progress.phase === "documents" || progress.phase === "facts") &&
            isStoreDocumentPath(key)
          ) {
            processed = true;
            const previous = await docs.read(key);
            if (previous) {
              const expanded = await prepareDocument(
                key,
                previous,
                progress.phase === "facts" ? progress : null,
              );
              await docs.update(key, (latest) =>
                isSameJson(latest, previous) && !isSameJson(latest, expanded) ? expanded : null,
              );
            }
          } else if (
            (progress.phase === "documents" || progress.phase === "facts") &&
            key.startsWith("job:details:detail-answer:")
          ) {
            processed = true;
            const expanded = await prepareDetailAnswer(
              key.slice("job:details:".length),
              value,
              progress.phase === "facts" ? progress : null,
            );
            await storage.transaction(async (transaction) => {
              const latest = await transaction.get(key);
              if (isSameJson(latest, value) && !isSameJson(value, expanded))
                await transaction.put(key, expanded);
            });
          }
          if (progress.phase === "vendors") {
            const saved = policy.readSavedVendorGames?.(key, value);
            if (saved) {
              await saveVendorGames(saved.records, key, saved.rejected);
              processed = true;
            }
            if (key.startsWith("identity:entity:") || key.startsWith("identity:vendor:"))
              progress.conflicts += await lookup.countMappingConflicts(key);
          }
          return processed;
        },
        null,
      );
      progress.cursor = key;
      progress.checkedDocuments += 1;
      await storage.put(BACKFILL_KEY, progress);
    }
    if (entries.size < BATCH_SIZE) {
      if (progress.phase === "documents") {
        progress.phase = "facts";
        progress.cursor = "";
      } else if (progress.phase === "facts") {
        progress.phase = "vendors";
        progress.cursor = "";
      } else progress.complete = true;
      await storage.put(BACKFILL_KEY, progress);
    }
  }

  async function readStatus() {
    const progress = await storage.get(BACKFILL_KEY);
    const errors = [...(await storage.list({ prefix: "identity:error:" })).values()].reduce(
      (total, count) => total + count,
      0,
    );
    return {
      ...(await lookup.readStatus()),
      errors,
      checks: {
        verified:
          !!progress?.complete &&
          !progress.missingEntries &&
          !progress.missingFacts &&
          !progress.conflicts &&
          !errors,
        missingEntries: progress?.missingEntries ?? 0,
        missingFacts: progress?.missingFacts ?? 0,
        competingMappings: progress?.conflicts ?? 0,
      },
      backfill: {
        complete: progress?.complete ?? false,
        checkedDocuments: progress?.checkedDocuments ?? 0,
      },
    };
  }

  async function restartBackfill() {
    await storage.put(BACKFILL_KEY, createBackfillProgress());
  }

  return {
    prepareDocument: (key, document) =>
      attemptIdentity(key, () => prepareDocument(key, document), stripIdentityMetadata(document)),
    prepareDetailAnswer: (key, value) =>
      attemptIdentity(key, () => prepareDetailAnswer(key, value), stripIdentityMetadata(value)),
    saveVendorGames: (records, rejected = 0) =>
      attemptIdentity("snapshot", () => saveVendorGames(records, "snapshot", rejected), null),
    backfill,
    lookup,
    readStatus,
    restartBackfill,
  };
}
