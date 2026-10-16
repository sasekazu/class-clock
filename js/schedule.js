/*
 * ClassClock - schedule logic (pure functions, no DOM).
 *
 * Shared by the compact (Mac) and mobile layouts, and unit-tested under Node.
 * Everything is computed in Japan time (Asia/Tokyo) regardless of the device's
 * own time zone.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ClassClockSchedule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TZ = "Asia/Tokyo";

  /** Remaining minutes at or below this value switch the display to the warning colour. */
  const WARN_MINUTES = 5;

  const hm = (h, m) => h * 60 + m;

  /**
   * Standard class periods, 2026 (Tohoku Gakuin University).
   * `start` / `end` are minutes after 00:00 JST. A period covers [start, end).
   */
  const PERIODS = Object.freeze([
    { n: 1, start: hm(8, 45), end: hm(10, 15) },
    { n: 2, start: hm(10, 45), end: hm(12, 15) },
    { n: 3, start: hm(13, 15), end: hm(14, 45) },
    { n: 4, start: hm(15, 0), end: hm(16, 30) },
    { n: 5, start: hm(16, 45), end: hm(18, 15) },
    { n: 6, start: hm(18, 25), end: hm(19, 55) },
    { n: 7, start: hm(20, 5), end: hm(21, 35) },
  ].map(Object.freeze));

  const MS_PER_MIN = 60000;
  const pad = (n) => String(n).padStart(2, "0");

  /** "HH:mm" - used for the current clock. */
  const formatClock = (h, m) => `${pad(h)}:${pad(m)}`;
  /** "H:mm" from minutes after midnight - used for scheduled times. */
  const formatMinutes = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;

  // ---- JST date/time parts -------------------------------------------------

  const jstFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  /** Split an epoch-ms timestamp into JST calendar/clock parts. wd: 0=Sun..6=Sat */
  function jstParts(epochMs) {
    const o = {};
    for (const p of jstFormat.formatToParts(new Date(epochMs))) o[p.type] = p.value;
    return {
      y: +o.year,
      mo: +o.month,
      d: +o.day,
      wd: WEEKDAY_INDEX[o.weekday],
      h: +o.hour % 24,
      mi: +o.minute,
      s: +o.second,
      ms: ((epochMs % 1000) + 1000) % 1000, // JST offset is whole seconds
    };
  }

  // ---- Japanese public holidays (computed; valid for roughly 2000-2099) ----

  const holidayCache = {};

  function holidaysOf(year) {
    if (holidayCache[year]) return holidayCache[year];
    const set = new Set();
    const key = (m, d) => m * 100 + d;
    const dow = (m, d) => new Date(Date.UTC(year, m - 1, d)).getUTCDay();
    // Day-of-month of the n-th Monday.
    const nthMon = (m, n) => ((1 - dow(m, 1) + 7) % 7) + 1 + 7 * (n - 1);
    const k = year - 1980;
    const spring = Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4));
    const autumn = Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4));
    [
      [1, 1], [1, nthMon(1, 2)], [2, 11], [2, 23], [3, spring], [4, 29],
      [5, 3], [5, 4], [5, 5], [7, nthMon(7, 3)], [8, 11], [9, nthMon(9, 3)],
      [9, autumn], [10, nthMon(10, 2)], [11, 3], [11, 23],
    ].forEach(([m, d]) => set.add(key(m, d)));

    // Substitute holiday: a holiday on Sunday moves to the next non-holiday day.
    [...set].forEach((v) => {
      const m = Math.floor(v / 100);
      const d = v % 100;
      if (dow(m, d) !== 0) return;
      let t = new Date(Date.UTC(year, m - 1, d + 1));
      while (set.has(key(t.getUTCMonth() + 1, t.getUTCDate()))) t = new Date(t.getTime() + 864e5);
      set.add(key(t.getUTCMonth() + 1, t.getUTCDate()));
    });

    // Citizens' holiday: a weekday sandwiched between two holidays.
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const t = new Date(Date.UTC(year, m - 1, d));
        if (t.getUTCMonth() !== m - 1 || t.getUTCDay() === 0 || set.has(key(m, d))) continue;
        const pv = new Date(t.getTime() - 864e5);
        const nx = new Date(t.getTime() + 864e5);
        if (set.has(key(pv.getUTCMonth() + 1, pv.getUTCDate())) &&
            set.has(key(nx.getUTCMonth() + 1, nx.getUTCDate()))) set.add(key(m, d));
      }
    }
    return (holidayCache[year] = set);
  }

  const isHoliday = (y, mo, d) => holidaysOf(y).has(mo * 100 + d);

  /** 'weekend' | 'holiday' | 'weekday' for a JST date (parts from jstParts). */
  function dayType(t) {
    if (t.wd === 0 || t.wd === 6) return "weekend";
    return isHoliday(t.y, t.mo, t.d) ? "holiday" : "weekday";
  }

  // ---- Status --------------------------------------------------------------

  /**
   * Work out what the clock should show at `epochMs`.
   *
   * phase:
   *   'class' - a period is in progress           (remainingMin = until it ends)
   *   'break' - between two periods               (remainingMin = until next starts)
   *   'off'   - weekend/holiday, before the first period or after the last one
   *
   * remainingMin is rounded UP to whole minutes, so it never reads 0 while a
   * segment is still running (10:14:30 -> 1).
   */
  function getStatus(epochMs) {
    const t = jstParts(epochMs);
    const type = dayType(t);
    const schoolDay = type === "weekday";
    const nowMs = ((t.h * 60 + t.mi) * 60 + t.s) * 1000 + t.ms; // ms since JST midnight

    const status = {
      time: t,
      clock: formatClock(t.h, t.mi),
      dayType: type,
      schoolDay,
      phase: "off",
      offReason: schoolDay ? null : type, // 'weekend' | 'holiday' | 'before' | 'after'
      current: null,   // period in progress (phase 'class')
      previous: null,  // last period that has ended
      next: null,      // first period that starts after now
      startMin: null,  // start of the segment being counted (class or break)
      endMin: null,    // end of that segment
      remainingMin: null,
      progress: null,  // 0..1 elapsed within the segment
      warn: false,
    };
    if (!schoolDay) return status;

    status.current = PERIODS.find((p) => nowMs >= p.start * MS_PER_MIN && nowMs < p.end * MS_PER_MIN) || null;
    status.previous = [...PERIODS].reverse().find((p) => p.end * MS_PER_MIN <= nowMs) || null;
    status.next = PERIODS.find((p) => p.start * MS_PER_MIN > nowMs) || null;

    let startMin = null;
    let endMin = null;
    if (status.current) {
      status.phase = "class";
      startMin = status.current.start;
      endMin = status.current.end;
    } else if (status.previous && status.next) {
      status.phase = "break";
      startMin = status.previous.end;
      endMin = status.next.start;
    } else {
      status.offReason = status.next ? "before" : "after";
      return status;
    }

    status.startMin = startMin;
    status.endMin = endMin;
    status.remainingMin = Math.ceil((endMin * MS_PER_MIN - nowMs) / MS_PER_MIN);
    status.progress = (nowMs - startMin * MS_PER_MIN) / ((endMin - startMin) * MS_PER_MIN);
    status.warn = status.phase === "class" && status.remainingMin <= WARN_MINUTES;
    return status;
  }

  return {
    TZ,
    WARN_MINUTES,
    PERIODS,
    jstParts,
    isHoliday,
    dayType,
    getStatus,
    formatClock,
    formatMinutes,
  };
});
