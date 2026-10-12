// On phones the tabs float at the bottom in equal slots, and chrome.css slides the pill to the
// slot the bar's --tab-index names, or hides it while a tab beside the bar shows. open-last-tab.js
// places it before the first paint.

const findBar = () => /** @type {HTMLElement} */ (document.getElementById("tabBar"));

const readTabs = () =>
  /** @type {HTMLElement[]} */ ([...findBar().querySelectorAll("[role=tab]")]).map(
    (button) => button.dataset.tab,
  );

/**
 * Slides the pill to a tab, or hides it for a tab beside the bar, like search, to show again on
 * the next tab chosen in the bar without sliding there.
 * @param {string} tab
 */
export function moveTabSelection(tab) {
  const bar = findBar();
  const index = readTabs().indexOf(tab);
  if (index < 0) {
    bar.classList.add("is-unselected");
    return;
  }
  bar.style.setProperty("--tab-index", String(index));
  if (!bar.classList.contains("is-unselected")) return;
  // The pill takes its new place while it's still hidden, so it shows there rather than sliding.
  bar.querySelector(".tab-pill")?.getBoundingClientRect();
  bar.classList.remove("is-unselected");
}
