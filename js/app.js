/*
 * ClassClock - rendering.
 *
 * Both layouts (compact / mobile) are driven by the same status object from
 * schedule.js. Elements opt in with data-bind="<name>"; CSS decides which
 * layout is visible.
 *
 * Debug: ?now=2026-10-16T10:14:30+09:00 starts the clock at that moment
 * (add &freeze=1 to stop it); handy for checking layouts outside class hours.
 */
(function () {
  "use strict";

  var S = window.ClassClockSchedule;
  var SVGNS = "http://www.w3.org/2000/svg";
  var WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  // ---- time source (real clock, or ?now= for debugging) --------------------

  var params = new URLSearchParams(location.search);
  var offset = 0;
  var frozenAt = null;
  var nowParam = params.get("now");
  if (nowParam) {
    // A bare local time is read as JST.
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(nowParam)) nowParam += "+09:00";
    var parsed = Date.parse(nowParam);
    if (!isNaN(parsed)) {
      if (params.has("freeze")) frozenAt = parsed;
      else offset = parsed - Date.now();
    }
  }
  var currentTime = function () { return frozenAt !== null ? frozenAt : Date.now() + offset; };

  // ---- view model ----------------------------------------------------------

  var periodName = function (p) { return p.n + "校時"; };
  var minutesText = S.formatMinutes;

  /** Turn a schedule status into the strings each layout shows. */
  function describe(st) {
    var t = st.time;
    var v = {
      clock: st.clock,
      sec: String(t.s).padStart(2, "0"), // shown small, mobile layout only
      date: t.y + "年" + t.mo + "月" + t.d + "日（" + WEEKDAYS[t.wd] + "）",
      title: "", sub: "", range: "", remain: "", remainLabel: "",
    };

    if (st.phase === "class") {
      v.title = periodName(st.current);
      v.sub = "〜" + minutesText(st.endMin);
      v.range = minutesText(st.startMin) + " – " + minutesText(st.endMin);
      v.remainLabel = "終了まで";
      v.remain = String(st.remainingMin);
    } else if (st.phase === "break") {
      v.title = "休み時間";
      v.sub = periodName(st.next) + " " + minutesText(st.endMin) + "〜";
      v.range = "次は " + periodName(st.next) + " " + minutesText(st.endMin) + "〜";
      v.remainLabel = periodName(st.next) + "まで";
      v.remain = String(st.remainingMin);
    } else {
      v.title = st.offReason === "weekend" || st.offReason === "holiday" ? "休日" : "授業時間外";
      if (st.offReason === "before") v.sub = "次 " + periodName(st.next) + " " + minutesText(st.next.start) + "〜";
      else if (st.offReason === "after") v.sub = "本日の授業は終了";
      else v.sub = "授業はありません";
      v.range = v.sub;
    }
    return v;
  }

  // ---- DOM binding ---------------------------------------------------------

  var bound = {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-bind]"), function (el) {
    (bound[el.getAttribute("data-bind")] = bound[el.getAttribute("data-bind")] || []).push(el);
  });
  var bars = Array.prototype.slice.call(document.querySelectorAll("[data-bind-progress]"));
  var ring = document.querySelector("[data-bind-ring]");
  var cache = {};

  function setText(name, value) {
    if (cache[name] === value) return;
    cache[name] = value;
    (bound[name] || []).forEach(function (el) { el.textContent = value === "" ? "\u00a0" : value; });
  }

  function setBody(attr, value) {
    if (document.body.getAttribute(attr) !== value) document.body.setAttribute(attr, value);
  }

  // ---- ring: a gap every 30 minutes (mobile) -----------------------------------

  var RING_STEP_MIN = 30;
  var ringTicks = document.getElementById("ring-ticks");
  var ticksFor = null;

  /** Cut the ring into 30-minute arcs: a 90-minute class becomes three arcs. */
  function setRingTicks(totalMin) {
    if (ticksFor === totalMin) return;
    ticksFor = totalMin;
    while (ringTicks.firstChild) ringTicks.removeChild(ringTicks.firstChild);
    if (!totalMin) return;
    for (var m = 0; m < totalMin; m += RING_STEP_MIN) {
      var tick = document.createElementNS(SVGNS, "line");
      tick.setAttribute("x1", 170); tick.setAttribute("y1", 100);
      tick.setAttribute("x2", 200); tick.setAttribute("y2", 100);
      tick.setAttribute("class", "ring-tick");
      // the whole svg is turned -90deg in CSS, so angle 0 is 12 o'clock
      tick.setAttribute("transform", "rotate(" + (360 * m / totalMin) + " 100 100)");
      ringTicks.appendChild(tick);
    }
  }

  // ---- day timeline (mobile) ---------------------------------------------------

  var dayTl = document.querySelector("#day .tl");
  var dayLabels = document.querySelector("#day .tl-labels");
  // Only periods 1-5 are drawn in the bar (6th/7th are not shown). The clock, countdown
  // and ring still handle them; the bar just stays "all done" once period 5 is over.
  var DAY_BAR_LAST_PERIOD = 5;
  var DAY_PERIODS = S.PERIODS.filter(function (p) { return p.n <= DAY_BAR_LAST_PERIOD; });
  var DAY_START = DAY_PERIODS[0].start;
  var DAY_END = DAY_PERIODS[DAY_PERIODS.length - 1].end;
  var dayPct = function (min) { return ((min - DAY_START) / (DAY_END - DAY_START)) * 100; };

  var daySegs = DAY_PERIODS.map(function (p) {
    var seg = document.createElement("div");
    seg.className = "seg future";
    seg.style.left = dayPct(p.start) + "%";
    seg.style.width = dayPct(p.end) - dayPct(p.start) + "%";
    var fill = document.createElement("i");
    seg.appendChild(fill);
    dayTl.appendChild(seg);

    var label = document.createElement("span");
    label.textContent = p.n;
    label.style.left = (dayPct(p.start) + dayPct(p.end)) / 2 + "%";
    dayLabels.appendChild(label);
    return { p: p, seg: seg, fill: fill, label: label, state: "future" };
  });
  var dayNow = document.createElement("div");
  dayNow.className = "now";
  dayTl.appendChild(dayNow);

  function renderDay(st) {
    var t = st.time;
    var nowMin = t.h * 60 + t.mi + t.s / 60;
    daySegs.forEach(function (d) {
      var state = !st.schoolDay ? "future" : nowMin >= d.p.end ? "past" : nowMin >= d.p.start ? "cur" : "future";
      if (d.state !== state) {
        d.state = state;
        d.seg.className = "seg " + state;
        d.label.className = state === "cur" ? "cur" : "";
      }
      if (state === "cur") d.fill.style.width = (((nowMin - d.p.start) / (d.p.end - d.p.start)) * 100).toFixed(2) + "%";
      else if (d.fill.style.width) d.fill.style.width = "";
    });
    var visible = st.schoolDay && nowMin >= DAY_START && nowMin <= DAY_END;
    dayNow.style.display = visible ? "" : "none";
    if (visible) dayNow.style.left = dayPct(nowMin).toFixed(3) + "%";
  }

  // ---- render --------------------------------------------------------------

  function render() {
    var st = S.getStatus(currentTime());
    var v = describe(st);

    Object.keys(v).forEach(function (name) { setText(name, v[name]); });
    setBody("data-phase", st.phase);
    setBody("data-state", st.warn ? "warn" : st.phase);

    var p = st.progress === null ? 0 : Math.min(Math.max(st.progress, 0), 1);
    var scale = "scaleX(" + p.toFixed(4) + ")";
    bars.forEach(function (bar) { bar.style.transform = scale; });
    ring.setAttribute("stroke-dasharray", (p * 100).toFixed(2) + " 100"); // ring is pathLength=100
    setRingTicks(st.endMin === null ? 0 : st.endMin - st.startMin);
    renderDay(st);
  }

  // Re-render on every whole second (just after the boundary).
  function loop() {
    render();
    setTimeout(loop, 1000 - (currentTime() % 1000) + 8);
  }
  loop();

  // Timers are throttled in background tabs / sleeping phones: catch up at once.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") render();
  });
  window.addEventListener("pageshow", render);
  window.addEventListener("focus", render);

  // ---- Screen Wake Lock (mobile) --------------------------------------------

  var wakeBtn = document.getElementById("wake-btn");
  var wakeMsg = document.getElementById("wake-msg");
  var wakeWanted = false;
  var sentinel = null;

  function wakeUI() {
    var on = wakeWanted && sentinel !== null;
    wakeBtn.setAttribute("aria-pressed", on ? "true" : "false");
    wakeBtn.textContent = on ? "画面点灯中（タップで解除）" : "画面を点灯したままにする";
  }

  function say(text) { wakeMsg.textContent = text; }

  async function acquireWake() {
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", function () { sentinel = null; wakeUI(); });
      say("");
    } catch (e) {
      wakeWanted = false;
      sentinel = null;
      say("画面の点灯を維持できませんでした（省電力モードなどが原因の可能性があります）。");
    }
    wakeUI();
  }

  function releaseWake() {
    wakeWanted = false;
    if (sentinel) sentinel.release().catch(function () {});
    sentinel = null;
    say("");
    wakeUI();
  }

  if (!("wakeLock" in navigator)) {
    wakeBtn.disabled = true;
    wakeBtn.textContent = "画面の点灯維持は使えません";
    say(window.isSecureContext === false
      ? "この機能は HTTPS で開いた場合のみ使えます。端末の自動ロック設定を長くしてください。"
      : "このブラウザは画面スリープ防止に対応していません。端末の自動ロック設定を長くしてください。");
  } else {
    wakeBtn.addEventListener("click", function () {
      if (wakeWanted) { releaseWake(); return; }
      wakeWanted = true;
      acquireWake();
    });
    // The browser drops the lock when the page is hidden; take it again on return.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && wakeWanted && !sentinel) acquireWake();
    });
  }
})();
