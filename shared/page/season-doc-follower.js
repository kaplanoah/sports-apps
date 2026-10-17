// Follows a document the store keeps for the season a page shows, like the list of players its
// search finds, keeping what the page makes of it and redrawing as it changes.

/**
 * A follower of one kind of document, by season: it keeps what `read` makes of the season's, or
 * null for one the page can't read, with `keep`, and redraws with `showChange` as it changes, but
 * not while there is still none. One for a season the page has moved on from is left out.
 * @template Kept
 * @param {{ nameKey: (year: number) => string, read: (doc: any) => Kept | null, keep: (kept: Kept | null) => void }} kind
 * @returns {(store: { doc: (key: string) => any }, year: number, showChange: () => void) => void}
 */
export function createSeasonDocFollower({ nameKey, read, keep }) {
  /** @type {number | null} */
  let followedYear = null;
  /** @type {Kept | null} */
  let kept = null;
  let unwatch = () => {};
  return (store, year, showChange) => {
    if (year === followedYear) return;
    followedYear = year;
    unwatch();
    kept = null;
    keep(null);
    unwatch = store.doc(nameKey(year)).onSnapshot(
      (/** @type {any} */ snapshot) => {
        if (year !== followedYear) return;
        const shown = read(snapshot.exists ? snapshot.data() : null);
        if (!shown && !kept) return;
        kept = shown;
        keep(shown);
        showChange();
      },
      () => {},
    );
  };
}
