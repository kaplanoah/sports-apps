import { describeTeamStatus } from "./bracket.js";
import {
  describeDrought,
  listRankedOrder,
  renderPlainClub,
  renderStatusChip,
  renderTitleSummary,
} from "./clubs.js";
import { html, setHtml } from "#shared/html.js";
import { session } from "./session.js";
import { nameTeam, TEAMS } from "./teams.js";

export const REORDER_EVENT = "rankingreorder";

// Each grip is a vertical slider, which a swipe up or down in VoiceOver adjusts by sending an arrow
// key: Up or Right moves its club up the list, and Down or Left down it. Home and End move it to
// either end, as on any slider.
/** @type {Record<string, (from: number, count: number) => number>} */
const MOVES = {
  ArrowUp: (from) => from - 1,
  ArrowRight: (from) => from - 1,
  ArrowDown: (from) => from + 1,
  ArrowLeft: (from) => from + 1,
  Home: () => 0,
  End: (from, count) => count - 1,
};

/**
 * The ranking with a club moved by a slider's key, or null when the key moves it nowhere.
 * @param {string[]} order
 * @param {string} id
 * @param {string} key
 */
export function moveClub(order, id, key) {
  const from = order.indexOf(id);
  const to = MOVES[key]?.(from, order.length);
  if (from < 0 || to === undefined || to === from || to < 0 || to >= order.length) return null;
  const moved = order.filter((club) => club !== id);
  moved.splice(to, 0, id);
  return moved;
}

/**
 * A club's row. A club that's out looks like the rest: the ranking says who you're for, not who's
 * still playing.
 * @param {string} id
 * @param {number} index
 * @param {number} count
 */
export function renderRankItem(id, index, count) {
  const { league } = TEAMS[id];
  // Up the list is up the slider, so its value counts from the bottom, and its text says the rank.
  return html`<li class="rank-item" data-id="${id}">
      <button
        type="button"
        class="grip"
        role="slider"
        aria-orientation="vertical"
        aria-label="Move ${nameTeam(id)}"
        aria-valuemin="1"
        aria-valuemax="${count}"
        aria-valuenow="${count - index}"
        aria-valuetext="Ranked ${index + 1} of ${count}"
      >&#8942;&#8942;</button>
      <span class="rank-id">
        ${renderPlainClub(id)}
        <span class="chip filled league-tag ${league}">${league}</span>
        <span class="rank-drought tabular">${describeDrought(id)}</span>
        <span class="rank-ws tabular">${renderTitleSummary(id)}</span>
      </span>
      ${renderStatusChip(describeTeamStatus(session.state, id))}
    </li>`;
}

export function renderRanking() {
  const list = document.getElementById("rankList");
  const numbers = document.getElementById("rankNumbers");
  const order = listRankedOrder();
  if (!order.length) {
    setHtml(numbers, html``);
    setHtml(
      list,
      html`<li class="rank-empty">The ranking fills in once there's a playoff field</li>`,
    );
    return;
  }
  // Rank numbers live outside the rows so they stay put while rows are dragged.
  setHtml(numbers, html`${order.map((_, index) => html`<li class="tabular">${index + 1}</li>`)}`);
  const focusedId = findFocusedClub(list);
  setHtml(list, html`${order.map((id, index) => renderRankItem(id, index, order.length))}`);
  if (focusedId) focusGrip(list, focusedId);
  wireReordering(list);
}

// A redraw replaces the handle a keyboard user is on, so focus moves to its replacement.
function findFocusedClub(list) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !list.contains(focused)) return null;
  if (!focused.classList.contains("grip")) return null;
  return /** @type {HTMLElement} */ (focused.closest(".rank-item")).dataset.id;
}

const focusGrip = (list, id) =>
  /** @type {HTMLElement | null} */ (
    list.querySelector(`.rank-item[data-id="${id}"] .grip`)
  )?.focus();

const announceOrder = (list, order) =>
  list.dispatchEvent(new CustomEvent(REORDER_EVENT, { detail: { order } }));

function moveWithKeyboard(list, event) {
  const grip = event.target instanceof HTMLElement && event.target.closest(".grip");
  if (!grip || !(event.key in MOVES)) return;
  event.preventDefault();
  const id = /** @type {HTMLElement} */ (grip.closest(".rank-item")).dataset.id;
  const order = moveClub(listRankedOrder(), id, event.key);
  if (order) announceOrder(list, order);
}

// Bound once: the list element survives re-renders.
let isWired = false;

function wireReordering(list) {
  if (isWired) return;
  isWired = true;
  list.addEventListener("keydown", (event) => moveWithKeyboard(list, event));
  if (typeof Sortable === "undefined") return;
  Sortable.create(list, {
    animation: 140,
    handle: ".grip",
    chosenClass: "dragging",
    ghostClass: "drag-ghost",
    onStart: () => {
      session.isReordering = true;
    },
    onEnd: () => {
      const rows = /** @type {HTMLElement[]} */ ([...list.querySelectorAll(".rank-item")]);
      announceOrder(
        list,
        rows.map((row) => row.dataset.id),
      );
    },
  });
}
