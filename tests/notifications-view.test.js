import test from "node:test";
import assert from "node:assert/strict";
import { renderNotificationRows } from "../shared/page/notifications-view.js";
import { chooseNotificationControls } from "../shared/page/notification-status.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../shared/page/notification-preferences.js";
import { describeRemindersSetting } from "../shared/page/page-places.js";
import { LEAGUE_WORDS as MLB_WORDS } from "../apps/mlb/page/js/league-words.js";
import { LEAGUE_WORDS as WNBA_WORDS } from "../apps/wnba/page/js/league-words.js";

const renderRows = (words, preferences = DEFAULT_NOTIFICATION_PREFERENCES, status = "off") =>
  String(
    renderNotificationRows({
      words,
      controls: chooseNotificationControls({ status, preferences, isBusy: false }),
      note: "Permission guidance",
    }),
  );

for (const [league, words, timing, updates] of /** @type {const} */ ([
  ["MLB", MLB_WORDS, "Time before game", "Game updates"],
  ["WNBA", WNBA_WORDS, "Time before tipoff", "Final scores"],
])) {
  test(`${league} shows Game starts, its timing, then updates with the league's words`, () => {
    const markup = renderRows(words);
    const titles = [
      ...markup.matchAll(/id="(?:remindersTitle|reminderTimingTitle|notifyTitle)">([^<]+)/g),
    ].map(([, title]) => title);
    assert.deepEqual(titles, ["Game starts", timing, updates]);
    assert.deepEqual(describeRemindersSetting(words).name, ["Game starts", timing]);
    assert.ok(describeRemindersSetting(words).words.includes(timing));
    assert.ok(
      markup.includes(league === "MLB" ? "At scheduled first pitch" : "At scheduled tipoff"),
    );
    assert.match(markup, /id="notifyNote" role="status">Permission guidance</);
    assert.equal((markup.match(/role="switch"/g) ?? []).length, 2);
    assert.match(
      markup,
      /<label class="control-row reminder-timing" data-setting="settings:reminders">/,
    );
    assert.match(markup, /<select[^>]+aria-labelledby="reminderTimingTitle" >/);
  });
}

test("reminders default off with a prompt, a saved 10-minute default and the approved presets", () => {
  const markup = renderRows(MLB_WORDS);
  assert.match(markup, /id="remindersSwitch" aria-checked="false"/);
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.minutes, 10);
  assert.match(markup, /<option value="" disabled selected>Choose time<\/option>/);
  assert.deepEqual(
    [...markup.matchAll(/<option value="(\d+)" (selected)?>([^<]+)<\/option>/g)].map(
      ([, minutes, selected, label]) => [Number(minutes), !!selected, label],
    ),
    [
      [0, false, "At scheduled first pitch"],
      [10, false, "10 minutes before"],
      [30, false, "30 minutes before"],
      [60, false, "1 hour before"],
      [180, false, "3 hours before"],
    ],
  );
});

test("either category can remain on independently and timing keeps its saved choice", () => {
  for (const reminders of [true, false]) {
    const markup = renderRows(
      MLB_WORDS,
      { ...DEFAULT_NOTIFICATION_PREFERENCES, reminders, updates: !reminders, minutes: 60 },
      "on",
    );
    assert.match(markup, new RegExp(`id="remindersSwitch" aria-checked="${reminders}"`));
    assert.match(markup, new RegExp(`id="notifySwitch" aria-checked="${!reminders}"`));
    assert.equal(/<select[^>]+ disabled>/.test(markup), false);
    if (reminders) assert.match(markup, /<option value="60" selected>1 hour before<\/option>/);
    else assert.match(markup, /Choose time/);
  }
});

test("unsupported devices retain guidance without unusable reminder controls", () => {
  const markup = renderRows(WNBA_WORDS, DEFAULT_NOTIFICATION_PREFERENCES, "unsupported");
  assert.doesNotMatch(markup, /remindersSwitch|reminderTiming/);
  assert.match(markup, /id="notifySwitch"[^>]+hidden/);
  assert.match(markup, /Permission guidance/);
});
