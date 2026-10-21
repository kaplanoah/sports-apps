// The page's first drawing replaces the note slow-load.js shows while its views are empty.
export function endLoadNote() {
  document.getElementById("loadNote")?.remove();
}

/** Whether the page shows a drawing yet, its own or the one it last showed. */
export const hasDrawing = () => !document.getElementById("loadNote");
