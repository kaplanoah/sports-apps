// The sheet a tap on a player's name opens, beside the sheet it was in: his facts and numbers for
// the current season, which the store keeps, read the first time the sheet shows him and again
// once they're old, beside the hitters MLB ranks and, for a starter, the qualified starters and his
// matchup side, which his numbers are ranked among. A sheet that didn't load reads again on a tap
// on Try again, as the phone comes back online or the page comes back, or a minute later. The
// sheet keeps what it read with him, so a reload draws it again while it reads again.

import { setHtml } from "#shared/html.js";
import { readPlayingNow } from "#shared/playing-now.js";
import { classifyReadFailure, watchRetries } from "#shared/retry.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import {
  createSheetReads,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_READ_AGAIN_MS,
} from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";
import { TEAMS } from "./teams.js";
import { fetchPitcher } from "./pitcher-fetch.js";
import {
  describePlayerNote,
  isStarter,
  renderPlayerBody,
  renderPlayerFacts,
  renderPlayerHeading,
} from "./player-view.js";
import { countClubGames } from "./qualifying.js";
import { session } from "./session.js";

/** @typedef {import("./player-view.js").Player} Player */
/** @typedef {import("./player-view.js").ShownPlayer} ShownPlayer */
/**
 * Who the sheet shows, from the row that opened it. `isPlayingNow` says a box score showed him
 * playing now (`#shared/playing-now.js`).
 * @typedef {{ id: number, club: string, name: string, number: string, isPlayingNow?: boolean }} PlayerSubject
 */
/** @typedef {Omit<ShownPlayer, "isLoading" | "failure">} PlayerFound */
/** @typedef {import("#shared/sheet-reads.js").SheetRead<PlayerFound>} PlayerRead */

/** @type {PlayerSubject | null} */
let shownPlayer = null;

const findSheet = () => /** @type {HTMLElement} */ (document.getElementById("playerSheet"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {number} id
 * @param {number} year
 */
const nameRead = (id, year) => `${id}:${year}`;

/**
 * A document the store keeps, or null when it keeps none.
 * @param {string} path
 */
const fetchDoc = (path) =>
  fetchFromWorker(`store/${path}`, {
    reuseMs: SHEET_READ_AGAIN_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => "data" in body,
  }).then((body) => body.data);

// Each read is kept by his id and season, as 680757:2026. One the store keeps no sheet for has
// found its answer too.
const reads = createSheetReads({
  empty: /** @type {PlayerFound} */ ({
    player: null,
    hitters: null,
    starters: null,
    side: null,
    isUnkept: false,
  }),
  hasFound: (read) => !!read.player || read.isUnkept,
  show: (key) => {
    if (shownPlayer && key === nameRead(shownPlayer.id, session.currentSeason)) renderSheet();
  },
});

/**
 * What the sheet ranks him among, read once his own numbers say what he is. A read that fails
 * finds nothing of it, so the sheet keeps what the last one found.
 * @param {Player} player
 * @param {number} year
 */
async function readRankedAmong(player, year) {
  const isHitter = Boolean(player.hitting) && player.position !== "P";
  const isRotation = isStarter(player.pitching);
  const [hitters, starters, side] = await Promise.allSettled([
    isHitter ? fetchDoc(`hitters/${year}`) : null,
    isRotation ? fetchDoc(`starters/${year}`) : null,
    isRotation ? fetchPitcher(player.id, year) : null,
  ]);
  /** @param {PromiseSettledResult<any>} result */
  const readFound = (result) => (result.status === "fulfilled" ? result.value : null);
  return { hitters: readFound(hitters), starters: readFound(starters), side: readFound(side) };
}

/**
 * Reads him and what he's ranked among, by the numbers he had before when his own read fails.
 * @param {number} id
 * @param {number} year
 * @param {PlayerRead} kept
 */
async function loadPlayer(id, year, kept) {
  // The store answers null for a player it keeps no sheet for, apart from a read that failed.
  /** @type {import("#shared/retry.js").ReadFailure | null} */
  let failure = null;
  const player = await fetchDoc(`players/${year}-${id}`).catch((error) => {
    failure = classifyReadFailure(error);
    return undefined;
  });
  const shown = player ?? kept.player;
  const ranked = shown ? await readRankedAmong(shown, year) : {};
  return { found: { ...ranked, player, isUnkept: player === null }, failure };
}

/**
 * His last read for the season, after starting a new one when it has none or it's old.
 * @param {number} id
 * @param {number} year
 */
const readPlayer = (id, year) =>
  reads.read(nameRead(id, year), (kept) => loadPlayer(id, year, kept));

function renderSheet() {
  const subject = shownPlayer;
  if (!subject) return;
  const shown = readPlayer(subject.id, session.currentSeason);
  const person = shown.player ?? subject;
  setHtml(findElement("playerTitle"), renderPlayerHeading(person));
  setHtml(findElement("playerNote"), describePlayerNote(person));
  setHtml(findElement("playerPlace"), shown.player?.facts?.birthplace ?? "");
  setHtml(findElement("playerFacts"), renderPlayerFacts(shown.player, shown.isLoading) || "");
  const clubGames = countClubGames(person.club, session.currentSeason);
  setHtml(
    findElement("playerBody"),
    renderPlayerBody({ ...shown, clubGames, isPlayingNow: !!subject.isPlayingNow }),
  );
}

// A read that failed is dropped, so the sheet shows its placeholders while it reads again.
function retryPlayer() {
  if (shownPlayer && reads.drop(nameRead(shownPlayer.id, session.currentSeason))) renderSheet();
}

/** @param {PlayerSubject} subject */
function showPlayer(subject) {
  shownPlayer = subject;
  renderSheet();
}

// What it read goes with him, for the sheet to show again while it reads again.
function readShownPlayer() {
  if (!shownPlayer) return null;
  const year = session.currentSeason;
  const { player, hitters, starters, side } = reads.find(nameRead(shownPlayer.id, year)) ?? {};
  return { ...shownPlayer, year, player, hitters, starters, side };
}

/** @param {any} saved */
const isSavedSubject = (saved) =>
  Number.isInteger(saved?.id) &&
  typeof saved.name === "string" &&
  typeof saved.club === "string" &&
  Object.hasOwn(TEAMS, saved.club);

/** @param {any} saved what readShownPlayer found */
function reopenPlayer(saved) {
  if (!isSavedSubject(saved)) return false;
  const {
    id,
    club,
    name,
    number = "",
    isPlayingNow,
    year,
    player,
    hitters,
    starters,
    side,
  } = saved;
  if (typeof year === "number" && player)
    reads.keepShown(nameRead(id, year), { player, hitters, starters, side });
  showPlayer({ id, club, name, number, isPlayingNow: isPlayingNow === true });
  return true;
}

/** @param {Event} event */
function openOnTap(event) {
  const button = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (event.target).closest("[data-player]")
  );
  const {
    player,
    playerTeam: club,
    playerName: name,
    playerNumber: number = "",
  } = button?.dataset ?? {};
  if (!button || !player || !club || !name) return;
  const id = Number(player);
  const isPlayingNow = readPlayingNow(button.dataset);
  openSheet(findSheet(), {
    key: player,
    show: () => showPlayer({ id, club, name, number, isPlayingNow }),
  });
}

export function startPlayerSheet() {
  watchRetries(findSheet(), retryPlayer);
  wireSheet(findSheet(), {
    keeper: { read: readShownPlayer, reopen: reopenPlayer },
    name: "Player",
    forget: () => {
      shownPlayer = null;
    },
  });
  document.addEventListener("click", openOnTap);
}
