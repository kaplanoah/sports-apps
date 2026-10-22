// What the Updates box shows of an app's move from its old address to its own: a card at the old
// address that opens the new one, and, on the new icon's first open, an ask to turn notifications
// on again where they were on at the old address (move-choices.js). Each shows in the box's place,
// and the X dismisses the card for good, kept on the device as the note on updating the icon's
// dismissal is (re-add-note.js).

import { renderDismissButton } from "./dismiss-button.js";
import { html } from "./html.js";
import { readStoredText, storeText } from "./local-storage.js";

const CARD_DISMISSED_KEY = "moveCardDismissed";

const CARD_TITLE = "New icon and link";
const CARD_TEXT =
  "The app has a new icon (took me embarrassingly long to notice the WNBA ball is always orange and white) and a simpler link. Please add the new site to your home screen.";
const ASK_TITLE = "Keep notifications on?";
const ASK_TEXT =
  "You had notifications turned on from the old site. Apple requires approving notifications again for a new site. You can always configure notifications in settings.";

let isCardDismissedInMemory = false;

/**
 * Whether the page opened at the app's old address: Cloudflare's own, with the key in its path.
 * @param {{ hostname: string, pathname: string }} address
 */
export const isOldAddress = ({ hostname, pathname }) =>
  hostname.endsWith(".workers.dev") && pathname.split("/")[1] !== "";

/**
 * Which notice the Updates box shows in its place: the card while an app that's moving opens from
 * the Home Screen at its old address, where the Worker hasn't refused a handoff and the viewer
 * hasn't dismissed it, or else the notifications ask a move left waiting. A browser there leaves
 * for the new address instead.
 * @param {{
 *   isMoving: boolean,
 *   isOldAddress: boolean,
 *   isOnHomeScreen: boolean,
 *   isCardDismissed: boolean,
 *   isHandoffRefused: boolean,
 *   notificationsAsk: string | null,
 * }} state
 * @returns {"card" | "notifications" | null}
 */
export function chooseMoveNotice({
  isMoving,
  isOldAddress,
  isOnHomeScreen,
  isCardDismissed,
  isHandoffRefused,
  notificationsAsk,
}) {
  const isCardShown =
    isMoving && isOldAddress && isOnHomeScreen && !isCardDismissed && !isHandoffRefused;
  if (isCardShown) return "card";
  if (notificationsAsk === "ask") return "notifications";
  return null;
}

/**
 * @param {string} title
 * @param {string} text
 */
const renderCopy = (title, text) =>
  html`<div class="move-notice-copy">
    <span class="move-notice-title">${title}</span>
    <span class="move-notice-text">${text}</span>
  </div>`;

// Until a handoff arrives the button waits, since the new address asks for the code without one.
/** @param {{ address: string | null }} card */
export const renderMoveCard = ({ address }) =>
  html`<div class="move-notice">
    <div class="move-notice-row">
      <span class="appearance-icon move-notice-icon" aria-hidden="true"></span>
      ${renderCopy(CARD_TITLE, CARD_TEXT)}
      ${renderDismissButton({ id: "dismissMoveCard", label: "Dismiss move note" })}
    </div>
    <div class="move-notice-actions">
      ${
        address === null
          ? html`<a class="move-notice-button" id="useNewSite" aria-disabled="true">Use new site</a>`
          : html`<a class="move-notice-button" id="useNewSite" href="${address}">Use new site</a>`
      }
    </div>
  </div>`;

export const renderNotificationsAsk = () =>
  html`<div class="move-notice">
    <div class="move-notice-row">
      ${renderCopy(ASK_TITLE, ASK_TEXT)}
      ${renderDismissButton({ id: "dismissNotificationsAsk", label: "Dismiss notifications ask" })}
    </div>
    <div class="move-notice-actions">
      <button type="button" class="move-notice-button move-notice-button-outlined" id="leaveNotificationsOff">Leave off</button>
      <button type="button" class="move-notice-button" id="turnNotificationsOn">Turn on</button>
    </div>
  </div>`;

// Storage can refuse access, as in a private window, and then the dismissal lasts until a reload.
export const isMoveCardDismissed = () =>
  isCardDismissedInMemory || readStoredText(CARD_DISMISSED_KEY) !== null;

export function keepMoveCardDismissed() {
  isCardDismissedInMemory = true;
  storeText(CARD_DISMISSED_KEY, "dismissed");
}
