// The sheet a tap on a player's name opens, beside the sheet it was in: her facts and numbers for
// the season shown, which the store keeps, read the first time the sheet shows her season and
// again once they're old. She shows as out only while her team still plays. A sheet that didn't
// load reads again on a tap on Try again, as the phone comes back online or the page comes back,
// or a minute later. The sheet keeps her numbers with her, so a reload draws them again while it
// reads them again.

import { setHtml } from "#shared/html.js";
import { classifyReadFailure, watchRetries } from "#shared/retry.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";
import {
  describePlayerNote,
  renderPlayerBody,
  renderPlayerFacts,
  renderPlayerHeading,
} from "./player-view.js";
import { isStillPlaying } from "./series.js";
import { isPastSeason, session } from "./session.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./player-view.js").Player} Player */
/** @typedef {import("./player-view.js").PlayerSubject} PlayerSubject */
/** @typedef {import("#shared/retry.js").ReadFailure} ReadFailure */
/** @typedef {{ at: number, player: Player | null, isLoading: boolean, failure: ReadFailure | null }} PlayerRead */

const FETCH_TIMEOUT_MS = 15 * 1000;
// Her numbers change after each game.
const READ_AGAIN_MS = 10 * 60 * 1000;
// A sheet that didn't load reads again a minute later.
const RETRY_MS = 60 * 1000;

// Each read is kept by her id, team, and season, as 1627668:NYL:2026.
/** @type {Map<string, PlayerRead>} */
const reads = new Map();
/** @type {PlayerSubject | null} */
let shownPlayer = null;

const findSheet = () => /** @type {HTMLElement} */ (document.getElementById("playerSheet"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {PlayerSubject} subject
 * @param {number} year
 */
const nameRead = ({ id, team }, year) => `${id}:${team}:${year}`;

/**
 * @param {PlayerSubject} subject
 * @param {number} year
 */
const fetchPlayer = ({ id, team }, year) =>
  fetchFromWorker(
    `player?id=${encodeURIComponent(id)}&team=${encodeURIComponent(team)}&season=${year}`,
    {
      reuseMs: READ_AGAIN_MS,
      timeoutMs: FETCH_TIMEOUT_MS,
      isExpected: (body) => body.id === id && body.team === team && body.season === year,
    },
  );

/** @param {PlayerRead} read */
const isFresh = (read) =>
  read.isLoading || Date.now() - read.at < (read.player ? READ_AGAIN_MS : RETRY_MS);

/**
 * Keeps what a read found, or what the last one did when it failed, and why it did.
 * @param {string} key
 * @param {PlayerRead} read
 * @param {Player | null} player
 * @param {ReadFailure | null} failure
 */
function keepRead(key, read, player, failure) {
  if (reads.get(key) !== read) return;
  reads.set(key, { ...read, isLoading: false, player: player ?? read.player, failure });
  renderSheet();
}

/**
 * Her last read for the season, after starting a new one when there's none or it's old.
 * @param {PlayerSubject} subject
 * @param {number} year
 */
function readPlayer(subject, year) {
  const key = nameRead(subject, year);
  const kept = reads.get(key);
  if (kept && isFresh(kept)) return kept;
  /** @type {PlayerRead} */
  const read = { at: Date.now(), player: kept?.player ?? null, isLoading: true, failure: null };
  reads.set(key, read);
  fetchPlayer(subject, year).then(
    (player) => keepRead(key, read, player, null),
    (error) => keepRead(key, read, null, classifyReadFailure(error)),
  );
  return read;
}

function renderSheet() {
  const subject = shownPlayer;
  if (!subject) return;
  const { player, isLoading, failure } = readPlayer(subject, session.year);
  const showsOut = !isPastSeason() && isStillPlaying(session.season?.series ?? [], subject.team);
  setHtml(findElement("playerTitle"), renderPlayerHeading(subject, player));
  setHtml(findElement("playerNote"), describePlayerNote(subject, player));
  setHtml(findElement("playerFacts"), renderPlayerFacts(player, isLoading) || "");
  setHtml(
    findElement("playerBody"),
    renderPlayerBody({
      player,
      isLoading,
      failure,
      season: session.season,
      isPastSeason: isPastSeason(),
      showsOut,
      now: Date.now(),
    }),
  );
}

// A read that failed is dropped, so the sheet shows its placeholders while it reads again.
function retryPlayer() {
  if (!shownPlayer) return;
  const key = nameRead(shownPlayer, session.year);
  const read = reads.get(key);
  if (!read || read.player || read.isLoading) return;
  reads.delete(key);
  renderSheet();
}

/** @param {PlayerSubject} subject */
function showPlayer(subject) {
  shownPlayer = subject;
  renderSheet();
}

/** @param {unknown} value */
const isText = (value) => typeof value === "string" && value.length > 0;

// Her numbers go with her, for the sheet to show again while it reads them again.
const readShownPlayer = () =>
  shownPlayer && {
    ...shownPlayer,
    year: session.year,
    player: reads.get(nameRead(shownPlayer, session.year))?.player ?? null,
  };

/**
 * Takes back her numbers as the sheet showed them, unless it has read them since.
 * @param {PlayerSubject} subject
 * @param {{ year?: unknown, player?: unknown }} saved
 */
function keepSavedPlayer(subject, { year, player }) {
  if (typeof year !== "number" || !player || typeof player !== "object") return;
  const key = nameRead(subject, year);
  if (!reads.has(key))
    reads.set(key, {
      at: 0,
      player: /** @type {Player} */ (player),
      isLoading: false,
      failure: null,
    });
}

/** @param {Partial<PlayerSubject> & { year?: unknown, player?: unknown } | null} saved */
function reopenPlayer(saved) {
  if (!saved || !isText(saved.id) || !isText(saved.name)) return false;
  if (typeof saved.team !== "string" || !Object.hasOwn(TEAMS, saved.team)) return false;
  const subject = { id: saved.id, team: saved.team, name: saved.name };
  keepSavedPlayer(subject, saved);
  showPlayer(subject);
  return true;
}

// A tap anywhere in a roster's row opens its player, whose name is the button in the row's
// pinned half.
/** @param {Element} target */
function findPlayerButton(target) {
  const button = target.closest("[data-player]");
  if (button) return /** @type {HTMLElement} */ (button);
  const row = /** @type {HTMLElement | null} */ (target.closest("tr[data-player-row]"));
  if (!row?.dataset.playerRow) return null;
  return /** @type {HTMLElement | null} */ (
    row
      .closest(".roster-tables")
      ?.querySelector(`[data-player="${CSS.escape(row.dataset.playerRow)}"]`) ?? null
  );
}

/** @param {Event} event */
function openOnTap(event) {
  const button = findPlayerButton(/** @type {Element} */ (event.target));
  const { player: id, playerTeam: team, playerName: name } = button?.dataset ?? {};
  if (!id || !team || !name) return;
  openSheet(findSheet(), {
    key: `${id}:${team}`,
    show: () => showPlayer({ id, team, name }),
  });
}

/** Redraws the open sheet from what the page shows now. */
export const refreshPlayerSheet = () => renderSheet();

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
