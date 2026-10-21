// The tuning panel, on any channel but production while a round is open: a slider or option
// buttons for each CSS custom property the round names, setting it on :root as it moves, each
// with a reset to where the page's stylesheets put it, and a Copy button for every value as text
// to paste back. The build writes the round into the page as #tuningRound and loads this module,
// and leaves both out of production (worker/tuning-files.mjs).

import { html, setHtml } from "./html.js";
import { readStoredJson, storeJson } from "./local-storage.js";
import {
  isSlider,
  nudgeNumber,
  readNumber,
  readRound,
  restoreSettings,
  writeCopyText,
  writeNumber,
} from "./tuning-round.js";

const COPIED_MS = 2000;

// Phosphor's caret-left, at its Light weight.
const STEP_DOWN_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="M164.24,203.76a6,6,0,1,1-8.48,8.48l-80-80a6,6,0,0,1,0-8.48l80-80a6,6,0,0,1,8.48,8.48L88.49,128Z" />
</svg>`;

// Phosphor's caret-right, at its Light weight.
const STEP_UP_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z" />
</svg>`;

// Phosphor's arrow-counter-clockwise, at its Light weight.
const RESET_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="M222,128a94,94,0,0,1-92.74,94H128a93.43,93.43,0,0,1-64.5-25.65,6,6,0,1,1,8.24-8.72A82,82,0,1,0,70,70l-.19.19L39.44,98H72a6,6,0,0,1,0,12H24a6,6,0,0,1-6-6V56a6,6,0,0,1,12,0V90.34L61.63,61.4A94,94,0,0,1,222,128Z" />
</svg>`;

// Phosphor's arrows-down-up, at its Light weight.
const DOCK_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="M116.24,171.76a6,6,0,0,1,0,8.48l-32,32a6,6,0,0,1-8.48,0l-32-32a6,6,0,0,1,8.48-8.48L74,193.51V48a6,6,0,0,1,12,0V193.51l21.76-21.75A6,6,0,0,1,116.24,171.76Zm96-96-32-32a6,6,0,0,0-8.48,0l-32,32a6,6,0,0,0,8.48,8.48L170,62.49V208a6,6,0,0,0,12,0V62.49l21.76,21.75a6,6,0,0,0,8.48-8.48Z" />
</svg>`;

// Phosphor's x, at its Light weight, like the page's other close buttons.
const CLOSE_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z" />
</svg>`;

/**
 * @typedef {object} PanelState
 * @property {import("./tuning-round.js").Round} round
 * @property {import("./tuning-round.js").RoundSettings} starts
 * @property {import("./tuning-round.js").RoundSettings} settings
 * @property {boolean} isOpen
 * @property {"bottom" | "top"} dock
 * @property {"idle" | "copied" | "failed"} copy
 */

/** @param {import("./tuning-round.js").Round} round */
const nameStorageKey = (round) => `tuningPanel:${round.name}`;

/** @param {import("./tuning-round.js").Round} round */
const readStarts = (round) =>
  Object.fromEntries(
    round.values.map(({ property }) => [
      property,
      getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    ]),
  );

/**
 * @param {import("./tuning-round.js").SliderValue} slider
 * @param {PanelState} state
 */
function drawSlider(slider, { starts, settings }) {
  const { property, label, min, max, step } = slider;
  const value = settings[property];
  const number = readNumber(value, slider);
  if (readNumber(starts[property], slider) === null)
    return html`<p class="tuning-note">
      ${property} isn't a number in ${slider.unit || "no unit"} on :root
    </p>`;
  return html`<div class="tuning-controls">
    <button type="button" data-nudge="-1" aria-label="${label} a step down">
      ${STEP_DOWN_ICON}
    </button>
    <input
      type="range"
      data-slider="${property}"
      min="${min}"
      max="${max}"
      step="${step}"
      value="${number ?? min}"
      aria-label="${label}"
    />
    <button type="button" data-nudge="1" aria-label="${label} a step up">${STEP_UP_ICON}</button>
  </div>`;
}

/**
 * @param {import("./tuning-round.js").OptionValue} value
 * @param {PanelState} state
 */
const drawOptions = ({ label, options, property }, { settings }) =>
  html`<div class="tuning-controls" role="group" aria-label="${label}">
    ${options.map(
      (option) =>
        html`<button
          type="button"
          class="tuning-option"
          data-option="${option}"
          aria-pressed="${String(settings[property] === option)}"
        >
          ${option}
        </button>`,
    )}
  </div>`;

/**
 * @param {import("./tuning-round.js").RoundValue} value
 * @param {PanelState} state
 */
function drawRow(value, state) {
  const { property, label } = value;
  const isAtStart = state.settings[property] === state.starts[property];
  return html`<div class="tuning-row" data-key="${property}" data-property="${property}">
    <div class="tuning-row-top">
      <span class="tuning-label">${label}</span>
      <output class="tuning-value">${state.settings[property] || "not set"}</output>
      <button type="button" class="tuning-icon" data-reset aria-label="Reset ${label}" ${isAtStart ? "disabled" : ""}>
        ${RESET_ICON}
      </button>
    </div>
    ${isSlider(value) ? drawSlider(value, state) : drawOptions(value, state)}
  </div>`;
}

/** @param {PanelState["copy"]} copy */
const nameCopyButton = (copy) => ({ idle: "Copy", copied: "Copied", failed: "Copy below" })[copy];

/** @param {PanelState} state */
const drawPanel = (state) =>
  html`<div class="tuning-top">
      <h2 class="tuning-name">${state.round.name}</h2>
      <button type="button" class="tuning-copy" data-copy>${nameCopyButton(state.copy)}</button>
      <button
        type="button"
        class="tuning-icon"
        data-dock
        aria-label="${state.dock === "bottom" ? "Move to the top" : "Move to the bottom"}"
      >
        ${DOCK_ICON}
      </button>
      <button type="button" class="tuning-icon" data-close aria-label="Close tuning">
        ${CLOSE_ICON}
      </button>
    </div>
    ${
      state.copy === "failed" &&
      html`<textarea class="tuning-copy-text" readonly aria-label="Values to copy">
${writeCopyText(state.round, state.settings)}</textarea
    >`
    }
    <div class="tuning-list">${state.round.values.map((value) => drawRow(value, state))}</div>`;

/**
 * Sets each value on :root, or takes it off where it's back at its start, so the page's own
 * stylesheets set it exactly as they ship.
 * @param {PanelState} state
 */
function applySettings({ starts, settings }) {
  const { style } = document.documentElement;
  for (const [property, value] of Object.entries(settings)) {
    if (value === starts[property]) style.removeProperty(property);
    else style.setProperty(property, value);
  }
}

/** @param {PanelState} state */
const keepState = ({ round, starts, settings, isOpen, dock }) =>
  storeJson(nameStorageKey(round), { starts, values: settings, isOpen, dock });

/**
 * A range input keeps the value it was dragged to over its markup's, so each takes the setting's.
 * @param {HTMLElement} panel
 * @param {PanelState} state
 */
function syncSliders(panel, { round, settings }) {
  for (const value of round.values.filter(isSlider)) {
    const input = panel.querySelector(`input[data-slider="${value.property}"]`);
    const number = readNumber(settings[value.property], value);
    if (input instanceof HTMLInputElement && number !== null) input.value = String(number);
  }
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLButtonElement} toggle
 * @param {PanelState} state
 */
function drawState(panel, toggle, state) {
  setHtml(panel, drawPanel(state));
  syncSliders(panel, state);
  panel.hidden = !state.isOpen;
  panel.dataset.dock = state.dock;
  toggle.hidden = state.isOpen;
  toggle.dataset.dock = state.dock;
  applySettings(state);
  keepState(state);
}

/**
 * @param {PanelState} state
 * @param {string} property
 */
const findValue = (state, property) =>
  state.round.values.find((value) => value.property === property);

/**
 * The setting a tap on one of a row's buttons makes, or null for a tap that sets nothing.
 * @param {PanelState} state
 * @param {HTMLElement} button
 * @param {string} property
 */
function readTappedSetting(state, button, property) {
  const value = findValue(state, property);
  if (!value) return null;
  if (button.matches("[data-reset]")) return state.starts[property];
  if (button.dataset.option !== undefined) return button.dataset.option;
  if (button.dataset.nudge && isSlider(value))
    return nudgeNumber(state.settings[property], value, button.dataset.nudge === "1" ? 1 : -1);
  return null;
}

/**
 * @param {PanelState} state
 * @param {() => void} redraw
 */
async function copySettings(state, redraw) {
  try {
    await navigator.clipboard.writeText(writeCopyText(state.round, state.settings));
    state.copy = "copied";
  } catch {
    state.copy = "failed";
  }
  redraw();
  if (state.copy === "copied")
    setTimeout(() => {
      state.copy = "idle";
      redraw();
    }, COPIED_MS);
}

/**
 * @param {HTMLElement} panel
 * @param {PanelState} state
 * @param {() => void} redraw
 */
function watchTaps(panel, state, redraw) {
  panel.addEventListener("click", (event) => {
    const button = event.target instanceof Element && event.target.closest("button");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.matches("[data-copy]")) return void copySettings(state, redraw);
    if (button.matches("[data-close]")) state.isOpen = false;
    if (button.matches("[data-dock]")) state.dock = state.dock === "bottom" ? "top" : "bottom";
    const property = button.closest("[data-property]")?.getAttribute("data-property");
    const setting = property && readTappedSetting(state, button, property);
    if (property && setting !== null && setting !== "") state.settings[property] = setting;
    redraw();
  });
}

/**
 * @param {HTMLElement} panel
 * @param {PanelState} state
 * @param {() => void} redraw
 */
function watchSliders(panel, state, redraw) {
  panel.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.slider) return;
    const value = findValue(state, input.dataset.slider);
    if (!value || !isSlider(value)) return;
    state.settings[value.property] = writeNumber(Number(input.value), value);
    redraw();
  });
}

// A modal sheet leaves everything outside it untouchable, so the panel and its button move into
// the sheet on top while one is open, and back out once none is.
/** @param {HTMLElement[]} parts */
function followModalSheets(parts) {
  const placeParts = () => {
    const sheets = [...document.querySelectorAll("dialog")].filter((dialog) =>
      dialog.matches(":modal"),
    );
    const holder = sheets.at(-1) ?? document.body;
    for (const part of parts) if (part.parentElement !== holder) holder.append(part);
  };
  new MutationObserver(placeParts).observe(document.body, {
    subtree: true,
    attributeFilter: ["open"],
  });
}

// A pull to refresh starts from a touch anywhere on the page, so a drag on the panel stays its own.
/** @param {HTMLElement} part */
const keepTouchesInside = (part) =>
  part.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });

export function startTuningPanel() {
  const source = document.getElementById("tuningRound");
  if (!source?.textContent) return;
  const round = readRound(source.textContent);
  const starts = readStarts(round);
  const kept = readStoredJson(nameStorageKey(round));
  /** @type {PanelState} */
  const state = {
    round,
    starts,
    settings: restoreSettings(starts, kept),
    isOpen: Boolean(kept?.isOpen),
    dock: kept?.dock === "top" ? "top" : "bottom",
    copy: "idle",
  };
  const panel = Object.assign(document.createElement("section"), { className: "tuning-panel" });
  panel.setAttribute("aria-label", "Tuning");
  const toggle = Object.assign(document.createElement("button"), {
    type: "button",
    className: "tuning-toggle",
    textContent: "Tune",
  });
  const redraw = () => drawState(panel, toggle, state);
  toggle.addEventListener("click", () => {
    state.isOpen = true;
    redraw();
  });
  watchTaps(panel, state, redraw);
  watchSliders(panel, state, redraw);
  for (const part of [panel, toggle]) keepTouchesInside(part);
  document.body.append(toggle, panel);
  followModalSheets([toggle, panel]);
  redraw();
}

startTuningPanel();
