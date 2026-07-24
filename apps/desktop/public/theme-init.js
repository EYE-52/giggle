/* Applies the saved theme before paint — no flash, no hydration mismatch.
   Loaded as an external beforeInteractive script so React never renders an
   inline <script> (which warns in React 19 / Next 16).
   Keep this list in sync with THEMES in components/ThemeToggle.tsx. */
(function () {
  try {
    var themes = ["dark", "light", "tangerine"];
    var t = localStorage.getItem("giggle.theme");
    if (themes.indexOf(t) < 0) t = "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
