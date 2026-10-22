import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseMoveNotice,
  isMoveCardDismissed,
  isOldAddress,
  keepMoveCardDismissed,
  renderMoveCard,
  renderNotificationsAsk,
} from "../shared/page/move-notices.js";
import { dropSavedStorage, useDeniedStorage, useSavedStorage } from "./saved-storage.js";

/** @param {string} href */
const isOldHref = (href) => isOldAddress(new URL(href));

const CARD_DUE = {
  isMoving: true,
  isOldAddress: true,
  isOnHomeScreen: true,
  isCardDismissed: false,
  isHandoffRefused: false,
  notificationsAsk: null,
};

/**
 * The text of each element with `name` as its class, in order.
 * @param {import("../shared/page/html.js").Markup} markup
 * @param {string} name
 */
const readTexts = (markup, name) =>
  [...markup.text.matchAll(new RegExp(`class="${name}"[^>]*>([^<]*)<`, "g"))].map(
    (match) => match[1],
  );

test("the old address is Cloudflare's own with the key in its path", () => {
  assert.equal(isOldHref("https://mlb-app.example-subdomain.workers.dev/k3y/"), true);
  assert.equal(isOldHref("https://mlb-app.example-subdomain.workers.dev/k3y/?theme=dark"), true);
  assert.equal(isOldHref("https://mlb-app.example-subdomain.workers.dev/"), false);
  assert.equal(isOldHref("https://app.example.com/"), false);
  assert.equal(isOldHref("https://app.example.com/k3y/"), false);
  assert.equal(isOldHref("http://localhost:8787/k3y/"), false);
});

test("the card shows in a Home Screen app at the old address of an app that's moving", () => {
  assert.equal(chooseMoveNotice(CARD_DUE), "card");
});

test("the card stays away from an app not moving, the new address, the browser, a dismissal, and a phone the Worker won't hand off", () => {
  for (const change of [
    { isMoving: false },
    { isOldAddress: false },
    { isOnHomeScreen: false },
    { isCardDismissed: true },
    { isHandoffRefused: true },
  ])
    assert.equal(chooseMoveNotice({ ...CARD_DUE, ...change }), null, JSON.stringify(change));
});

test("the notifications ask shows until it's answered, wherever the card doesn't", () => {
  const waiting = { ...CARD_DUE, isOnHomeScreen: false, notificationsAsk: "ask" };
  assert.equal(chooseMoveNotice(waiting), "notifications");
  assert.equal(
    chooseMoveNotice({ ...waiting, isMoving: false, isOldAddress: false }),
    "notifications",
  );
  assert.equal(chooseMoveNotice({ ...waiting, notificationsAsk: "answered" }), null);
  assert.equal(chooseMoveNotice({ ...waiting, notificationsAsk: null }), null);
});

test("the card says the app has a new icon and link, with the icon, the X, and Use new site", () => {
  const card = renderMoveCard({ address: "https://app.example.com/?move=abc" });
  assert.deepEqual(readTexts(card, "move-notice-title"), ["New icon and link"]);
  assert.deepEqual(readTexts(card, "move-notice-text"), [
    "The app has a new icon (took me embarrassingly long to notice the WNBA ball is always orange and white) and a simpler link. Please add the new site to your home screen.",
  ]);
  assert.match(card.text, /class="appearance-icon move-notice-icon"/);
  assert.match(card.text, /id="dismissMoveCard"/);
  assert.match(
    card.text,
    /<a class="move-notice-button" id="useNewSite" href="https:\/\/app\.example\.com\/\?move=abc">Use new site<\/a>/,
  );
});

test("Use new site waits, going nowhere, until a handoff arrives", () => {
  const card = renderMoveCard({ address: null });
  assert.match(card.text, /id="useNewSite" aria-disabled="true">Use new site</);
  assert.doesNotMatch(card.text, /href=/);
});

test("the notifications ask has its words, the X, Leave off outlined, and Turn on, with no icon", () => {
  const ask = renderNotificationsAsk();
  assert.deepEqual(readTexts(ask, "move-notice-title"), ["Keep notifications on?"]);
  assert.deepEqual(readTexts(ask, "move-notice-text"), [
    "You had notifications turned on from the old site. Apple requires approving notifications again for a new site. You can always configure notifications in settings.",
  ]);
  assert.match(ask.text, /id="dismissNotificationsAsk"/);
  assert.match(
    ask.text,
    /class="move-notice-button move-notice-button-outlined" id="leaveNotificationsOff">Leave off<\/button>\s*<button type="button" class="move-notice-button" id="turnNotificationsOn">Turn on</,
  );
  assert.doesNotMatch(ask.text, /move-notice-icon/);
});

test("a dismissal of the card is kept for the device", (t) => {
  t.after(dropSavedStorage);
  const saved = new Map();
  useSavedStorage(saved);
  assert.equal(isMoveCardDismissed(), false);
  keepMoveCardDismissed();
  assert.equal(saved.get("moveCardDismissed"), "dismissed");
});

test("a dismissal of the card lasts until the page reloads on a device whose storage refuses access", (t) => {
  t.after(dropSavedStorage);
  useDeniedStorage();
  keepMoveCardDismissed();
  assert.equal(isMoveCardDismissed(), true);
});
