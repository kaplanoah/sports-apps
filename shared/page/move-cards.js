// The cards the Updates box shows in place of its updates while an app moves to its own address
// (page-move.js): at the old address, one that sends the fan on to the new one, and on the new
// Home Screen app's first open, one that asks to turn notifications back on, which a new site has
// to ask for again. Each goes for good once the fan answers it or taps its X.

/* global forgetNotificationsAsk, isMovingToPageHost, isNotificationsAskKept, isOldAddress,
   requestPageMove -- from page-move.js */

import { isIos, isOnHomeScreen } from "./device.js";
import { renderDismissButton } from "./dismiss-button.js";
import { html } from "./html.js";
import { readStoredText, storeText } from "./local-storage.js";
import { areNotificationsOn, turnOnNotifications } from "./notifications.js";

/** @typedef {"move" | "notifications"} MoveCard */

export const MOVE_TITLE = "New icon and link";
export const MOVE_TEXT =
  "The app has a new icon (took me embarrassingly long to notice the WNBA ball is always orange and white) and a simpler link. Please add the new site to your home screen.";
export const MOVE_BUTTON = "Use new site";
export const NOTIFICATIONS_TITLE = "Keep notifications on?";
export const NOTIFICATIONS_TEXT =
  "You had notifications turned on from the old site. Apple requires approving notifications again for a new site. You can always configure notifications in settings.";
export const LEAVE_OFF_BUTTON = "Leave off";
export const TURN_ON_BUTTON = "Turn on";

const DISMISSED_KEY = "moveCardDismissed";

let isDismissedInMemory = false;

const isMoveCardDismissed = () => isDismissedInMemory || readStoredText(DISMISSED_KEY) !== null;

function keepMoveCardDismissed() {
  isDismissedInMemory = true;
  storeText(DISMISSED_KEY, "dismissed");
}

/**
 * Which card the box shows in place of its updates, if any.
 * @param {{ isMoving: boolean, isOldAddress: boolean, isCardDismissed: boolean,
 *   isAskKept: boolean, canAsk: boolean }} state
 * @returns {MoveCard | null}
 */
export function chooseMoveCard({ isMoving, isOldAddress, isCardDismissed, isAskKept, canAsk }) {
  if (isMoving && isOldAddress) return isCardDismissed ? null : "move";
  return isAskKept && canAsk ? "notifications" : null;
}

// Only a phone that hasn't answered the new site's ask yet can be asked.
const canAskForNotifications = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  Notification.permission === "default";

/** The card this page shows in place of the box's updates, if any. */
export const chooseShownMoveCard = () =>
  chooseMoveCard({
    isMoving: isMovingToPageHost(),
    isOldAddress: isOldAddress(location.href),
    isCardDismissed: isMoveCardDismissed(),
    isAskKept: isNotificationsAskKept(),
    canAsk: canAskForNotifications(),
  });

/**
 * @param {string} title
 * @param {string} text
 */
const renderCopy = (title, text) =>
  html`<span class="move-card-copy">
    <span class="move-card-title">${title}</span>
    <span class="move-card-text">${text}</span>
  </span>`;

/** @param {MoveCard} card */
export function renderMoveCard(card) {
  if (card === "move")
    return html`<div class="move-card-row">
        <span class="appearance-icon appearance-icon-light move-card-icon" aria-hidden="true"></span>
        ${renderCopy(MOVE_TITLE, MOVE_TEXT)}
        ${renderDismissButton({ id: "dismissMoveCard", label: "Dismiss the new site" })}
      </div>
      <div class="move-card-actions">
        <button type="button" class="move-card-button" id="useNewSite">${MOVE_BUTTON}</button>
      </div>`;
  return html`<div class="move-card-row">
      ${renderCopy(NOTIFICATIONS_TITLE, NOTIFICATIONS_TEXT)}
      ${renderDismissButton({ id: "dismissNotificationsAsk", label: "Dismiss notifications" })}
    </div>
    <div class="move-card-actions">
      <button type="button" class="move-card-button move-card-button-outlined" id="leaveNotificationsOff">${LEAVE_OFF_BUTTON}</button>
      <button type="button" class="move-card-button" id="turnNotificationsOn">${TURN_ON_BUTTON}</button>
    </div>`;
}

// A Home Screen app hands Safari the new address under this scheme, since the app would otherwise
// open it itself, and Safari is where the new site is added.
async function openNewSite() {
  const address = await requestPageMove({
    notifications: areNotificationsOn(),
    fromApp: isOnHomeScreen(),
  });
  if (!address) return;
  location.assign(isOnHomeScreen() && isIos() ? `x-safari-${address.href}` : address.href);
}

/**
 * Answers a tap on a card's button.
 * @param {Element} target
 * @returns {boolean} whether the card goes, so the box draws again
 */
export function answerMoveCard(target) {
  if (target.closest("#useNewSite")) {
    openNewSite();
    return false;
  }
  if (target.closest("#dismissMoveCard")) {
    keepMoveCardDismissed();
    return true;
  }
  if (target.closest("#turnNotificationsOn")) turnOnNotifications();
  else if (!target.closest("#leaveNotificationsOff, #dismissNotificationsAsk")) return false;
  forgetNotificationsAsk();
  return true;
}
