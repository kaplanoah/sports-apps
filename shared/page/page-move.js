// Moves fans from an app's old address, under its key at Cloudflare's own, to its own address,
// carrying their choices in the address it opens there (move-choices.js). The Worker makes the
// handoff that signs the new address in (serveMoveHandoff in access-gate.js). The browser at the
// old address leaves for the new one as it opens, and stays where there's no handoff. A Home Screen
// app shows a card in the Updates box that opens the new address in Safari, to add it there, and
// the new icon's first open asks to turn notifications on again where they were on before
// (move-notices.js).

// Every page that loads this runs move-choices.js and pick-theme.js first.
/* global MOVE_KEY, NOTIFICATIONS_ASK_KEY, packMove, readKeptChoices -- from move-choices.js */
/* global buildSafariAddress, readPickedAppearance -- from pick-theme.js */

import { isIos, isOnHomeScreen } from "./device.js";
import { keepHandoff } from "./handoff.js";
import { readStoredText, storeText } from "./local-storage.js";
import {
  chooseMoveNotice,
  isMoveCardDismissed,
  isOldAddress,
  keepMoveCardDismissed,
  renderMoveCard,
  renderNotificationsAsk,
} from "./move-notices.js";
import { isNotifying, turnOnNotifications } from "./notifications.js";

const MOVE_PATH = "access/move";

let isMoving = false;
let wasNotifying = false;
let isAskAnswered = false;
let redrawNotice = () => {};

const isAtOldAddress = () => isOldAddress(location);

// A browser at the old address leaves for the new one as soon as a handoff arrives, which it
// needs, since it keeps its cookies apart from the new address's.
const isHandoffWanted = () =>
  isMoving && isAtOldAddress() && (!isOnHomeScreen() || !isMoveCardDismissed());

function followHandoff() {
  const handoffAddress = handoff.readAddress();
  if (!isOnHomeScreen() && handoffAddress !== null)
    location.replace(buildMovedAddress(handoffAddress));
  else redrawNotice();
}

const handoff = keepHandoff({
  path: MOVE_PATH,
  isWanted: isHandoffWanted,
  onRenewed: followHandoff,
});

/**
 * The new address the handoff opens, with this device's choices, which an iPhone's Home Screen app
 * hands Safari, on its theme, to add the site there.
 * @param {string} handoffAddress
 */
function buildMovedAddress(handoffAddress) {
  const address = new URL(handoffAddress);
  const move = { choices: readKeptChoices(), icon: null, isNotifying: wasNotifying };
  address.searchParams.set(MOVE_KEY, packMove(move));
  if (isOnHomeScreen() && isIos()) return buildSafariAddress(readPickedAppearance(), address.href);
  return address.href;
}

const readNotificationsAsk = () => (isAskAnswered ? null : readStoredText(NOTIFICATIONS_ASK_KEY));

function answerNotificationsAsk() {
  isAskAnswered = true;
  storeText(NOTIFICATIONS_ASK_KEY, "answered");
  redrawNotice();
}

/** What the Updates box shows of the move in its place, or null where it shows its own. */
export function renderMoveNotice() {
  const notice = chooseMoveNotice({
    isMoving,
    isOldAddress: isAtOldAddress(),
    isOnHomeScreen: isOnHomeScreen(),
    isCardDismissed: isMoveCardDismissed(),
    isHandoffRefused: handoff.isRefused(),
    notificationsAsk: readNotificationsAsk(),
  });
  if (notice === "notifications") return renderNotificationsAsk();
  if (notice === null) return null;
  const handoffAddress = handoff.readAddress();
  return renderMoveCard({
    address: handoffAddress === null ? null : buildMovedAddress(handoffAddress),
  });
}

// A tap carries the choices as they stand then, which may have changed since the card was drawn.
/** @param {HTMLAnchorElement} link */
function carryChoicesInLink(link) {
  const handoffAddress = handoff.readAddress();
  if (handoffAddress !== null) link.href = buildMovedAddress(handoffAddress);
}

function dismissCard() {
  keepMoveCardDismissed();
  handoff.follow();
  redrawNotice();
}

function turnOnFromAsk() {
  if (turnOnNotifications()) answerNotificationsAsk();
}

/** @param {Event} event */
function answerNoticeTap(event) {
  const target = /** @type {Element} */ (event.target);
  const link = target.closest("#useNewSite");
  if (link) carryChoicesInLink(/** @type {HTMLAnchorElement} */ (link));
  else if (target.closest("#dismissMoveCard")) dismissCard();
  else if (target.closest("#turnNotificationsOn")) turnOnFromAsk();
  else if (target.closest("#leaveNotificationsOff, #dismissNotificationsAsk"))
    answerNotificationsAsk();
}

/**
 * Starts the move where the app is moving, and the notifications ask a move left waiting either
 * way, drawn with `redraw`.
 * @param {{ isMoving: boolean, redraw: () => void }} app
 */
export async function startPageMove(app) {
  isMoving = app.isMoving;
  redrawNotice = app.redraw;
  /** @type {HTMLElement} */ (document.getElementById("updates")).addEventListener(
    "click",
    answerNoticeTap,
  );
  if (!isHandoffWanted()) return;
  wasNotifying = await isNotifying();
  handoff.follow();
}
