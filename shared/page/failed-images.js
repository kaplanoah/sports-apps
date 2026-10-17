// Pictures from other sites that didn't load, like a news photo its outlet moved, which each view
// then leaves out, as if it had none, rather than showing the browser's broken picture. A picture
// fails and fires its error in one task, so the redraw takes it away before the screen shows it.
// Coming back online, the page tries each again.

/** @type {Set<string>} */
const failedImages = new Set();

/** @param {string} url */
export const hasImageFailed = (url) => failedImages.has(url);

/** @param {string} url */
export function noteFailedImage(url) {
  failedImages.add(url);
}

/**
 * Calls `redraw` once a picture inside `element` fails to load, and once the phone is back online.
 * @param {HTMLElement} element
 * @param {() => void} redraw
 */
export function watchFailedImages(element, redraw) {
  element.addEventListener(
    "error",
    (event) => {
      const url = event.target instanceof HTMLImageElement && event.target.getAttribute("src");
      if (!url || hasImageFailed(url)) return;
      noteFailedImage(url);
      redraw();
    },
    true,
  );
  addEventListener("online", () => {
    failedImages.clear();
    redraw();
  });
}
