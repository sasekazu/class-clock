"use strict";
// Run with:  node --test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/schedule.js");

/** Epoch ms for a JST wall-clock time, e.g. at("2026-10-16", "10:14:30.5"). */
const at = (date, time) => {
  const [hms, frac = "0"] = time.split(".");
  const [h, m, s = "00"] = hms.split(":");
  const ms = String(frac).padEnd(3, "0").slice(0, 3);
  return Date.parse(`${date}T${h.padStart(2, "0")}:${m}:${s}.${ms}+09:00`);
};
const status = (date, time) => S.getStatus(at(date, time));

// 2026-10-16 is an ordinary Friday.
const FRI = "2026-10-16";

test("period table matches the 2026 standard timetable", () => {
  const table = S.PERIODS.map((p) => [p.n, S.formatMinutes(p.start), S.formatMinutes(p.end)]);
  assert.deepEqual(table, [
    [1, "8:45", "10:15"],
    [2, "10:45", "12:15"],
    [3, "13:15", "14:45"],
    [4, "15:00", "16:30"],
    [5, "16:45", "18:15"],
    [6, "18:25", "19:55"],
    [7, "20:05", "21:35"],
  ]);
  for (let i = 1; i < S.PERIODS.length; i++) {
    assert.ok(S.PERIODS[i].start > S.PERIODS[i - 1].end, "periods must not overlap");
  }
});

test("JST parts are independent of the system time zone", () => {
  // 15:00 UTC = 00:00 JST the next day
  const t = S.jstParts(Date.parse("2026-10-15T15:00:00Z"));
  assert.deepEqual([t.y, t.mo, t.d, t.wd, t.h, t.mi, t.s], [2026, 10, 16, 5, 0, 0, 0]);
  const u = S.jstParts(Date.parse("2026-12-31T14:59:59.250Z"));
  assert.deepEqual([u.y, u.mo, u.d, u.h, u.mi, u.s, u.ms], [2026, 12, 31, 23, 59, 59, 250]);
});

test("every period boundary: start, last millisecond, end", () => {
  for (const p of S.PERIODS) {
    const dur = p.end - p.start;
    const startMs = at(FRI, "0:00") + p.start * 60000;
    const endMs = at(FRI, "0:00") + p.end * 60000;

    const first = S.getStatus(startMs);
    assert.equal(first.phase, "class");
    assert.equal(first.current.n, p.n);
    assert.equal(first.remainingMin, dur);
    assert.equal(first.progress, 0);

    const justBefore = S.getStatus(startMs - 1);
    assert.notEqual(justBefore.phase, "class", `period ${p.n} must not start 1ms early`);

    const last = S.getStatus(endMs - 1);
    assert.equal(last.phase, "class");
    assert.equal(last.current.n, p.n);
    assert.equal(last.remainingMin, 1);

    const over = S.getStatus(endMs);
    assert.notEqual(over.phase, "class", `period ${p.n} must end exactly at its end time`);
  }
});

test("remaining minutes are rounded up", () => {
  assert.equal(status(FRI, "10:00:00").remainingMin, 15);
  assert.equal(status(FRI, "10:00:00.001").remainingMin, 15);
  assert.equal(status(FRI, "10:00:01").remainingMin, 15);
  assert.equal(status(FRI, "10:00:59.999").remainingMin, 15);
  assert.equal(status(FRI, "10:01:00").remainingMin, 14);
  assert.equal(status(FRI, "10:14:00").remainingMin, 1);
  assert.equal(status(FRI, "10:14:30").remainingMin, 1);
  assert.equal(status(FRI, "10:14:59.999").remainingMin, 1);
});

test("elapsed minutes are rounded down and pair with the remaining minutes", () => {
  assert.equal(status(FRI, "8:45:00").elapsedMin, 0);
  assert.equal(status(FRI, "8:45:59.999").elapsedMin, 0);
  assert.equal(status(FRI, "8:46:00").elapsedMin, 1);
  assert.equal(status(FRI, "9:30:00").elapsedMin, 45);
  assert.equal(status(FRI, "10:14:59.999").elapsedMin, 89);
  for (const time of ["8:45:00", "9:00:00", "9:58:00", "10:14:00"]) {
    const s = status(FRI, time); // on a whole minute: elapsed + remaining = 90
    assert.equal(s.elapsedMin + s.remainingMin, 90, time);
  }
  // within a minute the two differ by at most one
  const mid = status(FRI, "9:58:20");
  assert.deepEqual([mid.elapsedMin, mid.remainingMin], [73, 17]);
  // breaks count from the end of the previous class; off-hours have none
  assert.equal(status(FRI, "10:20:00").elapsedMin, 5);
  assert.equal(status(FRI, "12:15:00").elapsedMin, 0);
  assert.equal(status(FRI, "07:00:00").elapsedMin, null);
  assert.equal(status("2026-10-17", "10:00:00").elapsedMin, null);
});

test("warning turns on at 5 minutes remaining or less, only during class", () => {
  assert.equal(status(FRI, "10:09:59").remainingMin, 6);
  assert.equal(status(FRI, "10:09:59").warn, false);
  assert.equal(status(FRI, "10:10:00").remainingMin, 5);
  assert.equal(status(FRI, "10:10:00").warn, true);
  assert.equal(status(FRI, "10:14:59").warn, true);
  // 5 minutes before the next class starts is a break: no warning
  const b = status(FRI, "10:40:00");
  assert.equal(b.phase, "break");
  assert.equal(b.remainingMin, 5);
  assert.equal(b.warn, false);
});

test("progress runs 0 -> 1 across a class", () => {
  assert.equal(status(FRI, "8:45:00").progress, 0);
  assert.equal(status(FRI, "9:30:00").progress, 0.5);
  assert.ok(status(FRI, "10:14:59.999").progress > 0.999);
});

test("break between classes counts down to the next start", () => {
  const b = status(FRI, "10:15:00");
  assert.equal(b.phase, "break");
  assert.equal(b.remainingMin, 30);
  assert.equal(b.previous.n, 1);
  assert.equal(b.next.n, 2);
  assert.equal(b.startMin, S.PERIODS[0].end);
  assert.equal(b.endMin, S.PERIODS[1].start);
  assert.equal(b.progress, 0);

  assert.equal(status(FRI, "10:44:59.999").remainingMin, 1);
  assert.equal(status(FRI, "10:45:00").phase, "class");

  // lunch break
  const lunch = status(FRI, "12:15:00");
  assert.equal(lunch.phase, "break");
  assert.equal(lunch.remainingMin, 60);
  assert.equal(lunch.next.n, 3);

  // short breaks: 14:45-15:00, 16:30-16:45, 18:15-18:25, 19:55-20:05
  for (const [time, mins, next] of [["14:45", 15, 4], ["16:30", 15, 5], ["18:15", 10, 6], ["19:55", 10, 7]]) {
    const s = status(FRI, time);
    assert.equal(s.phase, "break", time);
    assert.equal(s.remainingMin, mins, time);
    assert.equal(s.next.n, next, time);
  }
});

test("outside class hours: before first, after last", () => {
  const early = status(FRI, "07:00:00");
  assert.equal(early.phase, "off");
  assert.equal(early.offReason, "before");
  assert.equal(early.next.n, 1);
  assert.equal(early.remainingMin, null);

  const justBefore = status(FRI, "08:44:59.999");
  assert.equal(justBefore.phase, "off");
  assert.equal(justBefore.offReason, "before");

  const late = status(FRI, "21:35:00");
  assert.equal(late.phase, "off");
  assert.equal(late.offReason, "after");
  assert.equal(late.next, null);

  assert.equal(status(FRI, "23:59:59.999").phase, "off");
  assert.equal(status(FRI, "00:00:00").offReason, "before");
});

test("clock text is HH:mm in JST", () => {
  assert.equal(status(FRI, "09:05:59").clock, "09:05");
  assert.equal(status(FRI, "00:00:00").clock, "00:00");
  assert.equal(status(FRI, "23:59:59").clock, "23:59");
});

test("weekends are outside class hours, even during a period's time", () => {
  const sat = status("2026-10-17", "10:00:00");
  assert.equal(sat.phase, "off");
  assert.equal(sat.offReason, "weekend");
  assert.equal(sat.schoolDay, false);
  assert.equal(status("2026-10-18", "13:30:00").offReason, "weekend");
});

test("public holidays are outside class hours", () => {
  const holidays = {
    "2026-01-01": "New Year",
    "2026-01-12": "Coming of Age (2nd Mon)",
    "2026-02-11": "National Foundation",
    "2026-02-23": "Emperor's Birthday",
    "2026-03-20": "Vernal Equinox",
    "2026-04-29": "Showa Day",
    "2026-05-04": "Greenery Day",
    "2026-05-05": "Children's Day",
    "2026-05-06": "Substitute for 5/3 (Sun)",
    "2026-07-20": "Marine Day (3rd Mon)",
    "2026-08-11": "Mountain Day",
    "2026-09-21": "Respect for the Aged (3rd Mon)",
    "2026-09-22": "Citizens' Holiday",
    "2026-09-23": "Autumnal Equinox",
    "2026-10-12": "Sports Day (2nd Mon)",
    "2026-11-03": "Culture Day",
    "2026-11-23": "Labor Thanksgiving",
  };
  for (const [date, name] of Object.entries(holidays)) {
    const s = status(date, "10:00:00");
    assert.equal(s.phase, "off", `${date} ${name}`);
    assert.ok(["holiday", "weekend"].includes(s.offReason), `${date} ${name}`);
  }
  // Ordinary weekdays next to holidays are school days
  for (const date of ["2026-10-13", "2026-11-04", "2026-11-02", "2026-11-24", "2026-05-07"]) {
    assert.equal(status(date, "10:00:00").phase, "class", date);
  }
  assert.equal(status("2026-11-03", "10:00:00").offReason, "holiday");
});

test("date change at midnight: Friday night -> Saturday", () => {
  const before = status("2026-10-16", "23:59:59.999");
  assert.deepEqual([before.time.d, before.time.wd, before.offReason], [16, 5, "after"]);
  const after = status("2026-10-17", "00:00:00");
  assert.deepEqual([after.time.d, after.time.wd, after.offReason], [17, 6, "weekend"]);
});

test("date change at midnight: Sunday night -> Monday morning", () => {
  const sun = status("2026-10-18", "23:59:59.999");
  assert.equal(sun.offReason, "weekend");
  const mon = status("2026-10-19", "00:00:00");
  assert.equal(mon.schoolDay, true);
  assert.equal(mon.phase, "off");
  assert.equal(mon.offReason, "before");
  assert.equal(status("2026-10-19", "08:45:00").phase, "class");
});

test("date change at midnight: weekday into a holiday and out again", () => {
  // Mon 2026-11-02 evening -> Tue 11-03 (Culture Day) -> Wed 11-04
  assert.equal(status("2026-11-02", "23:59:59.999").offReason, "after");
  assert.equal(status("2026-11-03", "00:00:00").offReason, "holiday");
  assert.equal(status("2026-11-03", "23:59:59.999").offReason, "holiday");
  assert.equal(status("2026-11-04", "00:00:00").offReason, "before");
});

test("date change across the new year", () => {
  const s = status("2026-12-31", "23:59:59.999");
  assert.equal(s.time.y, 2026);
  const n = status("2027-01-01", "00:00:00");
  assert.equal(n.time.y, 2027);
  assert.equal(n.offReason, "holiday");
});

test("UTC and JST dates differ: JST midnight is 15:00 UTC", () => {
  // 2026-10-16T14:59:59Z is still Friday night in JST; one second later it is Saturday.
  assert.equal(S.getStatus(Date.parse("2026-10-16T14:59:59Z")).time.wd, 5);
  assert.equal(S.getStatus(Date.parse("2026-10-16T15:00:00Z")).time.wd, 6);
  // 02:00 UTC = 11:00 JST -> 2nd period on a Friday
  assert.equal(S.getStatus(Date.parse("2026-10-16T02:00:00Z")).current.n, 2);
});
