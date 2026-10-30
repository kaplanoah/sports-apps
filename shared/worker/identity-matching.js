import { readEasternDay } from "../page/days.js";

/** @param {any} game */
const readDay = (game) =>
  game.date ??
  (Number.isFinite(Date.parse(game.start)) ? readEasternDay(Date.parse(game.start)).date : null);
const readLetters = (name) =>
  String(name ?? "")
    .normalize("NFD")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
const readPlayerName = (player) =>
  readLetters(`${player.firstName ?? ""} ${player.lastName ?? ""}`);

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
    const disputed =
      !!established && !!confident && String(candidate.id) !== established && !decisive;
    if (disputed) {
      observations.push({
        type,
        vendor,
        vendorId: String(record.id),
        internalId: String(candidate.id),
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
