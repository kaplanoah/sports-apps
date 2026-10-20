import { describeTeamStatus } from "./bracket.js";
import {
  describeDrought,
  listRankedOrder,
  nameTeam,
  renderPlainClub,
  renderStatusChip,
  renderTitleSummary,
} from "./clubs.js";
import { html, setHtml } from "#shared/html.js";
import { session } from "./session.js";
import { TEAMS } from "./teams.js";

export const REORDER_EVENT = "rankingreorder";

const MOVES = { ArrowUp: -1, ArrowDown: 1 };

// A club that's out looks like the rest: the ranking says who you're for, not who's still playing.
function renderRankItem(id, index) {
  const { league } = TEAMS[id];
  return html`<li class="rank-item" data-id="${id}">
      <button type="button" class="grip" aria-label="Move ${nameTeam(id)}, ranked ${index + 1}. Use the up and down arrow keys.">&#8942;&#8942;</button>
      <span class="rank-id">
        ${renderPlainClub(id)}
        <span class="chip league-tag ${league}">${league}</span>
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
  setHtml(list, html`${order.map(renderRankItem)}`);
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
  const step = MOVES[event.key];
  if (!grip || !step) return;
  event.preventDefault();
  const id = /** @type {HTMLElement} */ (grip.closest(".rank-item")).dataset.id;
  const order = listRankedOrder();
  const from = order.indexOf(id);
  const to = from + step;
  if (to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  announceOrder(list, order);
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
