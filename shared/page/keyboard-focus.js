// Browsers treat any keydown as keyboard navigation, so Shift alone would ring the last-clicked
// element. controls.css shows focus rings only while the body has the kbd class this sets.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

// In a field being typed in, the arrows, Home, and End move its cursor, so only Tab leaves it.
const TEXT_ENTRY = "textarea, input:not([type='radio'], [type='checkbox'], [type='range'])";

const isNavigation = (event) =>
  NAV_KEYS.has(event.key) &&
  (event.key === "Tab" || !(event.target instanceof Element && event.target.matches(TEXT_ENTRY)));

export function trackKeyboardFocus() {
  addEventListener(
    "keydown",
    (event) => {
      if (isNavigation(event)) document.body.classList.add("kbd");
    },
    true,
  );
  addEventListener("pointerdown", () => document.body.classList.remove("kbd"), true);
}
