// The Notifications group's rows, rendered without the browser for text and state checks.
import { html } from "./html.js";
import { REMINDER_PRESETS } from "./notification-preferences.js";

/**
 * @param {object} state
 * @param {ReturnType<typeof import("./notification-status.js").chooseNotificationControls>} state.controls
 * @param {typeof import("./notification-preferences.js").DEFAULT_NOTIFICATION_PREFERENCES} state.preferences
 * @param {Pick<import("./league-words.js").LeagueWords, "notificationUpdates" | "reminderTiming">} state.words
 * @param {ReturnType<typeof html> | string} state.note
 */
export function renderNotificationRows({ controls, preferences, words, note }) {
  const renderToggle = (id, title, checked, extra = html``) => html`<div class="control-row">
    <span class="control-label"><span id="${id}Title">${title}</span>${extra}</span>
    <button type="button" role="switch" class="switch" id="${id}Switch" aria-checked="${String(checked)}" aria-labelledby="${id}Title" ${controls.areSwitchesHidden ? "hidden" : ""} ${controls.areSwitchesDisabled ? "disabled" : ""}>
      <span class="switch-knob" aria-hidden="true"></span>
    </button></div>`;
  return html`<h3 class="settings-group-label" id="notificationsSettingsTitle">Notifications</h3>
    ${
      controls.areSwitchesHidden
        ? html``
        : html`${renderToggle("reminders", "Game starts", controls.areRemindersOn)}
    <label class="control-row reminder-timing" data-setting="settings:reminders">
      <span class="control-label"><span id="reminderTimingTitle">${words.reminderTiming}</span></span>
      <select class="select-field" id="reminderTiming" aria-labelledby="reminderTimingTitle" ${controls.isTimingDisabled ? "disabled" : ""}>
        ${REMINDER_PRESETS.map(({ minutes, label }) => html`<option value="${minutes}" ${preferences.minutes === minutes ? "selected" : ""}>${label}</option>`)}
      </select>
    </label>`
    }
    ${renderToggle(
      "notify",
      words.notificationUpdates,
      controls.areUpdatesOn,
      html`<span class="control-note" id="notifyNote" role="status">${note}</span>`,
    )} `;
}
