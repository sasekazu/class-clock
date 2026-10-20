/*
 * ClassClock - "予定あり" marks (pure helpers, no DOM / no storage access).
 *
 * The marks are per day: the stored value remembers which date it belongs to, and
 * anything saved for another date is ignored, so tomorrow starts clean.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ClassClockMarks = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY = "classclock.marks";
  var pad = function (n) { return String(n).padStart(2, "0"); };

  /** "2026-10-16" from JST date parts (schedule.jstParts). */
  function dateKey(t) { return t.y + "-" + pad(t.mo) + "-" + pad(t.d); }

  /** Marked period numbers from a stored string; [] if missing, malformed or from another day. */
  function parse(raw, today) {
    try {
      var o = JSON.parse(raw);
      if (o && o.date === today && Array.isArray(o.periods)) {
        return o.periods.filter(function (n) { return Number.isInteger(n) && n > 0; })
          .filter(function (n, i, a) { return a.indexOf(n) === i; })
          .sort(function (a, b) { return a - b; });
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  /** New sorted list with period n added, or removed if it was there. */
  function toggle(list, n) {
    var next = list.indexOf(n) >= 0 ? list.filter(function (m) { return m !== n; }) : list.concat([n]);
    return next.sort(function (a, b) { return a - b; });
  }

  function serialize(today, list) { return JSON.stringify({ date: today, periods: list }); }

  return { KEY: KEY, dateKey: dateKey, parse: parse, toggle: toggle, serialize: serialize };
});
