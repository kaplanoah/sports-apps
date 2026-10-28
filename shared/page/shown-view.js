// What the page shows can change without a scroll, as a tab shows or a part slides in to rest,
// and what follows the shown view's scroll hears of it here.

/** @type {(() => void)[]} */
const watchers = [];

/** @param {() => void} watcher */
export function watchShownView(watcher) {
  watchers.push(watcher);
}

export function noteShownViewChange() {
  for (const watcher of watchers) watcher();
}
