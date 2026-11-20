import { isSameJson } from "../page/compare.js";

/**
 * Chooses what a part of a game's details becomes: the read's answer when the read changed it and
 * nothing else did meanwhile, otherwise the latest, so a read that took a while never writes over a
 * newer one.
 * @param {any} stored the part as the read started from it
 * @param {any} read the part as the read answered it
 * @param {any} latest the part as saved now
 */
const chooseSettledPart = (stored, read, latest) =>
  isSameJson(stored, read) || !isSameJson(stored, latest) ? latest : read;

/**
 * Settles each part on its own, leaving every other field as it is now.
 * @param {Record<string, any> | null | undefined} stored
 * @param {Record<string, any>} read
 * @param {Record<string, any>} latest
 * @param {string[]} fields
 */
function settleParts(stored, read, latest, fields) {
  const settled = { ...latest };
  for (const field of fields) {
    const part = chooseSettledPart(stored?.[field], read[field], latest[field]);
    if (part === undefined) delete settled[field];
    else settled[field] = part;
  }
  return settled;
}

/**
 * Saves what a read of a game's details changed onto the details as they are now. With `fields`,
 * each is a part that settles on its own, like a box score beside a lead, and every other field
 * keeps its latest value. Without them the whole document is one part, so a box score is never a
 * mix of two reads.
 * @param {Record<string, any> | null | undefined} stored the details the read started from
 * @param {Record<string, any>} read the details the read answered
 * @param {Record<string, any> | null} latest the details saved now
 * @param {string[]} [fields] the parts of the details that settle on their own
 * @returns {Record<string, any> | null} the details to save, or null when there is nothing to change
 */
export function mergeReadDetails(stored, read, latest, fields) {
  if (!latest) return isSameJson(stored, read) ? null : read;
  const merged = fields
    ? settleParts(stored, read, latest, fields)
    : chooseSettledPart(stored, read, latest);
  return isSameJson(latest, merged) ? null : merged;
}

/**
 * Whether every part a read answered is what's kept, so no newer write took one from it. Fields
 * the read doesn't answer, like facts the store adds to a document, don't count.
 * @param {Record<string, any>} kept the details kept after the read
 * @param {Record<string, any>} read the details the read answered
 * @param {string[]} [fields] the parts of the details that settle on their own
 */
export const isReadKept = (kept, read, fields) =>
  fields ? fields.every((field) => isSameJson(kept[field], read[field])) : isSameJson(kept, read);
