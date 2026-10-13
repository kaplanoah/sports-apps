// A read worked out again only when what it reads from changes, for work too slow to repeat on
// every key press or redraw, like a search's season of thousands of games.

/**
 * A function that returns what `read` last returned while each of its sources is the same one as
 * last time, and reads again once any changes.
 * @template {unknown[]} Sources
 * @template Result
 * @param {(...sources: Sources) => Result} read
 * @returns {(...sources: Sources) => Result}
 */
export function keepLastRead(read) {
  /** @type {{ sources: Sources, result: Result } | null} */
  let kept = null;
  return (...sources) => {
    const last = kept;
    const isSame =
      last !== null && sources.every((source, index) => source === last.sources[index]);
    if (isSame) return last.result;
    const result = read(...sources);
    kept = { sources, result };
    return result;
  };
}
