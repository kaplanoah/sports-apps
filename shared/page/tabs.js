/** @param {HTMLButtonElement[]} buttons */
export function selectTab(buttons, tab) {
  for (const button of buttons) {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }
}

/** @param {HTMLButtonElement[]} buttons */
export const readSelectedTab = (buttons) =>
  buttons.find((button) => button.classList.contains("active"))?.dataset.tab;

function moveBetweenTabs(event, buttons, onSelect) {
  const index = buttons.indexOf(event.target);
  const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 };
  if (index === -1 || !(event.key in targets)) return;
  event.preventDefault();
  const next = buttons[(targets[event.key] + buttons.length) % buttons.length];
  onSelect(next.dataset.tab);
  next.focus();
}

/**
 * @param {HTMLButtonElement[]} buttons
 * @param {(tab: string) => void} onSelect
 */
export function wireTabs(buttons, onSelect) {
  for (const button of buttons) {
    button.addEventListener("click", () => onSelect(button.dataset.tab));
    button.addEventListener("keydown", (event) => moveBetweenTabs(event, buttons, onSelect));
  }
}

/**
 * Wires the tabs in `tabList`, reading them on each tap or key, so tabs it redraws, as when they
 * reorder, still work.
 * @param {HTMLElement} tabList
 * @param {(tab: string) => void} onSelect
 */
export function wireTabList(tabList, onSelect) {
  const readButtons = () =>
    /** @type {HTMLButtonElement[]} */ ([...tabList.querySelectorAll("[role=tab]")]);
  tabList.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[role=tab]");
    if (button instanceof HTMLElement && button.dataset.tab) onSelect(button.dataset.tab);
  });
  tabList.addEventListener("keydown", (event) => moveBetweenTabs(event, readButtons(), onSelect));
}
