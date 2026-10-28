// Browsers treat any keydown as keyboard navigation, so Shift alone would ring the last-clicked
// element. controls.css shows focus rings only while the body has the kbd class this sets.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

export function trackKeyboardFocus() {
  addEventListener(
    "keydown",
    (event) => {
      if (NAV_KEYS.has(event.key)) document.body.classList.add("kbd");
    },
    true,
  );
  addEventListener("pointerdown", () => document.body.classList.remove("kbd"), true);
}
