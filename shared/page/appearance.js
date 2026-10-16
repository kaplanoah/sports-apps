// The settings panel's appearance choice: the app's light look, its dark one, or System to follow
// the phone. Each device keeps its own, since the page saves nothing to the store. pick-theme.js
// sets the theme before the first paint; this keeps it, and the icons and bar color that go with
// it, current. Each app hands it its looks' icons and bar colors.

import { createViewerChoice } from "./device-storage.js";

/**
 * @typedef {{ barColor: string, tabIcon: string, homeScreenIcon: string }} Look
 * @typedef {{ light: Look, dark: Look }} Looks
 */

const CHOICES = ["auto", "light", "dark"];

// A home-screen page keeps its settings apart from the browser's, so matching the icon takes
// choosing again in the browser.
const HOME_SCREEN_NOTE =
  "Apple sets a home-screen icon only when the page is added. To match this look, choose it in your browser and add the page again.";

const darkScheme = matchMedia("(prefers-color-scheme: dark)");
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const appearance = createViewerChoice("appearance", (stored) =>
  typeof stored === "string" && CHOICES.includes(stored) ? stored : "auto",
);

/**
 * @param {string} choice
 * @returns {"light" | "dark"}
 */
const resolveTheme = (choice) => {
  if (choice === "light" || choice === "dark") return choice;
  return darkScheme.matches ? "dark" : "light";
};

// A phone keeps the icon a page offers at the moment it's added to the home screen, so the page
// offers the one that matches the theme showing.
/**
 * @param {Looks} looks
 * @param {"light" | "dark"} theme
 */
function showTheme(looks, theme) {
  const { barColor, tabIcon, homeScreenIcon } = looks[theme];
  document.documentElement.dataset.theme = theme;
  findElement("themeColor").setAttribute("content", barColor);
  findElement("tabIcon").setAttribute("href", tabIcon);
  findElement("homeScreenIcon").setAttribute("href", homeScreenIcon);
}

/**
 * Shows the theme the viewer picked, or the phone's for System, now and whenever the phone's
 * changes.
 * @param {Looks} looks
 * @param {() => string} readPicked
 */
function followTheme(looks, readPicked) {
  const showChosenTheme = () => showTheme(looks, resolveTheme(readPicked()));
  showChosenTheme();
  darkScheme.addEventListener("change", showChosenTheme);
  return showChosenTheme;
}

/**
 * Shows the saved look, and another tab's choice too.
 * @param {Looks} looks
 */
export function followSavedTheme(looks) {
  appearance.watch(followTheme(looks, appearance.read));
}

/** @param {NodeListOf<HTMLInputElement>} choices */
function checkSavedChoice(choices) {
  const saved = appearance.read();
  for (const choice of choices) choice.checked = choice.value === saved;
}

/**
 * Wires the settings' Appearance choices, and the welcome's copy of them
 * (draw-home-screen-asks.js), to the look they pick.
 * @param {Looks} looks
 */
export function startAppearance(looks) {
  const choices = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="appearance"], input[name="welcomeAppearance"]')
  );
  checkSavedChoice(choices);
  const showChosenTheme = followTheme(looks, appearance.read);
  for (const choice of choices) {
    choice.addEventListener("change", () => {
      appearance.keep(choice.value);
      checkSavedChoice(choices);
      showChosenTheme();
      if (choice.name === "appearance")
        findElement("appearanceNote").textContent = HOME_SCREEN_NOTE;
    });
  }
  appearance.watch(() => {
    checkSavedChoice(choices);
    showChosenTheme();
  });
}
