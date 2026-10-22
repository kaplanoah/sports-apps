// Carries a viewer's choices from the app's old address to its own, whose storage starts empty.
// The old address packs them into the address it opens there, under `move`, which the browser
// keeps, so a Home Screen app added from it opens with them, as it does with `?theme`
// (pick-theme.js). A browser or app that already holds choices of its own keeps them, and the
// browser swaps a copied link's choices for its own. It loads as a plain script in each page's
// head, before pick-theme.js, which calls it as the page opens.

/* global isLook -- from pick-theme.js */

const MOVE_KEY = "move";

// Some browsers and servers cut off a longer address.
const MOVE_LENGTH_LIMIT = 2000;

// Every viewer choice either app makes with createViewerChoice (device-storage.js).
const MOVED_CHOICES = [
  "appearance",
  "newsChoices",
  "rankings",
  "releaseNotesShownUntil",
  "updatesSeenAt",
];

// A Home Screen app asks once whether to turn notifications on again, where they were on at the
// old address, since a phone asks permission for each site.
const NOTIFICATIONS_ASK_KEY = "moveNotificationsAsk";

/**
 * @typedef {{
 *   choices: Record<string, string>,
 *   icon: "light" | "dark" | null,
 *   isNotifying: boolean,
 * }} Move
 */

/** @param {Move} move */
function encodeMove(move) {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(move)))
    binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} packed */
function decodeMove(packed) {
  const binary = atob(packed.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
  );
}

/** @param {Record<string, string>} choices */
function findLargestChoice(choices) {
  return Object.keys(choices).reduce((largest, key) =>
    choices[key].length > choices[largest].length ? key : largest,
  );
}

/**
 * The move as one value for an address, leaving out its largest choices until it fits.
 * @param {Move} move
 */
function packMove(move) {
  const choices = { ...move.choices };
  let packed = encodeMove({ ...move, choices });
  while (packed.length >= MOVE_LENGTH_LIMIT && Object.keys(choices).length > 0) {
    delete choices[findLargestChoice(choices)];
    packed = encodeMove({ ...move, choices });
  }
  return packed;
}

/**
 * The move a packed value holds, keeping only the choices it may carry, or null for anything else.
 * @param {string | null} packed
 * @returns {Move | null}
 */
function unpackMove(packed) {
  if (packed === null) return null;
  let move;
  try {
    move = decodeMove(packed);
  } catch {
    return null;
  }
  if (typeof move !== "object" || move === null) return null;
  /** @type {Record<string, string>} */
  const choices = {};
  for (const key of MOVED_CHOICES)
    if (typeof move.choices?.[key] === "string") choices[key] = move.choices[key];
  return {
    choices,
    icon: isLook(move.icon) ? move.icon : null,
    isNotifying: move.isNotifying === true,
  };
}

const readMoveFromAddress = () => unpackMove(new URL(location.href).searchParams.get(MOVE_KEY));

/** The icon the move carries, which a Home Screen app added from this address takes. */
const readMovedIcon = () => readMoveFromAddress()?.icon ?? null;

/** @param {Move | null} move */
function writeMoveInAddress(move) {
  const address = new URL(location.href);
  if (move === null) address.searchParams.delete(MOVE_KEY);
  else address.searchParams.set(MOVE_KEY, packMove(move));
  if (address.href !== location.href) history.replaceState(history.state, "", address);
}

/** @param {string} icon */
function keepMovedIcon(icon) {
  const move = readMoveFromAddress();
  if (move !== null && isLook(icon)) writeMoveInAddress({ ...move, icon });
}

/** The choices this device keeps, as their stored text. */
function readKeptChoices() {
  /** @type {Record<string, string>} */
  const choices = {};
  try {
    for (const key of MOVED_CHOICES) {
      const text = localStorage.getItem(key);
      if (text !== null) choices[key] = text;
    }
  } catch {
    /* without storage, the device has none of its own */
  }
  return choices;
}

/** @param {Record<string, string>} choices */
function keepCarriedChoices(choices) {
  try {
    for (const [key, text] of Object.entries(choices)) localStorage.setItem(key, text);
  } catch {
    /* without storage, the page opens on its defaults */
  }
}

function askToKeepNotifying() {
  try {
    if (localStorage.getItem(NOTIFICATIONS_ASK_KEY) === null)
      localStorage.setItem(NOTIFICATIONS_ASK_KEY, "ask");
  } catch {
    /* without storage, the app never asks */
  }
}

// A device with no choices of its own takes the move's. A Home Screen app opens at the address it
// was added from each time, so it drops the move from its address at once. The browser keeps it
// for the app it adds.
/** @param {boolean} isAppOnHomeScreen */
function takeMovedChoices(isAppOnHomeScreen) {
  if (new URL(location.href).searchParams.get(MOVE_KEY) === null) return;
  const move = readMoveFromAddress();
  if (move === null) {
    writeMoveInAddress(null);
    return;
  }
  if (Object.keys(readKeptChoices()).length === 0) keepCarriedChoices(move.choices);
  if (!isAppOnHomeScreen) return;
  if (move.isNotifying) askToKeepNotifying();
  writeMoveInAddress(null);
}

// The app added from the browser takes the browser's choices as they stand as it loads, its own
// where it had any before the move, and a pick, which Safari loads the page again for.
function carryKeptChoices() {
  const move = readMoveFromAddress();
  if (move !== null) writeMoveInAddress({ ...move, choices: readKeptChoices() });
}
