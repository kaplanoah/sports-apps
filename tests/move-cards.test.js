import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMoveCard,
  LEAVE_OFF_BUTTON,
  MOVE_BUTTON,
  MOVE_TEXT,
  MOVE_TITLE,
  NOTIFICATIONS_TITLE,
  renderMoveCard,
  TURN_ON_BUTTON,
  writeNotificationsText,
} from "../shared/page/move-cards.js";
import { normalizeSpaces } from "./text.js";

const AT_OLD_ADDRESS = {
  isMoving: true,
  isOldAddress: true,
  isCardDismissed: false,
  isAskKept: false,
  canAsk: false,
};

const AT_NEW_APP = { ...AT_OLD_ADDRESS, isOldAddress: false, isAskKept: true, canAsk: true };

test("the move's card shows only at the old address of an app that's moving, until it's dismissed", () => {
  assert.equal(chooseMoveCard(AT_OLD_ADDRESS), "move");
  assert.equal(chooseMoveCard({ ...AT_OLD_ADDRESS, isMoving: false }), null);
  assert.equal(chooseMoveCard({ ...AT_OLD_ADDRESS, isOldAddress: false }), null);
  assert.equal(chooseMoveCard({ ...AT_OLD_ADDRESS, isCardDismissed: true }), null);
});

test("the notifications ask shows on the new app's first open, only where it can ask", () => {
  assert.equal(chooseMoveCard(AT_NEW_APP), "notifications");
  assert.equal(chooseMoveCard({ ...AT_NEW_APP, isAskKept: false }), null);
  assert.equal(chooseMoveCard({ ...AT_NEW_APP, canAsk: false }), null);
  assert.equal(chooseMoveCard({ ...AT_NEW_APP, isMoving: false }), "notifications");
});

/**
 * Each text the card shows, in order.
 * @param {"move" | "notifications"} card
 * @param {boolean} [isOnIos]
 */
const readTexts = (card, isOnIos = true) =>
  [...renderMoveCard(card, isOnIos).text.matchAll(/>([^<]+)</g)]
    .map((match) => normalizeSpaces(match[1]).trim())
    .filter(Boolean);

test("the move's card asks the fan to add the new site, with the theme's icon", () => {
  assert.deepEqual(readTexts("move"), [MOVE_TITLE, MOVE_TEXT, MOVE_BUTTON]);
  assert.equal(MOVE_TITLE, "New icon and link");
  assert.equal(
    MOVE_TEXT,
    "The app has a new icon (took me embarrassingly long to notice the WNBA ball is always orange and white) and a simpler link. Please add the new site to your home screen.",
  );
  assert.equal(MOVE_BUTTON, "Use new site");
  const markup = renderMoveCard("move", true).text;
  assert.match(markup, /class="appearance-icon[^"]*move-card-icon"/);
  assert.match(markup, /id="useNewSite"/);
  assert.match(markup, /id="dismissMoveCard"/);
});

test("the notifications ask offers to leave them off or turn them on, with no icon", () => {
  assert.deepEqual(readTexts("notifications"), [
    NOTIFICATIONS_TITLE,
    writeNotificationsText(true),
    LEAVE_OFF_BUTTON,
    TURN_ON_BUTTON,
  ]);
  assert.equal(NOTIFICATIONS_TITLE, "Keep notifications on?");
  assert.equal(
    writeNotificationsText(true),
    "You had notifications turned on from the old site. Apple requires approving notifications again for a new site. You can always configure notifications in settings.",
  );
  assert.equal(LEAVE_OFF_BUTTON, "Leave off");
  assert.equal(TURN_ON_BUTTON, "Turn on");
  const markup = renderMoveCard("notifications", true).text;
  assert.doesNotMatch(markup, /move-card-icon/);
  assert.match(markup, /class="[^"]*move-card-button-outlined" id="leaveNotificationsOff"/);
  assert.match(markup, /id="dismissNotificationsAsk"/);
});

test("the notifications ask names Apple only on an iPhone or iPad", () => {
  assert.equal(readTexts("notifications", false)[1], writeNotificationsText(false));
  assert.equal(
    writeNotificationsText(false),
    "You had notifications turned on from the old site. Your phone requires approving notifications again for a new site. You can always configure notifications in settings.",
  );
});
