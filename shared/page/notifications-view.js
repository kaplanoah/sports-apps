// The Notifications group's rows, rendered without the browser for text and state checks.
import { html } from "./html.js";
import { REMINDER_PRESETS, nameReminderPreset } from "./notification-preferences.js";

/**
 * @param {object} state
 * @param {ReturnType<typeof import("./notification-status.js").chooseNotificationControls>} state.controls
 * @param {Pick<import("./league-words.js").LeagueWords, "notificationUpdates" | "reminderTiming" | "reminderAtStart">} state.words
 * @param {ReturnType<typeof html> | string} state.note
 */
export function renderNotificationRows({ controls, words, note }) {
  const renderToggle = (
    id,
    category,
    title,
    checked,
    extra = html``,
  ) => html`<div class="control-row">
    <span class="control-label"><span id="${id}Title">${title}</span>${extra}</span>
    <span class="notification-switch">
    <span class="notification-spinner" aria-hidden="true" ${controls.spinnerCategory === category ? "" : "hidden"}></span>
    <button type="button" role="switch" class="switch" id="${id}Switch" aria-checked="${String(checked)}" aria-labelledby="${id}Title" aria-busy="${String(controls.pendingCategory === category)}" ${controls.areSwitchesHidden ? "hidden" : ""} ${controls.areSwitchesDisabled ? "disabled" : ""}>
      <span class="switch-knob" aria-hidden="true"></span>
    </button></span></div>`;
  return html`<h3 class="settings-group-label" id="notificationsSettingsTitle">Notifications</h3>
    ${
      controls.areSwitchesHidden
        ? html``
        : html`${renderToggle("reminders", "reminders", "Game starts", controls.areRemindersOn)}
    <label class="control-row reminder-timing" data-setting="settings:reminders">
      <span class="control-label"><span id="reminderTimingTitle">${words.reminderTiming}</span></span>
      <select class="select-field" id="reminderTiming" aria-labelledby="reminderTimingTitle" ${controls.isTimingDisabled ? "disabled" : ""}>
        ${controls.areRemindersOn ? html`` : html`<option value="" disabled selected>Choose time</option>`}
        ${REMINDER_PRESETS.map((minutes) => html`<option value="${minutes}" ${controls.areRemindersOn && controls.timingMinutes === minutes ? "selected" : ""}>${nameReminderPreset(minutes, words)}</option>`)}
      </select>
    </label>`
    }
    ${renderToggle(
      "notify",
      "updates",
      words.notificationUpdates,
      controls.areUpdatesOn,
      html`<span class="control-note" id="notifyNote" role="status">${note}</span>`,
    )} `;
}
