/* Applies the saved look (skin + palette + mode) before paint — no flash, no
   hydration mismatch. Loaded as an external beforeInteractive script so React
   never renders an inline <script> (which warns in React 19 / Next 16).

   Mirrors lib/look.ts read logic (keep the two in sync — test/look.test.js
   asserts this file's contract):
     giggle.look  JSON {skin, palette, mode} with validation; bad values fall
                  back per-field; absent → migrate legacy giggle.theme
                  ("dark" → mode dark, "light" → mode light, else defaults).
     data-mode    the RESOLVED light/dark (auto follows prefers-color-scheme).
     data-theme   still set to the resolved light/dark so existing [data-theme]
                  CSS keeps working during the skin transition. */
(function () {
  var SKINS = ["soft", "play", "paper", "clay", "scrap"];
  var PALETTES = ["raspberry", "grape", "lagoon", "moss", "honey", "petrol"];
  var DEFAULT_LOOK = { skin: "soft", palette: "honey", mode: "auto" };

  function readLook() {
    var look = { skin: null, palette: null, mode: null };
    try {
      var raw = localStorage.getItem("giggle.look");
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        if (SKINS.indexOf(parsed.skin) >= 0) look.skin = parsed.skin;
        if (PALETTES.indexOf(parsed.palette) >= 0) look.palette = parsed.palette;
        if (parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "auto") look.mode = parsed.mode;
      }
      if (!look.skin && !look.palette && !look.mode) {
        var legacy = localStorage.getItem("giggle.theme");
        if (legacy === "dark" || legacy === "light") look.mode = legacy;
      }
    } catch (e) {}
    return { skin: look.skin || DEFAULT_LOOK.skin, palette: look.palette || DEFAULT_LOOK.palette, mode: look.mode || DEFAULT_LOOK.mode };
  }

  function resolveMode(mode) {
    if (mode === "light" || mode === "dark") return mode;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  function apply() {
    var look = readLook();
    var resolved = resolveMode(look.mode);
    var root = document.documentElement;
    root.setAttribute("data-skin", look.skin);
    root.setAttribute("data-palette", look.palette);
    root.setAttribute("data-mode", resolved);
    root.setAttribute("data-theme", resolved);
  }

  apply();
  /* Auto mode stays live even before hydration. */
  try {
    var query = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof query.addEventListener === "function") query.addEventListener("change", apply);
    else if (typeof query.addListener === "function") query.addListener(apply);
  } catch (e) {}
})();
