// Safari keeps 5 MB for a site's storage, counting up to two bytes for each character, and a save
// that doesn't fit fails. A test's season shows less than a phone does, without its news or the
// sheets it has open, so the page's copy of it keeps to half.
const SAFARI_STORAGE_BYTES = 5 * 1024 * 1024;
export const SAVED_COPY_BYTES = SAFARI_STORAGE_BYTES / 2;

/**
 * How many bytes Safari would count for what the page keeps in storage.
 * @param {import("@playwright/test").Page} page
 */
export const measureStoredBytes = (page) =>
  page.evaluate(() =>
    Object.keys(localStorage).reduce(
      (total, key) => total + 2 * (key.length + (localStorage.getItem(key)?.length ?? 0)),
      0,
    ),
  );
