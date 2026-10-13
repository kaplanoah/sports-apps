import { describePlayerIndex } from "#shared/page-search.js";
import { isOnRoster } from "./rosters.js";

// Every player on a club's roster this season, as the page's search finds him: his names as MLB
// uses them, his club, and his number. The roster job builds it from the rosters it reads, and
// saves it beside them.

/**
 * A player's first and last names as MLB uses them, like "Jung Hoo" and "Lee", from its list of
 * every player, or, for a player the list doesn't have yet, his full name split at its first space.
 * @param {any} entry a player on MLB's roster
 * @param {any} person the player in MLB's list of every player
 */
function readNames(entry, person) {
  if (person?.useName && person?.useLastName)
    return { firstName: person.useName, lastName: person.useLastName.trim() };
  const [firstName = "", ...rest] = (entry.person?.fullName ?? "").split(" ");
  return { firstName, lastName: rest.join(" ") };
}

/**
 * @param {number} season
 * @param {{ club: string, roster: any }[]} rosters every club's roster, as MLB answered
 * @param {Map<number, any>} people MLB's list of every player, by id
 */
export const indexRosters = (season, rosters, people) =>
  describePlayerIndex(
    season,
    rosters.flatMap(({ club, roster }) =>
      (roster?.roster ?? []).filter(isOnRoster).map((/** @type {any} */ entry) => ({
        id: String(entry.person.id),
        team: club,
        number: entry.jerseyNumber ?? "",
        ...readNames(entry, people.get(entry.person.id)),
      })),
    ),
  );
