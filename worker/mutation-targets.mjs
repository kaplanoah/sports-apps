export const MUTATION_TARGETS = ["search-reading", "series-text", "season-days"];

/** @param {string | undefined} target */
export function readMutationTarget(target) {
  if (!MUTATION_TARGETS.includes(target))
    throw new Error(`Choose MUTATION_TARGET from ${MUTATION_TARGETS.join(", ")}.`);
  return `shared/page/${target}.js`;
}
