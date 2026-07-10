/* Applies the saved theme before paint — no flash, no hydration mismatch.
   Loaded as an external beforeInteractive script so React never renders an
   inline <script> (which warns in React 19 / Next 16). */
(function () {
  try {
    var t = localStorage.getItem("giggle.theme") || "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
