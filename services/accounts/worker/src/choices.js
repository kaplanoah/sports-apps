// An account keeps each app's choices apart, each with the time a device made it, so a choice
// saved from two devices ends as the one made last, whichever device saves first.

/** @typedef {{ value: unknown, writtenAt: number }} Choice */
/** @typedef {Record<string, Choice>} AppChoices */

/** @param {unknown} choice */
const isChoice = (choice) =>
  typeof choice === "object" &&
  choice !== null &&
  "value" in choice &&
  "writtenAt" in choice &&
  Number.isFinite(choice.writtenAt);

/**
 * The choices kept, with each one saved taking a choice's place only when it was made later.
 * @param {AppChoices} kept
 * @param {Record<string, unknown>} saved
 * @returns {AppChoices}
 */
export function mergeChoices(kept, saved) {
  const merged = { ...kept };
  for (const [name, choice] of Object.entries(saved)) {
    if (!isChoice(choice)) continue;
    const { value, writtenAt } = /** @type {Choice} */ (choice);
    if (writtenAt > (merged[name]?.writtenAt ?? -Infinity)) merged[name] = { value, writtenAt };
  }
  return merged;
}
