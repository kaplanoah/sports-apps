// The page's asks to be added to the Home Screen, which only a phone's or tablet's browser shows:
// the welcome over the whole screen that it opens on, until the viewer adds the page or goes on in
// the browser, and the box at the bottom of settings, which keeps the steps. Modules run only once
// all of them have loaded, so a welcome they drew would arrive over a page already painted. This
// plain script loads in the head, and the page calls drawHomeScreenAsks() right after its
// settings, before anything is painted. home-screen.js takes both from there.

// home-screen.js keeps it under the same key once the viewer goes on in the browser.
const WELCOME_CLOSED_KEY = "homeScreenWelcomeClosed";

const TIP_TITLE = "Use this site like an app";
const BENEFIT = "It opens full screen, without the browser's bars";

// The browser's own Share and menu buttons, copied so people find them.
const SHARE_GLYPH = `<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M8 9H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-2" />
  <path d="M12 15V3" />
  <path d="M8.5 6.5 12 3l3.5 3.5" />
</svg>`;
const MENU_GLYPH = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <circle cx="12" cy="5" r="2" />
  <circle cx="12" cy="12" r="2" />
  <circle cx="12" cy="19" r="2" />
</svg>`;

// The same tests of the device as device.js makes for the page's modules. An iPad says it's a Mac,
// so its touch screen gives it away.
const isIosDevice = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isBrowserOnTouchDevice = () =>
  matchMedia("(hover: none) and (pointer: coarse)").matches &&
  !matchMedia("(display-mode: standalone)").matches &&
  /** @type {{ standalone?: boolean }} */ (navigator).standalone !== true;

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
/** @param {string} key */
function readStoredText(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// The appearance the viewer picked, kept as JSON, or, if kept earlier, as its name, as
// pick-theme.js reads it.
function readAppearance() {
  const stored = readStoredText("appearance") ?? "";
  try {
    const choice = JSON.parse(stored);
    return typeof choice === "string" ? choice : "auto";
  } catch {
    return stored || "auto";
  }
}

/**
 * The page's own markup, which this script writes before html.js can load.
 * @param {string} markup
 */
const parseMarkup = (markup) =>
  [...new DOMParser().parseFromString(markup, "text/html").body.childNodes].map((node) =>
    document.importNode(node, true),
  );

/** @param {boolean} isOnIos */
const listBrowserSteps = (isOnIos) =>
  isOnIos
    ? [`Tap ${SHARE_GLYPH} Share`, "Tap Add to Home Screen"]
    : [`Tap ${MENU_GLYPH} Menu`, "Tap Add to Home screen"];

/** @param {boolean} isOnIos */
const writeTipSteps = (isOnIos) =>
  isOnIos
    ? `Tap ${SHARE_GLYPH} <b>Share</b>, then <b>Add to Home Screen</b>. ${BENEFIT}.`
    : `Tap ${MENU_GLYPH} <b>Menu</b>, then <b>Add to Home screen</b>. ${BENEFIT}.`;

// The appearance choices settings shows, as the welcome's first step, kept apart from them.
function copyThemeChoices() {
  const choices = /** @type {HTMLElement} */ (
    document.querySelector(".appearance-row .appearance-choices").cloneNode(true)
  );
  const picked = readAppearance();
  choices.setAttribute("aria-labelledby", "welcomePickTitle");
  for (const input of choices.querySelectorAll("input")) {
    input.name = "welcomeAppearance";
    input.checked = input.value === picked;
  }
  return choices;
}

/** @param {boolean} isOnIos */
function drawWelcome(isOnIos) {
  const welcome = /** @type {HTMLDialogElement} */ (document.getElementById("homeScreenWelcome"));
  const [shareStep, addStep] = listBrowserSteps(isOnIos);
  welcome.replaceChildren(
    ...parseMarkup(`<h1 class="gate-title welcome-title" id="welcomeTitle"></h1>
      <ol class="welcome-steps">
        <li>
          <span class="welcome-step" id="welcomePickTitle">Pick your theme</span>
          <span class="welcome-note">You can change it later in Settings</span>
          <span class="welcome-step-body"></span>
        </li>
        <li data-ask="browser"><span class="welcome-step">${shareStep}</span></li>
        <li data-ask="browser"><span class="welcome-step">${addStep}</span></li>
        <li data-ask="install" hidden>
          <span class="welcome-step">Tap to install</span>
          <span class="welcome-step-body">
            <button type="button" class="open-button" data-install>Install</button>
          </span>
        </li>
      </ol>
      <button type="button" class="welcome-continue">Continue in the browser</button>`),
  );
  const appName = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  welcome.querySelector(".welcome-title").textContent =
    `Add ${appName.getAttribute("content")} to your Home Screen`;
  welcome.querySelector(".welcome-step-body").append(copyThemeChoices());
  return welcome;
}

/** @param {boolean} isOnIos */
function drawTip(isOnIos) {
  const tip = /** @type {HTMLElement} */ (document.getElementById("homeScreenTip"));
  tip.replaceChildren(
    ...parseMarkup(`<span class="home-screen-icon" aria-hidden="true"></span>
      <span class="home-screen-copy">
        <span class="home-screen-title">${TIP_TITLE}</span>
        <span class="home-screen-steps" data-ask="browser">${writeTipSteps(isOnIos)}</span>
        <span class="home-screen-steps" data-ask="install" hidden>${BENEFIT}</span>
        <button type="button" class="home-screen-install" data-ask="install" data-install hidden>
          Install
        </button>
      </span>`),
  );
  tip.hidden = false;
}

// A computer, or the page open from the Home Screen, asks nothing.
function drawHomeScreenAsks() {
  if (!isBrowserOnTouchDevice()) return;
  const isOnIos = isIosDevice();
  drawTip(isOnIos);
  const welcome = drawWelcome(isOnIos);
  if (readStoredText(WELCOME_CLOSED_KEY) !== "closed") welcome.showModal();
}
