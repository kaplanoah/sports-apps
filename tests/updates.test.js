import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../shared/page/html.js";
import {
  dismissNotes,
  endNoteClocks,
  listFreshNotes,
  listNotesToShow,
  renderUpdates,
  startFirstLookClocks,
  startNoteClocks,
} from "../shared/page/updates.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

const NOW = new Date("2026-10-01T23:00:00Z");
const at = (iso) => Date.parse(iso);

/**
 * @param {import("../shared/page/html.js").Markup} markup
 * @param {string} name
 */
const readCells = (markup, name) =>
  [...markup.text.matchAll(new RegExp(`<span class="${name}">([^<]*)</span>`, "g"))].map((match) =>
    normalizeSpaces(match[1]),
  );

test("the box counts its updates since the oldest, and names each one's time once", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates(
      [
        { at: at("2026-10-01T22:30:00Z"), text: html`<b>Liberty</b> won` },
        { at: at("2026-10-01T22:30:00Z"), text: html`<b>Fever</b> won` },
        { at: at("2026-09-30T22:00:00Z"), text: html`<b>Dream</b> won` },
      ],
      [],
      NOW,
    );

    assert.deepEqual(readCells(markup, "updates-count"), ["3 updates since yesterday"]);
    assert.deepEqual(readCells(markup, "when"), ["6:30 PM", "", "Yesterday"]);
    assert.match(markup.text, /<span class="what"><b>Liberty<\/b> won<\/span>/);
    assert.match(markup.text, /aria-label="Dismiss updates"/);
  }));

test("a game that ran past midnight names the night it was played, and one that didn't its day", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates(
      [
        {
          at: at("2026-10-01T04:30:00Z"),
          day: new Date(2026, 8, 30),
          endedNextDay: true,
          text: html`<b>Liberty</b> won`,
        },
        { at: at("2026-09-30T23:00:00Z"), day: new Date(2026, 8, 30), text: html`<b>Lynx</b> won` },
        {
          at: at("2026-09-30T04:06:00Z"),
          day: new Date(2026, 8, 29),
          endedNextDay: true,
          text: html`<b>Fever</b> won`,
        },
        {
          at: at("2026-09-23T04:06:00Z"),
          day: new Date(2026, 8, 22),
          endedNextDay: true,
          text: html`<b>Sky</b> won`,
        },
      ],
      [],
      NOW,
    );

    assert.deepEqual(readCells(markup, "updates-count"), ["4 updates since Sep 22"]);
    assert.deepEqual(readCells(markup, "when"), [
      "Last night",
      "Yesterday",
      "Tuesday night",
      "Sep 22",
    ]);
  }));

test("a game past midnight on a night the league's day hasn't ended shows the time it ended", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates(
      [
        {
          at: at("2026-10-01T04:30:00Z"),
          day: new Date(2026, 8, 30),
          endedNextDay: true,
          text: html`won`,
        },
      ],
      [],
      new Date(2026, 8, 30),
    );

    assert.deepEqual(readCells(markup, "when"), ["12:30 AM"]);
  }));

test("one update today reads in the singular, since earlier today", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates([{ at: at("2026-10-01T20:00:00Z"), text: html`won` }], [], NOW);

    assert.deepEqual(readCells(markup, "updates-count"), ["1 update since earlier today"]);
  }));

test("an update about one game carries the button that opens it, and one about none has no button", () => {
  const markup = renderUpdates(
    [
      {
        at: at("2026-10-01T22:30:00Z"),
        text: html`<b>Liberty</b> won`,
        action: html`<button type="button" class="game-open" data-game="401"></button>`,
      },
      { at: at("2026-10-01T22:00:00Z"), text: html`<b>Fever</b> clinched` },
    ],
    [],
    NOW,
  );
  const items = [...markup.text.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item]) => item);

  assert.match(items[0], /<button type="button" class="game-open" data-game="401"><\/button>$/);
  assert.doesNotMatch(items[1], /<button/);
});

test("the box lists the newest dozen and counts the rest", () => {
  const updates = Array.from({ length: 15 }, (_, index) => ({
    at: at("2026-10-01T20:00:00Z") - index * 60 * 1000,
    text: html`Game ${index}`,
  }));
  const markup = renderUpdates(updates, [], NOW);

  assert.equal(markup.text.match(/<span class="what">/g)?.length, 12);
  assert.match(markup.text, /<li class="more">and 3 more<\/li>/);
});

const NOTE = { at: at("2026-10-01T17:00:00Z"), text: "Game details now include channels." };

test("release notes sit under the updates, headed New in the app, and only the first heading closes the box", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates(
      [{ at: at("2026-10-01T20:00:00Z"), text: html`won` }],
      [NOTE],
      NOW,
    );

    assert.deepEqual(readCells(markup, "updates-count"), [
      "1 update since earlier today",
      "New in the app",
    ]);
    assert.match(markup.text, /<span class="what">won<\/span>[\s\S]*Game details now include/);
    assert.match(markup.text, /<div class="updates-notes updates-section">/);
    assert.equal(markup.text.match(/id="dismissUpdates"/g)?.length, 1);
  }));

test("a box with only release notes heads them New in the app, beside its dismiss button", () => {
  const markup = renderUpdates([], [NOTE], NOW);

  assert.deepEqual(readCells(markup, "updates-count"), ["New in the app"]);
  assert.match(
    markup.text,
    /<div class="updates-notes">\s*<div class="updates-head">[\s\S]*id="dismissUpdates"/,
  );
  assert.doesNotMatch(markup.text, /updates-section|class="when"/);
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {import("../shared/page/updates.js").ReleaseNote[]} notes
 * @param {import("../shared/page/updates.js").NoteClocks | null} clocks
 * @param {number} now
 */
const listNoteTexts = (notes, clocks, now) =>
  listFreshNotes(notes, clocks, now).map((note) => note.text);

test("a device's first look shows each note out for less than two weeks", () => {
  const notes = [
    { at: "2026-10-01T17:00:00Z", text: "Channels" },
    { at: "2026-09-10T17:00:00Z", text: "News" },
  ];
  const firstLook = at("2026-10-02T17:00:00Z");
  const clocks = startFirstLookClocks(notes, 0, firstLook);

  assert.deepEqual(listNoteTexts(notes, clocks, firstLook), ["Channels"]);
  assert.deepEqual(listNoteTexts(notes, clocks, at("2026-10-01T17:00:00Z") + 14 * DAY - 1), [
    "Channels",
  ]);
  assert.deepEqual(listNoteTexts(notes, clocks, at("2026-10-01T17:00:00Z") + 14 * DAY), []);
});

test("a device's first look counts a note out by the box's last dismissal as dismissed", () => {
  const notes = [
    { at: "2026-10-03T17:00:00Z", text: "Search" },
    { at: "2026-10-01T17:00:00Z", text: "Channels" },
  ];
  const firstLook = at("2026-10-04T17:00:00Z");
  const clocks = startFirstLookClocks(notes, at("2026-10-01T17:00:00Z"), firstLook);

  assert.deepEqual(listNoteTexts(notes, clocks, firstLook), ["Search"]);
});

test("a note out while the device was away shows for two weeks from when it first shows", () => {
  const notes = [{ at: "2026-10-01T17:00:00Z", text: "Channels" }];
  const back = at("2026-12-01T17:00:00Z");
  const clocks = startNoteClocks(notes, {}, back);

  assert.deepEqual(listNoteTexts(notes, clocks, back), ["Channels"]);
  assert.deepEqual(listNoteTexts(notes, clocks, back + 14 * DAY - 1), ["Channels"]);
  assert.deepEqual(listNoteTexts(notes, clocks, back + 14 * DAY), []);
});

test("a note shows from its time, and a dismissal ends every note out by then", () => {
  const notes = [
    { at: "2026-10-03T17:00:00Z", text: "Search" },
    { at: "2026-10-01T17:00:00Z", text: "Channels" },
  ];
  const beforeSearch = at("2026-10-02T17:00:00Z");
  const clocks = startNoteClocks(notes, {}, beforeSearch);

  assert.deepEqual(Object.keys(clocks), ["2026-10-01T17:00:00Z"], "not out yet");
  assert.deepEqual(listNoteTexts(notes, clocks, beforeSearch), ["Channels"]);

  const dismissed = endNoteClocks(notes, clocks, beforeSearch);
  assert.deepEqual(listNoteTexts(notes, dismissed, beforeSearch), []);
  const afterSearch = at("2026-10-04T17:00:00Z");
  assert.deepEqual(
    listNoteTexts(notes, startNoteClocks(notes, dismissed, afterSearch), afterSearch),
    ["Search"],
  );
});

test("the device keeps when each note it shows stops showing, and its dismissal", () => {
  const notes = [{ at: "2026-10-01T17:00:00Z", text: "Channels" }];
  const firstLook = at("2026-10-02T17:00:00Z");

  assert.deepEqual(
    listNotesToShow(notes, 0, firstLook).map((note) => note.text),
    ["Channels"],
  );
  const awayNotes = [{ at: "2026-11-01T17:00:00Z", text: "Search" }, ...notes];
  const back = at("2026-12-01T17:00:00Z");
  assert.deepEqual(
    listNotesToShow(awayNotes, 0, back).map((note) => note.text),
    ["Search"],
  );

  dismissNotes(awayNotes, back + DAY);
  assert.deepEqual(listNotesToShow(awayNotes, 0, back + DAY), []);
});

test("the box lists the newest three release notes and how many more", () => {
  const notes = ["Search", "Highlights", "Rosters", "News", "Channels"].map((text, index) => ({
    at: at("2026-10-01T17:00:00Z") - index * DAY,
    text,
  }));
  const markup = renderUpdates([], notes, NOW);

  assert.deepEqual(readCells(markup, "what"), ["Search", "Highlights", "Rosters"]);
  assert.match(markup.text, /<li class="more">and 2 more<\/li>/);
  assert.doesNotMatch(renderUpdates([], notes.slice(0, 3), NOW).text, /class="more"/);
});
