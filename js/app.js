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
      date: t.mo + "/" + t.d + " (" + WEEKDAYS[t.wd] + ")",
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
