import { readNameLetters } from "./player-name.js";
import { readEasternDay } from "../page/days.js";

/** @param {any} game */
const readDay = (game) =>
  game.date ??
  (Number.isFinite(Date.parse(game.start)) ? readEasternDay(Date.parse(game.start)).date : null);
const readPlayerName = (player) =>
  readNameLetters(`${player.firstName ?? ""} ${player.lastName ?? ""}`);

function hasSameTeams(first, second) {
  return !!first.away && !!first.home && first.away === second.away && first.home === second.home;
}

function matchesGame(first, second) {
  return hasSameTeams(first, second) && !!readDay(first) && readDay(first) === readDay(second);
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

/**
 * Match normalized records, retaining established identities when schedules or rosters change.
 * @param {ReturnType<typeof import("./identity.js").createIdentityLookup>} lookup
 * @param {{ type: "game" | "player", vendor: string, natives: any[], records: any[] }} batch
 */
export async function reconcileIdentities(lookup, { type, vendor, natives, records }) {
  const uniqueNatives = [...new Map(natives.map((record) => [String(record.id), record])).values()];
  const uniqueRecords = [...new Map(records.map((record) => [String(record.id), record])).values()];
  const observations = [];
  for (const record of uniqueRecords) {
    const established = await lookup.read(type, vendor, String(record.id));
    const matches = uniqueNatives.filter((native) =>
      type === "game" ? matchesGame(native, record) : matchesPlayer(native, record),
    );
    const numbered =
      type === "game" && Number.isInteger(record.gameNumber) && record.gameNumber > 0;
    const candidates = numbered
      ? matches.filter((native) => native.gameNumber === record.gameNumber)
      : matches;
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const competitors =
      candidate &&
      uniqueRecords.filter((other) =>
        type === "game"
          ? matchesGame(candidate, other) &&
            (!numbered || other.gameNumber === candidate.gameNumber)
          : matchesPlayer(candidate, other),
      );
    const confident =
      candidate &&
      competitors.length === 1 &&
      (type !== "game" || numbered || matches.length === 1);
    const decisive = !!confident && (numbered || !!(candidate.birthdate && record.birthdate));
    const internalId =
      established && !decisive ? established : confident ? String(candidate.id) : undefined;
    const establishedNative = uniqueNatives.find((native) => String(native.id) === established);
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
              day: readDay(record),
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
  await lookup.save(observations);
}
