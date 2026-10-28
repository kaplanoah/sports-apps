// The Notifications group's rows, rendered without the browser for text and state checks.
import { html } from "./html.js";
import { REMINDER_PRESETS, nameReminderPreset } from "./notification-preferences.js";

/** @typedef {"notify" | "reminders" | "reminderTiming"} NotePlace */

/** The note place of each category's switch. */
export const NOTE_PLACES = /** @type {const} */ ({ updates: "notify", reminders: "reminders" });

/**
 * @param {object} state
 * @param {ReturnType<typeof import("./notification-status.js").chooseNotificationControls>} state.controls
 * @param {Pick<import("./league-words.js").LeagueWords, "notificationUpdates" | "reminderTiming" | "reminderAtStart">} state.words
 * @param {ReturnType<typeof html> | string} state.note
 * @param {NotePlace} state.notePlace the control whose save the note answers, else the updates row
 */
export function renderNotificationRows({ controls, words, note, notePlace }) {
  const renderNote = (id) =>
    html`<span class="control-note" id="${id}Note" role="status">${notePlace === id ? note : ""}</span>`;
  const renderToggle = (category, title, checked) => {
    const id = NOTE_PLACES[category];
    return html`<div class="control-row">
    <span class="control-label"><span id="${id}Title">${title}</span>${renderNote(id)}</span>
    <span class="notification-switch">
    <span class="notification-spinner" aria-hidden="true" ${controls.spinnerCategory === category ? "" : "hidden"}></span>
    <button type="button" role="switch" class="switch${controls.isSaving ? " is-saving" : ""}" id="${id}Switch" aria-checked="${String(checked)}" aria-labelledby="${id}Title" aria-busy="${String(controls.pendingCategory === category)}" ${controls.areSwitchesHidden ? "hidden" : ""} ${controls.areSwitchesDisabled ? "disabled" : ""}>
      <span class="switch-knob" aria-hidden="true"></span>
    </button></span></div>`;
  };
  return html`<h3 class="settings-group-label" id="notificationsSettingsTitle">Notifications</h3>
    ${
      controls.areSwitchesHidden
        ? html``
        : html`${renderToggle("reminders", "Game starts", controls.areRemindersOn)}
    <label class="control-row reminder-timing" data-setting="settings:reminders">
      <span class="control-label"><span id="reminderTimingTitle">${words.reminderTiming}</span>${renderNote("reminderTiming")}</span>
      <select class="select-field${controls.isSaving ? " is-saving" : ""}" id="reminderTiming" aria-labelledby="reminderTimingTitle" ${controls.isTimingDisabled ? "disabled" : ""}>
        ${REMINDER_PRESETS.map((minutes) => html`<option value="${minutes}" ${controls.timingMinutes === minutes ? "selected" : ""}>${nameReminderPreset(minutes, words)}</option>`)}
      </select>
    </label>`
    }
    ${renderToggle("updates", words.notificationUpdates, controls.areUpdatesOn)} `;
}
