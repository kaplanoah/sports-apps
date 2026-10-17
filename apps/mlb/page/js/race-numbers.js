// A club's race numbers as the standings and its sheet show them: what each one's label means, and
// how a number shows, a dash once clinched, E once out, and otherwise the number.

import { html } from "#shared/html.js";

export const MAGIC_NUMBER_TITLE =
  "Division magic number: combined wins by this team and losses by the club closest behind it that would clinch the division. A dash means clinched.";
export const DIVISION_ELIMINATION_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
export const WILD_CARD_ELIMINATION_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

/**
 * A race number's text, and whether it's clinched or still live, which its color tells.
 * @param {string | null | undefined} value an elimination or magic number, a dash, or E
 * @returns {{ text: import("#shared/html.js").Markup | string, state: "" | "clinched" | "live" }}
 */
export function describeRaceNumber(value) {
  if (value === "E") return { text: "E", state: "" };
  if (value == null || value === "-") return { text: html`&mdash;`, state: "clinched" };
  return { text: value, state: "live" };
}

/**
 * A division leader's magic number: a dash once it has won the division, or null while MLB's
 * standings don't count one.
 * @param {{ clinched?: boolean, magic?: string | null }} leader its standings row
 */
export function readMagicNumber(leader) {
  if (leader.clinched) return "-";
  return /^\d+$/.test(leader.magic || "") ? /** @type {string} */ (leader.magic) : null;
}
