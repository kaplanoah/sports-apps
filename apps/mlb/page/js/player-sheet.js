// The sheet a tap on a player's name opens, beside the sheet it was in: his facts and numbers for
// the current season, which the store keeps, read the first time the sheet shows him and again
// once they're old, beside the hitters MLB ranks and, for a starter, the qualified starters and his
// matchup side, which his numbers are ranked among. A sheet that didn't load reads again on a tap
// on Try again, as the phone comes back online or the page comes back, or a minute later. The
// sheet keeps what it read with him, so a reload draws it again while it reads again.

import { setHtml } from "#shared/html.js";
import { classifyReadFailure, watchRetries } from "#shared/retry.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
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
/** @typedef {{ id: number, club: string, name: string, number: string }} PlayerSubject */
/** @typedef {ShownPlayer & { at: number }} PlayerRead */

const FETCH_TIMEOUT_MS = 15 * 1000;
// His numbers, and those he's ranked among, change after each game.
const READ_AGAIN_MS = 10 * 60 * 1000;
// A sheet that didn't load reads again a minute later.
const RETRY_MS = 60 * 1000;

// Each read is kept by his id and season, as 680757:2026.
/** @type {Map<string, PlayerRead>} */
const reads = new Map();
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
    reuseMs: READ_AGAIN_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) => "data" in body,
  }).then((body) => body.data);

/** @param {PlayerRead} read */
const isFresh = (read) =>
  read.isLoading || Date.now() - read.at < (read.player ? READ_AGAIN_MS : RETRY_MS);

/**
 * What the sheet ranks him among, read once his own numbers say what he is. A read that fails
 * leaves what the last one found.
 * @param {Player} player
 * @param {number} year
 * @param {PlayerRead} read
 */
async function readRankedAmong(player, year, read) {
  const isHitter = Boolean(player.hitting) && player.position !== "P";
  const isRotation = isStarter(player.pitching);
  const [hitters, starters, side] = await Promise.allSettled([
    isHitter ? fetchDoc(`hitters/${year}`) : null,
    isRotation ? fetchDoc(`starters/${year}`) : null,
    isRotation ? fetchPitcher(player.id, year) : null,
  ]);
  /** @param {PromiseSettledResult<any>} result @param {any} kept */
  const keep = (result, kept) => (result.status === "fulfilled" ? result.value : kept);
  return {
    hitters: keep(hitters, read.hitters),
    starters: keep(starters, read.starters),
    side: keep(side, read.side),
  };
}

/**
 * Reads him and what he's ranked among, and redraws the sheet if it still shows him.
 * @param {number} id
 * @param {number} year
 * @param {PlayerRead} read
 */
async function loadPlayer(id, year, read) {
  const key = nameRead(id, year);
  // The store answers null for a player it keeps no sheet for, apart from a read that failed.
  /** @type {import("#shared/retry.js").ReadFailure | null} */
  let failure = null;
  const player = await fetchDoc(`players/${year}-${id}`).catch((error) => {
    failure = classifyReadFailure(error);
    return undefined;
  });
  const found = player ?? read.player;
  const ranked = found ? await readRankedAmong(found, year, read) : {};
  if (reads.get(key) !== read) return;
  const isUnkept = player === null;
  reads.set(key, { ...read, ...ranked, player: found, isUnkept, isLoading: false, failure });
  if (shownPlayer?.id === id) renderSheet();
}

/**
 * His last read for the season, after starting a new one when it has none or it's old.
 * @param {number} id
 * @param {number} year
 */
function readPlayer(id, year) {
  const key = nameRead(id, year);
  const kept = reads.get(key);
  if (kept && isFresh(kept)) return kept;
  /** @type {PlayerRead} */
  const read = {
    at: Date.now(),
    player: kept?.player ?? null,
    hitters: kept?.hitters ?? null,
    starters: kept?.starters ?? null,
    side: kept?.side ?? null,
    isUnkept: false,
    isLoading: true,
    failure: null,
  };
  reads.set(key, read);
  loadPlayer(id, year, read);
  return read;
}

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
  setHtml(findElement("playerBody"), renderPlayerBody({ ...shown, clubGames }));
}

// A read that failed is dropped, so the sheet shows its placeholders while it reads again.
function retryPlayer() {
  if (!shownPlayer) return;
  const key = nameRead(shownPlayer.id, session.currentSeason);
  const read = reads.get(key);
  if (!read || read.player || read.isLoading || read.isUnkept) return;
  reads.delete(key);
  renderSheet();
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
  const { player, hitters, starters, side } = reads.get(nameRead(shownPlayer.id, year)) ?? {};
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
  const { id, club, name, number = "", year, player, hitters, starters, side } = saved;
  const key = nameRead(id, year);
  if (typeof year === "number" && player && !reads.has(key))
    reads.set(key, {
      at: 0,
      player,
      hitters,
      starters,
      side,
      isUnkept: false,
      isLoading: false,
      failure: null,
    });
  showPlayer({ id, club, name, number });
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
  if (!player || !club || !name) return;
  const id = Number(player);
  openSheet(findSheet(), { key: player, show: () => showPlayer({ id, club, name, number }) });
}

export function startPlayerSheet() {
  watchRetries(findSheet(), retryPlayer);
  wireSheet(findSheet(), {
    closeButton: findElement("playerCloseBtn"),
    backButton: findElement("playerBackBtn"),
    keeper: { read: readShownPlayer, reopen: reopenPlayer },
    name: "Player",
    forget: () => {
      shownPlayer = null;
    },
  });
  document.addEventListener("click", openOnTap);
}
