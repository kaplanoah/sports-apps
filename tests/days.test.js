import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  addDays,
  countDaysBetween,
  countDaysInMonth,
  describeDay,
  formatClockTime,
  formatClockTimeWithoutMeridiem,
  formatDateAndTime,
  formatMinutesIntoDay,
  formatShortDate,
  formatShortWeekday,
  formatWeekday,
  formatWeekdayAndDate,
  formatWeekdayOrDate,
  isSameMonth,
  isStillToComeToday,
  nameDay,
  readCalendarDate,
  readDayOfMonth,
  readEasternDay,
  readMinutesIntoDay,
  readPlayingDay,
  readWeekday,
  shiftMonth,
} from "../shared/page/days.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

/** @param {Date | null} date */
const readMonthAndDay = (date) => date && [date.getMonth() + 1, date.getDate()];

// 9:00 PM Eastern on Thursday, October 1.
const THURSDAY_NIGHT = "2026-10-02T01:00:00Z";

// Zones on both sides of UTC, and far enough from it that a date read as midnight UTC is the day
// before or after.
const ZONES = ["Pacific/Honolulu", EASTERN, "UTC", "Asia/Tokyo", "Pacific/Kiritimati"];

test("days between count calendar days, whatever the hour, backward as well as forward", () =>
  checkInTimeZone(EASTERN, () => {
    const lateThursday = new Date(2026, 9, 1, 23, 59);
    assert.equal(countDaysBetween(new Date(2026, 9, 1, 0, 1), lateThursday), 0);
    assert.equal(countDaysBetween(lateThursday, new Date(2026, 9, 2, 0, 1)), 1);
    assert.equal(countDaysBetween(lateThursday, new Date(2026, 8, 30, 12)), -1);
  }));

test("days between stay whole across a daylight saving change", () =>
  checkInTimeZone(EASTERN, () => {
    assert.equal(countDaysBetween(new Date(2026, 9, 31, 12), new Date(2026, 10, 2, 12)), 2);
    assert.equal(countDaysBetween(new Date(2026, 2, 7, 12), new Date(2026, 2, 9, 12)), 2);
  }));

test("a game is still to come today only before it starts, on the viewer's own day, in any zone", () => {
  for (const zone of ZONES)
    checkInTimeZone(zone, () => {
      const now = new Date(2026, 9, 1, 15);
      const today = new Date(2026, 9, 1);
      assert.equal(isStillToComeToday({ state: "pre", day: today }, now), true, zone);
      assert.equal(isStillToComeToday({ state: "live", day: today }, now), false, zone);
      assert.equal(isStillToComeToday({ state: "final", day: today }, now), false, zone);
      assert.equal(
        isStillToComeToday({ state: "pre", day: new Date(2026, 9, 2) }, now),
        false,
        zone,
      );
      assert.equal(isStillToComeToday({ state: "pre", day: null }, now), false, zone);
    });
});

test("a league's date is midnight of that date on the viewer's calendar, in any zone", () => {
  for (const zone of ["America/Los_Angeles", EASTERN, "Asia/Tokyo"])
    checkInTimeZone(zone, () => {
      const day = readCalendarDate("2026-10-01");
      assert.deepEqual(readMonthAndDay(day), [10, 1], zone);
      assert.equal(day.getHours(), 0, zone);
    });
});

test("a game with a set time is played on the viewer's own day", () => {
  const game = { start: THURSDAY_NIGHT, isTimeSet: true, leagueDate: "2026-10-01" };
  const expected = { "America/Los_Angeles": [10, 1], [EASTERN]: [10, 1], "Asia/Tokyo": [10, 2] };
  for (const [zone, day] of Object.entries(expected))
    assert.deepEqual(
      checkInTimeZone(zone, () => readMonthAndDay(readPlayingDay(game))),
      day,
      zone,
    );
});

test("a game without a set time is played on the league's day, wherever the viewer is", () => {
  const game = { start: "2026-10-01T04:00:00Z", isTimeSet: false, leagueDate: "2026-10-01" };
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo"])
    assert.deepEqual(
      checkInTimeZone(zone, () => readMonthAndDay(readPlayingDay(game))),
      [10, 1],
      zone,
    );
});

test("a game falls back on whichever of its start and its league's day it has", () =>
  checkInTimeZone(EASTERN, () => {
    const leagueDate = "2026-10-01";
    assert.deepEqual(readMonthAndDay(readPlayingDay({ isTimeSet: true, leagueDate })), [10, 1]);
    assert.deepEqual(
      readMonthAndDay(readPlayingDay({ start: THURSDAY_NIGHT, isTimeSet: false })),
      [10, 1],
    );
    assert.equal(readPlayingDay({ start: "not a time", isTimeSet: true }), null);
    assert.equal(readPlayingDay({ start: null, isTimeSet: false, leagueDate: null }), null);
  }));

test("times and dates read the viewer's clock and calendar", () =>
  checkInTimeZone("America/Los_Angeles", () => {
    const start = new Date(THURSDAY_NIGHT);
    assert.equal(normalizeSpaces(formatClockTime(start)), "6:00 PM");
    assert.equal(formatShortDate(start), "Oct 1");
    assert.equal(formatWeekdayAndDate(start), "Thu, Oct 1");
    assert.equal(formatWeekday(start), "Thursday");
    assert.equal(formatShortWeekday(start), "Thu");
  }));

test("a clock time without AM or PM keeps just the hour and minutes", () =>
  checkInTimeZone("America/Los_Angeles", () => {
    assert.equal(formatClockTimeWithoutMeridiem(new Date(THURSDAY_NIGHT)), "6:00");
    assert.equal(formatClockTimeWithoutMeridiem(new Date("2026-10-01T17:05:00Z")), "10:05");
  }));

test("the Eastern day is the league's, whatever the viewer's zone", () => {
  for (const zone of ["America/Los_Angeles", EASTERN, "Asia/Tokyo"])
    checkInTimeZone(zone, () => {
      assert.deepEqual(readEasternDay(Date.parse(THURSDAY_NIGHT)), {
        date: "2026-10-01",
        hour: 21,
        year: 2026,
      });
      assert.deepEqual(readEasternDay(Date.parse("2027-01-01T04:30:00Z")), {
        date: "2026-12-31",
        hour: 23,
        year: 2026,
      });
      assert.equal(readEasternDay(Date.parse("2026-10-02T04:00:00Z")).hour, 0);
    });
});

test("adding days to a date crosses months, years, and daylight saving changes", () => {
  for (const zone of ["Pacific/Honolulu", EASTERN, "Asia/Tokyo"])
    checkInTimeZone(zone, () => {
      assert.equal(addDays("2026-09-29", 4), "2026-10-03");
      assert.equal(addDays("2026-10-01", -14), "2026-09-17");
      assert.equal(addDays("2026-12-30", 3), "2027-01-02");
      assert.equal(addDays("2026-11-01", 1), "2026-11-02");
      assert.equal(addDays("2026-03-08", -1), "2026-03-07");
      assert.equal(addDays("2026-10-01", 0), "2026-10-01");
    });
});

test("a day near now is yesterday, today, or tomorrow, then its weekday, then its date", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date(2026, 9, 1, 12);
    const wednesday = new Date(2026, 8, 30, 23, 59);
    const thursday = new Date(2026, 9, 1, 0, 1);
    const friday = new Date(2026, 9, 2, 23, 59);
    assert.equal(nameDay(wednesday, now), "yesterday");
    assert.equal(nameDay(thursday, now), "today");
    assert.equal(nameDay(friday, now), "tomorrow");
    assert.equal(nameDay(new Date(2026, 8, 25, 20), now), "Friday");
    assert.equal(nameDay(new Date(2026, 9, 7, 20), now), "Wednesday");
    assert.equal(nameDay(new Date(2026, 8, 24, 20), now), "Sep 24");
    assert.equal(nameDay(new Date(2026, 9, 8, 20), now), "Oct 8");
  }));

test("a game's day starts a line as Yesterday, Today, or Tomorrow, and further off as its weekday and date", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date(2026, 9, 10, 12).getTime();
    assert.equal(describeDay(new Date(2026, 9, 9), now), "Yesterday");
    assert.equal(describeDay(new Date(2026, 9, 10), now), "Today");
    assert.equal(describeDay(new Date(2026, 9, 11), now), "Tomorrow");
    assert.equal(describeDay(new Date(2026, 9, 8), now), "Thu, Oct 8");
    assert.equal(describeDay(new Date(2026, 9, 16), now), "Fri, Oct 16");
  }));

test("a day's name says only the near days asked for, in the form asked for", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date(2026, 9, 1, 12);
    const wednesday = new Date(2026, 8, 30, 20);
    const thursday = new Date(2026, 9, 1, 20);
    const friday = new Date(2026, 9, 2, 20);
    assert.equal(nameDay(thursday, now, { isCapitalized: true }), "Today");
    assert.equal(nameDay(wednesday, now, { isCapitalized: true }), "Yesterday");
    assert.equal(
      nameDay(thursday, now, { nearDays: [-1, 1], nameOtherDay: formatWeekday }),
      "Thursday",
    );
    assert.equal(nameDay(friday, now, { nearDays: [0], nameOtherDay: formatShortWeekday }), "Fri");
    assert.equal(
      nameDay(wednesday, now, { nearDays: [], nameOtherDay: formatWeekdayAndDate }),
      "Wed, Sep 30",
    );
  }));

// Node takes its default locale from the environment when it starts, so a German one needs a
// process of its own.
test("near days are named in English in any language, and weekdays in the viewer's", () => {
  const script = `
    import { formatWeekday, nameDay } from ${JSON.stringify(import.meta.resolve("../shared/page/days.js"))};
    const now = new Date(2026, 9, 1, 12);
    const names = [-1, 0, 1, 3].map((offset) => nameDay(new Date(2026, 9, 1 + offset, 12), now));
    console.log(JSON.stringify({ names, weekday: formatWeekday(now) }));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", TZ: EASTERN },
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output), {
    names: ["yesterday", "today", "tomorrow", "Sonntag"],
    weekday: "Donnerstag",
  });
});

test("a day's name is the same on the viewer's calendar in any zone", () => {
  for (const zone of ["Pacific/Honolulu", EASTERN, "Asia/Tokyo"])
    checkInTimeZone(zone, () => {
      const now = new Date(2026, 9, 1, 0, 30);
      assert.equal(nameDay(new Date(2026, 8, 30, 23, 30), now), "yesterday", zone);
      assert.equal(nameDay(new Date(2026, 9, 1, 23, 30), now), "today", zone);
    });
});

test("a weekday names a day within a week either way, and a date one further off", () =>
  checkInTimeZone(EASTERN, () => {
    const thursday = new Date(2026, 9, 1, 12);
    assert.equal(formatWeekdayOrDate(thursday, 6), "Thursday");
    assert.equal(formatWeekdayOrDate(thursday, -6), "Thursday");
    assert.equal(formatWeekdayOrDate(thursday, 7), "Oct 1");
    assert.equal(formatWeekdayOrDate(thursday, -7), "Oct 1");
  }));

test("a date's day of the month, weekday, and month are the same in any zone", () => {
  for (const zone of ZONES)
    checkInTimeZone(zone, () => {
      assert.equal(readDayOfMonth("2026-10-01"), 1, zone);
      assert.equal(readDayOfMonth("2026-09-30"), 30, zone);
      assert.equal(readWeekday("2026-10-01"), 4, zone);
      assert.equal(readWeekday("2026-10-04"), 0, zone);
      assert.equal(readWeekday("2027-01-02"), 6, zone);
      assert.ok(isSameMonth("2026-10-01", "2026-10-31"), zone);
      assert.ok(!isSameMonth("2026-09-30", "2026-10-01"), zone);
      assert.ok(!isSameMonth("2026-10-01", "2027-10-01"), zone);
    });
});

test("a month's length and the months around it cross years and leap days, in any zone", () => {
  for (const zone of ZONES)
    checkInTimeZone(zone, () => {
      assert.equal(countDaysInMonth(9, 2026), 30, zone);
      assert.equal(countDaysInMonth(10, 2026), 31, zone);
      assert.equal(countDaysInMonth(2, 2026), 28, zone);
      assert.equal(countDaysInMonth(2, 2028), 29, zone);
      assert.deepEqual(shiftMonth("2026-10-31", 1), { month: 11, year: 2026 }, zone);
      assert.deepEqual(shiftMonth("2026-12-15", 1), { month: 1, year: 2027 }, zone);
      assert.deepEqual(shiftMonth("2026-01-01", -1), { month: 12, year: 2025 }, zone);
      assert.deepEqual(shiftMonth("2026-10-01", 0), { month: 10, year: 2026 }, zone);
    });
});

test("a moment's minutes into the day are on the viewer's clock, or on the zone asked for", () => {
  const start = new Date(THURSDAY_NIGHT);
  const expected = { "America/Los_Angeles": 18 * 60, [EASTERN]: 21 * 60, "Asia/Tokyo": 10 * 60 };
  for (const [zone, minutes] of Object.entries(expected))
    checkInTimeZone(zone, () => {
      assert.equal(readMinutesIntoDay(start), minutes, zone);
      assert.equal(readMinutesIntoDay(start, EASTERN), 21 * 60, zone);
      assert.equal(readMinutesIntoDay(new Date("2026-10-01T04:05:00Z"), EASTERN), 5, zone);
    });
});

test("reading minutes into the day again makes no new formatter, on the viewer's clock or a zone's", (context) => {
  const start = new Date(THURSDAY_NIGHT);
  readMinutesIntoDay(start, "America/Chicago");
  const made = context.mock.method(Intl, "DateTimeFormat");
  for (let count = 0; count < 3; count += 1) {
    readMinutesIntoDay(start);
    readMinutesIntoDay(start, "America/Chicago");
  }
  assert.equal(made.mock.callCount(), 0);
});

test("a time of day in minutes reads as a clock time, with its minutes only off the hour", () => {
  for (const zone of ZONES)
    checkInTimeZone(zone, () => {
      assert.equal(normalizeSpaces(formatMinutesIntoDay(21 * 60)), "9 PM", zone);
      assert.equal(normalizeSpaces(formatMinutesIntoDay(19 * 60 + 5)), "7:05 PM", zone);
      assert.equal(normalizeSpaces(formatMinutesIntoDay(0)), "12 AM", zone);
    });
});

test("a moment's date and time name its year only when it isn't now's, by the viewer's calendar", () =>
  checkInTimeZone("America/Los_Angeles", () => {
    const newYearsEve = new Date("2027-01-01T05:00:00Z");
    assert.equal(
      normalizeSpaces(formatDateAndTime(newYearsEve, new Date(2026, 11, 31, 22))),
      "Dec 31, 9:00 PM",
    );
    assert.equal(
      normalizeSpaces(formatDateAndTime(newYearsEve, new Date(2027, 0, 2))),
      "Dec 31, 2026, 9:00 PM",
    );
  }));
