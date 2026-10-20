import { html } from "./html.js";

// Phosphor's x, at its Light weight, like the page's other close buttons.
const DISMISS_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"
  />
</svg>`;

/**
 * The X in a box's corner that dismisses it, named for what it dismisses.
 * @param {{ id: string, label: string }} button
 */
export const renderDismissButton = ({ id, label }) =>
  html`<button type="button" class="dismiss-button" id="${id}" aria-label="${label}" title="Dismiss">${DISMISS_ICON}</button>`;
