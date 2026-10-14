import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeDevice,
  describeJobStatus,
  describeLoad,
  describeOpenSheets,
  describeTimeAway,
  nameReportButton,
  writeHeader,
  writeRecordsAsText,
} from "../shared/page/diagnostics.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

const MINUTE_MS = 60 * 1000;

test("a load names a reload, and anything else an open", () => {
  assert.equal(describeLoad("reload"), "Reloaded");
  assert.equal(describeLoad("navigate"), "Opened");
  assert.equal(describeLoad("back_forward"), "Opened");
  assert.equal(describeLoad(undefined), "Opened");
});

test("a return names how long the page was away", () => {
  assert.equal(describeTimeAway(20 * 1000), "Back after less than a minute");
  assert.equal(describeTimeAway(5 * MINUTE_MS), "Back after 5 min");
  assert.equal(describeTimeAway(135 * MINUTE_MS), "Back after 2 h 15 min");
});

test("a copied step from before its record started, like a first paint, shows how long before", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date("2026-10-03T23:00:00Z");
    const records = [
      {
        at: Date.parse("2026-10-03T22:42:00Z"),
        how: "Reloaded",
        tab: "Games",
        lines: [
          { ms: -40, text: "First paint" },
          { ms: 0, text: "Shows stamp 40/18px" },
        ],
      },
    ];

    assert.equal(
      normalizeSpaces(writeRecordsAsText(records, now)),
      ["Today 6:42 PM, Reloaded, Games", "-40 First paint", "+0 Shows stamp 40/18px"].join("\n"),
    );
  }));

test("copied records list each open, newest first, with its steps and any dip", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date("2026-10-03T23:00:00Z");
    const records = [
      {
        at: Date.parse("2026-10-03T22:42:00Z"),
        how: "Back after 12 min",
        tab: "Bracket",
        lines: [
          { ms: 0, text: "Shows stamp 40/18px" },
          { ms: 120, text: "stamp: text 40 to 0", isDip: true },
        ],
      },
      { at: Date.parse("2026-10-02T18:15:00Z"), how: "Opened", tab: "", lines: [] },
    ];

    assert.equal(
      normalizeSpaces(writeRecordsAsText(records, now)),
      [
        "Today 6:42 PM, Back after 12 min, Bracket (dip)",
        "+0 Shows stamp 40/18px",
        "+120 stamp: text 40 to 0",
        "",
        "Yesterday 2:15 PM, Opened",
      ].join("\n"),
    );
  }));

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const IPHONE_HOME_SCREEN =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const IPHONE_IOS_26 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

test("a device names an iPhone's Safari version and WebKit build, and the iOS version only as what Safari reports", () => {
  assert.equal(
    describeDevice(IPHONE_IOS_26),
    "iPhone, Safari 26.0, WebKit 605.1.15, reports iOS 18.7",
  );
  assert.equal(
    describeDevice(IPHONE_SAFARI),
    "iPhone, Safari 18.6, WebKit 605.1.15, reports iOS 18.6.2",
  );
  assert.equal(describeDevice(IPHONE_HOME_SCREEN), "iPhone, WebKit 605.1.15, reports iOS 18.6.2");
  assert.equal(
    describeDevice("Mozilla/5.0 (X11; Linux x86_64)"),
    "Mozilla/5.0 (X11; Linux x86_64)",
  );
});

const PAGE_FACTS = {
  appName: "WNBA",
  release: { version: "2.27.13", commit: "abc1234", builtAt: "2026-10-06T12:00:00Z" },
  userAgent: IPHONE_HOME_SCREEN,
  isOnHomeScreen: true,
  width: 390,
  height: 844,
  pixelRatio: 3,
  prefersReducedMotion: false,
  theme: "dark",
  timeZone: "America/New_York",
  openedAt: Date.parse("2026-10-07T10:01:00Z"),
  returns: 3,
  jobs: [
    {
      name: "news",
      status: {
        ranAt: "2026-10-07T12:00:00Z",
        durationMs: 8000,
        requests: 14,
        lastFailure: null,
      },
    },
    {
      name: "players",
      status: {
        ranAt: "2026-10-07T12:15:00Z",
        durationMs: 2000,
        requests: 1,
        leagueReads: 3,
        lastFailure: {
          at: "2026-10-06T23:40:00Z",
          message: "Reading 2026's stats failed: The WNBA didn't answer",
        },
      },
    },
  ],
  now: new Date("2026-10-07T12:16:30Z"),
};

test("the report opens with the release, the device, and the page's state", () =>
  checkInTimeZone(EASTERN, () => {
    assert.equal(
      normalizeSpaces(writeHeader(PAGE_FACTS)),
      [
        "WNBA v2.27.13 commit abc1234",
        "Device: iPhone, WebKit 605.1.15, reports iOS 18.6.2",
        "Runs from the Home Screen",
        "Viewport 390x844 at 3x",
        "Reduced motion off",
        "Theme dark",
        "Opened Wed, Oct 7 6:01:00 AM, 2 h 16 min ago",
        "Back from the background 3 times since",
        "Now Wed, Oct 7 8:16:30 AM, America/New_York",
        "News job last ran Wed, Oct 7 8:00:00 AM, 14 requests",
        "Players job last ran Wed, Oct 7 8:15:00 AM, 1 request, sheets read the league 3 times, last failed Tue, Oct 6 7:40:00 PM: Reading 2026's stats failed: The WNBA didn't answer",
      ].join("\n"),
    );
  }));

test("a header in a browser, with no theme or release known, says so and leaves the theme out", () =>
  checkInTimeZone(EASTERN, () => {
    const header = writeHeader({
      ...PAGE_FACTS,
      appName: "MLB",
      release: null,
      isOnHomeScreen: false,
      prefersReducedMotion: true,
      theme: undefined,
      returns: 1,
    });

    assert.match(header, /^MLB, release unknown$/m);
    assert.match(header, /^Runs in the browser$/m);
    assert.match(header, /^Reduced motion on$/m);
    assert.match(header, /^Back from the background 1 time since$/m);
    assert.doesNotMatch(header, /Theme/);
  }));

test("a job's line says when it has no run saved, or its status couldn't be read", () => {
  assert.equal(
    describeJobStatus({ name: "players", status: undefined }),
    "Players job: no run saved",
  );
  assert.equal(
    describeJobStatus({ name: "news", status: null }),
    "News job: status couldn't be read",
  );
});

test("a record on request lists each open sheet and which one its dialog shows", () => {
  assert.deepEqual(
    describeOpenSheets([
      { id: "sheetDialog", isShown: false },
      { id: "teamSheet", isShown: true },
      { id: "settingsDialog", isShown: true },
    ]),
    ["Sheet sheetDialog", "Sheet teamSheet, shown", "Sheet settingsDialog, shown"],
  );
  assert.deepEqual(describeOpenSheets([]), ["No sheets open"]);
});

test("the report button offers the report at once, then says it went", () => {
  const ready = { reportStep: null, isTouch: true };
  assert.equal(nameReportButton(ready), "Share report");
  assert.equal(nameReportButton({ ...ready, isTouch: false }), "Copy report");
  assert.equal(nameReportButton({ ...ready, reportStep: "shared" }), "Shared");
  assert.equal(nameReportButton({ ...ready, reportStep: "copied" }), "Copied");
});
