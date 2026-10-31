// Corroborated matching shared by live vendor links and persisted identity reconciliation.
import { readPlayerName } from "./player-name.js";
import { readEasternDay } from "../page/days.js";

/** @param {any} game */
const readIdentityDay = (game) =>
  game.date ??
  (Number.isFinite(Date.parse(game.start)) ? readEasternDay(Date.parse(game.start)).date : null);

/** @param {any} record */
export const nameIdentityGameGroup = (record) =>
  JSON.stringify([record.away, record.home, readIdentityDay(record)]);

function hasSameTeams(first, second) {
  return !!first.away && !!first.home && first.away === second.away && first.home === second.home;
}

function matchesGame(first, second) {
  return (
    hasSameTeams(first, second) &&
    !!readIdentityDay(first) &&
    readIdentityDay(first) === readIdentityDay(second)
  );
}

function matchesPlayer(first, second) {
  const name = readPlayerName(first);
  if (!name || name !== readPlayerName(second)) return false;
  if (first.birthdate && second.birthdate) return first.birthdate === second.birthdate;
  return (
    !!first.team && first.team === second.team && !!first.number && first.number === second.number
  );
}

function hasContradictoryEvidence(native, record, type) {
  if (!native) return false;
  if (type === "game")
    return (
      (!!native.away && !!record.away && native.away !== record.away) ||
      (!!native.home && !!record.home && native.home !== record.home) ||
      (Number.isInteger(native.gameNumber) &&
        Number.isInteger(record.gameNumber) &&
        native.gameNumber !== record.gameNumber)
    );
  return !!native.birthdate && !!record.birthdate && native.birthdate !== record.birthdate;
}

function findIdentityCandidate(type, record, uniqueNatives, uniqueRecords) {
  const matches = uniqueNatives.filter((native) =>
    type === "game" ? matchesGame(native, record) : matchesPlayer(native, record),
  );
  const numbered =
    type === "game" &&
    Number.isInteger(record.gameNumber) &&
    record.gameNumber > 0 &&
    matches.some((native) => Number.isInteger(native.gameNumber) && native.gameNumber > 0);
  const candidates = numbered
    ? matches.filter((native) => native.gameNumber === record.gameNumber)
    : matches;
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const competitors =
    candidate &&
    uniqueRecords.filter((other) =>
      type === "game"
        ? matchesGame(candidate, other) && (!numbered || other.gameNumber === candidate.gameNumber)
        : matchesPlayer(candidate, other),
    );
  const confident =
    candidate && competitors.length === 1 && (type !== "game" || numbered || matches.length === 1);
  const decisive = !!confident && (numbered || !!(candidate.birthdate && record.birthdate));
  return { candidate, confident: !!confident, decisive, numbered };
}

/**
 * Match normalized records, retaining established identities when schedules or rosters change.
 * @param {ReturnType<typeof import("./identity.js").createIdentityLookup>} lookup
 * @param {{ type: "game" | "player", vendor: string, natives: any[], records: any[], offset?: number, limit?: number, factsRevision?: string | null }} batch
 */
export async function reconcileIdentities(
  lookup,
  { type, vendor, natives, records, offset = 0, limit = Infinity, factsRevision = undefined },
) {
  const revision = factsRevision === undefined ? await lookup.readFactsRevision() : factsRevision;
  const uniqueNatives = [...new Map(natives.map((record) => [String(record.id), record])).values()];
  const uniqueRecords = [...new Map(records.map((record) => [String(record.id), record])).values()];
  const observations = [];
  for (const record of uniqueRecords.slice(offset, offset + limit)) {
    const established = await lookup.read(type, vendor, String(record.id));
    const { candidate, confident, decisive, numbered } = findIdentityCandidate(
      type,
      record,
      uniqueNatives,
      uniqueRecords,
    );
    const internalId =
      established && !decisive ? established : confident ? String(candidate.id) : undefined;
    let establishedNative = uniqueNatives.find((native) => String(native.id) === established);
    if (established && !establishedNative) {
      const entry = await lookup.readEntry(type, established);
      establishedNative = entry ? { id: entry.id, ...entry.facts } : null;
    }
    const disputed =
      !!established &&
      !decisive &&
      (hasContradictoryEvidence(establishedNative, record, type) ||
        (!!confident && String(candidate.id) !== established));
    if (disputed) {
      observations.push({
        type,
        vendor,
        vendorId: String(record.id),
        internalId: established,
        disputed: true,
        evidence: { method: type === "game" ? "teams-day" : "player-facts" },
      });
      continue;
    }
    const method =
      established && !decisive
        ? "existing-id"
        : type === "player"
          ? "player-facts"
          : numbered
            ? "game-number"
            : "teams-day";
    observations.push({
      type,
      vendor,
      vendorId: String(record.id),
      ...(internalId && { internalId }),
      decisive,
      preserveProblem: !!established && !confident,
      evidence: {
        method,
        ...(type === "game"
          ? {
              away: record.away,
              home: record.home,
              day: readIdentityDay(record),
              gameNumber: record.gameNumber ?? null,
            }
          : {
              name: readPlayerName(record),
              team: record.team ?? null,
              number: record.number ?? null,
              birthdate: record.birthdate ?? null,
            }),
      },
    });
  }
  return lookup.save(observations, revision);
}
