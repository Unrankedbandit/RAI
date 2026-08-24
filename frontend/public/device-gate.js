/*!
 * RAI device gate — sends each visitor to the right UI and keeps the two
 * UIs interchangeable while device data changes.
 *
 *   web UI    = https://rai.josephbissell.com/      (desktop / laptop)
 *   mobile UI = https://mockup.josephbissell.com/   (phone / tablet)
 *
 * Classification combines every signal the browser gives us:
 *   UA string, UA Client Hints (navigator.userAgentData.mobile),
 *   pointer type (coarse vs fine), touch points, viewport width,
 *   and the Network Information API (connection type / effectiveType).
 *
 * The class is re-evaluated LIVE on resize / orientationchange / pointer /
 * connection change, so the UI interchanges when device data changes —
 * e.g. DevTools device emulation, a tablet rotating, a 2-in-1 detaching
 * its keyboard — not just on first connect.
 *
 * Manual override (demo control, sticky for the session):
 *   ?ui=mobile | ?ui=web     (?to= accepted as an alias)
 *
 * Viewport width ALONE never classifies a device as mobile — narrowing a
 * desktop browser window keeps the web UI. Dev convenience: no redirects
 * ever happen on localhost/127.0.0.1 (classification still runs; inspect
 * window.__deviceGate).
 *
 * CANONICAL COPY: parcel-mockup/public/device-gate.js
 * Keep rai/RAI/frontend/public/device-gate.js byte-identical.
 */
(function () {
  "use strict";

  var MOBILE_URL = "https://mockup.josephbissell.com/";
  var WEB_URL = "https://rai.josephbissell.com/";
  var MOBILE_HOSTS = { "mockup.josephbissell.com": 1, "parcel.josephbissell.com": 1 };
  var WEB_HOSTS = { "rai.josephbissell.com": 1, "www.josephbissell.com": 1 };

  var OVERRIDE_KEY = "rai.ui.override"; // sessionStorage: "mobile" | "web"
  var GUARD_KEY = "rai.gate.redirs"; // sessionStorage: {"n":count,"ts":ms}
  var GUARD_MAX = 2; // max auto-redirects...
  var GUARD_WINDOW_MS = 15000; // ...within this window
  var RECHECK_DEBOUNCE_MS = 350;

  function hostKind() {
    var h = location.hostname;
    if (MOBILE_HOSTS[h]) return "mobile";
    if (WEB_HOSTS[h]) return "web";
    return "dev"; // localhost / anything else: classify but never redirect
  }

  function readOverride() {
    try {
      var q = new URLSearchParams(location.search);
      var v = q.get("ui") || q.get("to") || "";
      v = v.toLowerCase();
      if (v === "mobile" || v === "phone" || v === "tablet") {
        sessionStorage.setItem(OVERRIDE_KEY, "mobile");
      } else if (v === "web" || v === "desktop" || v === "pc") {
        sessionStorage.setItem(OVERRIDE_KEY, "web");
      } else if (v === "auto" || v === "clear") {
        sessionStorage.removeItem(OVERRIDE_KEY);
      }
      var s = sessionStorage.getItem(OVERRIDE_KEY);
      return s === "mobile" || s === "web" ? s : null;
    } catch (e) {
      return null;
    }
  }

  // Multi-signal classifier. Positive score = mobile, negative = desktop.
  // Decision: >= +3 mobile, <= -2 desktop, in between = unsure (stay put).
  function classify() {
    var ua = navigator.userAgent || "";
    var sig = {};
    var score = 0;

    // 1) UA string (works everywhere)
    var uaMobile =
      /Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile|Mobile Safari|Kindle|Silk|PlayBook|Tablet/i.test(
        ua,
      );
    sig.uaMobile = uaMobile;
    if (uaMobile) score += 3;
    if (/Windows NT|Macintosh|X11|CrOS|Linux x86_64/i.test(ua) && !uaMobile) score -= 1;

    // 2) UA Client Hints (Chromium): high-trust boolean
    var uad = navigator.userAgentData;
    sig.uaDataMobile = uad ? !!uad.mobile : null;
    if (uad) score += uad.mobile ? 3 : -3;

    // 3) Pointer / touch (primary input mechanism)
    var coarse = false;
    var fine = false;
    try {
      coarse = window.matchMedia("(pointer: coarse)").matches;
      fine = window.matchMedia("(pointer: fine)").matches;
    } catch (e) {}
    sig.coarsePointer = coarse;
    sig.touchPoints = navigator.maxTouchPoints || 0;
    if (coarse) score += 2;
    if (fine && !coarse) score -= 1;
    if (sig.touchPoints >= 2 && coarse) score += 1;

    // 4) Viewport — only ever REINFORCES a pointer-based decision, never
    //    overrides one (a narrow desktop window is still a desktop).
    var w = window.innerWidth || 0;
    sig.viewportWidth = w;
    if (coarse && w > 0 && w < 820) score += 2;
    if (fine && !coarse && w >= 1024) score -= 1;

    // 5) Network Information API ("device data connection"): a cellular
    //    link or a 2G-class effective type is a weak mobile hint.
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    sig.connectionType = conn && conn.type ? conn.type : null;
    sig.effectiveType = conn && conn.effectiveType ? conn.effectiveType : null;
    if (conn) {
      if (conn.type === "cellular") score += 1;
      if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") score += 1;
    }

    var result = score >= 3 ? "mobile" : score <= -2 ? "desktop" : "unsure";
    return { result: result, score: score, signals: sig };
  }

  function guardAllowsRedirect() {
    try {
      var now = Date.now();
      var g = JSON.parse(sessionStorage.getItem(GUARD_KEY) || "null");
      if (!g || now - g.ts > GUARD_WINDOW_MS) g = { n: 0, ts: now };
      if (g.n >= GUARD_MAX) return false;
      g.n += 1;
      g.ts = now;
      sessionStorage.setItem(GUARD_KEY, JSON.stringify(g));
      return true;
    } catch (e) {
      return true;
    }
  }

  function targetFor(kind) {
    return kind === "mobile" ? MOBILE_URL : WEB_URL;
  }

  function wantedKind() {
    var override = readOverride();
    if (override) return { kind: override, why: "override ?ui=" + override };
    var c = classify();
    if (c.result === "unsure") return { kind: hostKind(), why: "unsure (score " + c.score + ") — staying" };
    return { kind: c.result, why: "auto score " + c.score + " " + JSON.stringify(c.signals) };
  }

  function enforce(why) {
    // Installed PWA (standalone display mode): never bounce the user out of
    // their own app — the manifest scope ends at this origin, and a redirect
    // to the other UI would tear them out of the installed experience.
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
      return;
    }
    var here = hostKind();
    var want = wantedKind();
    window.__deviceGate = { here: here, want: want.kind, why: want.why, classify: classify };
    if (here === "dev") {
      console.info("[device-gate] dev host — classification:", want.kind, "(" + want.why + "); redirects disabled");
      return;
    }
    if (want.kind === here) return;
    if (!guardAllowsRedirect()) {
      console.warn("[device-gate] redirect loop guard tripped — staying on", here, "UI (wanted:", want.kind + ")");
      return;
    }
    console.info("[device-gate]", here, "→", want.kind, "(" + want.why + ")" + (why ? " [" + why + "]" : ""));
    // Propagate a manual override so it sticks on the destination origin too
    // (otherwise its auto-classifier would bounce the visitor straight back).
    var url = targetFor(want.kind);
    if (want.why.indexOf("override") === 0) url += "?ui=" + want.kind;
    location.replace(url);
  }

  // Initial decision on connect.
  enforce("connect");

  // Live interchange: re-decide whenever device data can have changed.
  var t = null;
  function recheck(why) {
    if (t) clearTimeout(t);
    t = setTimeout(function () {
      enforce(why);
    }, RECHECK_DEBOUNCE_MS);
  }
  window.addEventListener("resize", function () { recheck("resize"); });
  window.addEventListener("orientationchange", function () { recheck("orientation"); });
  try {
    var mq = window.matchMedia("(pointer: coarse)");
    if (mq.addEventListener) mq.addEventListener("change", function () { recheck("pointer"); });
  } catch (e) {}
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.addEventListener) {
    conn.addEventListener("change", function () { recheck("connection"); });
  }
})();
