/*
 * ClassClock - layout switch.
 *
 * Sets <html data-layout="compact|mobile">.
 *   ?mode=compact  - always the compact (Mac small window) layout
 *   ?mode=mobile   - always the mobile layout
 *   otherwise      - compact for very short / very wide windows, mobile otherwise
 */
(function () {
  "use strict";
  var html = document.documentElement;
  var forced = new URLSearchParams(location.search).get("mode");

  function pick() {
    if (forced === "compact" || forced === "mobile") return forced;
    var w = window.innerWidth;
    var h = window.innerHeight;
    return h <= 160 || w / h >= 3.2 ? "compact" : "mobile";
  }

  function apply() {
    var layout = pick();
    if (html.getAttribute("data-layout") !== layout) html.setAttribute("data-layout", layout);
  }

  apply();
  window.addEventListener("resize", apply);
})();
