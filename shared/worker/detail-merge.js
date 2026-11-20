import { isSameJson } from "../page/compare.js";

/**
 * Saves what a read of a game's details found onto the details as they are now, so a read that
 * took a while never writes back a field another writer changed meanwhile. A field the read left as
 * it found it, like one a failed part kept from `stored`, keeps its latest value; a field the read
 * changed takes the read's.
 * @param {Record<string, any> | null | undefined} stored the details the read started from
 * @param {Record<string, any>} read the details the read answered
 * @param {Record<string, any> | null} latest the details saved now
 * @returns {Record<string, any> | null} the details to save, or null when the read changed nothing
 */
export function mergeReadDetails(stored, read, latest) {
  const changes = Object.entries(read).filter(
    ([field, value]) => !stored || !(field in stored) || !isSameJson(stored[field], value),
  );
  if (!changes.length) return null;
  return { ...latest, ...Object.fromEntries(changes) };
}
