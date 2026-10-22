// Moves a fan from the app's old address, a workers.dev one under the key, to its own, which only
// the Worker names. A page moving to its own address says so in its head. A browser at the old
// address leaves for the new one at once, and a Home Screen app there offers the move in its
// Updates box (move-cards.js). Either carries the viewer's choices in the new address, packed in
// one value, since a Home Screen app keeps its storage apart from the browser's and opens at the
// address it was added from. The browser keeps them only where it has none of its own, and only
// soon after they were packed, so a copied link carries nobody's choices into another browser. A
// move from the Home Screen app opens the welcome's steps for finishing it, whose pick of the icon
// rides in the address too. The new app's first open keeps the choices into its empty storage,
// with the icon and whether to ask about notifications. This plain script loads in the head before
// pick-theme.js, which takes the choices first, before it keeps a theme the address names.

/* global isAppleBrowser, isLook, isOnHomeScreen, readPhoneLook -- from pick-theme.js */
/* global readAppearanceChoice -- from pick-theme.js */

const CARRIED_PARAMETER = "carried";

// The choices a move carries, the ones the viewer would miss most first, so the ones that don't fit
// are the ones a new device starts over on anyway.
const CARRIED_CHOICES = [
  "appearance",
  "rankings",
  "newsChoices",
  "updatesSeenAt",
  "releaseNotesShownUntil",
];

// Safari and the Worker take addresses of a few thousand characters, and the new address holds
// the Worker's own token beside the choices.
const MAX_CARRIED_LENGTH = 1500;

const CARRIED_FRESH_MS = 10 * 60 * 1000;

// The browser keeps a move from the Home Screen app under this key until its welcome closes.
const PAGE_MOVE_KEY = "pageMove";

// A Home Screen app opens at the address it was added from each time, so it marks the move taken.
const CARRIED_TAKEN_KEY = "carriedChoicesTaken";

// The new app asks about notifications on its first open, and across that open's reloads.
const NOTIFICATIONS_ASK_KEY = "notificationsAsk";

/**
 * What a move carries: when it was packed, each choice as the device keeps it, the look of the icon
 * picked for the new Home Screen app, whether notifications were on, and whether it left from the
 * Home Screen app.
 * @typedef {{ at: number, choices: Record<string, string>, icon: "light" | "dark" | null,
 *   notifications: boolean, fromApp: boolean }} Carried
 */

const isMovingToPageHost = () =>
  document.querySelector('meta[name="moving-to-page-host"]')?.getAttribute("content") === "true";

// The old address is the Worker's own workers.dev one, under the key the path starts with.
/** @param {string} href */
function isOldAddress(href) {
  const address = new URL(href);
  return address.hostname.endsWith(".workers.dev") && address.pathname.split("/")[1] !== "";
}

/** @param {string} text */
const encodeForAddress = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** @param {string} value */
const decodeFromAddress = (value) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
      character.charCodeAt(0),
    ),
  );

/** @param {unknown} value */
const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {Carried | null}
 */
function checkCarried(value) {
  if (!isPlainObject(value)) return null;
  const carried = /** @type {Record<string, unknown>} */ (value);
  if (typeof carried.at !== "number") return null;
  const choices = isPlainObject(carried.choices)
    ? /** @type {Record<string, unknown>} */ (carried.choices)
    : {};
  return {
    at: carried.at,
    choices: Object.fromEntries(
      CARRIED_CHOICES.filter((key) => typeof choices[key] === "string").map((key) => [
        key,
        /** @type {string} */ (choices[key]),
      ]),
    ),
    icon: isLook(carried.icon) ? carried.icon : null,
    notifications: carried.notifications === true,
    fromApp: carried.fromApp === true,
  };
}

/** @param {Carried} carried */
const encodeCarried = ({ at, choices, icon, notifications, fromApp }) =>
  encodeForAddress(
    JSON.stringify({
      at,
      choices,
      ...(icon && { icon }),
      ...(notifications && { notifications }),
      ...(fromApp && { fromApp }),
    }),
  );

// Each choice that would make the address too long stays behind.
/** @param {Carried} carried */
function packCarried(carried) {
  /** @type {Record<string, string>} */
  const packed = {};
  for (const key of CARRIED_CHOICES) {
    if (!(key in carried.choices)) continue;
    const choices = { ...packed, [key]: carried.choices[key] };
    if (encodeCarried({ ...carried, choices }).length <= MAX_CARRIED_LENGTH)
      packed[key] = choices[key];
  }
  return encodeCarried({ ...carried, choices: packed });
}

/** @param {string | null} value */
function unpackCarried(value) {
  if (value === null) return null;
  try {
    return checkCarried(JSON.parse(decodeFromAddress(value)));
  } catch {
    return null;
  }
}

/** @returns {Record<string, string>} */
function readCarriedChoices() {
  try {
    return Object.fromEntries(
      CARRIED_CHOICES.map((key) => [key, localStorage.getItem(key)]).filter(
        ([, text]) => text !== null,
      ),
    );
  } catch {
    return {};
  }
}

const hasOwnChoices = () => Object.keys(readCarriedChoices()).length > 0;

/** @param {Record<string, string>} choices */
function keepCarriedChoices(choices) {
  try {
    for (const [key, text] of Object.entries(choices)) localStorage.setItem(key, text);
  } catch {
    /* without storage, the page starts on its own choices */
  }
}

/**
 * @param {string} address
 * @param {Carried} carried
 */
function buildCarriedAddress(address, carried) {
  const url = new URL(address);
  url.searchParams.set(CARRIED_PARAMETER, packCarried(carried));
  return url;
}

/** @param {URL} address */
function replaceAddress(address) {
  if (address.href !== location.href) history.replaceState(history.state, "", address);
}

/** @returns {Carried | null} */
function readPageMove() {
  try {
    return checkCarried(JSON.parse(localStorage.getItem(PAGE_MOVE_KEY) ?? ""));
  } catch {
    return null;
  }
}

/** @param {Carried} move */
function keepPageMove(move) {
  try {
    localStorage.setItem(PAGE_MOVE_KEY, JSON.stringify(move));
  } catch {
    /* without storage, the browser shows the welcome a first visit does */
  }
}

/** The look of the icon picked for the new Home Screen app, while a move is being finished. */
const readPageMoveIcon = () => readPageMove()?.icon ?? null;

// The browser's address carries a move being finished, as the Home Screen app will open it, and
// nothing once none is.
function nameMoveInAddress() {
  const move = readPageMove();
  const address = new URL(location.href);
  if (move) address.searchParams.set(CARRIED_PARAMETER, packCarried(move));
  else address.searchParams.delete(CARRIED_PARAMETER);
  replaceAddress(address);
}

function forgetPageMove() {
  try {
    localStorage.removeItem(PAGE_MOVE_KEY);
  } catch {
    /* the move was never kept */
  }
  nameMoveInAddress();
}

// Safari takes the Home Screen app's address from the page as it loaded, so a pick loads the page
// again at the address that carries it, as pick-theme.js does for a theme.
/** @param {"light" | "dark"} icon */
function keepPageMoveIcon(icon) {
  const move = readPageMove();
  if (!move) return;
  keepPageMove({ ...move, icon });
  const address = buildCarriedAddress(location.href, { ...move, icon });
  if (isAppleBrowser()) location.replace(address);
  else replaceAddress(address);
}

/** @param {Carried} carried */
function takeIntoHomeScreen(carried) {
  try {
    if (localStorage.getItem(CARRIED_TAKEN_KEY) !== null) return;
    localStorage.setItem(CARRIED_TAKEN_KEY, String(carried.at));
    if (!hasOwnChoices()) keepCarriedChoices(carried.choices);
    if (carried.notifications) sessionStorage.setItem(NOTIFICATIONS_ASK_KEY, "ask");
  } catch {
    /* without storage, the app starts on its own choices */
  }
}

/** @param {string} choice */
const showLookOf = (choice) => (isLook(choice) ? choice : readPhoneLook());

// The welcome starts on the icon of the theme the app showed as the fan moved, the look they picked
// most recently, even where the browser kept a theme of its own.
/**
 * @param {Carried} carried
 * @param {number} now
 */
function takeIntoBrowser(carried, now) {
  if (Math.abs(now - carried.at) < CARRIED_FRESH_MS) {
    if (!hasOwnChoices()) keepCarriedChoices(carried.choices);
    if (carried.fromApp)
      keepPageMove({
        ...carried,
        icon: carried.icon ?? showLookOf(readAppearanceChoice(carried.choices.appearance ?? "")),
      });
  }
  nameMoveInAddress();
}

/**
 * Keeps the choices the address carries, and drops them from it in the Home Screen app.
 * @param {number} [now]
 * @returns {"light" | "dark" | null} the look of the icon the address carries
 */
function takeCarriedChoices(now = Date.now()) {
  const address = new URL(location.href);
  if (!address.searchParams.has(CARRIED_PARAMETER)) return null;
  const carried = unpackCarried(address.searchParams.get(CARRIED_PARAMETER));
  if (isOnHomeScreen()) {
    address.searchParams.delete(CARRIED_PARAMETER);
    replaceAddress(address);
    if (carried) takeIntoHomeScreen(carried);
  } else if (carried) takeIntoBrowser(carried, now);
  else nameMoveInAddress();
  return carried?.icon ?? null;
}

const isNotificationsAskKept = () => {
  try {
    return sessionStorage.getItem(NOTIFICATIONS_ASK_KEY) !== null;
  } catch {
    return false;
  }
};

function forgetNotificationsAsk() {
  try {
    sessionStorage.removeItem(NOTIFICATIONS_ASK_KEY);
  } catch {
    /* the ask was never kept */
  }
}

/**
 * The new address, carrying this device's choices, or null where the Worker gives none.
 * @param {{ notifications?: boolean, fromApp?: boolean }} [extras]
 * @returns {Promise<URL | null>}
 */
async function requestPageMove({ notifications = false, fromApp = false } = {}) {
  try {
    const response = await fetch("access/move", { method: "POST" });
    if (!response.ok) return null;
    const { address } = await response.json();
    const choices = readCarriedChoices();
    return buildCarriedAddress(address, {
      at: Date.now(),
      choices,
      icon: null,
      notifications,
      fromApp,
    });
  } catch {
    return null;
  }
}

// A browser at the old address leaves for the new one, and stays where it is without one. The
// Home Screen app moves only from its Updates box, since Safari has to open the new address.
async function leaveOldAddress() {
  if (!isMovingToPageHost() || isOnHomeScreen() || !isOldAddress(location.href)) return;
  const address = await requestPageMove();
  if (address) location.replace(address);
}
