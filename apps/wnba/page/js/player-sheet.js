// The sheet a tap on a player's name opens, beside the sheet it was in: her facts and numbers for
// the season shown, which the store keeps, read the first time the sheet shows her season and
// again once they're old. She shows as out only while her team still plays. A sheet that didn't
// load reads again on a tap on Try again, as the phone comes back online or the page comes back,
// or a minute later. The sheet keeps her numbers with her, so a reload draws them again while it
// reads them again.

import { setHtml } from "#shared/html.js";
import { readPlayingNow } from "#shared/playing-now.js";
import { watchRetries } from "#shared/retry.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import {
  createSheetReads,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_READ_AGAIN_MS,
} from "#shared/sheet-reads.js";
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
      reuseMs: SHEET_READ_AGAIN_MS,
      timeoutMs: SHEET_FETCH_TIMEOUT_MS,
      isExpected: (body) => body.id === id && body.team === team && body.season === year,
    },
  );

// Each read is kept by her id, team, and season, as 1627668:NYL:2026.
const reads = createSheetReads({
  empty: { player: /** @type {Player | null} */ (null) },
  hasFound: (read) => !!read.player,
  show: () => renderSheet(),
});

/**
 * Her last read for the season, after starting a new one when there's none or it's old.
 * @param {PlayerSubject} subject
 * @param {number} year
 */
const readPlayer = (subject, year) =>
  reads.read(nameRead(subject, year), () =>
    fetchPlayer(subject, year).then((player) => ({ found: { player } })),
  );

function renderSheet() {
  const subject = shownPlayer;
  if (!subject) return;
  const { player, isLoading, failure } = readPlayer(subject, session.year);
  const showsOut =
    !isPastSeason() &&
    !subject.isPlayingNow &&
    isStillPlaying(session.season?.series ?? [], subject.team);
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
  if (shownPlayer && reads.drop(nameRead(shownPlayer, session.year))) renderSheet();
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
    player: reads.find(nameRead(shownPlayer, session.year))?.player ?? null,
  };

/**
 * Takes back her numbers as the sheet showed them, unless it has read them since.
 * @param {PlayerSubject} subject
 * @param {{ year?: unknown, player?: unknown }} saved
 */
function keepSavedPlayer(subject, { year, player }) {
  if (typeof year !== "number" || !player || typeof player !== "object") return;
  reads.keepShown(nameRead(subject, year), { player: /** @type {Player} */ (player) });
}

/** @param {Partial<PlayerSubject> & { year?: unknown, player?: unknown } | null} saved */
function reopenPlayer(saved) {
  if (!saved || !isText(saved.id) || !isText(saved.name)) return false;
  if (typeof saved.team !== "string" || !Object.hasOwn(TEAMS, saved.team)) return false;
  const subject = {
    id: saved.id,
    team: saved.team,
    name: saved.name,
    isPlayingNow: saved.isPlayingNow === true,
  };
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
  if (!button || !id || !team || !name) return;
  const isPlayingNow = readPlayingNow(button.dataset);
  openSheet(findSheet(), {
    key: `${id}:${team}`,
    show: () => showPlayer({ id, team, name, isPlayingNow }),
  });
}

/** Redraws the open sheet from what the page shows now. */
export const refreshPlayerSheet = () => renderSheet();

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
